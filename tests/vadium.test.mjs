import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';
import ganache from 'ganache';
import solc from 'solc';
import { calculateCoverage } from '../src/coverage.js';
import { repaymentPlan } from '../src/repayment.js';
import { injectedWallet, switchWalletNetwork, assertWalletSession } from '../src/wallet.js';
import { INTEGRATION_TERMS, MARKETS, XLAYER } from '../src/markets.js';
import { pilotActions, pilotPosition } from '../src/pilot-state.js';
import { evaluateIssuerPrice, fetchIssuerJson, unavailableRisk } from '../scripts/issuer-price-model.mjs';

test('issuer relay rejects null quotes, unknown schema and unprovable price age', () => {
  const market = {...MARKETS.NVDAx, symbol:'NVDAx'};
  const metadata = {symbol:'NVDAx',underlying:{currency:'USD'},isTradingHalted:false,
    trading:{currency:'USD',isTradingHalted:false,openNow:true,currentPeriod:'market'},
    deployments:[{network:'XLayer',address:market.token,wrapperAddressV2:market.wrapper}]};
  const evaluate = priceResponse => evaluateIssuerPrice({market,metadata,priceResponse});
  assert.ok(evaluate({quote:null}).reasons.includes('QUOTE_UNAVAILABLE'));
  for (const quote of [0,-1,'100',Infinity,NaN]) assert.ok(evaluate({quote}).reasons.includes('INVALID_QUOTE'));
  const quote = evaluate({quote:150.25, timestamp:Date.now(), signature:'pretend'});
  assert.equal(quote.indicativePrice18,E(150.25).toString());
  assert.equal(quote.sourceObservedAt,null);
  assert.equal(quote.publishable,false);
  assert.deepEqual(quote.reasons,['SOURCE_OBSERVATION_TIME_UNAVAILABLE']);
  assert.ok(evaluateIssuerPrice({market,metadata:{...metadata,symbol:'TSLAx'},priceResponse:{quote:100}}).reasons.includes('ASSET_IDENTITY_MISMATCH'));
  assert.ok(evaluateIssuerPrice({market,metadata:{...metadata,deployments:{}},priceResponse:{quote:100}}).reasons.includes('ASSET_IDENTITY_MISMATCH'));
  assert.ok(evaluateIssuerPrice({market,metadata:{...metadata,deployments:[{network:'XLayer',address:123,wrapperAddressV2:null}]},priceResponse:{quote:100}}).reasons.includes('ASSET_IDENTITY_MISMATCH'));
  assert.ok(evaluateIssuerPrice({market,metadata:{...metadata,trading:{...metadata.trading,openNow:false,currentPeriod:'closed'}},priceResponse:{quote:100}}).reasons.includes('MARKET_CLOSED'));
});

test('issuer HTTP pipeline records errors instead of producing fallback prices', async () => {
  const url = 'https://api.xstocks.fi/api/v2/public/assets/NVDAx/price-data';
  const get = response => fetchIssuerJson(url,{fetchImpl:async()=>response});
  assert.equal((await get(new Response('{"quote":null}'))).data.quote,null);
  assert.equal((await get(new Response('not JSON'))).error,'MALFORMED_JSON');
  assert.equal((await get(new Response('[]'))).error,'INVALID_RESPONSE');
  const limited = await get(new Response('rate limited',{status:429,headers:{'retry-after':'60'}}));
  assert.equal(limited.error,'HTTP_ERROR');
  assert.equal(limited.headers['retry-after'],'60');
  assert.equal((await fetchIssuerJson(url,{fetchImpl:async()=>{throw new DOMException('timeout','TimeoutError');}})).error,'TIMEOUT');
});

test('issuer outage draft blocks credit increases but preserves repayment, top-up and exit', async () => {
  const f = await creditFixture();
  const who = await f.borrower.getAddress();
  await (await f.facility.connect(f.borrower).borrow(E(100),{gasLimit:1000000})).wait();
  await f.provider.send('evm_increaseTime',[5]);
  await f.provider.send('evm_mine',[]);
  const now = Number.parseInt((await f.provider.send('eth_getBlockByNumber',['latest',false])).timestamp,16);
  const raw = ethers.toUtf8Bytes('{"quote":null}');
  const risk = unavailableRisk(now,ethers.keccak256(raw));
  await (await f.oracle.connect(f.publisher).publish(await f.stock.getAddress(),risk,{gasLimit:1000000})).wait();
  assert.equal(await f.oracle.verifyInputs(await f.stock.getAddress(),raw),true);
  assert.equal(await f.facility.borrowCapacity(who),0n);
  await assert.rejects(f.facility.connect(f.borrower).borrow.staticCall(E(1)));
  assert.equal(await f.facility.isLiquidatable(who),false);
  await (await f.facility.connect(f.borrower).depositCollateral(E(1),{gasLimit:1000000})).wait();
  await (await f.stable.mint(who,E(1))).wait();
  await (await f.stable.connect(f.borrower).approve(await f.facility.getAddress(),E(101))).wait();
  await (await f.facility.connect(f.borrower).repay(E(101),{gasLimit:1000000})).wait();
  await (await f.facility.connect(f.borrower).withdrawCollateral(E(11),{gasLimit:1000000})).wait();
  assert.equal(await f.facility.debtOf(who),0n);
  assert.equal(await f.facility.collateralOf(who),0n);
});

test('completed private position cannot restart preparation after its lifetime supply is redeemed', () => {
  const state = { supplied: 20000n, lender: 0n, cash: 0n, debt: 0n, collateral: 0n, wrapped: 0n, raw: 100000n, wrapAmount: 100n, balance: 100000n, capacity: 0n, active: true };
  assert.equal(pilotPosition(state).title, 'Position closed');
  assert.ok(Object.values(pilotActions(state)).every(x => x === false));
  assert.equal(pilotActions({ ...state, wrapped: 100n }).unwrap, true);
  assert.equal(pilotActions({ ...state, wrapped: 100n }).deposit, false);
});

test('private desk preserves exit controls after expiry or pause', () => {
  const state = { supplied: 20000n, lender: 20000n, cash: 15000n, debt: 5001n, collateral: 100n, wrapped: 0n, raw: 100000n, wrapAmount: 100n, balance: 100000n, capacity: 25000n, active: false };
  assert.equal(pilotActions(state).repay, true);
  assert.equal(pilotActions(state).borrow, false);
  assert.equal(pilotActions(state).withdraw, false);
  assert.equal(pilotActions({ ...state, debt: 0n }).withdraw, true);
  assert.equal(pilotActions({ ...state, debt: 0n }).redeem, true);
  assert.equal(pilotActions({ ...state, debt: 0n, collateral: 0n, wrapped: 100n }).unwrap, true);
});

const here = path.dirname(fileURLToPath(import.meta.url));
function compile() {
  const contractsDir = path.resolve(here, '../contracts');
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
  const errors = (output.errors ?? []).filter((entry) => entry.severity === 'error');
  assert.deepEqual(errors, [], errors.map((entry) => entry.formattedMessage).join('\n'));
  return output.contracts;
}

const contracts = compile();
const artifact = (file, name) => contracts[file][name];
const E = (value) => ethers.parseUnits(String(value), 18);

