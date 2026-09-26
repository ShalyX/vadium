# Vadium review package

## Project summary

Vadium helps users manage USDG credit against wrapped tokenized equity on X Layer. It integrates the issuer's NVDAx and TSLAx V2 wrappers and has completed a restricted mainnet NVDAx credit cycle with real collateral and USDG. The build includes wallet-connected asset preparation, a credit desk with recorded receipts, interest-bearing credit contracts and local outage/recovery tests. Public borrowing remains unavailable pending verified pricing and release reviews.

Track: **Build a Market**. Repository: https://github.com/ShalyX/vadium . Hosted URL: https://vadium.vercel.app . Verify the deployed version before presenting it; packaging does not push or deploy changes.

## Review order

1. Run `npm ci --ignore-scripts`, `npm run check` and `npm run dev`.
2. Open `/review.html`, then inspect both assets in the wrap desk.
3. Open `/app.html#onchain-proof` and inspect the eight mainnet steps without connecting a wallet.
4. Run `npm run rehearse:credit-relay` and inspect its local snapshots and receipts.
5. Read the release boundaries in README and `docs/mainnet-release.md`.

## Evidence map

| Claim | File in deployments/ | Boundary |
| --- | --- | --- |
| Mainnet credit cycle | private-pilot.onchain-evidence.json | One participant; synthetic fixed price |
| Mainnet wrap/unwrap | private-pilot.wrapper-evidence.json | Real issuer wrapper transactions |
| Combined outage lifecycle | credit-relay-rehearsal.json | Local mock assets and fixture prices |
| Durable relay recovery | issuer-relay-rehearsal.json | Chain 1337 only |

## Final submission tasks

- Record/upload the required 2–4 minute demo using `docs/demo-script.md`.
- Sync the reviewed repository version, deploy it and verify the public links against the package manifest.
- Provide team/contact fields and participation route. These are not invented in this package.
- Confirm late acceptance with the organizer. The official kit still lists 25 September 2026, 23:59 UTC; no extension is verified.
- Preserve actual timestamps on the 26 September evidence and development work. Do not backdate new work.

No submission or message is sent by this package. Use existing receipts for the mainnet demonstration; no new loan or funding is required. Official requirements: https://www.okx.com/learn/okx-dev-day-builder-kit .
