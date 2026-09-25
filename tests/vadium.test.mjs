import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(here, '../../work/contract-review/package.json'));
const solc = require('solc');
const ganache = require('ganache');
const { ethers } = require('ethers');

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
  const halt = { price: 0, freshnessBps: 0, liquidityBps: 0, asOf: f.now + 1, state: 2, inputsHash: ethers.keccak256(ethers.toUtf8Bytes('halt')) };
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
