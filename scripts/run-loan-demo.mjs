import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.resolve(root, '../work/contract-review/package.json'));
const { ethers } = require('ethers');

if (process.env.RUN_VADIUM_DEMO !== '1') throw new Error('Set RUN_VADIUM_DEMO=1 to execute the testnet transaction sequence');

const envLines = fs.readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/);
const privateKeys = envLines
  .filter((line) => line.startsWith('DEPLOYER_PRIVATE_KEY=') && line.length > 'DEPLOYER_PRIVATE_KEY='.length)
  .map((line) => line.slice('DEPLOYER_PRIVATE_KEY='.length));
if (!privateKeys.length) throw new Error('A non-empty DEPLOYER_PRIVATE_KEY is required');

const deployment = JSON.parse(fs.readFileSync(path.join(root, 'deployments', 'xlayer-testnet.json'), 'utf8'));
if (deployment.chainId !== 1952) throw new Error('The demo runner is restricted to X Layer testnet');
const provider = new ethers.JsonRpcProvider(deployment.rpcUrl);
const wallet = new ethers.Wallet(privateKeys.at(-1), provider);
if (wallet.address.toLowerCase() !== deployment.deployer.toLowerCase()) throw new Error('Configured key does not match deployment owner');

const erc20Abi = [
  'function approve(address,uint256) returns(bool)',
  'function balanceOf(address) view returns(uint256)',
];
const poolAbi = [
  'function depositCollateral(uint256)', 'function borrow(uint256)', 'function repay(uint256) returns(uint256)',
  'function withdrawCollateral(uint256)', 'function borrowCapacity(address) view returns(uint256)',
  'function debtOf(address) view returns(uint256)', 'function collateralOf(address) view returns(uint256)',
  'function creditMultiplierBps() view returns(uint256)',
];
const oracleAbi = [
  'function currentRisk(address) view returns(bool,(uint128 price,uint16 freshnessBps,uint16 liquidityBps,uint64 asOf,uint8 state,bytes32 inputsHash))',
  'function publish(address,(uint128 price,uint16 freshnessBps,uint16 liquidityBps,uint64 asOf,uint8 state,bytes32 inputsHash))',
];
const stable = new ethers.Contract(deployment.stable, erc20Abi, wallet);
const stock = new ethers.Contract(deployment.collateral, erc20Abi, wallet);
const pool = new ethers.Contract(deployment.pool, poolAbi, wallet);
const oracle = new ethers.Contract(deployment.oracle, oracleAbi, wallet);
const collateralAmount = ethers.parseUnits('10', 18);
const borrowAmount = ethers.parseUnits('1000', 6);
const transactions = [];

async function send(label, promise) {
  const tx = await promise;
  console.log(`${label}: ${tx.hash}`);
  const receipt = await tx.wait();
  if (receipt.status !== 1) throw new Error(`${label} failed`);
  transactions.push({ label, hash: tx.hash, block: receipt.blockNumber });
}

const [available, liveRisk] = await oracle.currentRisk(deployment.collateral);
if (!available || liveRisk.state !== 0n) throw new Error('Start the demo from a healthy open oracle state');
if (await stock.balanceOf(wallet.address) < collateralAmount) throw new Error('Insufficient demo AAPLx');

await send('approve AAPLx', stock.approve(deployment.pool, collateralAmount));
await send('deposit 10 AAPLx', pool.depositCollateral(collateralAmount));
const openCapacity = await pool.borrowCapacity(wallet.address);
await send('borrow 1,000 dUSD', pool.borrow(borrowAmount));

let block = await provider.getBlock('latest');
const closedInputs = ethers.toUtf8Bytes(JSON.stringify({ scenario: 'demo-market-closed', sourceAsOf: Number(liveRisk.asOf) }));
await send('publish closed market', oracle.publish(deployment.collateral, {
  price: liveRisk.price, freshnessBps: liveRisk.freshnessBps, liquidityBps: liveRisk.liquidityBps,
  asOf: block.timestamp, state: 1, inputsHash: ethers.keccak256(closedInputs),
}));
const closedCapacity = await pool.borrowCapacity(wallet.address);

block = await provider.getBlock('latest');
const haltInputs = ethers.toUtf8Bytes(JSON.stringify({ scenario: 'demo-data-unavailable' }));
await send('publish unavailable market', oracle.publish(deployment.collateral, {
  price: 0, freshnessBps: 0, liquidityBps: 0, asOf: block.timestamp,
  state: 2, inputsHash: ethers.keccak256(haltInputs),
}));
const pausedMultiplier = await pool.creditMultiplierBps();

await send('approve dUSD repayment', stable.approve(deployment.pool, borrowAmount));
await send('repay 1,000 dUSD while paused', pool.repay(borrowAmount));
await send('withdraw 10 AAPLx while debt-free', pool.withdrawCollateral(collateralAmount));

const result = {
  wallet: wallet.address,
  openCapacity: ethers.formatUnits(openCapacity, 6),
  closedCapacity: ethers.formatUnits(closedCapacity, 6),
  pausedMultiplierBps: Number(pausedMultiplier),
  finalDebt: ethers.formatUnits(await pool.debtOf(wallet.address), 6),
  finalCollateral: ethers.formatUnits(await pool.collateralOf(wallet.address), 18),
  transactions,
};
fs.writeFileSync(path.join(root, 'deployments', 'loan-demo.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
