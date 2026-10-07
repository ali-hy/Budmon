// TP-0.21: the root package.json scripts are exactly §2.2.2's rows for the slices built so far
// (A-14). Each later slice adds its rows to ROWS (and replaces a command where §2.2.2 says so),
// so a script can't appear before its owning slice.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** §2.2.2 rows owned by the slices built so far: script → root command. */
const ROWS: Readonly<Record<string, string>> = {
  // S-0
  format: "prettier --write .",
  "format:check": "prettier --check .",
  lint: "eslint .",
  typecheck: "tsc -p tsconfig.json",
  test: "vitest run --project=!server-int",
  "test:int": "vitest run --project=server-int",
  check: "pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:int",
};

function rootScripts(): Record<string, unknown> {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
    scripts?: Record<string, unknown>;
  };
  return pkg.scripts ?? {};
}

describe("TP-0.21: root scripts (§2.2.2)", () => {
  it("TP-0.21: every root script is a §2.2.2 row of a built slice, with that row's command", () => {
    const scripts = rootScripts();
    const unexpected = Object.keys(scripts).filter((name) => !(name in ROWS));

    expect(unexpected).toEqual([]);
    for (const [name, command] of Object.entries(scripts)) {
      if (name in ROWS) expect({ [name]: command }).toEqual({ [name]: ROWS[name] });
    }
  });

  it.each(Object.keys(ROWS).map((name) => [name]))(
    "TP-0.21: the S-0 script %s is present",
    (name) => {
      expect(Object.keys(rootScripts())).toContain(name);
    },
  );
});
