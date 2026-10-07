// TP-2.14 (U): invariants of apps/server/src/platform/fx/iso4217.json (§3.3), plus extra cases
// TP-2.32x for the rest of §3.3's rules.
import { describe, expect, it } from "vitest";
import iso4217 from "../../../src/platform/fx/iso4217.json" with { type: "json" };

interface Entry {
  code: string;
  name: string;
  minorUnits: number;
  active: boolean;
}

const entries = iso4217 as readonly Entry[];
const byCode = new Map(entries.map((e) => [e.code, e]));

describe("TP-2.14 (U): iso4217.json", () => {
  it("TP-2.14: codes are unique", () => {
    expect(new Set(entries.map((e) => e.code)).size).toBe(entries.length);
  });

  it.each([
    ["EGP", 2],
    ["JPY", 0],
    ["KWD", 3],
    ["BHD", 3],
    ["USD", 2],
  ])("TP-2.14: %s has %i minor units", (code, minorUnits) => {
    expect(byCode.get(code)?.minorUnits).toBe(minorUnits);
  });

  it.each([["XAU"], ["XAG"], ["XPT"], ["XPD"], ["XDR"], ["XTS"], ["XXX"], ["CLF"], ["BOV"]])(
    "TP-2.14: %s isn't in the file",
    (code) => {
      expect(byCode.has(code)).toBe(false);
    },
  );

  it.each([
    ["XBA"],
    ["XBB"],
    ["XBC"],
    ["XBD"],
    ["XSU"],
    ["XUA"],
    ["CHE"],
    ["CHW"],
    ["COU"],
    ["MXV"],
    ["USN"],
    ["UYI"],
    ["UYW"],
  ])("TP-2.32x: the excluded code %s isn't in the file (§3.3)", (code) => {
    expect(byCode.has(code)).toBe(false);
  });

  it("TP-2.32x: every entry fits the currencies table (code ^[A-Z]{3}$, minor units 0 to 4, a name, a boolean)", () => {
    const bad = entries.filter(
      (e) =>
        !/^[A-Z]{3}$/.test(e.code) ||
        !Number.isInteger(e.minorUnits) ||
        e.minorUnits < 0 ||
        e.minorUnits > 4 ||
        typeof e.name !== "string" ||
        e.name.trim() === "" ||
        typeof e.active !== "boolean",
    );

    expect(bad).toEqual([]);
  });

  it.each([["EGP"], ["USD"], ["EUR"], ["GBP"], ["JPY"], ["KWD"], ["SAR"]])(
    "TP-2.32x: the seeded currency %s is active",
    (code) => {
      expect(byCode.get(code)?.active).toBe(true);
    },
  );

  it("TP-2.32x: English ISO names, e.g. EGP is Egyptian Pound", () => {
    expect(byCode.get("EGP")?.name).toBe("Egyptian Pound");
  });
});
