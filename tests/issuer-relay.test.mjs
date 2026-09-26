import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureRisk } from '../scripts/local-issuer-relay.mjs';
import { rehearseRelay } from '../scripts/rehearse-issuer-relay.mjs';
import { rehearseCreditRelay } from '../scripts/rehearse-credit-relay.mjs';

test('local fixture gate rejects stale, future, replayed, closed, malformed and real HTTP inputs', () => {
  const input = { source: 'LOCAL_TEST_FIXTURE', symbol: 'NVDAx', priceUsd: '100.25', session: 'open', sourceObservedAt: 1000 };
  assert.equal(fixtureRisk(input, 1001, 60).state, 0);
  for (const invalid of [null, { quote: 100 }, { ...input, source: 'ISSUER_HTTP' },
    { ...input, symbol: 'UNKNOWN' }, { ...input, session: 'closed' },
    { ...input, sourceObservedAt: 1002 }, { ...input, sourceObservedAt: 900 },
    { ...input, priceUsd: '-1' }, { ...input, priceUsd: '1e500' }, { ...input, priceUsd: 100 }]) {
    const risk = fixtureRisk(invalid, 1001, 60);
    assert.equal(risk.state, 2);
    assert.equal(risk.price, '0');
    assert.equal(risk.freshnessBps, 0);
    assert.equal(risk.liquidityBps, 0);
  }
  assert.equal(fixtureRisk(input, 1001, 60, 1000).state, 2);
});

test('local relay submits, recovers, handles outage and preserves verified receipts', async () => {
  const result = await rehearseRelay();
  assert.equal(result.mainnetTransactions, 0);
  assert.equal(result.checks.length, 7);
  assert.equal(result.receipts.filter(r => r.status === 'reverted').length, 1);
});

test('wrapped equity credit lifecycle uses relay outage/recovery and returns accrued interest to lender', async () => {
  const result = await rehearseCreditRelay();
  assert.equal(result.completed, true);
  assert.equal(result.mainnetTransactions, 0);
  assert.equal(result.snapshots.at(-1).debt, '0');
  assert.ok(BigInt(result.interestPaid) > 0n);
});
