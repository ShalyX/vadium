# Private mainnet execution pilot

Authorized by the user on 26 September 2026: a tiny, self-funded mainnet loan cycle with operator-set test pricing, with all evidence recorded. This exception applies only to this permanently restricted pilot. Public release retains the signed-report and review gates.

## Exact scope

- Participant, borrower and lender: `0x1DcB045123730e606A88380BCe534332F50332d2`.
- Real X Layer USDG and issuer V2 wrapped NVDAx. A new deployment; never the demo collateral pool.
- Lifetime supplied principal at most **0.02 USDG**; outstanding debt ceiling **0.01 USDG** for new draws. Interest can accrue above that ceiling.
- Planned cycle: supply **0.02 USDG**, wrap **0.001 NVDAx**, deposit its shares, draw **0.005 USDG**, repay with accrued interest, withdraw, unwrap, redeem lender shares.
- Wallet needs **0.021 USDG**, its existing NVDAx, and OKB for gas. Initial read found 0 USDG, 0.024216112027935145 NVDAx and 0.034067780986716456 OKB.
- Fixed **$100 synthetic test price** per underlying NVDAx, constructor-set by the operator. No market-data provider, signature verification, real freshness or liquidity measurement is claimed. The two 10000 risk scores are test constants.
- Borrow LTV 25%, liquidation threshold 50%, liquidation bonus zero, nominal annual interest 1% compounded each second. These are execution-test parameters, not reviewed market terms.
- Oracle and new supply/borrowing expire seven days after their respective deployments. Repayments, top-ups, debt-free collateral withdrawal and cash-backed lender redemption remain available. There is no collateral top-up cap; the UI defaults to only the tiny planned amount.
- All eight financial entrypoints, including liquidation/writeoff, require the immutable participant. Ownership changes cannot widen access, raise caps, replace the oracle or extend the window. An owner may pause supply/borrow. Direct token transfers are not recognized as deposits and must not be used.

## Commands and evidence

Deployed pool: `0x7539200A18333B77F6C4a2f8a7cbc61dddFb5E08`. Synthetic-price oracle: `0x75Eab56774d9b3fA49A83BD036177F7635E00Ad4`. See the deployment JSON for receipts. Local page: `http://127.0.0.1:4173/pilot.html`; hosted site has not been updated. Full check passed 34 tests and compiled 17 contracts.

Run `node scripts/record-private-pilot.mjs` after wallet actions to reconcile pool events, receipt fees and balances independently into `deployments/private-pilot.onchain-evidence.json`. Wrapper actions remain in the exported browser receipts; the recorder does not claim a wrapper round trip from pool events alone.

`node scripts/private-pilot.mjs` performs read-only chain/issuer preflight and writes its observations. `node scripts/private-pilot.mjs --deploy` deploys the two dedicated contracts using the existing operator key and records every deployment hash before waiting. It never transfers the participant's funds. Resume reuses recorded contracts and reconciles a pending deployment receipt.

- `deployments/private-pilot.mainnet.json`: exact addresses, deployment transactions, caps, issuer source, initial balances, compiler/source/runtime hashes and expiry.
- `deployments/private-pilot.compiler-input.json`: complete reproducible Solidity compiler input.
- `/pilot.html`: participant wallet execution; each approval and transaction requires wallet signing. Shows current debt and balances. `Export evidence` downloads deployment details, transaction calldata, receipt events and balance snapshots. This browser log persists in local storage; export it after the cycle.

Test coverage includes rejection of every financial action by another wallet, supply/debt caps, expiry, paused/stale-price repayment and top-up, real wrapper conversion rounding in mocks, full collateral exit and exact self-funded USDG reconciliation. Local mock tests do not prove a mainnet loan happened.

## Verified mainnet result — 26 September 2026

The participant completed the credit cycle. Snapshot block **71672097** confirms zero debt, deposited collateral, lender shares, pool cash and wallet wrapper shares. Supplied 0.02 USDG; drew 0.005 USDG; repaid **0.005001 USDG**; redeemed **0.020001 USDG**. The 0.000001 USDG paid interest returned to the same wallet as lender earnings. Wallet holds 1.037042 USDG and 0.024216112027935144 NVDAx.

- Repayment: `0x01c4a86d4df8f5c495b764fbc6c402c36cbf1d2933b7244acbeb99f5cda6781b`.
- Collateral withdrawal: `0x21ea245f5b2d8af99f507f00bfdd443572e4bae82415c6232f31b3d2fdc4e2c8`.
- Lender redemption: `0x517f56a2585ed0dfa379287e78b7332e1e8219c208f36b9b0ae890dd452021f9`.

Exact receipts, events and atomic balances are in `deployments/private-pilot.onchain-evidence.json`. `scripts/record-pilot-wrapper.mjs` records participant ERC-4626 Deposit/Withdraw receipts separately in `deployments/private-pilot.wrapper-evidence.json`. This pilot does not complete an independent audit, real oracle verification or public release.
