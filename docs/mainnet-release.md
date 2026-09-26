# Vadium mainnet release plan

**Product target:** separate NVDAx and TSLAx revolving USDG credit lines on X Layer, each secured by the issuer's current non-rebasing wrapper. The [credit quality benchmark](credit-quality-benchmark.md) defines the full facility requirements. Testnet is for integration and failure testing. The existing X Layer mainnet USDG pool uses mintable demo collateral and is transaction evidence only; it must not receive user funds.

## Verified collateral options

Checked against the [xStocks public assets API](https://docs.xstocks.fi/apis/openapi/assets) and X Layer contract code on 25 September 2026 using `npm run verify:assets`. The V2 wrapper `asset()` was checked against the issuer token onchain. Addresses must be rechecked immediately before deployment.

| Market | Issuer xStock | Current V2 wrapper | Launch fit |
| --- | --- | --- | --- |
| AAPLx | `0x9d275685dc284c8eb1c79f6aba7a63dc75ec890a` | `0x943bf64d566c32a2bcd41ac92fb63c111cc9de8f` | Existing integration and test reference. |
| SPYx | `0x90a2a4c76b5d8c0bc892a69ea28aa775a8f2dd48` | `0xe7e553cd128f0011777323a0b44a7b96ea1cb540` | Second market candidate: broader underlying exposure, subject to liquidity and risk review. |
| NVDAx | `0xc845b2894dbddd03858fd2d643b4ef725fe0849d` | `0xa8ddb5cd96b5222afe198316e9a57caa642850d5` | First planned facility; requires its own risk limits and liquidity review. |
| TSLAx | `0x8ad3c73f833d3f9a523ab01476625f269aeb7cf0` | `0xc3fdbe3a68ee5de461d30415a8165cf9aefe1171` | Second planned facility; requires separate risk limits and liquidity review. |

The canonical X Layer USDG address is `0x4ae46a509f6b1d9056937ba4500cb143933d2dc8`, also listed in [OKX's X Layer contract directory](https://web3.okx.com/onchainos/dev-docs/xlayer/developer/build-on-xlayer/contracts). The issuer API reports six decimals for its X Layer USDG route. Do not substitute a similarly named token.

## Integration design

Mainnet recheck, 26 September 2026: `npm run verify:assets -- NVDAx TSLAx` passed against the issuer API and X Layer. NVDAx's Chainlink v10 feed is `0x000a37a55df2ef907d8fa06af6632bc16da58a62b68be2e1994efaa037a0918a`; TSLAx's is `0x000a80c655069b61d168b887d5e7f4231fe288c6ccb84b1854c9ccead20f3398`. Both list verifier `0xcE73c8ad08CBDEaCa6078BF0627C8fe0a9a536E7`. Observed underlying units per whole wrapper share were `1001701196801074000` for NVDAx and `1000000000000000000` for TSLAx. Neither asset was reported halted. Feed registration is not proof of subscription access or signed-report verification.

The existing `deploy:xstock` command is an older paused integration deployment using `VadiumPool` and a publisher oracle. It does not deploy the current credit candidate or a verified-report oracle. Replace that path after the report integration and review gates are met; do not enable it as the production release.

1. **Collateral:** use the issuer's current V2 ERC-4626 wrapper. Raw EVM xStocks rebase and cannot be safely tracked by `collateralOf` as fixed token units. The [issuer's wrapper guidance](https://docs.xstocks.fi/developers/wrapped-xstocks) explicitly rejects legacy V1 wrappers as collateral.
2. **Valuation:** obtain an independent USD price for the underlying xStock, then convert wrapper shares to underlying units with `convertToAssets()`. The local pool contract now implements this valuation path when `underlyingCollateral` is configured. The wrapper exchange rate is an accounting conversion, never the price feed.
3. **Oracle:** the issuer [lists Chainlink pull feeds on X Layer](https://docs.xstocks.fi/apis/openapi/oracles/get_public_oracles_by_symbol). AAPLx feed ID: `0x000a7a12270b5a30236bf410679df0c6bb1bba2b40e5d86847748ff1c8f8452b`; verifier: `0xcE73c8ad08CBDEaCa6078BF0627C8fe0a9a536E7`. `VerifiedMarketRiskOracle.sol` now decodes a verified v10 report and applies timestamp, replay, and corporate-action guards; it has only been tested with a local mock verifier. Live signed reports, access credentials, deviation policy, heartbeat, outage operations, and independent review remain release gates. The issuer's cached indicative price endpoint is useful for comparison but is not sufficient as the sole lending oracle.
4. **Risk state:** distinguish equity reference-market state from 24/7 secondary trading. The issuer API reports a 24/5 trading mode for these assets, while issuer documentation says onchain secondary trading may continue around the clock. Session haircuts need a documented policy and tests for extended hours, holidays, halts, splits, and stale data.

## Market data available to the builder

The [OKX Builder Kit](https://www.okx.com/learn/okx-dev-day-builder-kit) links X Layer and RWA resources but does not include a licensed equities feed or credentials for publishing one. These are the available integration paths:

| Source | What is available | Use in Vadium |
| --- | --- | --- |
| [xStocks public API](https://docs.xstocks.fi/developers) | Unauthenticated metadata, current wrappers, listed oracle feeds, cached asset price data, and corporate-action details. | Asset discovery and UI comparison. Cached indicative price data has no signed proof for an onchain lending decision. |
| [Chainlink tokenized-asset Data Streams](https://docs.chain.link/data-streams/reference/report-schema-v10) | The issuer lists X Layer v10 feed IDs and verifier addresses; Chainlink offers self-serve Data Streams access. Reports include signed price, reference-market state, timestamps, and corporate-action multipliers. | Primary candidate for collateral valuation after live subscription, signed-report verification, policy review, and monitoring. |
| Existing OKX candle dataset | Historical trading observations used by the testnet demo publisher. | Regression and exploratory liquidity analysis only until source rights, coverage, and a reliable live ingestion path are confirmed. |

Public API access does not establish permission to use or redistribute the data commercially. The issuer's [site terms](https://xstocks.fi/documents/xstocks-terms-of-service.pdf) describe informational use and restrict commercial use of its services; confirm the applicable API/data terms with the issuer and the Chainlink subscription terms before release.

The signed report does not supply a defensible X Layer liquidation-depth score. Vadium still needs a separately reviewed liquidity source and a conservative policy for thin or unavailable markets. A publisher-controlled score is not sufficient for an unrestricted mainnet market.

## Release gates

- [x] Verify issuer token, current wrapper, wrapper underlying, USDG route, and X Layer contract code for candidate assets.
- [x] Reproduce local compilation, tests, and static build from this repository.
- [x] Add wrapper-aware valuation to the local pool contract with a regression test.
- [x] Add wallet wrap and unwrap controls for a configured live market, with wrapper previews and a local wrap → pool deposit → withdraw → unwrap test.
- [ ] Decide launch asset and document market-specific LTV, liquidation threshold, debt ceiling, liquidity cap, and economics. The deployed demo pool has no interest or loss socialization model; the local `VadiumCreditPool` candidate has both but has not been deployed or reviewed.
- [x] Implement the local v10 report verifier adapter and test its price, session, replay, and corporate-action behavior against a mock verifier.
- [ ] Test against a real signed X Layer report, then build monitored publication with bounded retries and outage alerts. Store raw publication inputs so onchain commitments can be independently checked.
- [x] Add a pool pause for new supplies and borrows while keeping repay and collateral top-ups available in the local contract.
- [ ] Assign pool and oracle ownership to separate controlled roles and document incident procedures.
- [ ] Audit the new pool, oracle integration, wrapper assumptions, liquidation rounding, token behavior, and bad-debt handling. The [internal liquidation review](liquidation-review.md) records a local dust settlement candidate and unresolved economics, close-factor, and reserve policies; independent review remains required.
- [ ] Review issuer distribution restrictions and the product's own legal and operating requirements for intended regions. [Issuer product terms](https://assets.backed.fi/products/apple-xstock) identify restricted jurisdictions.
- [ ] Deploy a new mainnet pool with the verified wrapper and USDG, verify source code and ownership, and publish the exact addresses. Never reuse the demo-collateral mainnet pool as the release market.
- [ ] Run a capped end-to-end mainnet transaction path with real assets, reconcile balances and events, and inspect the deployed site before enabling wider deposits.

## Dev Day evidence

The [OKX Builder Kit](https://www.okx.com/learn/okx-dev-day-builder-kit) lists **25 September 2026, 23:59 UTC** as the project submission deadline. Build a Market requires a working X Layer integration, contract addresses and technical links, and a demo video of the flow. Existing projects need a clear account of what was added during the official build period. Keep the testnet flow as a reproducible test environment and describe the current mainnet USDG transaction proof accurately until the release gates above are met.
