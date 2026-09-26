import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';
import ganache from 'ganache';
import solc from 'solc';
import { runLocalRelay } from './local-issuer-relay.mjs';

export async function rehearseCreditRelay() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vadium-credit-relay-'));
  const chain = ganache.provider({ logging: { quiet: true }, chain: { chainId: 1337 }, wallet: { totalAccounts: 4 } });
  const provider = new ethers.BrowserProvider(chain, undefined, { cacheTimeout: -1 });
  try {
    const contractsDirectory = new URL('../contracts/', import.meta.url);
    const sources = Object.fromEntries(fs.readdirSync(contractsDirectory).filter(name => name.endsWith('.sol'))
      .map(name => [name, { content: fs.readFileSync(new URL(name, contractsDirectory), 'utf8') }]));
    const compiled = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources,
      settings: { evmVersion: 'paris', optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } })));
    assert.equal((compiled.errors ?? []).filter(error => error.severity === 'error').length, 0);
    const owner = await provider.getSigner(0), lender = await provider.getSigner(2), borrower = await provider.getSigner(3);
    const publisher = new ethers.Wallet(Object.values(chain.getInitialAccounts())[1].secretKey, provider);
    const lenderAddress = await lender.getAddress(), borrowerAddress = await borrower.getAddress();
    const receipts = [], snapshots = [];
    const record = (step, receipt) => {
      receipts.push({ step, hash: receipt.hash, status: receipt.status, blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash, gasUsed: receipt.gasUsed.toString() });
      return receipt;
    };
    const send = async (step, transaction) => {
      const receipt = record(step, await (await transaction).wait());
      assert.equal(receipt.status, 1, step);
      return receipt;
    };
    const deploy = async (name, args) => {
      const artifact = compiled.contracts[`${name}.sol`][name];
      const contract = await new ethers.ContractFactory(artifact.abi, artifact.evm.bytecode.object, owner).deploy(...args);
      await send(`deploy-${name}`, Promise.resolve(contract.deploymentTransaction()));
      return contract;
    };
    const usd = value => ethers.parseUnits(String(value), 6), equity = value => ethers.parseUnits(String(value), 18);
    const stable = await deploy('MockERC20', ['LOCAL ONLY USDG', 'testUSDG', 6]);
    const stock = await deploy('MockERC20', ['LOCAL ONLY NVDAx', 'testNVDAx', 18]);
    const wrapper = await deploy('MockWrapper', [await stock.getAddress(), equity('1.2')]);
    const oracle = await deploy('MarketRiskOracle', [await owner.getAddress(), 3600]);
    const facility = await deploy('VadiumCreditPool', [await stable.getAddress(), await wrapper.getAddress(),
      await oracle.getAddress(), await stock.getAddress(), 6500, 8000, 7500, 5000, 3000, 500, 1000, usd(1000)]);
    const facilityAddress = await facility.getAddress(), wrapperAddress = await wrapper.getAddress();
    const journalFile = path.join(directory, 'relay.json');
    const gas = { gasLimit: 1000000 };
    await send('authorize-local-publisher', oracle.setPublisher(publisher.address, true));
    await send('mint-local-lender-funds', stable.mint(lenderAddress, usd(1000)));
    await send('mint-local-interest-budget', stable.mint(borrowerAddress, usd(2)));
    await send('mint-local-equity', stock.mint(borrowerAddress, equity(12)));
    await send('approve-supply', stable.connect(lender).approve(facilityAddress, usd(1000)));
    await send('supply', facility.connect(lender).supply(usd(1000), gas));
    await send('approve-wrap', stock.connect(borrower).approve(wrapperAddress, equity(12)));
    await send('wrap', wrapper.connect(borrower).deposit(equity(12), borrowerAddress, gas));
    assert.equal(await wrapper.balanceOf(borrowerAddress), equity(10));
    await send('approve-collateral', wrapper.connect(borrower).approve(facilityAddress, equity(10)));
    await send('deposit', facility.connect(borrower).depositCollateral(equity(9), gas));
    const advance = async seconds => { await provider.send('evm_increaseTime', [seconds]); await provider.send('evm_mine', []); };
    const publish = async available => {
      await advance(2);
      const timestamp = Number(BigInt((await provider.send('eth_getBlockByNumber', ['latest', false])).timestamp));
      const input = available ? { source: 'LOCAL_TEST_FIXTURE', symbol: 'NVDAx', priceUsd: '100', session: 'open', sourceObservedAt: timestamp }
        : { source: 'LOCAL_TEST_FIXTURE', symbol: 'NVDAx', quote: null, reason: 'SIMULATED_FEED_OUTAGE' };
      const result = await runLocalRelay({ provider, wallet: publisher, oracleAddress: await oracle.getAddress(),
        asset: wrapperAddress, symbol: 'NVDAx', journalFile, input });
      assert.equal(result.status, 'confirmed');
      assert.equal(result.risk.state, available ? 0 : 2);
    };
    const snapshot = async stage => {
      const value = { stage, debt: (await facility.debtOf(borrowerAddress)).toString(),
        collateralShares: (await facility.collateralOf(borrowerAddress)).toString(),
        borrowCapacity: (await facility.borrowCapacity(borrowerAddress)).toString(),
        lenderShares: (await facility.liquidityShares(lenderAddress)).toString(),
        cash: (await stable.balanceOf(facilityAddress)).toString(),
        oracleAvailable: (await oracle.currentRisk(wrapperAddress))[0] };
      snapshots.push(value);
      return value;
    };
    await publish(true);
    // Nine wrapper shares represent 10.8 underlying tokens: $1,080 * 65% = $702.
    assert.equal(await facility.borrowCapacity(borrowerAddress), usd(702));
    await send('borrow', facility.connect(borrower).borrow(usd(200), gas));
    await snapshot('borrowed');
    await advance(86400);
    assert.ok(await facility.debtOf(borrowerAddress) > usd(200));
    await publish(false);
    const outage = await snapshot('outage');
    assert.equal(outage.borrowCapacity, '0');
    assert.equal(outage.oracleAvailable, false);
    assert.equal(await facility.isLiquidatable(borrowerAddress), false);
    await assert.rejects(facility.connect(borrower).borrow.staticCall(usd(1)), error =>
      error.revert?.name === 'RiskUnavailable' || error.data === facility.interface.getError('RiskUnavailable').selector);
    const blocked = await facility.connect(borrower).borrow(usd(1), gas);
    let failedReceipt;
    try { await blocked.wait(); } catch (error) { failedReceipt = error.receipt; }
    assert.ok(failedReceipt, 'Blocked borrow must revert onchain');
    assert.equal(record('borrow-blocked-during-outage', failedReceipt).status, 0);
    await send('top-up-during-outage', facility.connect(borrower).depositCollateral(equity(1), gas));
    await send('approve-repayment', stable.connect(borrower).approve(facilityAddress, usd(300)));
    const debtBeforePartial = await facility.debtOf(borrowerAddress);
    await send('partial-repayment-during-outage', facility.connect(borrower).repay(usd(50), gas));
    assert.ok(await facility.debtOf(borrowerAddress) < debtBeforePartial);
    await publish(true);
    assert.ok(await facility.borrowCapacity(borrowerAddress) > 0n);
    await send('redraw-after-recovery', facility.connect(borrower).borrow(usd(25), gas));
    await snapshot('recovered-and-redrawn');
    // Close under a second outage to verify that exit never depends on price recovery.
    await publish(false);
    await send('full-repayment-during-outage', facility.connect(borrower).repay(usd(300), gas));
    assert.equal(await facility.debtOf(borrowerAddress), 0n);
    await send('withdraw-during-outage', facility.connect(borrower).withdrawCollateral(equity(10), gas));
    await send('unwrap', wrapper.connect(borrower).redeem(equity(10), borrowerAddress, borrowerAddress, gas));
    await send('redeem-lender-shares', facility.connect(lender).withdrawLiquidity(await facility.liquidityShares(lenderAddress), gas));
    const final = await snapshot('closed');
    for (const key of ['debt', 'collateralShares', 'lenderShares', 'cash']) assert.equal(final[key], '0', key);
    assert.equal(await facility.totalDebt(), 0n);
    assert.equal(await facility.totalLiquidityShares(), 0n);
    assert.equal(await wrapper.balanceOf(borrowerAddress), 0n);
    assert.equal(await wrapper.balanceOf(facilityAddress), 0n);
    assert.equal(await stock.balanceOf(borrowerAddress), equity(12));
    const lenderReceived = await stable.balanceOf(lenderAddress);
    const interestPaid = usd(2) - await stable.balanceOf(borrowerAddress);
    assert.ok(interestPaid > 0n);
    assert.equal(lenderReceived - usd(1000), interestPaid);
    const journal = JSON.parse(fs.readFileSync(journalFile, 'utf8'));
    assert.equal(journal.pending, null);
    assert.equal(journal.receipts.length, 4);
    return { mode: 'LOCAL_TEST_FIXTURES_ONLY', chainId: 1337, mainnetTransactions: 0, generatedAt: new Date().toISOString(),
      completed: true, stableDecimals: 6, wrapperAssetsPerShare: equity('1.2').toString(),
      contracts: { stable: await stable.getAddress(), stock: await stock.getAddress(), wrapper: wrapperAddress, oracle: await oracle.getAddress(), facility: facilityAddress },
      interestPaid: interestPaid.toString(), lenderReceived: lenderReceived.toString(), receipts, snapshots,
      relay: { binding: journal.binding, receipts: journal.receipts } };
  } finally {
    provider.destroy();
    await chain.disconnect();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const evidence = await rehearseCreditRelay();
  fs.writeFileSync(new URL('../deployments/credit-relay-rehearsal.json', import.meta.url), JSON.stringify(evidence, null, 2) + '\n');
  console.log(`Credit + relay lifecycle passed: ${evidence.receipts.length} lifecycle/setup receipts, 4 relay receipts; zero mainnet transactions.`);
}
