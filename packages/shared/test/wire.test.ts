// F-304 wire conversion. TP-1.7, plus the extra cases TP-1.18x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it } from "vitest";
import { asCurrencyCode } from "../src/money/currency.js";
import { Money } from "../src/money/money.js";
import {
  fromWireMoney,
  MAX_WIRE_MINOR,
  MoneyRangeError,
  toMoney,
  toWire,
  toWireMoney,
} from "../src/money/wire.js";
import { loadVectors } from "./support/vectors.js";

const EGP = asCurrencyCode("EGP");

function caught(operation: () => unknown): unknown {
  try {
    operation();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("F-304 wire conversion", () => {
  it.each(loadVectors("wire").map((c) => [c.minor, c]))(
    "TP-1.7: toWire and toWireMoney of %s match the vector",
    (_label, c) => {
      const m = Money.of(BigInt(c.minor), EGP);

      if (c.expected === "MoneyRangeError") {
        expect(() => toWire(m)).toThrow(MoneyRangeError);
        expect(() => toWireMoney(m)).toThrow(MoneyRangeError);
      } else {
        expect(toWire(m)).toBe(Number(c.expected));
        expect(toWireMoney(m)).toEqual({ amount: Number(c.expected), currency: "EGP" });
      }
    },
  );

  it.each([[2 ** 53 - 1], [-(2 ** 53 - 1)], [0], [-12345]])(
    "TP-1.7: toMoney(%d, EGP) is exact",
    (minor) => {
      const m = toMoney(minor, EGP);

      expect(m.minor).toBe(BigInt(minor));
      expect(m.currency).toBe("EGP");
    },
  );

  it.each([[1.5], [2 ** 53], [-(2 ** 53)], [Number.NaN], [Number.POSITIVE_INFINITY]])(
    "TP-1.7: toMoney(%d, EGP) throws MoneyRangeError",
    (minor) => {
      expect(() => toMoney(minor, EGP)).toThrow(MoneyRangeError);
    },
  );

  it("TP-1.18x: MAX_WIRE_MINOR is 2^53 − 1", () => {
    expect(MAX_WIRE_MINOR).toBe(9007199254740991);
  });

  it("TP-1.18x: MoneyRangeError's message holds no amount", () => {
    const error = caught(() => toWire(Money.of(98765432109876543n, EGP)));

    expect(error).toBeInstanceOf(MoneyRangeError);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain("98765432109876543");
  });

  it("TP-1.18x: fromWireMoney is the inverse of toWireMoney", () => {
    const m = fromWireMoney({ amount: -9007199254740991, currency: "KWD" });

    expect(m.minor).toBe(-9007199254740991n);
    expect(m.currency).toBe("KWD");
    expect(toWireMoney(m)).toEqual({ amount: -9007199254740991, currency: "KWD" });
  });

  it.each([["egp"], ["EG"], [""]])(
    "TP-1.18x: fromWireMoney with the invalid code %j throws TypeError",
    (currency) => {
      expect(() => fromWireMoney({ amount: 1, currency })).toThrow(TypeError);
    },
  );
});
