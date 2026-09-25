import { Contract, JsonRpcProvider } from 'ethers';

const symbols = process.argv.slice(2).length ? process.argv.slice(2) : ['AAPLx', 'SPYx', 'NVDAx', 'TSLAx'];
const provider = new JsonRpcProvider('https://rpc.xlayer.tech', 196, { staticNetwork: true });
const usdG = '0x4ae46a509f6b1d9056937ba4500cb143933d2dc8';
const wrapperAbi = [
  'function asset() view returns (address)',
  'function decimals() view returns (uint8)',
  'function convertToAssets(uint256) view returns (uint256)',
];

async function issuerJson(path) {
  const response = await fetch(`https://api.xstocks.fi/api/v2${path}`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Issuer API ${path}: HTTP ${response.status}`);
  return response.json();
}

try {
  for (const symbol of symbols) {
    if (!/^[A-Za-z0-9]+x$/.test(symbol)) throw new Error(`Invalid asset symbol: ${symbol}`);
    const [asset, oracle] = await Promise.all([
      issuerJson(`/public/assets/${symbol}`),
      issuerJson(`/public/oracles/${symbol}?network=XLayer`),
    ]);
    const deployment = asset.deployments?.find((entry) => entry.network === 'XLayer');
    const wrapperAddress = deployment?.wrapperAddressV2;
    const stable = deployment?.stablecoins?.find((entry) => entry.symbol === 'USDG');
    const feed = oracle.nodes?.find((entry) => entry.network === 'XLayer' && entry.managedBy === 'Chainlink');
    if (!deployment?.address || !wrapperAddress || !feed?.metadata?.feedId || !stable?.address
      || feed.metadata.reportSchema !== 'v10' || feed.metadata.decimals !== 18 || !feed.metadata.verifierContract) {
      throw new Error(`${symbol}: missing X Layer token, V2 wrapper, Chainlink feed, or USDG route`);
    }
    if (stable.address.toLowerCase() !== usdG) throw new Error(`${symbol}: unexpected USDG address`);
    if (asset.isTradingHalted) throw new Error(`${symbol}: issuer reports trading halted`);
    const [tokenCode, wrapperCode, stableCode, verifierCode] = await Promise.all([
      provider.getCode(deployment.address), provider.getCode(wrapperAddress), provider.getCode(stable.address),
      provider.getCode(feed.metadata.verifierContract),
    ]);
    if ([tokenCode, wrapperCode, stableCode, verifierCode].some((code) => code === '0x')) throw new Error(`${symbol}: contract code missing on X Layer`);
    const wrapper = new Contract(wrapperAddress, wrapperAbi, provider);
    const [underlying, decimals] = await Promise.all([wrapper.asset(), wrapper.decimals()]);
    if (underlying.toLowerCase() !== deployment.address.toLowerCase()) throw new Error(`${symbol}: wrapper asset() does not match issuer token`);
    const assetsPerWholeShare = await wrapper.convertToAssets(10n ** BigInt(decimals));
    if (assetsPerWholeShare <= 0n) throw new Error(`${symbol}: wrapper conversion is zero`);
    console.log(JSON.stringify({
      symbol, network: 'X Layer', chainId: 196, token: deployment.address,
      wrapperV2: wrapperAddress, wrapperDecimals: Number(decimals),
      assetsPerWholeShare: assetsPerWholeShare.toString(), stable: stable.address,
      chainlinkFeedId: feed.metadata.feedId, verifier: feed.metadata.verifierContract,
      tradingHalted: asset.isTradingHalted,
      source: `https://api.xstocks.fi/api/v2/public/assets/${symbol}`,
    }));
  }
} finally {
  provider.destroy();
}
