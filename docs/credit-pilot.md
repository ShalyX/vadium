# Credit rehearsal

Run `npm run pilot:credit` for an isolated local chain, or `npm run pilot:credit -- --testnet` for X Layer testnet (1952). The testnet command uses the configured deployer and faucet gas. It refuses other networks and never changes the public application's deployment configuration.

The runner deploys the current `VadiumCreditPool`, an ERC-4626 test wrapper, six-decimal demo USDG, and `VerifiedMarketRiskOracle` connected to an explicitly **mock** verifier. The oracle asset key must be the wrapper address because the pool queries risk using its collateral address; the price is still per underlying unit.

It executes wrap, collateral deposit, lender supply, report publication, draw, pause, full repayment, collateral withdrawal, unwrap, and lender redemption. Local runs advance one day to exercise interest and stale-report repayment. Local borrower and lender are separate accounts; testnet uses the configured operator for both roles to avoid funding extra wallets.

Assertions check replay rejection, blocked draws during pause, exact lender earnings, zero final debt, zero deposited collateral, zero wrapper balance, full underlying return, and zero remaining pool cash. Each confirmed transaction is checkpointed in `deployments/credit-pilot.testnet.json` (local results are ignored by Git). Recover an interrupted testnet sequence with `npm run pilot:credit -- --testnet --resume`. This reuses contracts and skips confirmed steps. Investigate unconfirmed submissions before resuming. Without `--resume`, the command deploys fresh contracts. Reads use confirmed block numbers with bounded retries when an RPC replica is behind.

All prices and economic terms in this rehearsal are synthetic. Successful execution proves contract integration, not real Chainlink authentication or approved mainnet terms. Real Data Streams credentials and a signed report are the next external integration dependency.
