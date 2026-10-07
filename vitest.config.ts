// Root Vitest configuration (LLD §10.1). Owned by the test-architect.
//
// Projects are declared through `test.projects`, with no `vitest.workspace.*` file: Vitest 4 removed
// workspace files and 5.0.3 throws on them (A-8).
//
// Projects are added as their slices create them: `web-unit` (jsdom, @solidjs/testing-library,
// MSW) in S-11a, and `server-int`'s `globalSetup` (Testcontainers Postgres) in S-2.
//
// Root scripts (§2.2.2): `pnpm test` = `vitest run --project=!server-int`;
// `pnpm test:int` = `vitest run --project=server-int`;
// `pnpm test:coverage` = `vitest run --project=shared --coverage` (A-35).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Several projects have no test files until their slice is built (S-1, S-2, S-4).
    passWithNoTests: true,
    // A-35: `pnpm test:coverage` (vitest run --project=shared --coverage) requires 100 % of the
    // branches in packages/shared/src/money/**. Nothing else is measured.
    coverage: {
      provider: "v8",
      include: ["packages/shared/src/money/**"],
      reporter: ["text-summary"],
      reportsDirectory: "coverage",
      thresholds: { "packages/shared/src/money/**": { branches: 100 } },
    },
    projects: [
      {
        test: {
          name: "shared",
          environment: "node",
          include: ["packages/shared/test/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "contract",
          environment: "node",
          include: ["packages/contract/test/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "server-unit",
          environment: "node",
          include: ["apps/server/test/unit/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "server-int",
          environment: "node",
          include: ["apps/server/test/integration/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "tools",
          environment: "node",
          include: [
            "tools/*/test/**/*.test.ts",
            "infra/budmonctl/test/**/*.test.ts",
            "packages/config/test/**/*.test.ts",
          ],
          // Type-aware ESLint and `tsc` runs start a TypeScript program per test.
          testTimeout: 60_000,
        },
      },
    ],
  },
});