test('private pilot enforces every financial entry, lifetime cap, debt cap and expired-price exit', async () => {
  const rpc = ganache.provider({ logging: { quiet: true } });
  const provider = new ethers.BrowserProvider(rpc);
  const pilot = await provider.getSigner(0);
  const stranger = await provider.getSigner(1);
  const who = await pilot.getAddress();
  const stable = await deploy('MockERC20', 'MockERC20.sol', pilot, ['USDG test', 'USDG', 6]);
  const stock = await deploy('MockERC20', 'MockERC20.sol', pilot, ['NVDA test', 'NVDAx', 18]);
  const wrapper = await deploy('MockWrapper', 'MockWrapper.sol', pilot, [await stock.getAddress(), E(1.2)]);
  const oracle = await deploy('PrivatePilotPrice', 'VadiumPrivatePilot.sol', pilot, [await wrapper.getAddress(), E(100)]);
  const pool = await deploy('VadiumPrivatePilot', 'VadiumPrivatePilot.sol', pilot, [await stable.getAddress(), await wrapper.getAddress(), await oracle.getAddress(), await stock.getAddress(), who]);
  const address = await pool.getAddress();
  for (const [method, args] of [['supply', [1]], ['withdrawLiquidity', [1]], ['depositCollateral', [1]], ['withdrawCollateral', [1]], ['borrow', [1]], ['repay', [1]], ['liquidate', [who, 1]], ['writeOffBadDebt', [who]]]) {
    await assert.rejects(pool.connect(stranger)[method].staticCall(...args), /PrivateParticipantOnly/);
  }
  const send = async (contract, method, ...args) => (await contract[method](...args, { gasLimit: 2000000 })).wait();
  await send(stable, 'mint', who, 21000);
  await send(stock, 'mint', who, E(0.001));
  await send(stable, 'approve', address, 21000);
  await send(pool, 'supply', 20000);
  await assert.rejects(pool.supply.staticCall(1), /PilotCapExceeded/);
  await send(stock, 'approve', await wrapper.getAddress(), E(0.001));
  await send(wrapper, 'deposit', E(0.001), who);
  const wrapped = await wrapper.balanceOf(who);
  await send(wrapper, 'approve', address, wrapped);
  await send(pool, 'depositCollateral', wrapped - 1n);
  await assert.rejects(pool.borrow.staticCall(10001), /DebtCeilingExceeded/);
  await send(pool, 'borrow', 5000);
  await send(pool, 'setRiskPause', true, true);
  await rpc.request({ method: 'evm_increaseTime', params: [8 * 86400] });
  await rpc.request({ method: 'evm_mine', params: [] });
  assert.equal((await oracle.currentRisk(await wrapper.getAddress()))[0], false);
  await assert.rejects(pool.borrow.staticCall(1), /PilotExpired/);
  await send(pool, 'depositCollateral', 1);
  const debt = await pool.debtOf(who);
  assert.ok(debt > 5000n);
  await send(stable, 'approve', address, 6000);
  await send(pool, 'repay', 6000);
  assert.equal(await pool.debtOf(who), 0n);
  await send(pool, 'withdrawCollateral', wrapped);
  await send(wrapper, 'redeem', wrapped, who, who);
  await send(pool, 'withdrawLiquidity', await pool.liquidityShares(who));
  assert.equal(await pool.collateralOf(who), 0n);
  assert.equal(await stable.balanceOf(address), 0n);
  assert.equal(await stable.balanceOf(who), 21000n);
  assert.ok(E(0.001) - await stock.balanceOf(who) <= 1n);
  await provider.destroy();
  await rpc.disconnect();
});

test('wallet detection supports OKX-only injection and falls back to a standard EVM wallet', () => {
  const okx = { request() {} };
  const standard = { request() {} };
  assert.equal(injectedWallet({ okxwallet: okx }), okx);
  assert.equal(injectedWallet({ okxwallet: okx, ethereum: standard }), okx);
  assert.equal(injectedWallet({ okxwallet: {}, ethereum: standard }), standard);
  assert.equal(injectedWallet({}), undefined);
});

test('wallet adds an unknown X Layer network then explicitly switches and verifies it', async () => {
  let chain = '0x1';
  let added = false;
  const calls = [];
  const wallet = { async request({ method, params }) {
    calls.push(method);
    if (method === 'eth_chainId') return chain;
    if (method === 'wallet_addEthereumChain') {
      assert.equal(params[0].chainId, '0xc4');
      added = true;
    }
    if (method === 'wallet_switchEthereumChain') {
      if (!added) throw { data: { originalError: { code: 4902 } } };
      chain = params[0].chainId;
    }
  } };
  await switchWalletNetwork(wallet, XLAYER);
  assert.deepEqual(calls, ['eth_chainId', 'wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_switchEthereumChain', 'eth_chainId']);
});

test('wallet fails closed on rejected or ineffective switches and changed signing accounts', async () => {
  const rejected = { async request({ method }) {
    if (method === 'eth_chainId') return '0x1';
    throw { code: 4001 };
  } };
  await assert.rejects(switchWalletNetwork(rejected, XLAYER), (error) => error.code === 4001);
  const ineffective = { async request({ method }) { if (method === 'eth_chainId') return '0x1'; } };
  await assert.rejects(switchWalletNetwork(ineffective, XLAYER), /did not switch/);
  const wallet = { async request({ method }) { return method === 'eth_accounts' ? ['0xABC'] : '0xc4'; } };
  await assertWalletSession(wallet, '0xabc', 196);
  await assert.rejects(assertWalletSession(wallet, '0xdef', 196), /changed/);
  await assert.rejects(assertWalletSession(wallet, '0xabc', 1952), /changed/);
});

test('repayment review preserves atomic debt and distinguishes partial payment from wallet shortfall', () => {
  const partial = repaymentPlan(1_000_000_001n, 400_000_000n, 400_000_000n);
  assert.equal(partial.payment, 400_000_000n);
  assert.equal(partial.remaining, 600_000_001n);
  assert.equal(partial.shortfall, 600_000_001n);
  assert.equal(partial.canRepayFull, false);
  assert.equal(partial.valid, true);
  const full = repaymentPlan(E(1) + 1n, E(2), E(2));
  assert.equal(full.payment, E(1) + 1n);
  assert.equal(full.remaining, 0n);
  assert.equal(full.canRepayFull, true);
  assert.equal(full.valid, true);
});

test('repayment review rejects empty, unfunded, and invalid amounts', () => {
  assert.equal(repaymentPlan(0n, E(1), E(1)).valid, false);
  assert.equal(repaymentPlan(E(1), E(1), 0n).valid, false);
  assert.equal(repaymentPlan(E(1), 0n, E(1)).valid, false);
  assert.throws(() => repaymentPlan(-1n, 0n, 0n), RangeError);
  assert.throws(() => repaymentPlan(1, 0n, 0n), RangeError);
});

test('coverage shows the correct cushion and price for a six-decimal USDG loan', () => {
  const position = calculateCoverage({
    debt: 1_000_000_000n, underlyingAmount: E(10), price: E(200),
    underlyingDecimals: 18, stableDecimals: 6, liquidationLtvBps: 8_000n,
  });
  assert.equal(position.stableValue, 2_000_000_000n);
  assert.equal(position.threshold, 1_600_000_000n);
  assert.equal(position.buffer, 600_000_000n);
  assert.equal(position.ltvBps, 5_000n);
  assert.equal(position.priceAtThreshold, E(125));
  assert.equal(position.liquidatable, false);
  const breach = calculateCoverage({
    debt: 1_600_000_001n, underlyingAmount: E(10), price: E(200),
    underlyingDecimals: 18, stableDecimals: 6, liquidationLtvBps: 8_000n,
  });
  assert.equal(breach.liquidatable, true);
});

