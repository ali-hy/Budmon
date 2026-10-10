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

  it("TP-11.23 (A-312): used {a} with en {a} is {en: []}: every shipped locale is a key", async () => {
    const check = await checkCatalogs();

    expect(check({ usedIds: new Set(["a"]), catalogs: { en: { a: "A" } } })).toEqual({
      missing: { en: [] },
    });
  });

  it("TP-11.31x (A-312): each locale's missing list is sorted", async () => {
    const check = await checkCatalogs();

    expect(check({ usedIds: new Set(["c", "a", "b"]), catalogs: { en: {} } })).toEqual({
      missing: { en: ["a", "b", "c"] },
    });
  });
});
