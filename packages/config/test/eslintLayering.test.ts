// F-1 rule 1, layering (`no-restricted-imports`, A-11). TP-0.2, plus the extra cases TP-0.8x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it } from "vitest";
import { errorRuleIds, lintFixture } from "./support/lintFixture.js";

const REPO = 'export function findX(): string {\n  return "x";\n}\n';
const DB_CLIENT = "export const client = 1;\n";
const DB_TYPES = "export type Executor = string;\n";
const DRIZZLE_IMPORT =
  'import { sql } from "drizzle-orm";\n\nexport const query = sql`select 1`;\n';
const PG_IMPORT = 'import { Pool } from "pg";\n\nexport const P = Pool;\n';

describe("F-1 layering (no-restricted-imports)", () => {
  describe("TP-0.2", () => {
    it.each([
      [
        "(a) a router importing ./xRepo.js",
        "apps/server/src/x/xRouter.ts",
        'import { findX } from "./xRepo.js";\n\nexport const handler = findX;\n',
      ],
      [
        "(b) a module service importing drizzle-orm",
        "apps/server/src/x/xService.ts",
        DRIZZLE_IMPORT,
      ],
      ["(c) a module service importing pg", "apps/server/src/x/xService.ts", PG_IMPORT],
      [
        "(d) a platform service importing ../db/client.js",
        "apps/server/src/platform/x/xService.ts",
        'import { client } from "../db/client.js";\n\nexport const c = client;\n',
      ],
    ])("TP-0.2 %s is a no-restricted-imports error", async (_label, file, source) => {
      const messages = await lintFixture({
        "apps/server/src/x/xRepo.ts": REPO,
        "apps/server/src/platform/db/client.ts": DB_CLIENT,
        [file]: source,
      });

      expect(errorRuleIds(messages, file)).toContain("no-restricted-imports");
    });

    it.each([
      ["(e) a repo importing drizzle-orm", "apps/server/src/x/xRepo.ts", DRIZZLE_IMPORT],
      [
        "(f) a module service importing ../platform/db/types.js",
        "apps/server/src/x/xService.ts",
        'import type { Executor } from "../platform/db/types.js";\n\nexport type E = Executor;\n',
      ],
      [
        "(g) a web file named *Service.ts importing drizzle-orm",
        "apps/web/src/x/xService.ts",
        DRIZZLE_IMPORT,
      ],
      ["(h) a tools file named *Service.ts importing pg", "tools/ci/xService.ts", PG_IMPORT],
    ])("TP-0.2 %s is not a no-restricted-imports error", async (_label, file, source) => {
      const messages = await lintFixture({
        "apps/server/src/platform/db/types.ts": DB_TYPES,
        [file]: source,
      });

      expect(errorRuleIds(messages, file)).not.toContain("no-restricted-imports");
    });
  });

  // TP-0.8x (added): the other restrictions F-1 rule 1 lists, and what stays allowed.
  describe("TP-0.8x: the other restricted imports in F-1 rule 1", () => {
    it.each([
      [
        "drizzle-orm/pg-core",
        'import { text } from "drizzle-orm/pg-core";\n\nexport const t = text;\n',
      ],
      ["pg", PG_IMPORT],
      ["**/db/**", 'import { client } from "../db/client.js";\n\nexport const c = client;\n'],
    ])("TP-0.8x: a router importing %s is an error", async (_label, source) => {
      const messages = await lintFixture({
        "apps/server/src/db/client.ts": DB_CLIENT,
        "apps/server/src/x/xRouter.ts": source,
      });

      expect(errorRuleIds(messages, "apps/server/src/x/xRouter.ts")).toContain(
        "no-restricted-imports",
      );
    });

    it("TP-0.8x: a module service importing drizzle-orm/pg-core is an error", async () => {
      const messages = await lintFixture({
        "apps/server/src/x/xService.ts":
          'import { text } from "drizzle-orm/pg-core";\n\nexport const t = text;\n',
      });

      expect(errorRuleIds(messages, "apps/server/src/x/xService.ts")).toContain(
        "no-restricted-imports",
      );
    });

    it("TP-0.8x: a module service importing a repo is allowed", async () => {
      const messages = await lintFixture({
        "apps/server/src/x/xRepo.ts": REPO,
        "apps/server/src/x/xService.ts":
          'import { findX } from "./xRepo.js";\n\nexport const run = findX;\n',
      });

      expect(errorRuleIds(messages, "apps/server/src/x/xService.ts")).not.toContain(
        "no-restricted-imports",
      );
    });

    it("TP-0.8x: a *Service.ts deeper than the two A-11 globs isn't covered by the service rule", async () => {
      const file = "apps/server/src/x/deep/xService.ts";
      const messages = await lintFixture({ [file]: DRIZZLE_IMPORT });

      expect(errorRuleIds(messages, file)).not.toContain("no-restricted-imports");
    });

    it("TP-0.8x: platform/http/sub/xService.ts is outside both service globs, so drizzle-orm isn't restricted there", async () => {
      const file = "apps/server/src/platform/http/sub/xService.ts";
      const messages = await lintFixture({ [file]: DRIZZLE_IMPORT });

      expect(errorRuleIds(messages, file)).not.toContain("no-restricted-imports");
    });

    it("TP-0.8x: a file under platform/http importing a repo is an error", async () => {
      const messages = await lintFixture({
        "apps/server/src/x/xRepo.ts": REPO,
        "apps/server/src/platform/http/health.ts":
          'import { findX } from "../../x/xRepo.js";\n\nexport const check = findX;\n',
      });

      expect(errorRuleIds(messages, "apps/server/src/platform/http/health.ts")).toContain(
        "no-restricted-imports",
      );
    });

    it("TP-0.8x: platform/http/httpService.ts gets both the service and the http restrictions", async () => {
      const file = "apps/server/src/platform/http/httpService.ts";
      const repoImport = await lintFixture({
        "apps/server/src/x/xRepo.ts": REPO,
        [file]: 'import { findX } from "../../x/xRepo.js";\n\nexport const check = findX;\n',
      });
      const drizzleImport = await lintFixture({ [file]: DRIZZLE_IMPORT });

      expect(errorRuleIds(repoImport, file)).toContain("no-restricted-imports");
      expect(errorRuleIds(drizzleImport, file)).toContain("no-restricted-imports");
    });
  });
});