async function creditFixture() {
  const f = await fixture();
  const facility = await deploy('VadiumCreditPool', 'VadiumCreditPool.sol', f.owner, [
    await f.stable.getAddress(), await f.stock.getAddress(), await f.oracle.getAddress(),
    ethers.ZeroAddress, 6_500, 8_000, 7_500, 5_000, 3_000, 500, 1_000, E(1_000_000),
  ]);
  await (await f.stable.connect(f.lender).approve(await facility.getAddress(), E(100_000))).wait();
  await (await f.stock.connect(f.borrower).approve(await facility.getAddress(), E(100))).wait();
  await f.publish();
  await (await facility.connect(f.lender).supply(E(20_000), { gasLimit: 1_000_000 })).wait();
  await (await facility.connect(f.borrower).depositCollateral(E(10))).wait();
  return { ...f, facility };
}

test('Credit facility accrues borrower interest into lender share value', async () => {
  const f = await creditFixture();
  const borrower = await f.borrower.getAddress();
  await (await f.facility.connect(f.borrower).borrow(E(1_000), { gasLimit: 1_000_000 })).wait();
  await f.provider.send('evm_increaseTime', [365 * 24 * 3600]);
  await f.provider.send('evm_mine', []);
  const debt = await f.facility.debtOf(borrower);
  assert.ok(debt > E(1_105) && debt < E(1_106));
  assert.ok((await f.facility.totalAssets()) > E(20_105));
  await (await f.stable.mint(borrower, E(200))).wait();
  await (await f.stable.connect(f.borrower).approve(await f.facility.getAddress(), E(2_000))).wait();
  await (await f.facility.connect(f.borrower).repay(E(2_000), { gasLimit: 1_000_000 })).wait();
  assert.equal(await f.facility.debtOf(borrower), 0n);
  const shares = await f.facility.liquidityShares(await f.lender.getAddress());
  const cashBefore = await f.stable.balanceOf(await f.lender.getAddress());
  await (await f.facility.connect(f.lender).withdrawLiquidity(shares, { gasLimit: 1_000_000 })).wait();
  assert.ok((await f.stable.balanceOf(await f.lender.getAddress())) - cashBefore > E(20_105));
});

test('Credit facility records lender loss when exhausted collateral cannot cover debt', async () => {
  const f = await creditFixture();
  const borrower = await f.borrower.getAddress();
  await (await f.facility.connect(f.borrower).borrow(E(1_300), { gasLimit: 1_000_000 })).wait();
  await (await f.oracle.connect(f.publisher).publish(await f.stock.getAddress(), {
    price: E(50), freshnessBps: 10_000, liquidityBps: 10_000, asOf: f.now + 1, state: 0,
    inputsHash: ethers.keccak256(ethers.toUtf8Bytes('credit-price-drop')),
  })).wait();
  assert.equal(await f.facility.isLiquidatable(borrower), true);
  await (await f.stable.connect(f.liquidator).approve(await f.facility.getAddress(), E(1_300))).wait();
  await (await f.facility.connect(f.liquidator).liquidate(borrower, E(1_300), { gasLimit: 1_000_000 })).wait();
  assert.equal(await f.facility.collateralOf(borrower), 0n);
  assert.equal(await f.facility.debtOf(borrower), 0n);
  assert.ok((await f.facility.totalAssets()) < E(20_000));
});

test('Credit facility supports partial repayment and a second draw', async () => {
  const f = await creditFixture();
  const borrower = await f.borrower.getAddress();
  await (await f.facility.connect(f.borrower).borrow(E(1_000), { gasLimit: 1_000_000 })).wait();
  await (await f.stable.connect(f.borrower).approve(await f.facility.getAddress(), E(1_000))).wait();
  await (await f.facility.connect(f.borrower).repay(E(400), { gasLimit: 1_000_000 })).wait();
  const afterRepay = await f.facility.debtOf(borrower);
  assert.ok(afterRepay >= E(600) && afterRepay < E(601));
  await (await f.facility.connect(f.borrower).borrow(E(300), { gasLimit: 1_000_000 })).wait();
  const afterRedraw = await f.facility.debtOf(borrower);
  assert.ok(afterRedraw >= E(900) && afterRedraw < E(901));
});

test('Credit facility bounds partial repayment rounding and closes all debt after interest', async () => {
  const f = await creditFixture();
  const borrower = await f.borrower.getAddress();
  await (await f.facility.connect(f.borrower).borrow(E(1_000), { gasLimit: 1_000_000 })).wait();
  await f.provider.send('evm_increaseTime', [365 * 24 * 3600]);
  await f.provider.send('evm_mine', []);
  await (await f.stable.mint(borrower, E(200))).wait();
  await (await f.stable.connect(f.borrower).approve(await f.facility.getAddress(), E(1_200))).wait();
  const offered = E(399);
  const paid = await f.facility.connect(f.borrower).repay.staticCall(offered);
  assert.ok(paid > 0n && paid <= offered);
  const debtBefore = await f.facility.debtOf(borrower);
  await (await f.facility.connect(f.borrower).repay(offered, { gasLimit: 1_000_000 })).wait();
  const debtAfter = await f.facility.debtOf(borrower);
  assert.ok(debtAfter < debtBefore && debtBefore - debtAfter <= offered + 2n);
  await (await f.facility.connect(f.borrower).repay(E(1_200), { gasLimit: 1_000_000 })).wait();
  assert.equal(await f.facility.debtOf(borrower), 0n);
  assert.equal(await f.facility.totalDebtShares(), 0n);
  assert.equal(await f.facility.totalDebt(), 0n);
});

test('Credit facility interest is independent of unrelated accrual calls', async () => {
  const f = await creditFixture();
  const borrower = await f.borrower.getAddress();
  await (await f.facility.connect(f.borrower).borrow(E(1_000), { gasLimit: 1_000_000 })).wait();
  const snapshot = await f.provider.send('evm_snapshot', []);
  const year = 365 * 24 * 3600;
  await f.provider.send('evm_increaseTime', [year]);
  await f.provider.send('evm_mine', []);
  await (await f.facility.connect(f.lender).supply(E(1), { gasLimit: 1_000_000 })).wait();
  await f.provider.send('evm_increaseTime', [year]);
  await f.provider.send('evm_mine', []);
  const withIntermediateAccrual = await f.facility.debtOf(borrower);
  assert.equal(await f.provider.send('evm_revert', [snapshot]), true);
  await f.provider.send('evm_increaseTime', [2 * year]);
  await f.provider.send('evm_mine', []);
  const withoutIntermediateAccrual = await f.facility.debtOf(borrower);
  const difference = withIntermediateAccrual > withoutIntermediateAccrual
    ? withIntermediateAccrual - withoutIntermediateAccrual
    : withoutIntermediateAccrual - withIntermediateAccrual;
  assert.ok(difference <= 1_000_000_000_000n, `interest differs by ${difference} wei when an unrelated accrual occurs`);
});

