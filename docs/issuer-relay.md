# Issuer price relay

Run `npm run check:issuer`, or `npm run check:issuer -- NVDAx`.

This command requires no credentials, loads no wallet key and sends no transaction. It retrieves the issuer's public asset metadata and price response, records exact HTTP bodies and selected headers, checks asset identity and trading state, and prepares an unavailable-risk draft for `MarketRiskOracle`. It does not modify the completed private pilot or open a new market.

## Observed upstream response

On 26 September 2026, both NVDAx and TSLAx `/price-data` endpoints returned HTTP 200 with `{"quote":null}`. This is **unavailable**, not a zero-dollar market price. Previous calls had timed out; HTTP status alone is not a price-availability check.

The official endpoint schema documents `quote` as a numeric indicative token price. It does **not** document a source observation timestamp. Source: https://docs.xstocks.fi/apis/openapi/assets/get_public_assets_price_data_by_symbol.md . Fetch time and HTTP Date cannot establish the age of an upstream cached price.

## Rules

- Require matching NVDAx/TSLAx symbol, X Layer token and current V2 wrapper, USD currency and explicit session/halt information.
- Reject null, absent, nonnumeric, nonpositive, nonfinite or unsupported-precision quotes. Positive numeric quotes can be normalized to 18 decimals for inspection only.
- Closed/unknown sessions and halts produce explicit rejection reasons. A newly returned numeric quote is still ineligible for lending without a documented source timestamp. Undocumented timestamp-like fields are not silently trusted.
- No fallback price, old-response reuse, synthetic price substitution or fabricated liquidity score.
- Timeout, malformed JSON, 429 and other HTTP failures are recorded. The one-shot runner does not retry aggressively or bypass rate limits; operators should respect recorded Retry-After values.
- Every run writes unique raw-input and decision files under `deployments/issuer-relay/`. The exact raw-input file bytes hash to the draft's `inputsHash`. `deployments/issuer-relay.latest.json` points to the latest run; previous evidence is preserved.
- Outage drafts have price/freshness/liquidity zero and state Unavailable. `asOf` is explicitly the outage observation time, not a claimed quote timestamp. Draft calldata has no destination. A future authorized sender must use chain time, verify publisher access and target configuration, and preserve receipt evidence.

## Local publisher and recovery rehearsal

Run `npm run rehearse:relay`. This starts an ephemeral Ganache chain (1337), deploys a local `MarketRiskOracle`, uses generated local accounts, executes the scenarios below, and writes `deployments/issuer-relay-rehearsal.json`. It loads no environment keys and accepts no remote RPC configuration. Positive reports are explicitly labelled `LOCAL_TEST_FIXTURE`; their price and scores are test constants, not market evidence.

`scripts/local-issuer-relay.mjs` implements one publication/recovery tick:

1. Check the actual RPC chain ID before signing or broadcasting. Only 1337 is accepted; X Layer 196 is rejected with no override.
2. Bind the journal to genesis hash, oracle, asset, market and signer. Hold an exclusive journal lock. Check deployed target code and publisher permission before preparing a new transaction.
3. Accept only explicit local fixtures with a valid decimal price, matching market, open session and source timestamp newer than the stored report, not future or expired. All other inputs become zero-price Unavailable reports. An already-unavailable oracle receives no repeated outage transaction. A same-second report waits for chain time to advance instead of inventing a timestamp.
4. Persist exact evidence, risk, signed transaction bytes and hash using a flushed temporary file and atomic rename **before** broadcast. No private key is saved.
5. On restart, reconcile the pending hash before considering new input. If needed, rebroadcast the same signed bytes and nonce. Ambiguous network errors retain pending state; the caller retries the same journal. Never replace an uncertain transaction with a new nonce or silently refresh its report timestamp.
6. Verify the receipt block is currently canonical and the emitted report exactly matches the prepared report. Save successful or reverted receipts with nonce, block/hash, gas, risk and evidence. A reverted transaction is recorded explicitly, not reported as publication success.

The rehearsal verifies stops before broadcast and after broadcast, duplicate prevention, fresh-report recovery, stale-report outage, publisher revocation, exclusive locking, journal binding and tamper rejection. The regular credit suite separately verifies outage behavior for borrowing, liquidation, repayment, top-up and withdrawal. `npm run test` includes both suites.

## Complete credit lifecycle rehearsal

Run `npm run rehearse:credit-relay` to connect the same durable relay to `VadiumCreditPool`, a six-decimal mock USDG and a test wrapper representing 1.2 underlying tokens per share. All contracts and generated wallets run on ephemeral chain 1337. No issuer contract, real token or mainnet wallet is used.

The command supplies lender funds, wraps 12 test equity tokens into 10 shares, deposits nine shares, publishes a labelled $100 fixture, and verifies $702 borrowing capacity from the wrapper conversion. It draws 200 test USDG and advances one day to accrue interest. An outage report then blocks a new draw with a recorded reverted receipt and leaves the position non-liquidatable. The borrower tops up one share and repays 50 during the outage. A fresh fixture restores borrowing and permits a 25 test USDG redraw. A second outage remains active through full repayment, withdrawal, unwrap and lender redemption.

Assertions require zero final debt, collateral, lender shares and pool cash; full restoration of the original test equity; and exact agreement between borrower interest paid and lender earnings. Evidence is saved to `deployments/credit-relay-rehearsal.json`, containing 25 setup/lifecycle receipts (one expected reverted draw), four relay receipts and state snapshots. This test also runs in `npm run check`. Fixture prices, scores, risk parameters and locally generated addresses are not production market evidence.

## Journal operations and limits

Use one journal per local signer/asset and a dedicated signer; other writers must not consume its nonces. Preserve pending records during RPC failures. A receipt without the expected event, corrupt journal, target mismatch or ambiguous replacement requires investigation and fails closed. There is no automated nonce replacement or fee bump.

Normal exceptions release the lock. A forcibly killed process can leave `<journal>.lock`; confirm its recorded PID is no longer running before removing that lock and restarting with the same journal. Never delete the journal to clear a pending transaction. The rehearsal tests restart checkpoints with the same running local chain; a newly created ephemeral chain cannot recover transactions from a discarded chain. Its temporary journal is removed after completion, while the exported receipt evidence remains.

This is a local runner, not a deployed service. It checks current receipt canonicality but does not provide production finality-depth monitoring or recovery across later reorganizations. No public service, unattended mainnet publisher, real equity price, production liquidity score or positive issuer HTTP price is enabled.

## Mainnet boundary

The read-only fetch/validation command and local transaction/recovery pipeline are implemented. **No mainnet price publication path is enabled:** the observed endpoint cannot yet satisfy source-age validation. A documented observation-time source or a separately authorized and explicitly weaker receipt-age policy is needed before positive issuer-price publication. This is not an independently signed oracle.

Local contract tests publish the unavailable draft into `MarketRiskOracle`, verify the evidence commitment, and prove it blocks new borrowing without triggering liquidation, while top-ups, full repayment and debt-free collateral withdrawal continue to work. No funds or deployment are needed for these tests.
