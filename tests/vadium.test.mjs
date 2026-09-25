import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';
import ganache from 'ganache';
import solc from 'solc';
import { calculateCoverage } from '../src/coverage.js';

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
  assert.ok(debt > E(1_099) && debt < E(1_101));
  assert.ok((await f.facility.totalAssets()) > E(20_099));
  await (await f.stable.mint(borrower, E(200))).wait();
  await (await f.stable.connect(f.borrower).approve(await f.facility.getAddress(), E(2_000))).wait();
  await (await f.facility.connect(f.borrower).repay(E(2_000), { gasLimit: 1_000_000 })).wait();
  assert.equal(await f.facility.debtOf(borrower), 0n);
  const shares = await f.facility.liquidityShares(await f.lender.getAddress());
  const cashBefore = await f.stable.balanceOf(await f.lender.getAddress());
  await (await f.facility.connect(f.lender).withdrawLiquidity(shares, { gasLimit: 1_000_000 })).wait();
  assert.ok((await f.stable.balanceOf(await f.lender.getAddress())) - cashBefore > E(20_099));
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
