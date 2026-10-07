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
  // S-0 (format to test:int)
  format: "prettier --write .",
  "format:check": "prettier --check .",
  lint: "eslint .",
  // S-2 (A-30): typecheck also checks apps/server.
  typecheck: "tsc -p tsconfig.json && tsc -p apps/server/tsconfig.json",
  test: "vitest run --project=!server-int",
  "test:int": "vitest run --project=server-int",
  // S-1 (A-35): test:coverage added; check runs it after test.
  "test:coverage": "vitest run --project=shared --coverage",
  check:
    "pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:coverage && pnpm test:int",
  // S-2 (A-14)
  dev: "pnpm --filter @budmon/server dev",
  "db:reset": "pnpm --filter @budmon/server db:reset",
  "db:seed": "pnpm --filter @budmon/server db:seed",
  "db:migrate": "pnpm --filter @budmon/server db:migrate",
};

/** §2.2.2's package-script column for apps/server, plus F-24's build (A-43). */
const SERVER_SCRIPTS: Readonly<Record<string, string>> = {
  dev: "tsx src/main/dev.ts",
  "db:reset": "tsx src/main/dbReset.ts",
  "db:seed": "tsx src/main/dbReset.ts --seed-only",
  // A-83: the development wrapper.
  "db:migrate": "tsx src/main/devMigrate.ts",
  build: "tsx scripts/build.ts",
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
    "TP-0.21: the script %s of a built slice is present",
    (name) => {
      expect(Object.keys(rootScripts())).toContain(name);
    },
  );
});

// TP-0.26x (test-architect addition, not an LLD ID): the root scripts that delegate to
// @budmon/server find the package script §2.2.2 names.
describe("TP-0.26x: apps/server package scripts (§2.2.2, F-24)", () => {
  it.each(Object.entries(SERVER_SCRIPTS))("TP-0.26x: %s is %j", (name, command) => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "apps/server/package.json"), "utf8")) as {
      scripts?: Record<string, unknown>;
    };

    expect(pkg.scripts?.[name]).toBe(command);
  });
});
