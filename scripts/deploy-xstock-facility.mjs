import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';
import solc from 'solc';
import { MARKETS, XLAYER } from '../src/markets.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const symbol = process.argv[2];
const market = MARKETS[symbol];

if (process.env.RUN_VADIUM_MAINNET !== '1') {
  throw new Error('Set RUN_VADIUM_MAINNET=1 to deploy a paused xStock facility on X Layer mainnet');
}
if (!market) throw new Error('Usage: node scripts/deploy-xstock-facility.mjs NVDAx|TSLAx');

const privateKeys = fs.readFileSync(path.join(root, '.env.local'), 'utf8')
  .split(/\r?\n/)
  .filter((line) => line.startsWith('DEPLOYER_PRIVATE_KEY=') && line.length > 'DEPLOYER_PRIVATE_KEY='.length)
  .map((line) => line.slice('DEPLOYER_PRIVATE_KEY='.length).trim().replace(/^['"]|['"]$/g, ''));
if (!privateKeys.length) throw new Error('A non-empty DEPLOYER_PRIVATE_KEY is required');

const provider = new ethers.JsonRpcProvider(XLAYER.rpcUrl, XLAYER.chainId, { staticNetwork: true });
const network = await provider.getNetwork();
if (network.chainId !== BigInt(XLAYER.chainId)) throw new Error(`Expected X Layer mainnet (${XLAYER.chainId})`);
const wallet = new ethers.Wallet(privateKeys.at(-1), provider);
if (await provider.getBalance(wallet.address) === 0n) throw new Error('No OKB available for deployment gas');

const wrapperAbi = [
  'function asset() view returns (address)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function convertToAssets(uint256) view returns (uint256)',
];
const tokenAbi = ['function symbol() view returns (string)', 'function decimals() view returns (uint8)'];

async function issuerJson(pathName) {
  const response = await fetch(`https://api.xstocks.fi/api/v2${pathName}`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Issuer API ${pathName}: HTTP ${response.status}`);
  return response.json();
}

const [asset, usdg] = await Promise.all([
  issuerJson(`/public/assets/${symbol}`),
  new ethers.Contract(XLAYER.usdg, tokenAbi, provider),
]);
const deployment = asset.deployments?.find((entry) => entry.network === 'XLayer');
if (!deployment?.address || !deployment.wrapperAddressV2) throw new Error(`${symbol}: issuer did not return an X Layer V2 wrapper`);
if (deployment.address.toLowerCase() !== market.token) {
  throw new Error(`${symbol}: issuer token ${deployment.address} does not match src/markets.js`);
}
if (deployment.wrapperAddressV2.toLowerCase() !== market.wrapper) {
  throw new Error(`${symbol}: issuer wrapper ${deployment.wrapperAddressV2} does not match src/markets.js`);
}

const wrapper = new ethers.Contract(market.wrapper, wrapperAbi, provider);
const token = new ethers.Contract(market.token, tokenAbi, provider);
const [underlying, wrapperDecimals, wrapperSymbol, tokenSymbol, usdgSymbol, usdgDecimals, tokenCode, wrapperCode, usdgCode] = await Promise.all([
  wrapper.asset(), wrapper.decimals(), wrapper.symbol(), token.symbol(), usdg.symbol(), usdg.decimals(),
  provider.getCode(market.token), provider.getCode(market.wrapper), provider.getCode(XLAYER.usdg),
]);
if ([tokenCode, wrapperCode, usdgCode].some((code) => code === '0x')) throw new Error(`${symbol}: token, wrapper, or USDG code is missing`);
if (underlying.toLowerCase() !== market.token) throw new Error(`${symbol}: wrapper.asset() does not match the issuer token`);
if (tokenSymbol.toLowerCase() !== symbol.toLowerCase()) throw new Error(`${symbol}: unexpected token symbol ${tokenSymbol}`);
if (usdgSymbol !== 'USDG') throw new Error(`Unexpected stable symbol ${usdgSymbol}`);
const backing = await wrapper.convertToAssets(10n ** BigInt(wrapperDecimals));
if (backing <= 0n) throw new Error(`${symbol}: wrapper convertToAssets is zero`);

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

const terms = market.terms;
const debtCeiling = ethers.parseUnits(terms.debtCeilingUsdg, Number(usdgDecimals));
console.log(`Deploying paused ${symbol} / USDG facility from ${wallet.address}. Borrow and supply start paused.`);
const oracle = await deploy('MarketRiskOracle.sol', 'MarketRiskOracle', [wallet.address, terms.oracleTtlSeconds]);
await (await oracle.setPublisher(wallet.address, true)).wait();
const pool = await deploy('VadiumPool.sol', 'VadiumPool', [
  XLAYER.usdg,
  market.wrapper,
  await oracle.getAddress(),
  market.token,
  terms.baseBorrowLtvBps,
  terms.liquidationLtvBps,
  terms.closedSessionFactorBps,
  terms.minFreshnessBps,
  terms.minLiquidityBps,
  terms.liquidationBonusBps,
  debtCeiling,
]);
const pauseTx = await pool.setRiskPause(true, true);
await pauseTx.wait();

const receipt = {
  network: 'X Layer Mainnet',
  chainId: XLAYER.chainId,
  marketMode: 'integration',
  demoAssets: false,
  symbol,
  deployer: wallet.address,
  stable: XLAYER.usdg,
  stableSymbol: usdgSymbol,
  collateral: market.wrapper,
  collateralSymbol: wrapperSymbol,
  underlyingCollateral: market.token,
  underlyingSymbol: tokenSymbol,
  oracle: await oracle.getAddress(),
  pool: await pool.getAddress(),
  borrowPaused: true,
  supplyPaused: true,
  pauseTransaction: pauseTx.hash,
  terms,
  warning: 'Paused integration deployment. Not an open lending market. Do not route public deposits here.',
};
const file = path.join(root, 'deployments', `xlayer-mainnet-${symbol.toLowerCase()}.json`);
fs.writeFileSync(file, JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt, null, 2));
console.log(`Wrote ${file}. Leave deployment-config.js on the testnet demo until a reviewed live market exists.`);
