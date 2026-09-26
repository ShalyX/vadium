// Canonical X Layer mainnet assets. Recheck with `npm run verify:assets` before any deployment.
// These are issuer token + current V2 wrapper addresses, not a live Vadium credit facility.

export const XLAYER = Object.freeze({
  chainId: 196,
  rpcUrl: 'https://rpc.xlayer.tech',
  explorer: 'https://www.okx.com/web3/explorer/xlayer',
  usdg: '0x4ae46a509F6b1D9056937BA4500cb143933D2dc8',
});

// Conservative placeholders for a paused integration pool. Not production LTVs.
export const INTEGRATION_TERMS = Object.freeze({
  baseBorrowLtvBps: 4_000,
  liquidationLtvBps: 6_000,
  closedSessionFactorBps: 5_000,
  minFreshnessBps: 7_000,
  minLiquidityBps: 5_000,
  liquidationBonusBps: 500,
  debtCeilingUsdg: '100',
  oracleTtlSeconds: 6 * 3600,
});

export const MARKETS = Object.freeze({
  NVDAx: Object.freeze({
    symbol: 'NVDAx',
    name: 'Nvidia tokenized exposure',
    token: '0xc845b2894dbddd03858fd2d643b4ef725fe0849d',
    wrapper: '0xa8ddb5cd96b5222afe198316e9a57caa642850d5',
    terms: INTEGRATION_TERMS,
  }),
  TSLAx: Object.freeze({
    symbol: 'TSLAx',
    name: 'Tesla tokenized exposure',
    token: '0x8ad3c73f833d3f9a523ab01476625f269aeb7cf0',
    wrapper: '0xc3fdbe3a68ee5de461d30415a8165cf9aefe1171',
    terms: INTEGRATION_TERMS,
  }),
});
