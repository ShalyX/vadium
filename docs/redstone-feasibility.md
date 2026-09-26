# RedStone equity access probe

Run `node scripts/probe-redstone.mjs`. Results are saved to `deployments/redstone-access-probe.json`. This is a read-only access and signature-evidence probe, not a lending oracle or deployment command. If RedStone has granted access, set `REDSTONE_API_KEY` in the local environment; the script sends it as `x-api-key` without writing the secret to evidence.

On 26 September 2026, unauthenticated requests to the official SDK's production gateway returned HTTP 403 with `{"message":"Forbidden"}` for NVDA, TSLA, NVDAx, TSLAx, and BTC as a control. No signed packages were returned. This does not prove that the equity feeds are absent or that all access requires payment. It establishes that this unauthenticated route does not currently supply the packages we need.

The current upstream SDK uses `x-api-key` authentication and rejects an empty authenticated gateway list. The production consumer identifies `redstone-primary-prod`, requires three distinct signers, and lists five authorized signer addresses. These configuration values and source URLs are preserved in the probe evidence. When packages are returned, the probe reproduces the protocol's numeric data-package serialization and checks the recovered signer against that five-address set; it still does not authorize a lending action or establish feed semantics.

## Next dependency

Obtain developer access from RedStone and confirm the exact production data service and feed IDs for NVDA/TSLA or NVDAx/TSLAx, authorized signers, update schedule, and permitted use for an X Layer lending pilot. Ask whether free developer access is available; pricing has not been established. Official contact: https://www.redstone.finance/developers.

Once packages are available, compare the probe's cryptographic result with the official protocol library and production signer quorum, then test an adapter that writes the validated price into Vadium's existing `currentRisk(wrapper)` interface. Stock prices require issuer multiplier and corporate-action handling before they can value xStock collateral. Market-hours behavior and stale underlying observations must be distinguished from newly signed packages.

Sources:
- https://github.com/redstone-finance/redstone-oracles-monorepo/blob/main/packages/sdk/src/data-services-urls.ts
- https://github.com/redstone-finance/redstone-oracles-monorepo/blob/main/packages/sdk/src/fetch-data-packages.ts
- https://github.com/redstone-finance/redstone-oracles-monorepo/blob/main/packages/evm-connector/contracts/data-services/PrimaryProdDataServiceConsumerBase.sol
