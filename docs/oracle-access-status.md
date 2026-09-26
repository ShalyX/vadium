# Live oracle access status — 26 September 2026

Constraint: no paid Chainlink subscription. User reconfirmed this; possessing an API key does not imply feed entitlement. Do not request credentials again as a substitute for resolving access.

No new live oracle was integrated or deployed. The completed private pilot retains its immutable synthetic-price oracle, and its lifetime supplied-principal cap is exhausted. It cannot be upgraded in place to a public live-price facility.

## Findings

- Issuer metadata for NVDAx and TSLAx on X Layer continues to identify Chainlink v10 pull feeds. This verifies identifiers, not access to reports. Sources: https://api.xstocks.fi/api/v2/public/oracles/NVDAx?network=XLayer and https://api.xstocks.fi/api/v2/public/oracles/TSLAx?network=XLayer.
- API3 describes public cryptographically signed base-feed data, with a delay, in https://docs.api3.org/oev/in-depth/data-feeds/. This is a potential architecture, not proof of NVDAx or TSLAx availability.
- API3's historical X Layer announcement is https://blog.api3.org/api3-integrates-next-generation-oracle-stack-on-x-layer/. The current official contracts deployment map has no chain 196 entries: https://github.com/api3dao/contracts/blob/main/deployments/addresses.json. The read result is preserved in `deployments/api3-xlayer-access-check.json`. This does not rule out historical contracts; it does not establish a maintained current feed either.
- Previous RedStone production gateway checks returned 403 without packages; see `redstone-feasibility.md`. Free equity access remains unconfirmed.
- Pyth's current developer landing page states Hermes requires an API key after its August 2026 upgrade: https://docs.pyth.network/. Do not describe it as a verified free drop-in X Layer route.

The remaining dependency is an accessible, independently verifiable price source for these assets on X Layer. A provider name, an unsigned HTTP quote, or a self-signed relay does not satisfy that dependency. No subscription purchased, access request submitted, funds moved or release flag enabled during this investigation.
