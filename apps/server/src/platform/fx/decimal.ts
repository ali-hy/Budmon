// F-130: provider decimal parsing. Numbers keep their exact source text; rates are normalised to
// 12 decimal places through F-300.
import { parseDecimal, toFixedDecimalString, type Rational } from "@budmon/shared";

type Reviver = (key: string, value: unknown, context: { source: string }) => unknown;

/** `JSON.parse` where every number becomes its exact source text. */
export function parseJsonKeepingNumberText(text: string): unknown {
  const reviver: Reviver = (_key, value, context) =>
    typeof value === "number" ? context.source : value;
  return JSON.parse(text, reviver as (key: string, value: unknown) => unknown);
}

const UPPER_BOUND: Rational = { num: 10n ** 12n, den: 1n };

/** The rate at 12 decimal places, or null when it isn't a decimal, is ≤ 0 or is ≥ 10^12. */
export function normaliseRate(raw: string): string | null {
  let r: Rational;
  try {
    r = parseDecimal(raw);
  } catch {
    return null;
  }
  // Denominators are positive (F-300 normalises them).
  if (r.num <= 0n) return null;
  if (r.num * UPPER_BOUND.den >= UPPER_BOUND.num * r.den) return null;
  return toFixedDecimalString(r, 12);
}
