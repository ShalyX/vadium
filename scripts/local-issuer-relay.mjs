import fs from 'node:fs';
import path from 'node:path';
import { ethers } from 'ethers';
import { unavailableRisk } from './issuer-price-model.mjs';

export const relayAbi = [
  'function isPublisher(address) view returns(bool)',
  'function maxAge() view returns(uint64)',
  'function risks(address) view returns(uint128 price,uint16 freshnessBps,uint16 liquidityBps,uint64 asOf,uint8 state,bytes32 inputsHash)',
  'function publish(address,(uint128 price,uint16 freshnessBps,uint16 liquidityBps,uint64 asOf,uint8 state,bytes32 inputsHash))',
  'event RiskPublished(address indexed asset,uint128 price,uint16 freshnessBps,uint16 liquidityBps,uint64 asOf,uint8 state,bytes32 inputsHash)',
];
const iface = new ethers.Interface(relayAbi);
const encode = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2);

function save(file, value) {
  const temporary = `${file}.tmp`;
  const fd = fs.openSync(temporary, 'w', 0o600);
  try { fs.writeFileSync(fd, encode(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
}

// Only the rehearsal creates positive reports. No issuer HTTP response is accepted here.
export function fixtureRisk(input, now, maxAge, previousAsOf = 0) {
  const inputsHash = ethers.keccak256(ethers.toUtf8Bytes(encode(input)));
  let price;
  try { price = typeof input?.priceUsd === 'string' ? ethers.parseUnits(input.priceUsd, 18) : 0n; } catch { price = 0n; }
  const valid = input?.source === 'LOCAL_TEST_FIXTURE' && ['NVDAx', 'TSLAx'].includes(input.symbol)
    && input.session === 'open' && price > 0n && price < 2n ** 128n
    && Number.isSafeInteger(input.sourceObservedAt) && input.sourceObservedAt > previousAsOf
    && input.sourceObservedAt <= now && now - input.sourceObservedAt <= maxAge;
  return valid
    ? { price: price.toString(), freshnessBps: 10000, liquidityBps: 10000, asOf: input.sourceObservedAt, state: 0, inputsHash }
    : unavailableRisk(now, inputsHash);
}

/** Local-chain transaction state machine. One journal per signer/asset; no remote CLI or key loading. */
export async function runLocalRelay({ provider, wallet, oracleAddress, asset, symbol, journalFile, input = null,
  checkpoint = async () => {} }) {
  // Read the actual RPC chain ID on every invocation, before signing or broadcasting.
  if (BigInt(await provider.send('eth_chainId', [])) !== 1337n) throw Error('LOCAL_ONLY: chain 1337 required; mainnet publication disabled');
  if (!['NVDAx', 'TSLAx'].includes(symbol)) throw Error('Unknown fixture market');
  oracleAddress = ethers.getAddress(oracleAddress);
  asset = ethers.getAddress(asset);
  if (asset === ethers.ZeroAddress || await provider.getCode(oracleAddress) === '0x') throw Error('Invalid local target');
  const genesis = await provider.send('eth_getBlockByNumber', ['0x0', false]);
  const binding = { chainId: 1337, genesis: genesis.hash, oracleAddress, asset, symbol, publisher: wallet.address };
  fs.mkdirSync(path.dirname(journalFile), { recursive: true });
  const lock = `${journalFile}.lock`;
  const fd = fs.openSync(lock, 'wx', 0o600);
  fs.writeFileSync(fd, encode({ pid: process.pid, startedAt: new Date().toISOString() }));
  try {
    const journal = fs.existsSync(journalFile) ? JSON.parse(fs.readFileSync(journalFile, 'utf8'))
      : { version: 1, binding, pending: null, receipts: [] };
    if (journal.version !== 1 || encode(journal.binding) !== encode(binding)) throw Error('Journal target mismatch');
    const oracle = new ethers.Contract(oracleAddress, relayAbi, provider);

    async function reconcile() {
      const pending = journal.pending;
      // Refuse tampered or mismatched persisted transactions, including a different destination.
      const tx = ethers.Transaction.from(pending.rawTransaction);
      const expectedData = iface.encodeFunctionData('publish', [asset, pending.risk]);
      if (tx.hash !== pending.hash || tx.from !== wallet.address || tx.to !== oracleAddress
          || tx.chainId !== 1337n || tx.value !== 0n || tx.data !== expectedData
          || ethers.keccak256(ethers.toUtf8Bytes(encode(pending.input))) !== pending.risk.inputsHash) throw Error('Invalid pending transaction');
      let receipt = await provider.getTransactionReceipt(pending.hash);
      if (!receipt) {
        // Broadcast exactly the persisted bytes. An ambiguous RPC failure leaves pending intact.
        try { await provider.broadcastTransaction(pending.rawTransaction); }
        catch (error) {
          receipt = await provider.getTransactionReceipt(pending.hash);
          if (!receipt) throw error;
        }
        await checkpoint('broadcast');
        receipt ??= await provider.getTransactionReceipt(pending.hash);
      }
      if (!receipt) return { status: 'pending', hash: pending.hash };
      const block = await provider.getBlock(receipt.blockNumber);
      if (block?.hash !== receipt.blockHash) throw Error('Receipt block is no longer canonical');
      const event = receipt.logs.filter(log => log.address.toLowerCase() === oracleAddress.toLowerCase())
        .map(log => { try { return iface.parseLog(log); } catch { return null; } })
        .find(log => log?.name === 'RiskPublished');
      if (receipt.status === 1 && (!event || event.args.asset !== asset
        || ['price','freshnessBps','liquidityBps','asOf','state','inputsHash'].some(key => String(event.args[key]) !== String(pending.risk[key])))) {
        throw Error('Confirmed receipt does not match the prepared report');
      }
      const record = { hash: pending.hash, nonce: tx.nonce, status: receipt.status === 1 ? 'confirmed' : 'reverted',
        blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, gasUsed: receipt.gasUsed.toString(),
        risk: pending.risk, input: pending.input };
      journal.receipts.push(record);
      journal.pending = null;
      save(journalFile, journal);
      return record;
    }
    // Recovery always precedes new input. A caller must explicitly run the next tick afterward.
    if (journal.pending) return await reconcile();
    if (!await oracle.isPublisher(wallet.address)) throw Error('Local signer is not an authorized publisher');
    const block = await provider.send('eth_getBlockByNumber', ['latest', false]);
    const now = Number(BigInt(block.timestamp));
    const previous = await oracle.risks(asset);
    const maxAge = Number(await oracle.maxAge());
    const risk = fixtureRisk(input?.symbol === symbol ? input : null, now, maxAge, Number(previous.asOf));
    // Preserve the exact original input as the evidence preimage, including invalid input.
    risk.inputsHash = ethers.keccak256(ethers.toUtf8Bytes(encode(input)));
    if (risk.state === 2 && previous.state === 2n) return { status: 'already-unavailable' };
    if (risk.asOf <= Number(previous.asOf)) return { status: 'waiting-for-next-block-time' };
    const data = iface.encodeFunctionData('publish', [asset, risk]);
    const nonce = Number(BigInt(await provider.send('eth_getTransactionCount', [wallet.address, 'pending'])));
    const gasPrice = BigInt(await provider.send('eth_gasPrice', []));
    const rawTransaction = await wallet.signTransaction({ to: oracleAddress, data, nonce, chainId: 1337,
      type: 0, gasPrice, gasLimit: 300000, value: 0 });
    journal.pending = { hash: ethers.keccak256(rawTransaction), rawTransaction, risk, input };
    save(journalFile, journal);
    await checkpoint('prepared');
    return await reconcile();
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}
