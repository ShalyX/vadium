const BPS = 10_000n;

export function calculateCoverage({ debt, underlyingAmount, price, underlyingDecimals, stableDecimals, liquidationLtvBps }) {
  if (underlyingDecimals < 0 || underlyingDecimals > 18 || stableDecimals < 0 || stableDecimals > 18
    || liquidationLtvBps <= 0n || liquidationLtvBps > BPS) {
    throw new Error('Invalid coverage parameters');
  }
  const valueUsd18 = underlyingAmount * price / (10n ** BigInt(underlyingDecimals));
  const stableValue = valueUsd18 / (10n ** BigInt(18 - stableDecimals));
  const threshold = stableValue * liquidationLtvBps / BPS;
  const buffer = threshold > debt ? threshold - debt : 0n;
  const ltvBps = stableValue > 0n ? debt * BPS / stableValue : null;
  const usageBps = threshold > 0n ? debt * BPS / threshold : null;
  const priceAtThreshold = underlyingAmount > 0n
    ? debt * (10n ** BigInt(18 - stableDecimals)) * (10n ** BigInt(underlyingDecimals)) * BPS
      / (underlyingAmount * liquidationLtvBps)
    : null;
  return { valueUsd18, stableValue, threshold, buffer, ltvBps, usageBps, priceAtThreshold,
    liquidatable: debt > threshold };
}
