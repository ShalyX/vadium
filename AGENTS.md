# Vadium agent guide

## Explicit private pilot exception — 26 September 2026

The user authorized a self-funded private mainnet loan rehearsal with operator-set test pricing and all evidence recorded. Only `VadiumPrivatePilot` may use this exception: immutable participant `0x1DcB045123730e606A88380BCe534332F50332d2`, lifetime 0.02 USDG supply cap, 0.01 USDG new-debt ceiling and seven-day supply/borrow window. See `docs/private-mainnet-pilot.md`. Do not extend this exception to public release or describe the synthetic price as a verified market feed. Keep all existing release gates for the public product.

Read `HANDOFF.md`, `docs/credit-quality-benchmark.md`, and `docs/mainnet-release.md` before changing the lending contracts or release configuration.

## Product target

- Build separate, revolving USDG credit lines secured by the issuer's current V2 wrapped NVDAx and TSLAx on X Layer mainnet. Testnet is for testing.
- A borrower should be able to wrap, deposit, draw, monitor collateral coverage and interest, top up or repay, withdraw, and unwrap. Lenders must see how interest and losses affect their shares.
- xStocks are tracker certificates with economic exposure, not direct Nvidia or Tesla shares. Do not promise a universal capital-gains-tax outcome or guaranteed instant liquidity.
- The deployed mainnet demo-collateral pool is transaction proof only. Never present it as a release market or route user deposits to it.

## Contract and data rules

- Use the current issuer V2 ERC-4626 wrapper as collateral. Verify `asset()` and the issuer's current address on X Layer before any deployment. Value shares with `convertToAssets(shares)` and an independent, fresh underlying USD price.
- Use a signed, verified market report for risk-increasing actions. Cached public API prices and wrapper conversion rates are insufficient as sole lending oracles.
- Repayment and collateral top-ups must remain available during oracle outages, market closure, and operator pauses. A session change alone must not liquidate a position.
- Treat interest, rounding, bad debt, lender losses, liquidation bounds, and stale-data behavior as fund-handling logic. Add meaningful tests for each change and run `npm run check`.
- Mainnet release requires real signed-report testing, market-specific risk limits, liquidity analysis, role separation, independent contract review, rights and jurisdiction review, and a capped end-to-end pilot. Keep release switches off until those gates are met.

## Workflow

- Review packaging: `npm run package:review` creates a curated source/evidence directory and SHA-256 manifest under ignored `release/`. Keep internal handoff/personal instructions, credentials and browser session logs out of the archive. Review guide and demo script are in `docs/review-package.md` and `docs/demo-script.md`; a script is not a recorded video. Check the deployed version separately before claiming public launch readiness.

- Combined credit/relay regression: `npm run rehearse:credit-relay` records the full local wrapped-collateral lifecycle with six-decimal stablecoin accounting, outage-safe top-up/repayment/exit, price recovery, redraw and lender-interest reconciliation. Preserve its fixture labels and separate local receipts from the completed real mainnet pilot evidence.

- Local relay continuation: `npm run rehearse:relay` exercises durable signing, broadcast, recovery, outage and receipt recording on ephemeral chain 1337 only. `scripts/local-issuer-relay.mjs` rejects other chains with no mainnet override. Positive fixture reports are explicitly synthetic. Preserve this boundary; see `docs/issuer-relay.md` for journal recovery, including stale-lock handling after a forced process kill.

- The user authorized building the issuer API relay after acknowledging operator-published pricing. First stage is `npm run check:issuer`: read-only collection, validation, evidence and local outage rehearsal. A real `/price-data` response returned `{ "quote": null }`; its documented schema has no source observation timestamp. Do not silently treat HTTP Date/fetch time as source freshness or enable a positive-price publication path without resolving that distinction. This authorization does not open public lending.

- Oracle budget constraint: the user has an unfunded Chainlink account and has repeatedly ruled out paying for a subscription. Do not ask them to configure/fund Chainlink credentials as the default next step. Require actual verified feed availability before recommending another provider; chain compatibility or historical partnership announcements alone are insufficient. Do not replace the restricted synthetic-price pilot with unsigned API prices or claim a verified live oracle without evidence.

- Current priority: make the real-asset mainnet flow usable before adding more product features. Work on wallet signing, a verified live oracle, the reviewed facility deployment, funded liquidity, and the complete wrap-to-repay pilot. Testnet remains internal validation.
- Make changes on the `codex/mainnet-hardening` branch unless the user requests another branch.
- Update `HANDOFF.md` after material decisions or code changes, including tests run and remaining blockers.
- Keep the README and UI claims aligned with deployed reality. State clearly when a feature is local-only, testnet-only, or live on mainnet.
- Preserve exact contract addresses, transaction links, and source evidence for Dev Day review. The official submission deadline is 25 September 2026 at 23:59 UTC.
- Treat the credit quality benchmark as an internal standard. Do not use its former name in public code, UI, docs, or submissions. Prioritize a responsive wallet-first product workspace over a promotional single-page layout. Verify the exact page the user is viewing, including asset loading and interaction feedback.