test('Credit facility can close a long-idle loan while the oracle is stale', async () => {
  const f = await creditFixture();
  const borrower = await f.borrower.getAddress();
  await (await f.facility.connect(f.borrower).borrow(E(1_000), { gasLimit: 1_000_000 })).wait();
  await f.provider.send('evm_increaseTime', [10 * 365 * 24 * 3600]);
  await f.provider.send('evm_mine', []);
  assert.equal((await f.oracle.currentRisk(await f.stock.getAddress()))[0], false);
  const debt = await f.facility.debtOf(borrower);
  assert.ok(debt > E(2_700) && debt < E(2_750));
  await (await f.stable.mint(borrower, E(2_000))).wait();
  await (await f.stable.connect(f.borrower).approve(await f.facility.getAddress(), E(3_000))).wait();
  await (await f.facility.connect(f.borrower).repay(E(3_000), { gasLimit: 1_000_000 })).wait();
  assert.equal(await f.facility.debtOf(borrower), 0n);
  assert.equal(await f.facility.totalDebtShares(), 0n);
  await (await f.facility.connect(f.borrower).withdrawCollateral(E(10))).wait();
});

test('Credit facility bounds repeat liquidation and passes exhausted-collateral loss to lenders', async () => {
  const f = await creditFixture();
  const borrower = await f.borrower.getAddress();
  await (await f.facility.connect(f.borrower).borrow(E(1_300), { gasLimit: 1_000_000 })).wait();
  await (await f.oracle.connect(f.publisher).publish(await f.stock.getAddress(), {
    price: E(100), freshnessBps: 10_000, liquidityBps: 10_000, asOf: f.now + 1, state: 0,
    inputsHash: ethers.keccak256(ethers.toUtf8Bytes('repeat-liquidation')),
  })).wait();
  await (await f.stable.connect(f.liquidator).approve(await f.facility.getAddress(), E(1_300))).wait();
  const first = await f.facility.connect(f.liquidator).liquidate.staticCall(borrower, E(300));
  assert.ok(first[0] > 0n && first[0] <= E(300));
  assert.ok(first[1] > 0n && first[1] <= E(10));
  await (await f.facility.connect(f.liquidator).liquidate(borrower, E(300), { gasLimit: 1_000_000 })).wait();
  const remaining = await f.facility.collateralOf(borrower);
  assert.equal(remaining, E(10) - first[1]);
  const second = await f.facility.connect(f.liquidator).liquidate.staticCall(borrower, E(1_300));
  assert.ok(second[0] > 0n && second[0] < E(1_000));
  assert.equal(second[1], remaining);
  await (await f.facility.connect(f.liquidator).liquidate(borrower, E(1_300), { gasLimit: 1_000_000 })).wait();
  assert.equal(await f.facility.collateralOf(borrower), 0n);
  assert.equal(await f.facility.debtOf(borrower), 0n);
  await assert.rejects(f.facility.connect(f.liquidator).liquidate.staticCall(borrower, E(1)));
  const lenderShares = await f.facility.liquidityShares(await f.lender.getAddress());
  const lenderBefore = await f.stable.balanceOf(await f.lender.getAddress());
  await (await f.facility.connect(f.lender).withdrawLiquidity(lenderShares, { gasLimit: 1_000_000 })).wait();
  const recovered = (await f.stable.balanceOf(await f.lender.getAddress())) - lenderBefore;
  assert.ok(recovered < E(20_000));
  assert.equal(await f.facility.totalLiquidityShares(), 0n);
});

test('Credit facility revalues wrapper shares when underlying per share changes', async () => {
  const f = await fixture();
  const borrower = await f.borrower.getAddress();
  const wrapper = await deploy('MockWrapper', 'MockWrapper.sol', f.owner, [await f.stock.getAddress(), E(1.2)]);
  const facility = await deploy('VadiumCreditPool', 'VadiumCreditPool.sol', f.owner, [
    await f.stable.getAddress(), await wrapper.getAddress(), await f.oracle.getAddress(),
    await f.stock.getAddress(), 6_500, 8_000, 7_500, 5_000, 3_000, 500, 1_000, E(1_000_000),
  ]);
  await (await wrapper.mint(borrower, E(10))).wait();
  await (await wrapper.connect(f.borrower).approve(await facility.getAddress(), E(10))).wait();
  await (await f.stable.connect(f.lender).approve(await facility.getAddress(), E(20_000))).wait();
  await (await facility.connect(f.lender).supply(E(20_000), { gasLimit: 1_000_000 })).wait();
  await (await f.oracle.connect(f.publisher).publish(await wrapper.getAddress(), {
    price: E(200), freshnessBps: 10_000, liquidityBps: 10_000, asOf: f.now, state: 0,
    inputsHash: ethers.keccak256(ethers.toUtf8Bytes('wrapper-rate')),
  })).wait();
  await (await facility.connect(f.borrower).depositCollateral(E(10))).wait();
  assert.equal(await facility.borrowCapacity(borrower), E(1_560));
  await (await facility.connect(f.borrower).borrow(E(1_000), { gasLimit: 1_000_000 })).wait();
  await (await wrapper.setAssetsPerShare(E(0.5))).wait();
  assert.equal(await facility.borrowCapacity(borrower), E(650));
  assert.equal(await facility.isLiquidatable(borrower), true);
});

