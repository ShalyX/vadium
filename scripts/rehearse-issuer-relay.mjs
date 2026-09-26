import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';
import ganache from 'ganache';
import solc from 'solc';
import { runLocalRelay, relayAbi } from './local-issuer-relay.mjs';

export async function rehearseRelay() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vadium-relay-'));
  const chain = ganache.provider({ logging: { quiet: true }, chain: { chainId: 1337 }, wallet: { totalAccounts: 3 } });
  const provider = new ethers.BrowserProvider(chain, undefined, { cacheTimeout: -1 });
  try {
    const source = fs.readFileSync(new URL('../contracts/MarketRiskOracle.sol', import.meta.url), 'utf8');
    const compiled = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: { 'MarketRiskOracle.sol': { content: source } },
      settings: { evmVersion: 'paris', optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } })));
    const artifact = compiled.contracts['MarketRiskOracle.sol'].MarketRiskOracle;
    const owner = await provider.getSigner(0);
    const accounts = Object.values(chain.getInitialAccounts());
    const wallet = new ethers.Wallet(accounts[1].secretKey, provider);
    const asset = await (await provider.getSigner(2)).getAddress();
    const oracle = await new ethers.ContractFactory(artifact.abi, artifact.evm.bytecode.object, owner).deploy(await owner.getAddress(), 60);
    await oracle.waitForDeployment();
    await (await oracle.setPublisher(wallet.address, true)).wait();
    const journalFile = path.join(dir, 'journal.json');
    const options = { provider, wallet, oracleAddress: await oracle.getAddress(), asset, symbol: 'NVDAx', journalFile };
    const now = async () => Number(BigInt((await provider.send('eth_getBlockByNumber', ['latest', false])).timestamp));
    const advance = async (seconds = 2) => { await provider.send('evm_increaseTime', [seconds]); await provider.send('evm_mine', []); };
    const fixture = async () => ({ source: 'LOCAL_TEST_FIXTURE', symbol: 'NVDAx', priceUsd: '100', session: 'open', sourceObservedAt: await now() });
    const run = (input, extra = {}) => runLocalRelay({ ...options, input, ...extra });
    const read = () => JSON.parse(fs.readFileSync(journalFile, 'utf8'));
    const checks = [];

    // Mainnet gate runs before filesystem access, signer access or sending.
    await assert.rejects(runLocalRelay({ provider: { send: async () => '0xc4' } }), /LOCAL_ONLY/);
    checks.push('X Layer mainnet rejected before signing');
    await assert.rejects(run(await fixture(), { checkpoint: async phase => { if (phase === 'prepared') throw Error('simulated stop before broadcast'); } }), /simulated stop/);
    const prepared = read().pending.hash;
    assert.equal(await provider.getTransactionReceipt(prepared), null);
    const recovered = await run(null);
    assert.equal(recovered.hash, prepared);
    assert.equal(recovered.status, 'confirmed');
    assert.equal((await oracle.currentRisk(asset))[0], true);
    checks.push('Restart before broadcast submits the persisted transaction');

    await advance();
    await assert.rejects(run({ source: 'ISSUER_HTTP', quote: null }, { checkpoint: async phase => { if (phase === 'broadcast') throw Error('simulated lost response'); } }), /simulated lost response/);
    const broadcast = read().pending.hash;
    const nonceBefore = await provider.send('eth_getTransactionCount', [wallet.address, 'latest']);
    const outage = await run(null);
    assert.equal(outage.hash, broadcast);
    assert.equal(outage.status, 'confirmed');
    assert.equal(await provider.send('eth_getTransactionCount', [wallet.address, 'latest']), nonceBefore);
    assert.equal((await oracle.currentRisk(asset))[0], false);
    assert.equal((await run(null)).status, 'already-unavailable');
    checks.push('Lost broadcast response recovered without duplicate nonce; repeated outage sends nothing');

    await advance();
    const recoveryInput = await fixture();
    assert.equal((await run(recoveryInput)).status, 'confirmed');
    assert.equal((await oracle.currentRisk(asset))[0], true);
    await advance(61);
    assert.equal((await run(recoveryInput)).risk.state, 2);
    assert.equal((await oracle.currentRisk(asset))[0], false);
    checks.push('Fresh fixture restores availability; expired fixture publishes an outage');

    await advance();
    await assert.rejects(run(await fixture(), { checkpoint: async phase => { if (phase === 'prepared') throw Error('prepared for revoked-role test'); } }), /revoked-role/);
    await (await oracle.setPublisher(wallet.address, false)).wait();
    assert.equal((await run(null)).status, 'reverted');
    assert.equal(read().pending, null);
    await assert.rejects(run(await fixture()), /not an authorized publisher/);
    checks.push('Revoked publisher records reverted receipt and blocks new signing');
    await (await oracle.setPublisher(wallet.address, true)).wait();

    fs.writeFileSync(`${journalFile}.lock`, 'another process');
    await assert.rejects(run(null), /EEXIST/);
    fs.unlinkSync(`${journalFile}.lock`);
    await assert.rejects(run(null, { symbol: 'TSLAx' }), /Journal target mismatch/);
    checks.push('Concurrent run and mismatched journal rejected');

    await advance();
    await assert.rejects(run(await fixture(), { checkpoint: async phase => { if (phase === 'prepared') throw Error('prepare tamper check'); } }), /tamper check/);
    const original = read();
    const tampered = structuredClone(original);
    tampered.pending.risk.price = '1';
    fs.writeFileSync(journalFile, JSON.stringify(tampered));
    await assert.rejects(run(null), /Invalid pending transaction/);
    fs.writeFileSync(journalFile, JSON.stringify(original));
    assert.equal((await run(null)).status, 'confirmed');
    checks.push('Altered pending report rejected; original persisted transaction recovers');
    const journal = read();
    assert.equal(journal.pending, null);
    assert.equal(new Set(journal.receipts.map(r => r.hash)).size, journal.receipts.length);
    const risk = await new ethers.Contract(options.oracleAddress, relayAbi, provider).risks(asset);
    assert.equal(risk.inputsHash, journal.receipts.at(-1).risk.inputsHash);
    return { mode: 'LOCAL_TEST_FIXTURES_ONLY', chainId: 1337, mainnetTransactions: 0,
      generatedAt: new Date().toISOString(), binding: journal.binding, checks, receipts: journal.receipts };
  } finally {
    provider.destroy();
    await chain.disconnect();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const evidence = await rehearseRelay();
  const destination = new URL('../deployments/issuer-relay-rehearsal.json', import.meta.url);
  fs.writeFileSync(destination, JSON.stringify(evidence, null, 2) + '\n');
  console.log(`Local relay rehearsal passed: ${evidence.checks.length} scenarios, ${evidence.receipts.length} receipts. No mainnet transactions.`);
}
