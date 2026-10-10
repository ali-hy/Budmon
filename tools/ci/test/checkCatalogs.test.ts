// F-9 checkCatalogs (D-37). TP-11.23, plus extra cases TP-11.31x. IDs ending in "x" are
// test-architect additions, not LLD test-plan IDs.
//
// tools/ci/checkCatalogs.ts arrives with S-11a; until then it loads through a variable specifier.
import { describe, expect, it } from "vitest";

type CheckCatalogs = (input: {
  usedIds: ReadonlySet<string>;
  catalogs: Record<string, Record<string, string>>;
}) => { missing: Record<string, string[]> };

const MODULE = "../checkCatalogs.js";

async function checkCatalogs(): Promise<CheckCatalogs> {
  return ((await import(/* @vite-ignore */ MODULE)) as { checkCatalogs: CheckCatalogs })
    .checkCatalogs;
}

describe("TP-11.23: catalog completeness (F-9)", () => {
  it("TP-11.23: used {a, b} with en {a} is missing {en: [b]}", async () => {
    const check = await checkCatalogs();

    expect(check({ usedIds: new Set(["a", "b"]), catalogs: { en: { a: "A" } } })).toEqual({
      missing: { en: ["b"] },
    });
  });

  it("TP-11.31x: a complete catalog has nothing missing for that locale", async () => {
    const check = await checkCatalogs();

    const result = check({ usedIds: new Set(["a", "b"]), catalogs: { en: { a: "A", b: "B" } } });

    expect(result.missing["en"] ?? []).toEqual([]);
  });
});
