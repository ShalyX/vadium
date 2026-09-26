import fs from 'node:fs';
import {
  concat,
  getBytes,
  isHexString,
  keccak256,
  parseUnits,
  recoverAddress,
  toBeHex,
  toUtf8Bytes,
} from 'ethers';

// Read-only access probe. HTTP success is NOT signature or feed verification.
const gateway = 'https://oracle-gateway.a.redstone.finance';
const service = 'redstone-primary-prod';
const apiKey = process.env.REDSTONE_API_KEY;
const authorizedSigners = new Set([
  '0x8bb8f32df04c8b654987daaed53d6b6091e3b774',
  '0xdeb22f54738d54976c4c0fe5ce6d408e40d88499',
  '0x51ce04be4b3e32572c4ec9135221d0691ba7d202',
  '0xdd682daec5a90dd295d14da4b0bec9281017b5be',
  '0x9c5ae89c4af6aa32ce58588dbaf90d18a855b6de',
]);
const sources = {
  gateway: 'https://github.com/redstone-finance/redstone-oracles-monorepo/blob/main/packages/sdk/src/data-services-urls.ts',
  request: 'https://github.com/redstone-finance/redstone-oracles-monorepo/blob/main/packages/sdk/src/fetch-data-packages.ts',
  protocol: 'https://github.com/redstone-finance/redstone-oracles-monorepo/blob/main/packages/protocol/src/data-package/DataPackage.ts',
  signers: 'https://github.com/redstone-finance/redstone-oracles-monorepo/blob/main/packages/evm-connector/contracts/data-services/PrimaryProdDataServiceConsumerBase.sol',
};

const intBytes = (value, byteSize) => getBytes(toBeHex(BigInt(value), byteSize));

// Mirrors RedStone protocol serialization for numeric data points. This is an
// off-chain evidence check only; it does not authorize a lending action.
function feedIdBytes(feedId) {
  if (feedId.length > 31) return getBytes(keccak256(isHexString(feedId) ? feedId : toUtf8Bytes(feedId)));
  const bytes = getBytes(toUtf8Bytes(feedId));
  return concat([bytes, new Uint8Array(32 - bytes.length)]);
}

function numericValueBytes(value, decimals = 8, byteSize = 32) {
  const scaled = parseUnits(String(value), decimals);
  return getBytes(toBeHex(scaled, byteSize));
}

function serializeDataPackage(dataPackage) {
  const points = [...(dataPackage.dataPoints || [])].sort((a, b) =>
    Buffer.from(feedIdBytes(String(a.dataFeedId))).compare(Buffer.from(feedIdBytes(String(b.dataFeedId))))
  );
  const byteSize = Number(points[0]?.valueByteSize ?? 32);
  const pointBytes = points.map(point => concat([
    feedIdBytes(String(point.dataFeedId)),
    numericValueBytes(point.value, Number(point.decimals ?? 8), Number(point.valueByteSize ?? byteSize)),
  ]));
  return concat([
    ...pointBytes,
    intBytes(dataPackage.timestampMilliseconds, 6),
    intBytes(byteSize, 4),
    intBytes(points.length, 3),
  ]);
}

function verifyPackage(pkg, requestedFeed) {
  try {
    const packageBytes = serializeDataPackage(pkg);
    const signatureBytes = Buffer.from(String(pkg.signature), 'base64');
    if (signatureBytes.length !== 65) throw new Error(`signature has ${signatureBytes.length} bytes`);
    const signer = recoverAddress(keccak256(packageBytes), `0x${signatureBytes.toString('hex')}`).toLowerCase();
    const requested = (pkg.dataPoints || []).some(point => String(point.dataFeedId) === requestedFeed);
    return {
      signer,
      signerAuthorized: authorizedSigners.has(signer),
      feedPresent: requested,
      timestampMilliseconds: Number(pkg.timestampMilliseconds),
      signatureVerified: authorizedSigners.has(signer) && requested,
    };
  } catch (error) {
    return { signatureVerified: false, verificationError: error.message };
  }
}

const results = await Promise.all(['NVDA', 'TSLA', 'NVDAx', 'TSLAx', 'BTC'].map(async feed => {
  const url = `${gateway}/v2/data-packages/latest-by-data-feeds/${service}?dataFeedIds=${feed}`;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: apiKey ? { 'x-api-key': apiKey } : undefined,
    });
    const body = await response.text();
    let data;
    try { data = JSON.parse(body); } catch { data = null; }
    const packages = data && !Array.isArray(data) && typeof data === 'object'
      ? Object.values(data).flat().filter(p => p && typeof p === 'object' && p.signature && p.dataPoints) : [];
    const verification = packages.map(pkg => verifyPackage(pkg, feed));
    const verifiedPackages = verification.filter(item => item.signatureVerified);
    const uniqueAuthorizedSigners = new Set(verification.filter(item => item.signerAuthorized).map(item => item.signer));
    return { feed, url, httpStatus: response.status, packagesReturned: packages.length,
      signatureVerified: verifiedPackages.length > 0,
      verifiedPackages: verifiedPackages.length,
      uniqueAuthorizedSigners: uniqueAuthorizedSigners.size,
      verification,
      access: response.status === 401 || response.status === 403
        ? 'access-denied' : packages.length ? 'packages-received-unverified' : 'no-packages',
      ...(packages.length ? { packages } : { response: body.slice(0, 1000) }) };
  } catch (error) {
    return { feed, url, access: 'request-failed', error: error.cause?.code || error.message, signatureVerified: false };
  }
}));
const evidence = { checkedAt: new Date().toISOString(), authentication: apiKey ? 'api-key' : 'none', service, sources,
  productionConsumer: { uniqueSignersRequired: 3, authorizedSigners: [...authorizedSigners] },
  readyForIntegration: false, results };
fs.writeFileSync(new URL('../deployments/redstone-access-probe.json', import.meta.url), JSON.stringify(evidence, null, 2));
for (const r of results) console.log(`${r.feed}: ${r.httpStatus || r.error} / ${r.access}`);
console.log('Saved deployments/redstone-access-probe.json; no oracle or funds changed.');
