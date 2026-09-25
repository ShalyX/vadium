# Vadium handoff

Updated: 25 September 2026. Branch: `codex/mainnet-hardening`.

## Product decision

The user set **revolving credit quality** as the benchmark and chose **separate NVDAx and TSLAx USDG facilities** for the first release. Mainnet is the product; testnet is internal testing. The old AAPLx/dUSD testnet deployment and the USDG mainnet pool with mintable collateral are demonstration evidence, not production facilities.

Use `docs/credit-quality-benchmark.md` for the borrower and lender acceptance criteria, and `docs/mainnet-release.md` for issuer addresses, data sources, and release gates. xStocks are tracker certificates, not direct shares. Do not repeat the blanket “no capital gains tax” claim.

## Implemented and verified before this handoff update

- Prior commits: `552e4cd` hardened wrapper-aware valuation, oracle adapter, wallet flow, and release checklist; `cf7be44` added wrap and unwrap onboarding. The full suite passed 16 tests at that point.
- Current working tree adds a borrower coverage panel with current LTV, price at the liquidation threshold, USDG buffer, and explicit states. `src/coverage.js` contains pure math; its six-decimal USDG threshold test passed.
- `contracts/VadiumCreditPool.sol` is a **new local candidate** with an interest index, debt shares, lender share value, and explicit writeoff after collateral exhaustion. It is not deployed or audited. Focused tests pass for one-year accrual/lender return, exhausted collateral/lender loss, and partial repayment/redraw. Ganache underestimates gas on candidate transactions, so these tests set explicit gas limits; real-wallet gas estimation still needs verification.
- `docs/credit-quality-benchmark.md` records the target flow and missing work. `AGENTS.md` records project rules.
- UI checkpoint `3a54b89`: the repository-root Python preview returned 404 for `/vendor/ethers.min.js`, preventing `src/app.js` from executing. `scripts/build-web.mjs` now also writes the ignored root `vendor/` asset. The Connect wallet button is enabled independently of RPC initialization; connection errors appear directly below the environment notice. Unknown-chain wallet errors also trigger the add-chain path. The page now has Position and Market details views, with the position workspace first. No benchmark name appears in public code or copy.
- Browser verification at `http://127.0.0.1:4173/`: app module executes, Connect wallet produces a wallet request, cancellation displays feedback, and Market details navigation hides the position workspace. Full wallet connection was not completed because the browser wallet request was rejected. Both configured testnet RPC endpoints failed SSL from the local shell and the browser market request timed out; this is visible in the UI rather than freezing the button.

## Immediate next actions

1. Add adversarial and invariant tests for interest and debt-share rounding, liquidation bounds, repeat liquidations, lender redemption around a loss, and wrapper conversion changes. Review the loss policy and liquidation economics independently.
2. Recheck the borrower coverage UI with a working RPC and complete a user-approved wallet connection. Verify gas estimates in a real wallet. Build the dedicated NVDAx and TSLAx market selection only when live facility configuration exists; do not display fake markets.
3. Keep the new facility labeled local-only. It still needs review of interest math, bad-debt allocation, liquidation fairness, market-specific limits, and real oracle integration.
4. Checkpoint commit `aed97b5` passed `npm run check`: 20 tests, 15 contracts compiled, static web build verified. `git diff --check` passed with line-ending warnings only.

## External dependencies and release blockers

- Chainlink Data Streams access and a real signed X Layer report; the local verifier adapter has only mock-report coverage.
- Independent onchain liquidity measurement, bounded publication, and outage monitoring. The current publisher-supplied liquidity score is insufficient for open mainnet lending.
- Real NVDAx and TSLAx V2 wrapper integration, facility terms, issuer/data usage rights, jurisdiction review, independent audit, controlled ownership, and a capped real-asset mainnet pilot.
- Browser visual verification of the coverage panel and a live wallet flow. The current localhost config points to the testnet demo.

The official OKX Dev Day project package is due **25 September 2026 at 23:59 UTC**. Describe the deployed demo accurately if submitting before these gates are satisfied.
