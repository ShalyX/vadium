// Amounts are integer token units. Keep all repayment arithmetic out of floats.
export function repaymentPlan(debt, balance, requested) {
  if ([debt, balance, requested].some((value) => typeof value !== 'bigint' || value < 0n)) {
    throw new RangeError('Repayment amounts must be nonnegative integer token units.');
  }
  const payment = requested < debt ? requested : debt;
  return {
    payment,
    remaining: debt - payment,
    shortfall: debt > balance ? debt - balance : 0n,
    canRepayFull: debt > 0n && balance >= debt,
    valid: payment > 0n && payment <= balance,
  };
}
