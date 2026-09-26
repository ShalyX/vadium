// UI eligibility only. The deployed contract remains the authority for each action.
export function pilotActions(s) {
  if (!s) return {};
  const funded = s.lender > 0n && s.cash > 0n;
  return {
    supply: s.supplied === 0n && s.balance >= 21000n && s.active,
    wrap: funded && s.raw >= s.wrapAmount && s.wrapped === 0n && s.collateral === 0n && s.active,
    deposit: funded && s.wrapped > 0n && s.collateral === 0n && s.active,
    borrow: s.debt === 0n && s.capacity >= 5000n && s.cash >= 5000n && s.active,
    repay: s.debt > 0n && s.balance >= s.debt + 100n,
    withdraw: s.debt === 0n && s.collateral > 0n,
    unwrap: s.wrapped > 0n && s.collateral === 0n,
    redeem: s.debt === 0n && s.lender > 0n,
  };
}

export function pilotPosition(s) {
  if (!s) return { title: 'Connect to check your position', description: 'Recorded receipts are available below. Wallet balances load after connection.' };
  if (s.debt > 0n) return { title: 'Loan active', description: 'Repay your debt to release all collateral. Interest is included in the displayed balance.' };
  if (s.collateral > 0n) return { title: 'Collateral ready to withdraw', description: 'Your debt is clear. Withdraw collateral, then unwrap your shares.' };
  if (s.wrapped > 0n && s.supplied > 0n && s.lender === 0n) return { title: 'Unwrap remaining shares', description: 'Your credit position is closed. Wrapped shares remain in your wallet.' };
  if (s.supplied >= 20000n && s.lender === 0n && s.wrapped === 0n) return { title: 'Position closed', description: 'No debt or deposited collateral remains. The lifetime supply allowance is used; this pilot cannot be funded again.' };
  if (s.lender > 0n) return { title: 'Liquidity supplied', description: 'Prepare collateral to draw, or redeem your lender shares to exit.' };
  return { title: 'Private facility', description: 'Only the configured participant can supply or borrow. Begin with 0.02 USDG of your own funds.' };
}
