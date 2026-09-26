# Vadium

**USDG credit against wrapped tokenized equity on X Layer.**

Vadium is building separate revolving NVDAx and TSLAx credit lines. Borrowers wrap issuer tokens, deposit collateral, draw USDG, then repay and recover their position. Lenders earn the interest paid by borrowers.

[Hosted product](https://vadium.vercel.app) · [Repository](https://github.com/ShalyX/vadium) · [Review package](docs/review-package.md)

## What works

| Component | Verified scope |
| --- | --- |
| Asset integration | Current issuer V2 NVDAx and TSLAx wrappers on X Layer; token checks, balances, conversion previews and wallet wrap/unwrap |
| Private mainnet cycle | Real wrapped NVDAx; 0.005 USDG borrowed, 0.005001 repaid and 0.020001 redeemed by the lender |
| Credit candidate | Interest, wrapper valuation, liquidation and lender-loss accounting tested locally |
| Local relay | Durable transaction publication, restart recovery, outage handling and receipt validation |
| Combined rehearsal | Wrap through lender redemption, including outage, top-up, repayment, recovery and redraw |

**Public borrowing is unavailable.** The mainnet pilot was restricted to one participant and used a fixed synthetic $100 underlying price. It verifies execution, not a live market feed. Local rehearsal assets and prices are explicitly synthetic.

## Review the evidence

Run locally and open `/review.html` for a wallet-free build overview. `/assets.html` reads mainnet wrappers. `/app.html` shows the private credit desk and eight recorded steps. The internal testnet prototype is at `/testnet.html`.

- Private facility: `0x7539200A18333B77F6C4a2f8a7cbc61dddFb5E08`
- [Credit receipts](deployments/private-pilot.onchain-evidence.json) and [wrapper receipts](deployments/private-pilot.wrapper-evidence.json)
- [Combined local rehearsal](deployments/credit-relay-rehearsal.json)
- [Pilot scope and restrictions](docs/private-mainnet-pilot.md)

At recorded block 71,672,097, debt, deposited collateral, lender shares and pool cash were zero. This is historical evidence. Older demo-collateral deployments are experiments and must not receive deposits.

## Run and verify

Use Node.js 24 and npm. No wallet key or subscription is needed for the build and local tests.

```sh
npm ci --ignore-scripts
npm run check
npm run dev
```

Open `http://127.0.0.1:4173`. Mainnet reads need network access; wallet transactions need an injected wallet. Missing access is reported instead of replaced with simulated balances.

```sh
npm run rehearse:relay
npm run rehearse:credit-relay
npm run check:issuer
npm run package:review
```

The last full contract gate passed 42 tests and compiled 17 contracts. The relay commands generate labelled local evidence; the issuer command is read-only. Review requires no new deployment. See the [relay runbook](docs/issuer-relay.md).

## Release boundaries

Shares are valued using `convertToAssets` and an underlying price. New credit needs acceptable data; repayments and top-ups remain available during outages. Interest and realized losses affect lender share value.

Mainnet relay publication remains disabled. The issuer HTTP endpoint has not provided usable pricing with a documented observation time. Public lending also needs reviewed risk/liquidity parameters, operational controls, rights/jurisdiction review and independent contract review. See the [release plan](docs/mainnet-release.md).

xStocks are tracker certificates with economic exposure, not direct company shares. No universal tax outcome or guaranteed liquidity is promised.

## Package status

This package may be newer than the hosted site or GitHub default branch. Match its file manifest before presenting a deployment as the reviewed build. [Demo script](docs/demo-script.md) and [dependency notices](THIRD_PARTY_NOTICES.md) are included. The video still needs recording.

The official deadline was 25 September 2026 at 23:59 UTC. Late acceptance is unverified; newer work retains its actual timestamps.
