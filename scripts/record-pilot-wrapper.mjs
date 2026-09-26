import fs from 'node:fs';
import { ethers } from 'ethers';
import config from '../private-pilot-config.js';
import { XLAYER } from '../src/markets.js';

// Read-only companion evidence: ERC-4626 wrap/unwrap receipts for the participant.
const credit = JSON.parse(fs.readFileSync('deployments/private-pilot.onchain-evidence.json', 'utf8'));
const startBlock = credit.events.find(x => x.event === 'LiquiditySupplied')?.block;
if (!startBlock || credit.pool !== config.pool) throw Error('Matching pilot supply evidence required');
const request = new ethers.FetchRequest(XLAYER.rpcUrl);
request.timeout = 15000;
const provider = new ethers.JsonRpcProvider(request, undefined, { batchMaxCount: 1, cacheTimeout: -1 });
const sendRpc = provider.send.bind(provider);
provider.send = async (...args) => {
  for (let attempt = 0; ; attempt++) {
    try { return await sendRpc(...args); }
    catch (error) { if (attempt >= 2) throw error; }
  }
};
const abi = new ethers.Interface([
  'event Deposit(address indexed sender,address indexed owner,uint256 assets,uint256 shares)',
  'event Withdraw(address indexed sender,address indexed receiver,address indexed owner,uint256 assets,uint256 shares)',
]);
try {
  if (Number((await provider.getNetwork()).chainId) !== 196) throw Error('Wrong chain');
  const endBlock = await provider.getBlockNumber();
  const events = [];
  for (let start = startBlock; start <= endBlock; start += 100) {
    let logs;
    for (let attempt = 0; ; attempt++) {
      try {
        logs = await provider.getLogs({ address: config.collateral, fromBlock: start, toBlock: Math.min(start + 99, endBlock), topics: [[abi.getEvent('Deposit').topicHash, abi.getEvent('Withdraw').topicHash], ethers.zeroPadValue(config.participant,32)] });
        break;
      } catch (error) { if (attempt >= 2) throw error; }
    }
    for (const log of logs) {
      const event = abi.parseLog(log);
      if (event.args.owner.toLowerCase() !== config.participant.toLowerCase()) continue;
      if (event.name === 'Withdraw' && event.args.receiver.toLowerCase() !== config.participant.toLowerCase()) continue;
      events.push({ event: event.name, hash: log.transactionHash, block: log.blockNumber, index: log.index, assets: event.args.assets.toString(), shares: event.args.shares.toString(), topics: log.topics, data: log.data });
    }
  }
  const receipts = [];
  for (const hash of new Set(events.map(x => x.hash))) {
    const receipt = await provider.getTransactionReceipt(hash);
    receipts.push({ hash, status: receipt.status, block: receipt.blockNumber, gasUsed: receipt.gasUsed.toString(), feeWei: receipt.fee.toString() });
  }
  const deposits = events.filter(x => x.event === 'Deposit');
  const withdrawals = events.filter(x => x.event === 'Withdraw');
  const sum = (entries, field) => entries.reduce((n,x) => n + BigInt(x[field]),0n);
  const closed = deposits.length > 0 && withdrawals.length > 0 && receipts.every(x => x.status === 1) && sum(deposits,'shares') === sum(withdrawals,'shares') && withdrawals.at(-1).block >= deposits[0].block;
  const evidence = { at: new Date().toISOString(), chainId: 196, participant: config.participant, wrapper: config.collateral, startBlock, endBlock, wrapperRoundTripVerified: closed, depositedAssets: sum(deposits,'assets').toString(), returnedAssets: sum(withdrawals,'assets').toString(), roundingDifferenceAtomic: (sum(deposits,'assets')-sum(withdrawals,'assets')).toString(), events, receipts };
  fs.writeFileSync('deployments/private-pilot.wrapper-evidence.json', JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify(evidence));
} finally { provider.destroy(); }
