function priceToString(
  price,
  { decimals = 18, maximumFractionDigits, precisionAdjustment = 0 } = {}
) {
  // Babel polyfill for BigInt (exponentiation with ** doesn't work!)
  let divisor = 10n;
  for (let i = 0; i < decimals - 6 - 1; i++) {
    divisor = divisor * 10n;
  }
  const amount = Number(BigInt(price) / divisor) / 1e6;
  let parsedFractionDigits;
  if (maximumFractionDigits == null) {
    parsedFractionDigits =
      amount < 0.0001
        ? 7
        : amount < 0.01
        ? 6
        : amount < 0.01
        ? 5
        : amount < 0.1
        ? 4
        : amount < 1
        ? 3
        : amount < 100
        ? 2
        : amount < 1000
        ? 1
        : 0;
  }
  return amount.toLocaleString(undefined, {
    maximumFractionDigits:
      (maximumFractionDigits || parsedFractionDigits) + precisionAdjustment,
  });
}

module.exports = priceToString;