test('Credit facility isolates two borrowers and shares a realized loss across two lenders', async () => {
  const f = await creditFixture();
  const secondBorrower = await f.provider.getSigner(5);
  const secondLender = await f.provider.getSigner(6);
  const firstBorrowerAddress = await f.borrower.getAddress();
  const secondBorrowerAddress = await secondBorrower.getAddress();
  const secondLenderAddress = await secondLender.getAddress();
  await (await f.stable.mint(secondLenderAddress, E(20_000))).wait();
  await (await f.stable.connect(secondLender).approve(await f.facility.getAddress(), E(20_000))).wait();
  await (await f.facility.connect(secondLender).supply(E(20_000), { gasLimit: 1_000_000 })).wait();
  await (await f.stock.mint(secondBorrowerAddress, E(100))).wait();
  await (await f.stock.connect(secondBorrower).approve(await f.facility.getAddress(), E(100))).wait();
  await (await f.facility.connect(secondBorrower).depositCollateral(E(100))).wait();
  await (await f.facility.connect(f.borrower).borrow(E(1_300), { gasLimit: 1_000_000 })).wait();
  await (await f.facility.connect(secondBorrower).borrow(E(500), { gasLimit: 1_000_000 })).wait();
  assert.equal(await f.facility.totalDebt(), await f.facility.debtOf(firstBorrowerAddress) + await f.facility.debtOf(secondBorrowerAddress));
  await (await f.oracle.connect(f.publisher).publish(await f.stock.getAddress(), {
    price: E(50), freshnessBps: 10_000, liquidityBps: 10_000, asOf: f.now + 1, state: 0,
    inputsHash: ethers.keccak256(ethers.toUtf8Bytes('two-borrower-loss')),
  })).wait();
  assert.equal(await f.facility.isLiquidatable(firstBorrowerAddress), true);
  assert.equal(await f.facility.isLiquidatable(secondBorrowerAddress), false);
  await (await f.stable.connect(f.liquidator).approve(await f.facility.getAddress(), E(1_300))).wait();
  await (await f.facility.connect(f.liquidator).liquidate(firstBorrowerAddress, E(1_300), { gasLimit: 1_000_000 })).wait();
  assert.equal(await f.facility.debtOf(firstBorrowerAddress), 0n);
  const remainingDebt = await f.facility.debtOf(secondBorrowerAddress);
  assert.ok(remainingDebt >= E(500) && remainingDebt < E(501));
  assert.equal(await f.facility.totalDebt(), remainingDebt);
  const firstShares = await f.facility.liquidityShares(await f.lender.getAddress());
  const secondShares = await f.facility.liquidityShares(secondLenderAddress);
  assert.equal(await f.facility.connect(f.lender).withdrawLiquidity.staticCall(firstShares),
    await f.facility.connect(secondLender).withdrawLiquidity.staticCall(secondShares));
  const firstBefore = await f.stable.balanceOf(await f.lender.getAddress());
  await (await f.facility.connect(f.lender).withdrawLiquidity(firstShares, { gasLimit: 1_000_000 })).wait();
  const firstRecovered = (await f.stable.balanceOf(await f.lender.getAddress())) - firstBefore;
  assert.ok(firstRecovered < E(20_000));
  await (await f.stable.mint(secondBorrowerAddress, E(1))).wait();
  await (await f.stable.connect(secondBorrower).approve(await f.facility.getAddress(), E(501))).wait();
  await (await f.facility.connect(secondBorrower).repay(E(501), { gasLimit: 1_000_000 })).wait();
  const secondBefore = await f.stable.balanceOf(secondLenderAddress);
  await (await f.facility.connect(secondLender).withdrawLiquidity(secondShares, { gasLimit: 1_000_000 })).wait();
  const secondRecovered = (await f.stable.balanceOf(secondLenderAddress)) - secondBefore;
  assert.ok(secondRecovered < E(20_000));
  assert.ok(firstRecovered > secondRecovered ? firstRecovered - secondRecovered < E(1) : secondRecovered - firstRecovered < E(1));
  assert.equal(await f.facility.totalLiquidityShares(), 0n);
  assert.equal(await f.facility.totalDebt(), 0n);
});

test('Credit facility settles zero-valued wrapper dust and records only the unpaid debt as lender loss', async () => {
  const f = await fixture();
  const borrower = await f.borrower.getAddress();
  const wrapper = await deploy('MockWrapper', 'MockWrapper.sol', f.owner, [await f.stock.getAddress(), E(1)]);
  const facility = await deploy('VadiumCreditPool', 'VadiumCreditPool.sol', f.owner, [
    await f.stable.getAddress(), await wrapper.getAddress(), await f.oracle.getAddress(),
    await f.stock.getAddress(), 6_500, 8_000, 7_500, 5_000, 3_000, 500, 1_000, E(1_000_000),
  ]);
  await (await wrapper.mint(borrower, E(10))).wait();
  await (await wrapper.connect(f.borrower).approve(await facility.getAddress(), E(10))).wait();
  await (await f.stable.connect(f.lender).approve(await facility.getAddress(), E(20_000))).wait();
  await (await facility.connect(f.lender).supply(E(20_000), { gasLimit: 1_000_000 })).wait();
  await (await f.oracle.connect(f.publisher).publish(await wrapper.getAddress(), {
    price: E(200), freshnessBps: 10_000, liquidityBps: 10_000, asOf: f.now, state: 0,
    inputsHash: ethers.keccak256(ethers.toUtf8Bytes('dust-before')),
  })).wait();
  await (await facility.connect(f.borrower).depositCollateral(E(10))).wait();
  await (await facility.connect(f.borrower).borrow(E(1_000), { gasLimit: 1_000_000 })).wait();
  await (await wrapper.setAssetsPerShare(1n)).wait();
  await (await f.oracle.connect(f.publisher).publish(await wrapper.getAddress(), {
    price: 1n, freshnessBps: 10_000, liquidityBps: 10_000, asOf: f.now + 1, state: 0,
    inputsHash: ethers.keccak256(ethers.toUtf8Bytes('dust-after')),
  })).wait();
  assert.equal(await facility.isLiquidatable(borrower), true);
  await f.provider.send('evm_increaseTime', [6 * 3600 + 2]);
  await f.provider.send('evm_mine', []);
  await assert.rejects(facility.connect(f.liquidator).liquidate.staticCall(borrower, ethers.MaxUint256));
  assert.equal(await facility.collateralOf(borrower), E(10));
  const freshAsOf = (await f.provider.getBlock('latest')).timestamp;
  await (await f.oracle.connect(f.publisher).publish(await wrapper.getAddress(), {
    price: 1n, freshnessBps: 10_000, liquidityBps: 10_000, asOf: freshAsOf, state: 0,
    inputsHash: ethers.keccak256(ethers.toUtf8Bytes('dust-refreshed')),
  })).wait();
  const debt = await facility.debtOf(borrower);
  assert.ok(debt >= E(1_000) && debt < E(1_001));
  await (await f.stable.connect(f.liquidator).approve(await facility.getAddress(), 1n)).wait();
  await assert.rejects(facility.connect(f.liquidator).liquidate.staticCall(borrower, 1n));
  assert.equal(await facility.connect(f.liquidator).liquidate.staticCall(borrower, ethers.MaxUint256).then((result) => result[0]), 1n);
  const lenderAssetsBefore = await facility.totalAssets();
  const liquidatorStableBefore = await f.stable.balanceOf(await f.liquidator.getAddress());
  const liquidatorWrapperBefore = await wrapper.balanceOf(await f.liquidator.getAddress());
  const receipt = await (await facility.connect(f.liquidator).liquidate(borrower, ethers.MaxUint256, { gasLimit: 1_000_000 })).wait();
  const loss = receipt.logs.map((log) => {
    try { return facility.interface.parseLog(log); } catch { return null; }
  }).find((log) => log?.name === 'BadDebtWrittenOff');
  assert.ok(loss.args.amount >= debt - 1n && loss.args.amount < debt + E(1) - 1n);
  assert.equal(await f.stable.balanceOf(await f.liquidator.getAddress()), liquidatorStableBefore - 1n);
  assert.equal(await wrapper.balanceOf(await f.liquidator.getAddress()), liquidatorWrapperBefore + E(10));
  assert.equal(await facility.collateralOf(borrower), 0n);
  assert.equal(await facility.debtOf(borrower), 0n);
  assert.equal(await facility.totalDebtShares(), 0n);
  const lenderAssetsAfter = await facility.totalAssets();
  assert.ok(lenderAssetsAfter <= lenderAssetsBefore && lenderAssetsBefore - lenderAssetsAfter <= loss.args.amount);
  await assert.rejects(facility.connect(f.borrower).withdrawCollateral.staticCall(1n));
});

