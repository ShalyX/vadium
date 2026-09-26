# Credit candidate: liquidation and accounting review

Internal engineering review, 26 September 2026. This is **not an independent audit**. `VadiumCreditPool.sol` remains a local, undeployed candidate. No NVDAx or TSLAx facility may be opened from these findings alone.

## Current mechanics

- Debt is represented by shares of a global borrow index. `annualRateBps` is a nominal annual rate compounded every second. Exponentiation by squaring makes accrued debt independent of how often another user touches the pool, apart from ray rounding.
- A borrower crosses the hard liquidation threshold when accrued debt exceeds `collateral value × liquidationLtvBps / 10,000`. The value uses the current wrapper `convertToAssets` result and the underlying USD price. Session haircuts reduce new credit; they do not themselves trigger liquidation.
- Liquidation requires an available oracle report. A liquidator chooses `requestedRepay`. The contract burns debt shares, transfers stablecoin in, and seizes wrapper shares worth the repayment plus the configured bonus. If the quote exceeds available collateral, it caps repayment by the current collateral value, transfers all collateral, and writes off the remaining debt.
- If the *entire* collateral position rounds to zero at the stablecoin's precision, a separate full-close path requires `requestedRepay` to cover the whole accrued debt. It charges the liquidator one atomic stablecoin unit, transfers all remaining wrapper shares, clears the debt, and records only the unpaid amount as lender loss. This requires a fresh report and cannot run on a partial-close request. A subsequent price or wrapper-rate recovery benefits the liquidator who took the shares, not the borrower or lenders. This is a local candidate policy, not approved market economics.
- The writeoff reduces lender assets. Lenders with equal shares bear the same proportional loss. Repayment and collateral top-ups do not require a fresh report.

## Verified cases

The local tests cover repeat liquidation through collateral exhaustion, lender redemption after a writeoff, two borrowers with one default and two equal lenders, partial repayment rounding, full close, wrapper exchange-rate deterioration, idle interest, and stale-oracle repayment. The two-borrower test confirms the healthy borrower's debt remains intact after the other position is written off. Dust settlement is tested with 18- and 6-decimal stablecoins, including lender loss accounting, a rejected partial-close request, and a rejected stale-report attempt.

## Open release blockers

1. **Dust settlement policy needs independent review.** The former zero-value deadlock now has an executable full-close path. A liquidator receives all residual wrapper shares for one atomic stablecoin unit while lenders absorb the unpaid debt. A future recovery can make those shares valuable. This windfall and the decision to socialize the loss need an explicit market policy, independent review, and public disclosure before deployment. The path is limited to a fresh reported value of zero at stablecoin precision; an incorrect price or wrapper conversion remains a material risk.
2. **No partial close factor.** The liquidator may request the entire debt on any breached position. A market-specific close factor, severe-breach exception, target post-liquidation coverage, and minimum economically useful repayment need liquidity analysis and independent review before implementation.
3. **No loss reserve.** Exhausted-collateral losses hit lender share value immediately. A reserve or other first-loss policy, disclosure, and lender withdrawal rules remain undecided.
4. **Rounding and external assumptions.** Test multiple collateral and stablecoin decimal combinations, repeated tiny operations, extreme share conversion changes, fee/rebase behavior, and unusually long elapsed periods. Review the wrapper's live conversion semantics and the oracle freshness policy independently.
5. **Liquidation economics.** The demo's 5% bonus and 80% threshold are not NVDAx or TSLAx terms. Set separate values only after measuring executable X Layer depth, keeper costs, price gaps, and stress losses.

The release switch remains off until these policies are specified, the contract is revised and retested, a real signed report is exercised, and an independent contract review is complete.
