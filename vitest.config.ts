// Root Vitest configuration (LLD §10.1). Owned by the test-architect.
//
// §10.1 names a root `vitest.workspace.ts`; Vitest 4 removed workspace files (Vitest 5.0.3 throws
// "The `test.workspace` option was removed in Vitest 4"), so the same projects are declared here
// through `test.projects`.
//
// Projects are added as their slices create them: `web-unit` (jsdom, @solidjs/testing-library,
// MSW) in S-11a, and `server-int`'s `globalSetup` (Testcontainers Postgres) in S-2.
//
// Root scripts (§10.1): `pnpm test` = `vitest run --project=!server-int`;
// `pnpm test:int` = `vitest run --project=server-int`.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Several projects have no test files until their slice is built (S-1, S-2, S-4).
    passWithNoTests: true,
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