test('Credit facility dust settlement uses one atomic USDG unit with six decimals', async () => {
  const f = await fixture();
  const borrower = await f.borrower.getAddress();
  const stable = await deploy('MockERC20', 'MockERC20.sol', f.owner, ['USDG test', 'USDG', 6]);
  const wrapper = await deploy('MockWrapper', 'MockWrapper.sol', f.owner, [await f.stock.getAddress(), E(1)]);
  const facility = await deploy('VadiumCreditPool', 'VadiumCreditPool.sol', f.owner, [
    await stable.getAddress(), await wrapper.getAddress(), await f.oracle.getAddress(),
    await f.stock.getAddress(), 6_500, 8_000, 7_500, 5_000, 3_000, 500, 1_000, 1_000_000_000_000n,
  ]);
  await (await stable.mint(await f.lender.getAddress(), 20_000_000_000n)).wait();
  await (await stable.mint(await f.liquidator.getAddress(), 1n)).wait();
  await (await stable.connect(f.lender).approve(await facility.getAddress(), 20_000_000_000n)).wait();
  await (await stable.connect(f.liquidator).approve(await facility.getAddress(), 1n)).wait();
  await (await wrapper.mint(borrower, E(10))).wait();
  await (await wrapper.connect(f.borrower).approve(await facility.getAddress(), E(10))).wait();
  await (await f.oracle.connect(f.publisher).publish(await wrapper.getAddress(), {
    price: E(200), freshnessBps: 10_000, liquidityBps: 10_000, asOf: f.now, state: 0,
    inputsHash: ethers.keccak256(ethers.toUtf8Bytes('six-decimal-before')),
  })).wait();
  await (await facility.connect(f.lender).supply(20_000_000_000n, { gasLimit: 1_000_000 })).wait();
  await (await facility.connect(f.borrower).depositCollateral(E(10))).wait();
  await (await facility.connect(f.borrower).borrow(1_000_000_000n, { gasLimit: 1_000_000 })).wait();
  await (await wrapper.setAssetsPerShare(1n)).wait();
  await (await f.oracle.connect(f.publisher).publish(await wrapper.getAddress(), {
    price: 1n, freshnessBps: 10_000, liquidityBps: 10_000, asOf: f.now + 1, state: 0,
    inputsHash: ethers.keccak256(ethers.toUtf8Bytes('six-decimal-after')),
  })).wait();
  await assert.rejects(facility.connect(f.liquidator).liquidate.staticCall(borrower, 1n));
  assert.equal(await facility.connect(f.liquidator).liquidate.staticCall(borrower, ethers.MaxUint256).then((result) => result[0]), 1n);
  await (await facility.connect(f.liquidator).liquidate(borrower, ethers.MaxUint256, { gasLimit: 1_000_000 })).wait();
  assert.equal(await stable.balanceOf(await f.liquidator.getAddress()), 0n);
  assert.equal(await wrapper.balanceOf(await f.liquidator.getAddress()), E(10));
  assert.equal(await facility.debtOf(borrower), 0n);
  assert.equal(await facility.totalDebtShares(), 0n);
});

