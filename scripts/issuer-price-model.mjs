import { ethers } from 'ethers';

// This endpoint documents { quote: number }, with no price observation timestamp.
// HTTP receipt time and Date headers are transport metadata, not price freshness.
export function evaluateIssuerPrice({ market, metadata, priceResponse }) {
  const reasons = [];
  const deployment = Array.isArray(metadata?.deployments) ? metadata.deployments.find(x => x?.network === 'XLayer') : null;
  const address = value => typeof value === 'string' ? value.toLowerCase() : null;
  if (metadata?.symbol !== market.symbol || address(deployment?.address) !== market.token.toLowerCase()
      || address(deployment?.wrapperAddressV2) !== market.wrapper.toLowerCase()) reasons.push('ASSET_IDENTITY_MISMATCH');
  const trading = metadata?.trading;
  if (metadata?.underlying?.currency !== 'USD' || trading?.currency !== 'USD') reasons.push('USD_CURRENCY_NOT_CONFIRMED');
  if (metadata?.isTradingHalted !== false || trading?.isTradingHalted !== false) reasons.push('HALTED_OR_UNKNOWN');
  if (!trading || typeof trading.openNow !== 'boolean' || !['market','extended','overnight','closed'].includes(trading.currentPeriod)) reasons.push('UNKNOWN_SESSION');
  else if (!trading.openNow || trading.currentPeriod === 'closed') reasons.push('MARKET_CLOSED');

  let indicativePrice18 = null;
  if (!priceResponse || !Object.hasOwn(priceResponse, 'quote') || priceResponse.quote === null) reasons.push('QUOTE_UNAVAILABLE');
  else if (typeof priceResponse.quote !== 'number' || !Number.isFinite(priceResponse.quote) || priceResponse.quote <= 0) reasons.push('INVALID_QUOTE');
  else {
    try {
      // Never round a large/imprecise JSON number into an onchain lending price.
      const value = ethers.parseUnits(String(priceResponse.quote),18);
      if (value <= 0n || value >= 2n ** 128n || priceResponse.quote > Number.MAX_SAFE_INTEGER) throw Error('Invalid quote precision');
      indicativePrice18 = value.toString();
    } catch { reasons.push('UNSUPPORTED_QUOTE_PRECISION'); }
  }
  // Unknown fields (including timestamp-like fields) cannot silently change the
  // documented schema or supply trusted freshness. A reviewed adapter is required.
  if (indicativePrice18 !== null) reasons.push('SOURCE_OBSERVATION_TIME_UNAVAILABLE');
  return { publishable: false, trustModel: 'operator-relayed-unsigned-issuer-api', indicativePrice18,
    sourceObservedAt: null, reasons, marketPeriod: trading?.currentPeriod ?? null };
}

export function unavailableRisk(now, inputsHash) {
  if (!Number.isSafeInteger(now) || now <= 0) throw Error('Invalid outage timestamp');
  if (!ethers.isHexString(inputsHash,32)) throw Error('Invalid evidence hash');
  // This is the time an outage was observed, never a new timestamp for an old price.
  return { price: '0', freshnessBps: 0, liquidityBps: 0, asOf: now, state: 2, inputsHash };
}

export async function fetchIssuerJson(url, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const fetchedAt = new Date().toISOString();
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error', headers: { accept: 'application/json' } });
    const body = await response.text();
    const headers = Object.fromEntries([...response.headers].filter(([key]) => /^(date|cache-control|age|retry-after|x-ratelimit-.*)$/.test(key)));
    if (!response.ok) return { url, fetchedAt, status: response.status, headers, body, error: 'HTTP_ERROR' };
    let data;
    try { data = JSON.parse(body); } catch { return { url, fetchedAt, status: response.status, headers, body, error: 'MALFORMED_JSON' }; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { url, fetchedAt, status: response.status, headers, body, error: 'INVALID_RESPONSE' };
    return { url, fetchedAt, status: response.status, headers, body, data };
  } catch (error) {
    return { url, fetchedAt, status: null, error: error.name === 'TimeoutError' || error.name === 'AbortError' ? 'TIMEOUT' : 'FETCH_FAILED' };
  }
}
