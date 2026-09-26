# Vadium

The site opens at the [landing page](index.html). The [credit desk](app.html) shows the restricted NVDAx mainnet facility, position controls and recorded receipts. The completed private cycle used a synthetic test price; public borrowing is unavailable. The internal demo remains at [testnet](testnet.html); the [wrap desk](assets.html) inspects issuer tokens and V2 wrappers on X Layer mainnet.

Vadium is building revolving USDG credit lines backed by wrapped tokenized equity positions on X Layer. The first release target is separate NVDAx and TSLAx facilities. The [credit quality benchmark](docs/credit-quality-benchmark.md) defines the borrower journey, interest and lender economics, coverage controls, and mainnet release gates. The current pool is a principal-only prototype: it changes new credit when the reference market is closed, price data is old, or onchain liquidity is thin, while keeping repayment and collateral top-ups available.

**Release target:** a real wrapped xStock / USDG market on X Layer mainnet. The deployed testnet market is for testing. The current mainnet USDG pool uses permissionless demo collateral and is not the release pool. See the [mainnet release plan](docs/mainnet-release.md) for verified asset options, the required wrapper and oracle design, and remaining launch gates.

## X Layer tokenized-asset integration

The [asset preparation desk](assets.html) reads the issuer's NVDAx and TSLAx tokens and current V2 ERC-4626 wrappers on X Layer mainnet. It checks contract code and `asset()` onchain, shows wrapper conversion estimates, and supports wallet-approved wrap and unwrap transactions. Neither wrapper is connected to a public Vadium USDG credit facility. Real wrapper transactions and the completed restricted NVDAx credit cycle are recorded in [private pilot evidence](docs/private-mainnet-pilot.md).

## Operator relay development

`npm run check:issuer` collects public issuer responses without signing. `npm run rehearse:relay` exercises publication, outages, restart recovery and receipt verification on an ephemeral local chain using explicitly labelled fixtures. It writes [local rehearsal evidence](deployments/issuer-relay-rehearsal.json); mainnet publication remains disabled. See [relay operation and boundaries](docs/issuer-relay.md).

`npm run rehearse:credit-relay` exercises wrap, supply, deposit, borrow, outage, top-up, partial repayment, recovery, redraw and full closeout with that relay. [Combined lifecycle evidence](deployments/credit-relay-rehearsal.json) records local receipts, borrower/lender balances and interest reconciliation. All prices and assets in this rehearsal are explicitly local test fixtures.

## Live X Layer testnet deployment

