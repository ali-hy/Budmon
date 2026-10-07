// F-303: currency conversion through USD rates, rounding once.
import type { CurrencyCode } from "./currency.js";
import { Money } from "./money.js";
import { rational, roundHalfEven, type Rational } from "./rational.js";

export function convertWithRates(
  m: Money,
  from: { unitsPerUsd: Rational; minorUnits: number },
  to: { currency: CurrencyCode; unitsPerUsd: Rational; minorUnits: number },
): Money {
  if (m.currency === to.currency) {
    return m;
  }
  if (from.unitsPerUsd.num <= 0n || to.unitsPerUsd.num <= 0n) {
    throw new RangeError("Rates must be positive");
  }
  const fromScale = 10n ** BigInt(from.minorUnits);
  const toScale = 10n ** BigInt(to.minorUnits);
  const converted = rational(
    m.minor * to.unitsPerUsd.num * from.unitsPerUsd.den * toScale,
    to.unitsPerUsd.den * from.unitsPerUsd.num * fromScale,
  );
  return Money.of(roundHalfEven(converted), to.currency);
}
