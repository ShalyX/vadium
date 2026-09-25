# Vadium: credit quality benchmark

## Product definition

Vadium should be a revolving USDG credit line secured by a user's wrapped tokenized equity position. The first release has **two isolated facilities**, one for the current NVDAx wrapper and one for the current TSLAx wrapper. Each facility has its own oracle, collateral rules, debt ceiling, interest rate, and liquidity. Testnet remains the integration environment; only a newly reviewed X Layer mainnet deployment can be a release market.

This is a securities-backed credit-line analogy, not a claim that xStocks are direct shares. The [issuer classifies xStocks as tracker certificates](https://docs.xstocks.fi/docs/product-legal-overview) that provide economic exposure without shareholder voting rights. The user should see the token and wrapper they actually hold.

The product promise is **access USDG while retaining the tokenized position, subject to collateral and liquidation risk**. Do not promise that borrowing, wrapping, repayment, or liquidation has a particular tax result. [FINRA's securities-backed credit-line explanation](https://www.finra.org/investors/insights/securities-backed-lines-credit) describes potential tax benefits alongside forced sales and unintended tax consequences; the answer for xStocks depends on the user's jurisdiction and transaction path.

## Borrower flow

1. Choose **NVDAx** or **TSLAx**. Show the issuer token, current V2 wrapper, USDG, available pool cash, oracle state, and facility terms before wallet connection.
2. Hold raw xStock, wrap it into the issuer's current ERC-4626 share token, and deposit those shares as collateral. Show the live wrapper conversion and exact token approvals.
3. Show the **credit line**: collateral value, current debt including accrued interest, current LTV, amount available to draw, hard liquidation threshold, USDG buffer, and underlying price at the threshold. Show the current rate and how it accrues before the draw transaction.
4. Draw USDG to the wallet. Each draw must use a fresh signed underlying price, the wrapper's current conversion, the market's asset-specific haircut, the facility debt ceiling, and actual USDG cash.
5. Monitor the position. Distinguish a reduced **new-draw limit** from a maintenance breach. Give a clear warning before the hard threshold and a direct **add collateral or repay** path. Offchain alerts must supplement the onchain state; they cannot be the only safety mechanism.
6. Repay interest and principal, redraw within the current limit, or repay in full. Repayment and collateral top-ups remain available during market closure, feed outage, or an operator pause.
7. Withdraw available collateral, then unwrap shares. The interface must reject a withdrawal that would leave debt above the permitted limit.

## Lender and risk flow

- Lenders supply real USDG and receive a claim on principal plus earned interest. Display utilization, realized yield, available cash, and withdrawal constraints. Existing zero-interest pool accounting does not meet this benchmark.
- Accrue interest into debt and lender assets with deterministic rounding. Document the rate, change authority, rate limits, and effective time. Add tests across long idle periods, partial repayment, full close, and liquidation.
- Set separate initial LTV, maintenance threshold, liquidation bonus, debt ceiling, and minimum market liquidity for NVDAx and TSLAx after live liquidity and stress analysis. The demo pool's 65% borrowing LTV and 80% liquidation LTV are **not** production parameters for either asset.
- A soft warning must precede the hard liquidation threshold. No grace period is promised by the current contracts. A hard breach can be liquidated only with a fresh usable price; design the stale-data and market-closure response explicitly.
- Bound partial liquidation, loss allocation, reserve funding, and lender redemption when collateral proceeds cannot cover debt. The current pool has no complete bad-debt model.
- Verify a real Chainlink v10 signed report and monitor report age, equity session state, corporate actions, tokenized/underlying price divergence, wrapper conversion, and liquidation depth. A publisher-supplied liquidity score alone is insufficient for unrestricted mainnet credit.

## Current code against the benchmark

| Capability | State on 25 September 2026 |
| --- | --- |
| Deposit wrapped xStock and draw/repay USDG | Contract path implemented locally; real NVDAx/TSLAx facilities not deployed. |
| Revolving use of repaid capacity | Supported by the principal-only pool when the oracle and cash permit. |
| Borrower coverage and liquidation price | Added to the browser; calculated from the current usable onchain price and wrapper conversion. |
| Accrued interest and lender return | Implemented in a new local-only facility candidate; one-year accrual and lender redemption tests pass. No deployment or independent review. |
| Maintenance call, alerting, and cure workflow | Warning view added; formal call policy and monitored alerts missing. |
| Bad-debt treatment and constrained liquidation | Local candidate writes off debt after collateral exhaustion and passes a lender-loss test; loss policy, bounds, and adversarial review remain open. |
| Real signed oracle operations and audited mainnet launch | Missing. |

## Next implementation order

1. Build and test interest-bearing debt accounting and lender share value in a **new facility version**. Keep the existing deployed demo pool as evidence; do not migrate user funds through it.
2. Add explicit facility terms and risk states to the UI. Show interest owed, rate, maintenance buffer, and cure actions before enabling a draw.
3. Implement bounded liquidation and bad-debt accounting, then adversarial and invariant tests.
4. Wire real NVDAx and TSLAx V2 wrappers, independent signed feeds, controlled oracle publication, and market-specific limits on testnet or a safe local fork.
5. Complete external contract review, rights and jurisdiction review, capped mainnet pilot, reconciliation, and monitored release.

The [OKX Builder Kit](https://www.okx.com/learn/okx-dev-day-builder-kit) submission should describe the existing testnet flow and USDG mainnet proof accurately. It should not describe the current demo-collateral pool as a live tokenized-stock Credit facility.
