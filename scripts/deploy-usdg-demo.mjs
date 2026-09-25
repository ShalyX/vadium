import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';
import solc from 'solc';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (process.env.RUN_VADIUM_MAINNET !== '1') {
  throw new Error('Set RUN_VADIUM_MAINNET=1 to deploy the USDG demo on X Layer mainnet');
}

const privateKeys = fs.readFileSync(path.join(root, '.env.local'), 'utf8')
  .split(/\r?\n/)
  .filter((line) => line.startsWith('DEPLOYER_PRIVATE_KEY=') && line.length > 'DEPLOYER_PRIVATE_KEY='.length)
  .map((line) => line.slice('DEPLOYER_PRIVATE_KEY='.length).trim().replace(/^['"]|['"]$/g, ''));
if (!privateKeys.length) throw new Error('A non-empty DEPLOYER_PRIVATE_KEY is required');

const rpcUrl = 'https://rpc.xlayer.tech';
const chainId = 196n;
const usdgAddress = '0x4ae46a509F6b1D9056937BA4500cb143933D2dc8';
const provider = new ethers.JsonRpcProvider(rpcUrl);
const network = await provider.getNetwork();
if (network.chainId !== chainId) throw new Error(`Expected X Layer mainnet (196), received ${network.chainId}`);
const wallet = new ethers.Wallet(privateKeys.at(-1), provider);
if (await provider.getBalance(wallet.address) === 0n) throw new Error('No OKB available for deployment gas');

const contractsDir = path.join(root, 'contracts');
const sources = Object.fromEntries(
  fs.readdirSync(contractsDir).map((name) => [name, { content: fs.readFileSync(path.join(contractsDir, name), 'utf8') }]),
);
const output = JSON.parse(solc.compile(JSON.stringify({
  language: 'Solidity',
  sources,
  settings: {
    evmVersion: 'paris',
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  },
})));
const errors = (output.errors ?? []).filter((issue) => issue.severity === 'error');
if (errors.length) throw new Error(errors.map((issue) => issue.formattedMessage).join('\n'));

async function deploy(file, name, args = []) {
  const artifact = output.contracts[file][name];
  const contract = await new ethers.ContractFactory(artifact.abi, artifact.evm.bytecode.object, wallet).deploy(...args);
  await contract.waitForDeployment();
  console.log(`${name}: ${await contract.getAddress()}`);
  return contract;
}

console.log(`Deploying real-USDG Vadium demo from ${wallet.address} on X Layer mainnet...`);
const stock = await deploy('MockERC20.sol', 'MockERC20', ['Apple xStock Demo', 'AAPLx', 18]);
const oracle = await deploy('MarketRiskOracle.sol', 'MarketRiskOracle', [wallet.address, 6 * 3600]);
await (await oracle.setPublisher(wallet.address, true)).wait();
const pool = await deploy('VadiumPool.sol', 'VadiumPool', [
  usdgAddress,
  await stock.getAddress(),
  await oracle.getAddress(),
  ethers.ZeroAddress,
  6_500,
  8_000,
  7_500,
  5_000,
  3_000,
  500,
  ethers.parseUnits('1000', 6),
]);

await (await stock.mint(wallet.address, ethers.parseUnits('1', 18))).wait();
const block = await provider.getBlock('latest');
const inputBlob = ethers.toUtf8Bytes(JSON.stringify({
  source: 'OKX paid candles',
  asset: 'AAPLx',
  price: '335.37967664914356',
  observedAt: '2026-09-25T14:00:00Z',
}));
const riskTx = await oracle.publish(await stock.getAddress(), {
  price: ethers.parseUnits('335.37967664914356', 18),
  freshnessBps: 10_000,
  liquidityBps: 10_000,
  asOf: block.timestamp,
  state: 0,
  inputsHash: ethers.keccak256(inputBlob),
});
const riskReceipt = await riskTx.wait();

const deployment = {
  network: 'X Layer Mainnet',
  chainId: Number(chainId),
  rpcUrl,
  explorer: 'https://www.okx.com/web3/explorer/xlayer',
  deployer: wallet.address,
  stable: usdgAddress,
  stableSymbol: 'USDG',
  collateral: await stock.getAddress(),
  collateralSymbol: 'AAPLx Demo',
  oracle: await oracle.getAddress(),
  pool: await pool.getAddress(),
  initialRiskTransaction: riskTx.hash,
  initialRiskBlock: riskReceipt.blockNumber,
};
fs.writeFileSync(path.join(root, 'deployments', 'xlayer-mainnet-usdg.json'), JSON.stringify(deployment, null, 2));
console.log(JSON.stringify(deployment, null, 2));
