// F-130 provider decimal parsing. TP-9.1, plus extra cases TP-9.21x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it } from "vitest";
import { normaliseRate, parseJsonKeepingNumberText } from "../../../src/platform/fx/decimal.js";

describe("TP-9.1: lossless parsing and normalisation (F-130)", () => {
  it("TP-9.1: parseJsonKeepingNumberText keeps every number as its exact source text", () => {
    const parsed = parseJsonKeepingNumberText('{"rates":{"EGP":48.123456789012345,"X":1e-3}}');

    expect(parsed).toEqual({ rates: { EGP: "48.123456789012345", X: "1e-3" } });
  });

  it('TP-9.1: normaliseRate("48.123456789012345") is "48.123456789012" (12 decimal places)', () => {
    expect(normaliseRate("48.123456789012345")).toBe("48.123456789012");
  });

  it.each([["0"], ["-1"], ["1e12"], ["abc"]])("TP-9.1: normaliseRate(%j) is null", (raw) => {
    expect(normaliseRate(raw)).toBeNull();
  });

  it("TP-9.21x: strings, booleans and nested arrays are unchanged; a number in an array keeps its text", () => {
    expect(parseJsonKeepingNumberText('{"a":"1.50","b":true,"c":[0.10,2],"d":null}')).toEqual({
      a: "1.50",
      b: true,
      c: ["0.10", "2"],
      d: null,
    });
  });

  it.each([
    ["48.5", "48.500000000000"],
    ["0.000000000001", "0.000000000001"],
    ["999999999999.999999999999", "999999999999.999999999999"],
  ])("TP-9.21x: normaliseRate(%j) is %j", (raw, normalised) => {
    expect(normaliseRate(raw)).toBe(normalised);
  });
});