async function deploy(name, file, signer, args = []) {
  const a = artifact(file, name);
  const contract = await new ethers.ContractFactory(a.abi, a.evm.bytecode.object, signer).deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

async function fixture() {
  const provider = new ethers.BrowserProvider(ganache.provider({
    logging: { quiet: true },
    chain: { hardfork: 'shanghai' },
    wallet: { totalAccounts: 8, defaultBalance: 1_000 },
  }));
  const owner = await provider.getSigner(0);
  const publisher = await provider.getSigner(1);
  const lender = await provider.getSigner(2);
  const borrower = await provider.getSigner(3);
  const liquidator = await provider.getSigner(4);
  const stable = await deploy('MockERC20', 'MockERC20.sol', owner, ['Demo USD', 'dUSD', 18]);
  const stock = await deploy('MockERC20', 'MockERC20.sol', owner, ['Apple xStock', 'AAPLx', 18]);
  const oracle = await deploy('MarketRiskOracle', 'MarketRiskOracle.sol', owner, [await owner.getAddress(), 6 * 3600]);
  await (await oracle.setPublisher(await publisher.getAddress(), true)).wait();
  const pool = await deploy('VadiumPool', 'VadiumPool.sol', owner, [
    await stable.getAddress(),
    await stock.getAddress(),
    await oracle.getAddress(),
    ethers.ZeroAddress,
    6_500,
    8_000,
    7_500,
    5_000,
    3_000,
    500,
    E(1_000_000),
  ]);
  await (await stable.mint(await lender.getAddress(), E(100_000))).wait();
  await (await stable.mint(await liquidator.getAddress(), E(100_000))).wait();
  await (await stock.mint(await borrower.getAddress(), E(100))).wait();
  await (await stable.connect(lender).approve(await pool.getAddress(), ethers.MaxUint256)).wait();
  await (await stable.connect(liquidator).approve(await pool.getAddress(), ethers.MaxUint256)).wait();
  await (await stock.connect(borrower).approve(await pool.getAddress(), ethers.MaxUint256)).wait();
  const now = (await provider.getBlock('latest')).timestamp;
  const publish = async ({ price = E(200), freshness = 10_000, liquidity = 10_000, state = 0, asOf = now } = {}) => {
    const risk = { price, freshnessBps: freshness, liquidityBps: liquidity, asOf, state, inputsHash: ethers.keccak256(ethers.toUtf8Bytes(`risk-${asOf}-${price}`)) };
    await (await oracle.connect(publisher).publish(await stock.getAddress(), risk)).wait();
  };
  return { provider, owner, publisher, lender, borrower, liquidator, stable, stock, oracle, pool, publish, now };
}

test('oracle rejects unauthorized, invalid, replayed, and future updates', async () => {
  const f = await fixture();
  const risk = { price: E(200), freshnessBps: 10_000, liquidityBps: 10_000, asOf: f.now, state: 0, inputsHash: ethers.ZeroHash };
  await assert.rejects(f.oracle.connect(f.borrower).publish.staticCall(await f.stock.getAddress(), risk));
  await f.publish();
  await assert.rejects(f.oracle.connect(f.publisher).publish.staticCall(await f.stock.getAddress(), risk));
  await assert.rejects(f.oracle.connect(f.publisher).publish.staticCall(await f.stock.getAddress(), { ...risk, asOf: f.now + 10_000 }));
  await assert.rejects(f.oracle.connect(f.publisher).publish.staticCall(await f.stock.getAddress(), { ...risk, asOf: f.now + 1, freshnessBps: 10_001 }));
});

test('oracle exposes auditable risk and becomes unavailable when stale', async () => {
  const f = await fixture();
  await f.publish({ freshness: 9_000, liquidity: 7_000 });
  const [available, risk] = await f.oracle.currentRisk(await f.stock.getAddress());
  assert.equal(available, true);
  assert.equal(risk.freshnessBps, 9_000n);
  assert.equal(risk.liquidityBps, 7_000n);
  await f.provider.send('evm_increaseTime', [6 * 3600 + 1]);
  await f.provider.send('evm_mine', []);
  assert.equal((await f.oracle.currentRisk(await f.stock.getAddress()))[0], false);
});

test('publisher can explicitly halt an asset without publishing a fake price', async () => {
  const f = await fixture();
  await f.publish();
  await f.provider.send('evm_increaseTime', [3]);
  await f.provider.send('evm_mine', []);
  const haltAsOf = Number.parseInt((await f.provider.send('eth_getBlockByNumber', ['latest', false])).timestamp, 16);
  const halt = { price: 0, freshnessBps: 0, liquidityBps: 0, asOf: haltAsOf, state: 2, inputsHash: ethers.keccak256(ethers.toUtf8Bytes('halt')) };
  await (await f.oracle.connect(f.publisher).publish(await f.stock.getAddress(), halt)).wait();
  assert.equal((await f.oracle.currentRisk(await f.stock.getAddress()))[0], false);
});

test('lender supplies liquidity and can redeem shares', async () => {
  const f = await fixture();
  await (await f.pool.connect(f.lender).supply(E(20_000))).wait();
  assert.equal(await f.pool.liquidityShares(await f.lender.getAddress()), E(20_000));
  await (await f.pool.connect(f.lender).withdrawLiquidity(E(5_000))).wait();
  assert.equal(await f.stable.balanceOf(await f.lender.getAddress()), E(85_000));
});

test('open-market borrowing completes the collateral-to-stablecoin loop', async () => {
  const f = await fixture();
  await f.publish();
  await (await f.pool.connect(f.lender).supply(E(20_000))).wait();
  await (await f.pool.connect(f.borrower).depositCollateral(E(10))).wait();
  assert.equal(await f.pool.borrowCapacity(await f.borrower.getAddress()), E(1_300));
  await (await f.pool.connect(f.borrower).borrow(E(1_000))).wait();
  assert.equal(await f.stable.balanceOf(await f.borrower.getAddress()), E(1_000));
  assert.equal(await f.pool.debtOf(await f.borrower.getAddress()), E(1_000));
});

test('closed-market state reduces new credit without making the same debt liquidatable', async () => {
  const f = await fixture();
  await f.publish({ state: 1 });
  await (await f.pool.connect(f.lender).supply(E(20_000))).wait();
  await (await f.pool.connect(f.borrower).depositCollateral(E(10))).wait();
  assert.equal(await f.pool.borrowCapacity(await f.borrower.getAddress()), E(975));
  await assert.rejects(f.pool.connect(f.borrower).borrow.staticCall(E(1_000)));
  await (await f.pool.connect(f.borrower).borrow(E(900))).wait();
  assert.equal(await f.pool.isLiquidatable(await f.borrower.getAddress()), false);
});

test('freshness and liquidity reduce credit transparently', async () => {
  const f = await fixture();
  await f.publish({ freshness: 8_000, liquidity: 6_000 });
  await (await f.pool.connect(f.borrower).depositCollateral(E(10))).wait();
  assert.equal(await f.pool.creditMultiplierBps(), 6_000n);
  assert.equal(await f.pool.borrowCapacity(await f.borrower.getAddress()), E(780));
});

test('thin, unavailable, and stale data block risk increases but never repayment', async () => {
  const f = await fixture();
  await f.publish();
  await (await f.pool.connect(f.lender).supply(E(20_000))).wait();
  await (await f.pool.connect(f.borrower).depositCollateral(E(10))).wait();
  await (await f.pool.connect(f.borrower).borrow(E(500))).wait();
  await f.publish({ liquidity: 2_999, asOf: f.now + 1 });
  await assert.rejects(f.pool.connect(f.borrower).borrow.staticCall(E(1)));
  await assert.rejects(f.pool.connect(f.borrower).withdrawCollateral.staticCall(E(1)));
  await (await f.stable.connect(f.borrower).approve(await f.pool.getAddress(), E(500))).wait();
  await (await f.pool.connect(f.borrower).repay(E(500))).wait();
  assert.equal(await f.pool.debtOf(await f.borrower.getAddress()), 0n);
  await (await f.pool.connect(f.borrower).withdrawCollateral(E(10))).wait();
});

test('debt ceiling and available cash are enforced', async () => {
  const f = await fixture();
  await f.publish({ price: E(1_000_000) });
  await (await f.pool.connect(f.lender).supply(E(100))).wait();
  await (await f.pool.connect(f.borrower).depositCollateral(E(10))).wait();
  await assert.rejects(f.pool.connect(f.borrower).borrow.staticCall(E(101)));
});

test('price decline enables bounded liquidation with a bonus', async () => {
  const f = await fixture();
  await f.publish();
  await (await f.pool.connect(f.lender).supply(E(20_000))).wait();
  await (await f.pool.connect(f.borrower).depositCollateral(E(10))).wait();
  await (await f.pool.connect(f.borrower).borrow(E(1_000))).wait();
  await f.publish({ price: E(100), asOf: f.now + 1 });
  assert.equal(await f.pool.isLiquidatable(await f.borrower.getAddress()), true);
  const before = await f.stock.balanceOf(await f.liquidator.getAddress());
  await (await f.pool.connect(f.liquidator).liquidate(await f.borrower.getAddress(), E(500))).wait();
  assert.equal(await f.pool.debtOf(await f.borrower.getAddress()), E(500));
  assert.equal((await f.stock.balanceOf(await f.liquidator.getAddress())) - before, E(5.25));
});

test('collateral withdrawal cannot leave an undercollateralized position', async () => {
  const f = await fixture();
  await f.publish();
  await (await f.pool.connect(f.lender).supply(E(20_000))).wait();
  await (await f.pool.connect(f.borrower).depositCollateral(E(10))).wait();
  await (await f.pool.connect(f.borrower).borrow(E(1_000))).wait();
  await assert.rejects(f.pool.connect(f.borrower).withdrawCollateral.staticCall(E(3)));
});

test('wrapped collateral uses underlying conversion for borrow and liquidation', async () => {
  const f = await fixture();
  const wrapper = await deploy('MockWrapper', 'MockWrapper.sol', f.owner, [await f.stock.getAddress(), E(1.2)]);
  const wrappedPool = await deploy('VadiumPool', 'VadiumPool.sol', f.owner, [
    await f.stable.getAddress(), await wrapper.getAddress(), await f.oracle.getAddress(),
    await f.stock.getAddress(), 6_500, 8_000, 7_500, 5_000, 3_000, 500, E(1_000_000),
  ]);
  await (await wrapper.mint(await f.borrower.getAddress(), E(10))).wait();
  await (await wrapper.connect(f.borrower).approve(await wrappedPool.getAddress(), E(10))).wait();
  await (await f.stable.connect(f.lender).approve(await wrappedPool.getAddress(), E(20_000))).wait();
  await (await wrappedPool.connect(f.lender).supply(E(20_000))).wait();
  const publishWrapped = async (price, asOf) => {
    await (await f.oracle.connect(f.publisher).publish(await wrapper.getAddress(), {
      price, freshnessBps: 10_000, liquidityBps: 10_000, asOf, state: 0,
      inputsHash: ethers.keccak256(ethers.toUtf8Bytes(`wrapper-${asOf}`)),
    })).wait();
  };
  await publishWrapped(E(200), f.now);
  await (await wrappedPool.connect(f.borrower).depositCollateral(E(10))).wait();
  assert.equal(await wrappedPool.borrowCapacity(await f.borrower.getAddress()), E(1_560));
  await (await wrappedPool.connect(f.borrower).borrow(E(1_000))).wait();
  await publishWrapped(E(100), f.now + 1);
  assert.equal(await wrappedPool.isLiquidatable(await f.borrower.getAddress()), true);
  await (await f.stable.connect(f.liquidator).approve(await wrappedPool.getAddress(), E(500))).wait();
  const before = await wrapper.balanceOf(await f.liquidator.getAddress());
  await (await wrappedPool.connect(f.liquidator).liquidate(await f.borrower.getAddress(), E(500))).wait();
  assert.equal((await wrapper.balanceOf(await f.liquidator.getAddress())) - before, E(4.375));
});

test('borrower wraps underlying, deposits shares, withdraws, and unwraps', async () => {
  const f = await fixture();
  const borrower = await f.borrower.getAddress();
  const wrapper = await deploy('MockWrapper', 'MockWrapper.sol', f.owner, [await f.stock.getAddress(), E(1.2)]);
  const wrappedPool = await deploy('VadiumPool', 'VadiumPool.sol', f.owner, [
    await f.stable.getAddress(), await wrapper.getAddress(), await f.oracle.getAddress(),
    await f.stock.getAddress(), 6_500, 8_000, 7_500, 5_000, 3_000, 500, E(1_000_000),
  ]);
  assert.equal(await wrapper.previewDeposit(E(6)), E(5));
  await (await f.stock.connect(f.borrower).approve(await wrapper.getAddress(), E(6))).wait();
  await (await wrapper.connect(f.borrower).deposit(E(6), borrower)).wait();
  assert.equal(await wrapper.balanceOf(borrower), E(5));
  assert.equal(await f.stock.balanceOf(borrower), E(94));
  await (await wrapper.connect(f.borrower).approve(await wrappedPool.getAddress(), E(5))).wait();
  await (await wrappedPool.connect(f.borrower).depositCollateral(E(5))).wait();
  assert.equal(await wrapper.maxRedeem(borrower), 0n);
  await (await wrappedPool.connect(f.borrower).withdrawCollateral(E(5))).wait();
  assert.equal(await wrapper.previewRedeem(E(5)), E(6));
  await (await wrapper.connect(f.borrower).redeem(E(5), borrower, borrower)).wait();
  assert.equal(await f.stock.balanceOf(borrower), E(100));
  assert.equal(await wrapper.balanceOf(borrower), 0n);
});

test('pool rejects fee-on-transfer collateral instead of overstating a deposit', async () => {
  const f = await fixture();
  const feeToken = await deploy('MockFeeToken', 'MockFeeToken.sol', f.owner);
  const feePool = await deploy('VadiumPool', 'VadiumPool.sol', f.owner, [
    await f.stable.getAddress(), await feeToken.getAddress(), await f.oracle.getAddress(),
    ethers.ZeroAddress, 6_500, 8_000, 7_500, 5_000, 3_000, 500, E(1_000_000),
  ]);
  await (await feeToken.mint(await f.borrower.getAddress(), E(10))).wait();
  await (await feeToken.connect(f.borrower).approve(await feePool.getAddress(), E(10))).wait();
  await assert.rejects(feePool.connect(f.borrower).depositCollateral.staticCall(E(10)));
  assert.equal(await feePool.collateralOf(await f.borrower.getAddress()), 0n);
});

test('operator pause blocks new borrowing and supply while repayment and top-ups work', async () => {
  const f = await fixture();
  await f.publish();
  await (await f.pool.connect(f.lender).supply(E(20_000))).wait();
  await (await f.pool.connect(f.borrower).depositCollateral(E(10))).wait();
  await (await f.pool.connect(f.borrower).borrow(E(500))).wait();
  await assert.rejects(f.pool.connect(f.borrower).setRiskPause.staticCall(true, true));
  await (await f.pool.connect(f.owner).setRiskPause(true, true)).wait();
  await assert.rejects(f.pool.connect(f.borrower).borrow.staticCall(E(1)));
  await assert.rejects(f.pool.connect(f.lender).supply.staticCall(E(1)));
  await (await f.pool.connect(f.borrower).depositCollateral(E(1))).wait();
  await (await f.stable.connect(f.borrower).approve(await f.pool.getAddress(), E(500))).wait();
  await (await f.pool.connect(f.borrower).repay(E(500))).wait();
  assert.equal(await f.pool.debtOf(await f.borrower.getAddress()), 0n);
});

test('verified v10 report drives pool price and session with replay protection', async () => {
  const f = await fixture();
  const verifier = await deploy('MockStreamsVerifier', 'MockStreamsVerifier.sol', f.owner);
  const feedId = ethers.keccak256(ethers.toUtf8Bytes('AAPLx feed'));
  const verifiedOracle = await deploy('VerifiedMarketRiskOracle', 'VerifiedMarketRiskOracle.sol', f.owner, [
    await verifier.getAddress(), feedId, await f.stock.getAddress(), 900, 6 * 3600, 90 * 60,
  ]);
  await (await verifiedOracle.setPublisher(await f.publisher.getAddress(), true)).wait();
  const pool = await deploy('VadiumPool', 'VadiumPool.sol', f.owner, [
    await f.stable.getAddress(), await f.stock.getAddress(), await verifiedOracle.getAddress(),
    ethers.ZeroAddress, 6_500, 8_000, 7_500, 5_000, 3_000, 500, E(1_000_000),
  ]);
  await (await f.stable.connect(f.lender).approve(await pool.getAddress(), E(20_000))).wait();
  await (await f.stock.connect(f.borrower).approve(await pool.getAddress(), E(10))).wait();
  await (await pool.connect(f.lender).supply(E(20_000))).wait();
  await (await pool.connect(f.borrower).depositCollateral(E(10))).wait();
  const reportType = 'tuple(bytes32 feedId,uint32 validFromTimestamp,uint32 observationsTimestamp,uint192 nativeFee,uint192 linkFee,uint32 expiresAt,uint64 lastUpdateTimestamp,int192 price,uint32 marketStatus,int192 currentMultiplier,int192 newMultiplier,uint32 activationDateTime,int192 tokenizedPrice)';
  const publish = async (label, observationsTimestamp, marketStatus, overrides = {}) => {
    const payload = ethers.toUtf8Bytes(label);
    const report = {
      feedId, validFromTimestamp: f.now - 1, observationsTimestamp, nativeFee: 0, linkFee: 0,
      expiresAt: f.now + 600, lastUpdateTimestamp: BigInt(f.now) * 1_000_000_000n,
      price: E(200), marketStatus, currentMultiplier: E(1), newMultiplier: 0,
      activationDateTime: 0, tokenizedPrice: E(200), ...overrides,
    };
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode([reportType], [report]);
    await (await verifier.allow(payload, encoded)).wait();
    return verifiedOracle.connect(f.publisher).publishVerified(payload, 10_000, ethers.keccak256(payload));
  };
  await (await publish('open', f.now, 2)).wait();
  assert.equal((await verifiedOracle.currentRisk(await f.stock.getAddress()))[0], true);
  assert.equal(await pool.borrowCapacity(await f.borrower.getAddress()), E(1_300));
  await assert.rejects(verifiedOracle.connect(f.publisher).publishVerified.staticCall(ethers.toUtf8Bytes('open'), 10_000, ethers.ZeroHash));
  await (await publish('closed', f.now + 1, 1)).wait();
  assert.equal(await pool.borrowCapacity(await f.borrower.getAddress()), E(975));
  await (await publish('split', f.now + 2, 2, { newMultiplier: E(2), activationDateTime: f.now + 300 })).wait();
  assert.equal((await verifiedOracle.currentRisk(await f.stock.getAddress()))[0], false);
});
