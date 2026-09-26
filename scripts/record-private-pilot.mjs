import fs from 'node:fs';
import { ethers } from 'ethers';
import config from '../private-pilot-config.js';
import { XLAYER } from '../src/markets.js';

if (!config.pool) throw Error('No deployed pilot');
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
try {
  if (Number((await provider.getNetwork()).chainId) !== 196) throw Error('Wrong chain');
  const block = await provider.getBlockNumber();
  const opt = { blockTag: block };
  const pool = new ethers.Contract(config.pool, config.abi, provider);
  const abi = ['function balanceOf(address) view returns(uint256)'];
  const stable = new ethers.Contract(config.stable, abi, provider);
  const wrapper = new ethers.Contract(config.collateral, abi, provider);
  const underlying = new ethers.Contract(config.underlying, abi, provider);
  const current = { debt: await pool.debtOf(config.participant,opt), collateral: await pool.collateralOf(config.participant,opt), lenderShares: await pool.liquidityShares(config.participant,opt), poolCash: await stable.balanceOf(config.pool,opt), walletUsdg: await stable.balanceOf(config.participant,opt), walletWrapped: await wrapper.balanceOf(config.participant,opt), walletUnderlying: await underlying.balanceOf(config.participant,opt), suppliedLifetime: await pool.suppliedLifetime(opt) };
  const fromBlock = config.transactions.find(x => x.key === 'pool').block;
  const events = [];
  // Bounded RPC ranges; event receipts are the independent evidence of activity.
  for (let start = fromBlock; start <= block; start += 100) {
    const logs = await provider.getLogs({ address: config.pool, fromBlock: start, toBlock: Math.min(start + 99, block) });
    for (const log of logs) {
      const parsed = pool.interface.parseLog(log);
      events.push({ hash: log.transactionHash, block: log.blockNumber, index: log.index, event: parsed?.name, args: parsed ? [...parsed.args].map(x => typeof x === 'bigint' ? x.toString() : x) : [], topics: log.topics, data: log.data });
    }
  }
  const receipts = [];
  for (const hash of new Set([...config.transactions.map(x => x.hash), ...events.map(x => x.hash)])) {
    const receipt = await provider.getTransactionReceipt(hash);
    receipts.push({ hash, status: receipt.status, block: receipt.blockNumber, gasUsed: receipt.gasUsed.toString(), gasPrice: receipt.gasPrice.toString(), feeWei: receipt.fee.toString(), contractAddress: receipt.contractAddress });
  }
  const completed = ['Borrowed','Repaid','CollateralWithdrawn','LiquidityWithdrawn'].every(name => events.some(x => x.event === name)) && current.debt === 0n && current.collateral === 0n && current.lenderShares === 0n;
  const evidence = { at: new Date().toISOString(), chainId: 196, block, pool: config.pool, participant: config.participant, syntheticPrice: true, creditCycleCompleted: completed, wrapperRoundTripVerifiedByThisRecorder: false, balancesAtomic: Object.fromEntries(Object.entries(current).map(([k,v]) => [k,v.toString()])), events, receipts };
  fs.writeFileSync('deployments/private-pilot.onchain-evidence.json', JSON.stringify(evidence,null,2) + '\n');
  console.log(JSON.stringify({ pool: config.pool, block, creditCycleCompleted: completed, balancesAtomic: evidence.balancesAtomic, recordedTransactions: receipts.length }));
} finally { provider.destroy(); }
