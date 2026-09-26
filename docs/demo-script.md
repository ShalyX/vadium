# Vadium demo — three-minute recording plan

Show actual interactions in the reviewed build. Label historical receipts “Recorded mainnet evidence” and the rehearsal “Local test fixtures”.

| Time | Screen / action | Narration |
| --- | --- | --- |
| 0:00–0:20 | Review page | “Vadium is building USDG credit against wrapped tokenized equity on X Layer. Deposit collateral, draw USDG, manage the position and repay to recover it.” |
| 0:20–0:50 | Select NVDAx then TSLAx in the wrap desk | “These are the issuer’s current V2 wrappers. We check the underlying token and read conversion rates onchain. xStocks provide tracker exposure, not direct company shares.” |
| 0:50–1:30 | Credit history; open borrow and repay receipts | “This private mainnet cycle used real wrapped NVDAx and USDG. It borrowed 0.005 USDG and repaid 0.005001. Collateral was recovered and lender funds redeemed. The pilot used a fixed synthetic price and accepted one participant.” |
| 1:30–2:20 | Run `npm run rehearse:credit-relay`; show snapshots | “These assets and prices are local fixtures. A pricing outage blocks new borrowing while top-ups and repayment remain available. Fresh pricing restores borrowing. We then close the position during a second outage.” |
| 2:20–2:40 | Final balances and interest fields | “Final debt, collateral and lender shares are zero. Borrower interest matches lender earnings. Separate relay tests cover interrupted broadcasts and restart recovery.” |
| 2:40–3:00 | Review boundaries and repository | “This build demonstrates the mainnet asset integration, a completed private cycle and tested failure handling. Public lending remains closed pending verified pricing and release reviews.” |

Record at 1080p with readable text. Close unrelated tabs and do not expose credentials. Allow the rehearsal to finish or label an edited time cut. Never simulate wallet approvals or describe fixture prices as live market data.

Still required: the actual recorded video and accessible URL. This file is a script, not a video.
