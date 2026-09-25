# Vadium handoff

Updated: 25 September 2026. Branch: `codex/mainnet-hardening`.

## Product decision

The user set **Lombard-style revolving credit** as the benchmark and chose **separate NVDAx and TSLAx USDG facilities** for the first release. Mainnet is the product; testnet is internal testing. The old AAPLx/dUSD testnet deployment and the USDG mainnet pool with mintable collateral are demonstration evidence, not production facilities.

Use `docs/lombard-benchmark.md` for the borrower and lender acceptance criteria, and `docs/mainnet-release.md` for issuer addresses, data sources, and release gates. xStocks are tracker certificates, not direct shares. Do not repeat the blanket “no capital gains tax” claim.

## Implemented and verified before this handoff update

- Prior commits: `552e4cd` hardened wrapper-aware valuation, oracle adapter, wallet flow, and release checklist; `cf7be44` added wrap and unwrap onboarding. The full suite passed 16 tests at that point.
- Current working tree adds a borrower coverage panel with current LTV, price at the liquidation threshold, USDG buffer, and explicit states. `src/coverage.js` contains pure math; its six-decimal USDG threshold test passed.
- `contracts/VadiumLombardPool.sol` is a **new local candidate** with an interest index, debt shares, lender share value, and explicit writeoff after collateral exhaustion. It is not deployed or audited. Focused tests pass for one-year accrual/lender return, exhausted collateral/lender loss, and partial repayment/redraw. Ganache underestimates gas on candidate transactions, so these tests set explicit gas limits; real-wallet gas estimation still needs verification.
- `docs/lombard-benchmark.md` records the target flow and missing work. `AGENTS.md` records project rules.

## Immediate next actions

1. Add adversarial and invariant tests for interest and debt-share rounding, liquidation bounds, repeat liquidations, lender redemption around a loss, and wrapper conversion changes. Review the loss policy and liquidation economics independently.
2. Inspect the borrower coverage UI in the local browser with a working RPC and verify gas estimates in a real wallet.
3. Keep the new facility labeled local-only. It still needs review of interest math, bad-debt allocation, liquidation fairness, market-specific limits, and real oracle integration.
4. Checkpoint commit `aed97b5` passed `npm run check`: 20 tests, 15 contracts compiled, static web build verified. `git diff --check` passed with line-ending warnings only.

## External dependencies and release blockers

- Chainlink Data Streams access and a real signed X Layer report; the local verifier adapter has only mock-report coverage.
- Independent onchain liquidity measurement, bounded publication, and outage monitoring. The current publisher-supplied liquidity score is insufficient for open mainnet lending.
- Real NVDAx and TSLAx V2 wrapper integration, facility terms, issuer/data usage rights, jurisdiction review, independent audit, controlled ownership, and a capped real-asset mainnet pilot.
- Browser visual verification of the coverage panel and a live wallet flow. The current localhost config points to the testnet demo.

The official OKX Dev Day project package is due **25 September 2026 at 23:59 UTC**. Describe the deployed demo accurately if submitting before these gates are satisfied.
