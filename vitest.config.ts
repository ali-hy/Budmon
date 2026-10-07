// Root Vitest configuration (LLD §10.1). Owned by the test-architect.
//
// Projects are declared through `test.projects`, with no `vitest.workspace.*` file: Vitest 4 removed
// workspace files and 5.0.3 throws on them (A-8).
//
// Projects are added as their slices create them: `web-unit` (jsdom, @solidjs/testing-library,
// MSW) in S-11a; `server-int`'s `globalSetup` (Testcontainers Postgres) came with S-2.
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
          // TP-2.27 runs esbuild over the server, and the config tests generate RSA keys.
          testTimeout: 60_000,
        },
      },
      {
        test: {
          name: "server-int",
          environment: "node",
          include: ["apps/server/test/integration/**/*.test.ts"],
          // §10.1: one Postgres (Testcontainers, or TEST_DATABASE_URL) with budmon_template built
          // by bootstrapCluster + runSchemaStep; each test file copies it (createTestDatabase).
          globalSetup: ["apps/server/test/setup/globalSetup.ts"],
          testTimeout: 60_000,
          hookTimeout: 180_000,
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
