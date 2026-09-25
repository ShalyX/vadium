# Vadium

Vadium is a session-aware lending market for tokenized equities on X Layer. It changes the credit available for new risk-taking when the reference market is closed, price data is old, or onchain liquidity is thin. Repayment and collateral top-ups are never disabled, and a session change cannot by itself liquidate an existing position.

## Live X Layer testnet deployment

- Pool: [`0xE74520d6B698b5Cc61c57152314c46933547751B`](https://www.okx.com/web3/explorer/xlayer-test/address/0xE74520d6B698b5Cc61c57152314c46933547751B)
- Market risk oracle: [`0xbC3b450c649Fb3020AE1C692b502BF85d6cD390a`](https://www.okx.com/web3/explorer/xlayer-test/address/0xbC3b450c649Fb3020AE1C692b502BF85d6cD390a)
- Demo AAPLx: [`0x235b537e0bc3549959E0aebf5528d8677E43FB02`](https://www.okx.com/web3/explorer/xlayer-test/address/0x235b537e0bc3549959E0aebf5528d8677E43FB02)
- Demo dUSD: [`0x588eb96429A3c22f22848185F2b5FfD08AdfD8Ae`](https://www.okx.com/web3/explorer/xlayer-test/address/0x588eb96429A3c22f22848185F2b5FfD08AdfD8Ae)

The pool was initialized with 50,000 dUSD of test liquidity. The latest oracle update intentionally reports `Unavailable`: the saved AAPL observation exceeded the six-hour freshness limit and the live OKX refresh was unreachable. This demonstrates Vadium's fail-closed path without presenting stale data as live.

## MVP scope

- One isolated xStock/stablecoin lending pool per deployment
- Lender deposits and share-based withdrawals
- Collateral deposit, borrow, repay, collateral withdrawal, and liquidation
- Onchain market state, freshness, liquidity, price, timestamp, and input commitment
- Wallet-connected interface with no silent demo fallback
- X Layer testnet demo deployment script with faucet-style mock assets

The testnet token contracts are deliberately permissionless demo faucets. They are not production assets. Mainnet deployment must use real token contracts, reviewed oracle operations, and audited pool code.

## Verify locally

The workspace already contains the shared `solc`, `ethers`, and Ganache runtime used by the tests.

```bash
npm test
npm run compile
npm run build
```

Serve this directory with any static server to inspect the interface. Until `deployment-config.js` contains deployed addresses, the interface clearly reports that it is unconfigured and will not simulate balances or transactions.

## Deploy the demo to X Layer testnet

1. Copy `.env.example` to `.env.local`.
2. Add a dedicated testnet deployer private key with testnet OKB. Never use a wallet that holds real funds.
3. Run `npm run deploy:demo`.
4. The script deploys demo dUSD, demo AAPLx, the oracle, and the pool; seeds lender liquidity; publishes the initial risk state; and updates `deployment-config.js`.

After refreshing the OKX candle dataset, run `npm run publish:risk`. The publisher uses the last confirmed non-zero-volume observation, the existing decaying freshness formula, and volume normalized against the ticker's own historical hour-of-week. If either component is unavailable, it publishes an explicit halt instead of manufacturing a confidence score. The current market calendar check covers weekday/session hours; exchange holidays remain a documented MVP limitation.

Verified X Layer network values:

- Mainnet: chain ID `196`, RPC `https://rpc.xlayer.tech`
- Testnet: chain ID `1952`, RPC `https://testrpc.xlayer.tech/terigon`
- Mainnet USDG: `0x4ae46a509F6b1D9056937BA4500cb143933D2dc8`

Official references: [X Layer network information](https://web3.okx.com/onchainos/dev-docs/xlayer/developer/build-on-xlayer/network-information), [X Layer contracts and token addresses](https://web3.okx.com/onchainos/dev-docs/xlayer/developer/build-on-xlayer/contracts).

## Safety model

The credit multiplier is the minimum of freshness and normalized liquidity, capped at 100%. A closed session applies an additional configured factor. These values constrain borrowing and collateral withdrawals only. Liquidation uses a separate fixed threshold and requires a current, non-halted oracle price.

This separation prevents the protocol from creating a predictable liquidation cliff at the traditional market close.
