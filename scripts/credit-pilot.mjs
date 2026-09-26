import fs from 'node:fs';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import solc from 'solc';
import ganache from 'ganache';

// A complete rehearsal with worthless assets and a MOCK report verifier.
// This runner never connects to mainnet or changes the public app configuration.
const testnet = process.argv.includes('--testnet');
if (process.argv.includes('--resume') && !testnet) throw new Error('Only persistent testnet runs can resume');
const root = new URL('../', import.meta.url);
const outputFile = new URL(`deployments/credit-pilot.${testnet ? 'testnet' : 'local'}.json`, root);
let local;
let provider;
let owner;
if (testnet) {
  // Match the existing deployment convention: last nonempty key wins.
  const keys = fs.readFileSync(new URL('.env.local', root), 'utf8').split(/\r?\n/)
    .filter(line => line.startsWith('DEPLOYER_PRIVATE_KEY='))
    .map(line => line.slice('DEPLOYER_PRIVATE_KEY='.length).trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
  provider = new ethers.JsonRpcProvider('https://testrpc.xlayer.tech', undefined, { batchMaxCount: 1 });
  assert.equal(BigInt(await provider.send('eth_chainId', [])), 1952n, 'Testnet only');
  owner = new ethers.NonceManager(new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY || keys.at(-1), provider));
  assert.ok(await provider.getBalance(await owner.getAddress()) > 0n, 'Testnet deployer needs faucet OKB');
} else {
  local = ganache.provider({ logging: { quiet: true }, chain: { chainId: 1337 } });
  provider = new ethers.BrowserProvider(local);
  owner = await provider.getSigner(0);
}
provider.pollingInterval = 500;
const prior = process.argv.includes('--resume') ? JSON.parse(fs.readFileSync(outputFile, 'utf8')) : null;
assert.ok(!prior || prior.chainId === (testnet ? 1952 : 1337), 'Resume network mismatch');
const records = prior?.transactions || [];
const addresses = prior?.addresses || {};
let confirmedBlock = records.at(-1)?.block;
// Public RPC load balancers can return an older "latest" state immediately after a receipt.
const originalSend = provider.send.bind(provider);
provider.send = async (method, params) => {
  const request = method === 'eth_call' && confirmedBlock && params[1] === 'latest'
    ? [params[0], ethers.toQuantity(confirmedBlock)] : params;
  for (let attempt = 0; ; attempt++) {
    try { return await originalSend(method, request); }
    catch (error) {
      if (method !== 'eth_call' || attempt >= 5 || !String(error.info?.responseBody).includes('block is out of range')) throw error;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
};
const save = (state, extra = {}) => fs.writeFileSync(outputFile, JSON.stringify({
  state, network: testnet ? 'X Layer testnet' : 'Local Ganache',
  chainId: testnet ? 1952 : 1337, mockAssets: true, mockVerifier: true,
  warning: 'Rehearsal only. Does not prove real Chainlink signature verification or mainnet readiness.',
  addresses, transactions: records, ...extra,
}, null, 2));
async function send(label, pending) {
  const previous = records.find(record => record.label === label);
  if (previous) return provider.getTransactionReceipt(previous.hash);
  const tx = await pending();
  const receipt = await tx.wait();
  assert.equal(receipt.status, 1, label);
  records.push({ label, hash: tx.hash, block: receipt.blockNumber });
  confirmedBlock = receipt.blockNumber;
  save('running');
  console.log(label);
  return receipt;
}
try {
  const sources = Object.fromEntries(fs.readdirSync(new URL('contracts/', root))
    .filter(name => name.endsWith('.sol'))
    .map(name => [name, { content: fs.readFileSync(new URL(`contracts/${name}`, root), 'utf8') }]));
  const compiled = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources,
    settings: { evmVersion: 'paris', optimizer: { enabled: true, runs: 200 },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } })));
  const errors = (compiled.errors || []).filter(e => e.severity === 'error');
  assert.equal(errors.length, 0, errors.map(e => e.formattedMessage).join('\n'));
  async function deploy(name, args = [], label = name) {
    const a = compiled.contracts[`${name}.sol`][name];
    if (addresses[label] && records.some(record => record.label === `Deploy ${label}`)) {
      return new ethers.Contract(addresses[label], a.abi, owner);
    }
    const contract = await new ethers.ContractFactory(a.abi, a.evm.bytecode.object, owner).deploy(...args);
    addresses[label] = await contract.getAddress();
    await send(`Deploy ${label}`, () => contract.deploymentTransaction());
    return contract;
  }
  const account = await owner.getAddress();
  const borrower = testnet ? owner : await provider.getSigner(1);
  const lender = testnet ? owner : await provider.getSigner(2);
  const borrowerAddress = await borrower.getAddress();
  const lenderAddress = await lender.getAddress();
  const E = ethers.parseEther;
  const U = value => ethers.parseUnits(value, 6);
  const gas = testnet ? {} : { gasLimit: 1_500_000 }; // Ganache underestimates accrual paths.
  const stable = await deploy('MockERC20', ['Pilot demo USDG', 'dUSDG', 6], 'stable');
  const stock = await deploy('MockERC20', ['Pilot demo equity', 'dEQUITY', 18], 'underlying');
  const wrapper = await deploy('MockWrapper', [stock.target, E('1.2')]);
  const verifier = await deploy('MockStreamsVerifier');
  const feedId = ethers.id('vadium-rehearsal-only');
  // Pool looks up risk by collateral wrapper; the report price is per underlying unit.
  const oracle = await deploy('VerifiedMarketRiskOracle', [verifier.target, feedId, wrapper.target, 3600, 7200, 1800]);
  const pool = await deploy('VadiumCreditPool', [stable.target, wrapper.target, oracle.target,
    stock.target, 4000, 6000, 5000, 7000, 5000, 500, 1000, U('10')]);
  await send('Authorize rehearsal publisher', () => oracle.setPublisher(account, true));
  await send('Mint demo liquidity', () => stable.mint(lenderAddress, U('2')));
  await send('Mint demo repayment reserve', () => stable.mint(borrowerAddress, U('0.1')));
  await send('Mint demo collateral', () => stock.mint(borrowerAddress, E('0.012')));
  await send('Approve demo supply', () => stable.connect(lender).approve(pool.target, U('2')));
  await send('Supply 2 dUSDG', () => pool.connect(lender).supply(U('2'), gas));
  await send('Approve wrapping', () => stock.connect(borrower).approve(wrapper.target, E('0.012')));
  const wrapReceipt = await send('Wrap 0.012 demo equity', () => wrapper.connect(borrower).deposit(E('0.012'), borrowerAddress));
  assert.equal(await wrapper.balanceOf(borrowerAddress, { blockTag: wrapReceipt.blockNumber }), E('0.01'));
  await send('Approve collateral', () => wrapper.connect(borrower).approve(pool.target, E('0.01')));
  await send('Deposit wrapped collateral', () => pool.connect(borrower).depositCollateral(E('0.01')));
  const block = await provider.getBlock('latest');
  const type = 'tuple(bytes32,uint32,uint32,uint192,uint192,uint32,uint64,int192,uint32,int192,int192,uint32,int192)';
  const report = ethers.AbiCoder.defaultAbiCoder().encode([type], [[feedId, block.timestamp,
    block.timestamp, 0, 0, block.timestamp + 3600, BigInt(block.timestamp) * 1_000_000_000n,
    E('200'), 2, E('1'), 0, 0, E('200')]]);
  const payload = ethers.toUtf8Bytes('MOCK-REPORT-REHEARSAL');
  await send('Load mock v10 report', () => verifier.allow(payload, report));
  await send('Publish through report adapter', () => oracle.publishVerified(payload, 10000, ethers.keccak256(report)));
  await assert.rejects(oracle.publishVerified.staticCall(payload, 10000, ethers.keccak256(report)));
  await send('Draw 0.5 dUSDG', () => pool.connect(borrower).borrow(U('0.5'), gas));
  if (!testnet) {
    await provider.send('evm_increaseTime', [86400]);
    await provider.send('evm_mine', []);
    confirmedBlock = Number(await originalSend('eth_blockNumber', []));
  }
  const debtBeforeRepayment = await pool.debtOf(borrowerAddress);
  if (!records.some(record => record.label === 'Repay principal and interest during pause')) {
    assert.ok(debtBeforeRepayment >= U('0.5'));
  }
  if (!testnet) assert.ok(debtBeforeRepayment > U('0.5'), 'Interest must accrue');
  await send('Pause new credit and supplies', () => pool.setRiskPause(true, true));
  await assert.rejects(pool.connect(borrower).borrow.staticCall(1n));
  await send('Approve bounded full repayment', () => stable.connect(borrower).approve(pool.target, U('0.6')));
  const repayment = await send('Repay principal and interest during pause', () => pool.connect(borrower).repay(U('0.6'), gas));
  const repaid = repayment.logs.map(log => { try { return pool.interface.parseLog(log); } catch { return null; } })
    .find(log => log?.name === 'Repaid').args.amount;
  assert.equal(await pool.debtOf(borrowerAddress), 0n);
  await send('Withdraw all collateral', () => pool.connect(borrower).withdrawCollateral(E('0.01'), gas));
  await send('Unwrap all shares', () => wrapper.connect(borrower).redeem(E('0.01'), borrowerAddress, borrowerAddress));
  const shares = await pool.liquidityShares(lenderAddress);
  const redemption = await send('Redeem lender principal and earnings', () => pool.connect(lender).withdrawLiquidity(shares, gas));
  const returned = redemption.logs.map(log => { try { return pool.interface.parseLog(log); } catch { return null; } })
    .find(log => log?.name === 'LiquidityWithdrawn').args.assets;
  assert.equal(returned, U('2') + repaid - U('0.5'), 'Lender receives exact realized interest');
  assert.equal(await stock.balanceOf(borrowerAddress), E('0.012'));
  assert.equal(await wrapper.balanceOf(borrowerAddress), 0n);
  assert.equal(await pool.collateralOf(borrowerAddress), 0n);
  assert.equal(await pool.totalDebt(), 0n);
  assert.equal(await stable.balanceOf(pool.target), 0n);
  save('passed', { reconciliation: { borrowed: '0.5', repaid: ethers.formatUnits(repaid, 6),
    lenderReturned: ethers.formatUnits(returned, 6), finalDebt: '0', finalCollateral: '0',
    underlyingReturned: '0.012', finalPoolCash: '0' } });
  console.log(`PASS: full credit round trip. Evidence: ${outputFile.pathname}`);
} catch (error) {
  save('failed', { error: error.shortMessage || error.message });
  throw error;
} finally {
  await provider.destroy();
  if (local) await local.disconnect();
}
