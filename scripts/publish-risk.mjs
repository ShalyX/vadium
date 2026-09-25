import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';
import { freshnessBps, liquidityAt, localParts } from './risk-model.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (match && match[2].trim()) process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
}

loadEnv(path.join(root, '.env.local'));
loadEnv(path.join(root, '.env'));
if (!process.env.DEPLOYER_PRIVATE_KEY) throw new Error('DEPLOYER_PRIVATE_KEY is required');

const deploymentPath = path.resolve(root, process.env.DEPLOYMENT_FILE || './deployments/demo.local.json');
if (!fs.existsSync(deploymentPath)) throw new Error(`Deployment manifest not found: ${deploymentPath}`);
const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
if (deployment.chainId === 196 && process.env.RUN_VADIUM_MAINNET !== '1') {
  throw new Error('Mainnet risk publication requires RUN_VADIUM_MAINNET=1');
}
if (deployment.chainId === 196 && !deployment.underlyingCollateral) {
  throw new Error('Mainnet manifest must name a verified non-rebasing wrapper and its underlying collateral');
}
const provider = new ethers.JsonRpcProvider(deployment.rpcUrl);
const network = await provider.getNetwork();
if (Number(network.chainId) !== deployment.chainId) throw new Error('Deployment and RPC chain IDs differ');
const latestBlock = await provider.getBlock('latest');
const ticker = process.env.TICKER || 'AAPL';
if (!process.env.TOKEN_DATA) throw new Error('TOKEN_DATA must point to a current, licensed candle dataset');
const dataPath = path.resolve(root, process.env.TOKEN_DATA);
const token = JSON.parse(fs.readFileSync(dataPath, 'utf8'))[ticker];
if (!token?.hourly?.length) throw new Error(`No hourly data for ${ticker}`);
if (deployment.chainId === 196 && token.address?.toLowerCase() !== deployment.underlyingCollateral?.toLowerCase()) {
  throw new Error('Candle dataset asset does not match the mainnet wrapper underlying');
}

const now = latestBlock.timestamp;
const rows = token.hourly.filter(([ts, price, volume = 0]) =>
  Number.isSafeInteger(ts) && ts <= now && Number.isFinite(price) && Number.isFinite(volume)).sort((a, b) => a[0] - b[0]);
const genuine = rows.filter(([, price, volume = 0]) => price > 0 && volume > 0).at(-1);
if (!genuine) throw new Error(`No confirmed non-zero-volume observation for ${ticker}`);
const [lastAsOf, lastPrice] = genuine;
const freshness = freshnessBps(now - lastAsOf);
const candleSlot = Math.floor(now / 3600) * 3600;
const liquidity = liquidityAt(rows, candleSlot).scoreBps;
const local = localParts(now);
const weekday = !['Sat', 'Sun'].includes(local.dow);
const minuteOfDay = local.hour * 60 + local.minute;
const open = weekday && minuteOfDay >= 9 * 60 + 30 && minuteOfDay < 16 * 60;
const halted = freshness === 0 || liquidity === 0;

const rawInputs = {
  ticker, tokenAddress: token.address, lastPrice, lastAsOf, publishedAt: now,
  freshnessBps: freshness, liquidityBps: liquidity,
  marketState: halted ? 'unavailable' : open ? 'open' : 'closed',
  volumeModel: '6h trailing / median same hour-of-week over 8 weeks',
};
const blob = ethers.toUtf8Bytes(JSON.stringify(rawInputs));
const update = halted
  ? { price: 0, freshnessBps: 0, liquidityBps: 0, asOf: now, state: 2, inputsHash: ethers.keccak256(blob) }
  : { price: ethers.parseUnits(String(lastPrice), 18), freshnessBps: freshness, liquidityBps: liquidity, asOf: now, state: open ? 0 : 1, inputsHash: ethers.keccak256(blob) };

const wallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
const oracle = new ethers.Contract(deployment.oracle, [
  'function publish(address,(uint128 price,uint16 freshnessBps,uint16 liquidityBps,uint64 asOf,uint8 state,bytes32 inputsHash))',
], wallet);
const publicationDir = path.join(root, 'deployments', 'risk-publications');
fs.mkdirSync(publicationDir, { recursive: true });
const publicationPath = path.join(publicationDir, `${deployment.chainId}-${ticker}-${now}.json`);
fs.writeFileSync(publicationPath, JSON.stringify({ deployment: path.basename(deploymentPath), rawInputs, update }, null, 2));
const transaction = await oracle.publish(deployment.collateral, update);
console.log(`Publishing ${rawInputs.marketState} risk for ${ticker}: ${transaction.hash}`);
const receipt = await transaction.wait();
if (receipt?.status !== 1) throw new Error('Risk publication failed onchain');
fs.writeFileSync(publicationPath, JSON.stringify({ deployment: path.basename(deploymentPath), rawInputs, update, transaction: transaction.hash }, null, 2));
console.log(JSON.stringify(rawInputs, null, 2));