- Pool: [`0xE74520d6B698b5Cc61c57152314c46933547751B`](https://www.okx.com/web3/explorer/xlayer-test/address/0xE74520d6B698b5Cc61c57152314c46933547751B)
- Market risk oracle: [`0xbC3b450c649Fb3020AE1C692b502BF85d6cD390a`](https://www.okx.com/web3/explorer/xlayer-test/address/0xbC3b450c649Fb3020AE1C692b502BF85d6cD390a)
- Demo AAPLx: [`0x235b537e0bc3549959E0aebf5528d8677E43FB02`](https://www.okx.com/web3/explorer/xlayer-test/address/0x235b537e0bc3549959E0aebf5528d8677E43FB02)
- Demo dUSD: [`0x588eb96429A3c22f22848185F2b5FfD08AdfD8Ae`](https://www.okx.com/web3/explorer/xlayer-test/address/0x588eb96429A3c22f22848185F2b5FfD08AdfD8Ae)

The pool was initialized with 50,000 dUSD of test liquidity. The app reads the oracle and pool directly from X Layer testnet. The oracle update expires after six hours; the interface shows a paused state when it does. The [latest risk publication](https://www.okx.com/web3/explorer/xlayer-test/tx/0x25e6a417adcedb792c6521bbe568364e846a4184b6711e2f230c330e0f103c06) used the confirmed AAPLx candle dataset.

## Real USDG mainnet proof

An experimental pool is deployed on X Layer mainnet with the canonical USDG contract as its stable asset. The collateral remains a demo AAPLx token that anyone can mint. This deployment is transaction proof; **do not supply real funds to this pool**.

- Pool: [`0x5d2194c68E3b0902b0B2f95eDd53Bc2De31d18cd`](https://www.okx.com/web3/explorer/xlayer/address/0x5d2194c68E3b0902b0B2f95eDd53Bc2De31d18cd)
- Market risk oracle: [`0x1d1dEda15055948e274c716B062928B3239D8DE3`](https://www.okx.com/web3/explorer/xlayer/address/0x1d1dEda15055948e274c716B062928B3239D8DE3)
- Demo AAPLx: [`0xeae5140AB19f9f08D4fE18015B5B40896a5821EC`](https://www.okx.com/web3/explorer/xlayer/address/0xeae5140AB19f9f08D4fE18015B5B40896a5821EC)
- USDG: [`0x4ae46a509F6b1D9056937BA4500cb143933D2dc8`](https://www.okx.com/web3/explorer/xlayer/address/0x4ae46a509F6b1D9056937BA4500cb143933D2dc8)
- Real borrow proof: [`0xa882397229c4ab8557a77f77bba2d790dec51184a3a8254469bc706f45d6d585`](https://www.okx.com/web3/explorer/xlayer/tx/0xa882397229c4ab8557a77f77bba2d790dec51184a3a8254469bc706f45d6d585)
- Repayment while risk was paused: [`0x218343687fdcb833a85d395b39a5b351da8de66b31d4a58cfd52d3c71272194b`](https://www.okx.com/web3/explorer/xlayer/tx/0x218343687fdcb833a85d395b39a5b351da8de66b31d4a58cfd52d3c71272194b)

The proof supplied `0.01 USDG`, borrowed `0.005 USDG`, reduced capacity from `2.179967` to `1.634975 USDG` when the market closed, and reduced new credit to zero when data became unavailable. Repayment remained enabled. The collateral and liquidity were then withdrawn, leaving zero debt and returning the wallet's USDG balance to its starting value.

## MVP scope

- One isolated xStock/stablecoin lending pool per deployment
- Lender deposits and share-based withdrawals
- Collateral deposit, borrow, repay, collateral withdrawal, and liquidation
- Onchain market state, freshness, liquidity, price, timestamp, and input commitment
- Wallet-connected interface with no silent demo fallback
- X Layer testnet demo deployment script with faucet-style mock assets

The browser prototype now lets a new testnet user mint demo AAPLx or dUSD, preview borrowing power before depositing, deposit collateral, borrow, repay, withdraw, supply liquidity, and redeem shares. Pool liquidity and the market risk state are visible before wallet connection. The oracle publisher is still operator-run; it is not an unattended data service. The mainnet USDG proof uses demo collateral and should be treated as transaction evidence, not as a live lending market for real collateral.

When a reviewed mainnet market is configured with `marketMode: 'live'`, the app also shows the issuer wrapper flow: wallet balances, `previewDeposit`/`previewRedeem` estimates, exact-amount approval for raw xStock, wrap, and unwrap after collateral withdrawal. These controls remain hidden on the testnet demo and the read-only mainnet proof. Wrapping uses the current V2 ERC-4626 wrapper; it does not imply that a mainnet lending pool has been approved or deployed.

The demo token contracts are deliberately permissionless faucets. They are not production assets. A production deployment requires real collateral contracts, reviewed oracle operations, and audited pool code.

## Verify locally

Install the pinned dependencies in this repository, then run the full check:

```bash
npm ci --ignore-scripts
npm run check
npm run verify:assets
```

Serve `public/` with any static server, or run `npm run dev` to open the local build at `http://127.0.0.1:4173`. The build copies the pinned Ethers browser module locally, so wallet actions do not depend on a CDN script at runtime. Until `deployment-config.js` contains deployed addresses, the interface clearly reports that it is unconfigured and will not simulate balances or transactions.

## Deploy the demo to X Layer testnet

1. Copy `.env.example` to `.env.local`.
2. Add a dedicated testnet deployer private key with testnet OKB. Never use a wallet that holds real funds.
3. Run `npm run deploy:demo`.
4. The script deploys demo dUSD, demo AAPLx, the oracle, and the pool; seeds lender liquidity; publishes the initial risk state; and updates `deployment-config.js`.

The mainnet proof scripts are deliberately gated by `RUN_VADIUM_MAINNET=1`. `npm run deploy:usdg` deploys an empty real-USDG pool, while `npm run demo:usdg` runs the reversible micro-loan and writes its receipt evidence to `deployments/loan-demo-usdg.json`.

After refreshing the OKX candle dataset, run `npm run publish:risk`. The publisher uses the last confirmed non-zero-volume observation, the existing decaying freshness formula, and volume normalized against the ticker's own historical hour-of-week. If either component is unavailable, it publishes an explicit halt instead of manufacturing a confidence score. The current market calendar check covers weekday/session hours; exchange holidays remain a documented MVP limitation.

Verified X Layer network values:

- Mainnet: chain ID `196`, RPC `https://rpc.xlayer.tech`
- Testnet: chain ID `1952`, RPC `https://testrpc.xlayer.tech/terigon`
- Mainnet USDG: `0x4ae46a509F6b1D9056937BA4500cb143933D2dc8`

Official references: [X Layer network information](https://web3.okx.com/onchainos/dev-docs/xlayer/developer/build-on-xlayer/network-information), [X Layer contracts and token addresses](https://web3.okx.com/onchainos/dev-docs/xlayer/developer/build-on-xlayer/contracts).

## Safety model

The credit multiplier is the minimum of freshness and normalized liquidity, capped at 100%. A closed session applies an additional configured factor. These values constrain borrowing and collateral withdrawals only. Liquidation uses a separate fixed threshold and requires a current, non-halted oracle price.

This separation prevents the protocol from creating a predictable liquidation cliff at the traditional market close.
