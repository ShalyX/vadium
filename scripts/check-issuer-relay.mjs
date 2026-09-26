import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { ethers } from 'ethers';
import { MARKETS } from '../src/markets.js';
import { evaluateIssuerPrice, fetchIssuerJson, unavailableRisk } from './issuer-price-model.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const symbols = process.argv.slice(2).length ? process.argv.slice(2) : ['NVDAx','TSLAx'];
if (symbols.some(s => !['NVDAx','TSLAx'].includes(s))) throw Error('Usage: npm run check:issuer -- [NVDAx TSLAx]');
const runId = `${new Date().toISOString().replaceAll(':','-')}-${randomUUID()}`;
const directory = path.join(root,'deployments','issuer-relay',runId);
fs.mkdirSync(directory,{recursive:true});
const iface = new ethers.Interface(['function publish(address,(uint128 price,uint16 freshnessBps,uint16 liquidityBps,uint64 asOf,uint8 state,bytes32 inputsHash))']);
const summary = [];
for (const symbol of symbols) {
  const base = `https://api.xstocks.fi/api/v2/public/assets/${symbol}`;
  const [metadata, price] = await Promise.all([fetchIssuerJson(base),fetchIssuerJson(`${base}/price-data`)]);
  const raw = { symbol, metadata, price };
  const rawJson = JSON.stringify(raw);
  const inputsHash = ethers.keccak256(ethers.toUtf8Bytes(rawJson));
  // Save exact hash preimage, including raw HTTP bodies, before preparing any calldata.
  fs.writeFileSync(path.join(directory,`${symbol}.inputs.json`),rawJson);
  const result = metadata.error || price.error
    ? { publishable:false, trustModel:'operator-relayed-unsigned-issuer-api', indicativePrice18:null, sourceObservedAt:null,
        reasons:[...(metadata.error ? [`METADATA_${metadata.error}`] : []),...(price.error ? [`PRICE_${price.error}`] : [])] }
    : evaluateIssuerPrice({market:{...MARKETS[symbol],symbol},metadata:metadata.data,priceResponse:price.data});
  const risk = unavailableRisk(Math.floor(Date.now()/1000),inputsHash);
  const record = { symbol, chainId:196, collateral:MARKETS[symbol].wrapper, ...result, inputsHash,
    outageDraft:risk, outageCalldata:iface.encodeFunctionData('publish',[MARKETS[symbol].wrapper,risk]),
    mode:'dry-run', transactionSent:false, oracleAddress:null,
    note:'Outage calldata only. No price publication, key loading or existing oracle change. Recompute timestamp against chain before any future authorized submission.' };
  fs.writeFileSync(path.join(directory,`${symbol}.decision.json`),JSON.stringify(record,null,2)+'\n');
  summary.push(record);
  console.log(`${symbol}: unavailable — ${result.reasons.join(', ')}; no transaction sent.`);
}
fs.writeFileSync(path.join(root,'deployments','issuer-relay.latest.json'),JSON.stringify({runId,directory:path.relative(root,directory),results:summary},null,2)+'\n');
console.log(`Saved raw inputs and decisions: deployments/issuer-relay/${runId}`);
