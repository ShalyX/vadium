import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (process.env.RUN_VADIUM_MAINNET !== '1') {
  throw new Error('Set RUN_VADIUM_MAINNET=1 to execute the real-USDG mainnet demo');
}

const privateKeys = fs.readFileSync(path.join(root, '.env.local'), 'utf8')
  .split(/\r?\n/)
  .filter((line) => line.startsWith('DEPLOYER_PRIVATE_KEY=') && line.length > 'DEPLOYER_PRIVATE_KEY='.length)
  .map((line) => line.slice('DEPLOYER_PRIVATE_KEY='.length).trim().replace(/^['"]|['"]$/g, ''));
if (!privateKeys.length) throw new Error('A non-empty DEPLOYER_PRIVATE_KEY is required');

const deployment = JSON.parse(fs.readFileSync(path.join(root, 'deployments', 'xlayer-mainnet-usdg.json'), 'utf8'));
if (deployment.chainId !== 196 || deployment.stableSymbol !== 'USDG') {
  throw new Error('Demo runner requires the X Layer mainnet USDG deployment');
}

const provider = new ethers.JsonRpcProvider(deployment.rpcUrl);
const wallet = new ethers.Wallet(privateKeys.at(-1), provider);
if (wallet.address.toLowerCase() !== deployment.deployer.toLowerCase()) {
  throw new Error('Configured key does not match deployment owner');
}

const erc20Abi = [
  'function approve(address,uint256) returns(bool)',
  'function balanceOf(address) view returns(uint256)',
];
const poolAbi = [
  'function supply(uint256) returns(uint256)',
  'function withdrawLiquidity(uint256) returns(uint256)',
  'function liquidityShares(address) view returns(uint256)',
  'function depositCollateral(uint256)',
  'function borrow(uint256)',
  'function repay(uint256) returns(uint256)',
  'function withdrawCollateral(uint256)',
  'function borrowCapacity(address) view returns(uint256)',
  'function debtOf(address) view returns(uint256)',
  'function collateralOf(address) view returns(uint256)',
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
const liquidityAmount = ethers.parseUnits('0.01', 6);
const borrowAmount = ethers.parseUnits('0.005', 6);
const collateralAmount = ethers.parseUnits('0.01', 18);
const startingUsdg = await stable.balanceOf(wallet.address);
if (startingUsdg < liquidityAmount) throw new Error('Wallet needs at least 0.01 USDG for the reversible demo');

const transactions = [];
async function send(label, promise) {
  const tx = await promise;
  console.log(`${label}: ${tx.hash}`);
  const receipt = await tx.wait();
  if (receipt.status !== 1) throw new Error(`${label} failed`);
  transactions.push({ label, hash: tx.hash, block: receipt.blockNumber });
  return receipt;
}

let [, risk] = await oracle.currentRisk(deployment.collateral);
let block = await provider.getBlock('latest');
if (risk.state !== 0n || Number(risk.asOf) + 21_600 < block.timestamp) {
  const restoreInputs = ethers.toUtf8Bytes(JSON.stringify({ scenario: 'restore-open-before-usdg-demo' }));
  const receipt = await send('restore open market', oracle.publish(deployment.collateral, {
    price: risk.price || ethers.parseUnits('335.37967664914356', 18),
    freshnessBps: 10_000,
    liquidityBps: 10_000,
    asOf: block.timestamp,
    state: 0,
    inputsHash: ethers.keccak256(restoreInputs),
  }));
  [, risk] = await oracle.currentRisk(deployment.collateral, { blockTag: receipt.blockNumber });
}

await send('approve 0.01 USDG liquidity', stable.approve(deployment.pool, liquidityAmount));
await send('supply 0.01 USDG', pool.supply(liquidityAmount));
await send('approve AAPLx collateral', stock.approve(deployment.pool, collateralAmount));
const depositReceipt = await send('deposit 0.01 AAPLx', pool.depositCollateral(collateralAmount));
const openCapacity = await pool.borrowCapacity(wallet.address, { blockTag: depositReceipt.blockNumber });
await send('borrow 0.005 USDG', pool.borrow(borrowAmount));

block = await provider.getBlock('latest');
const closedReceipt = await send('publish closed market', oracle.publish(deployment.collateral, {
  price: risk.price,
  freshnessBps: risk.freshnessBps,
  liquidityBps: risk.liquidityBps,
  asOf: block.timestamp,
  state: 1,
  inputsHash: ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify({ scenario: 'mainnet-usdg-market-closed' }))),
}));
const closedCapacity = await pool.borrowCapacity(wallet.address, { blockTag: closedReceipt.blockNumber });

block = await provider.getBlock('latest');
const unavailableReceipt = await send('publish unavailable market', oracle.publish(deployment.collateral, {
  price: 0,
  freshnessBps: 0,
  liquidityBps: 0,
  asOf: block.timestamp,
  state: 2,
  inputsHash: ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify({ scenario: 'mainnet-usdg-data-unavailable' }))),
}));
const pausedMultiplierBps = await pool.creditMultiplierBps({ blockTag: unavailableReceipt.blockNumber });

await send('approve 0.005 USDG repayment', stable.approve(deployment.pool, borrowAmount));
await send('repay 0.005 USDG while paused', pool.repay(borrowAmount));
await send('withdraw 0.01 AAPLx', pool.withdrawCollateral(collateralAmount));
const shares = await pool.liquidityShares(wallet.address);
await send('withdraw supplied USDG', pool.withdrawLiquidity(shares));

block = await provider.getBlock('latest');
const finalRiskReceipt = await send('restore open market', oracle.publish(deployment.collateral, {
  price: risk.price,
  freshnessBps: 10_000,
  liquidityBps: 10_000,
  asOf: block.timestamp,
  state: 0,
  inputsHash: ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify({ scenario: 'mainnet-usdg-demo-complete' }))),
}));

const result = {
  network: deployment.network,
  wallet: wallet.address,
  stable: { symbol: 'USDG', address: deployment.stable },
  pool: deployment.pool,
  supplied: '0.01',
  borrowed: '0.005',
  openCapacity: ethers.formatUnits(openCapacity, 6),
  closedCapacity: ethers.formatUnits(closedCapacity, 6),
  pausedMultiplierBps: Number(pausedMultiplierBps),
  finalDebt: ethers.formatUnits(await pool.debtOf(wallet.address, { blockTag: finalRiskReceipt.blockNumber }), 6),
  finalCollateral: ethers.formatUnits(await pool.collateralOf(wallet.address, { blockTag: finalRiskReceipt.blockNumber }), 18),
  startingUsdg: ethers.formatUnits(startingUsdg, 6),
  endingUsdg: ethers.formatUnits(await stable.balanceOf(wallet.address, { blockTag: finalRiskReceipt.blockNumber }), 6),
  transactions,
};
fs.writeFileSync(path.join(root, 'deployments', 'loan-demo-usdg.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
