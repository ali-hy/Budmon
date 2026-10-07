// F-1 rule 1, layering (`no-restricted-imports`). TP-0.2, plus the extra cases TP-0.8x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it } from "vitest";
import { errorRuleIds, lintFixture } from "./support/lintFixture.js";

const REPO = 'export function findX(): string {\n  return "x";\n}\n';
const DB_CLIENT = "export const client = 1;\n";

describe("F-1 layering (no-restricted-imports)", () => {
  describe("TP-0.2", () => {
    it("TP-0.2: a router importing a repo is an error", async () => {
      const messages = await lintFixture({
        "apps/server/src/x/xRepo.ts": REPO,
        "apps/server/src/x/xRouter.ts":
          'import { findX } from "./xRepo.js";\n\nexport const handler = findX;\n',
      });

      expect(errorRuleIds(messages, "apps/server/src/x/xRouter.ts")).toContain(
        "no-restricted-imports",
      );
    });

    it("TP-0.2: a service importing drizzle-orm is an error", async () => {
      const messages = await lintFixture({
        "apps/server/src/x/xService.ts":
          'import { sql } from "drizzle-orm";\n\nexport const query = sql`select 1`;\n',
      });

      expect(errorRuleIds(messages, "apps/server/src/x/xService.ts")).toContain(
        "no-restricted-imports",
      );
    });

    it("TP-0.2: a repo importing drizzle-orm is allowed", async () => {
      const messages = await lintFixture({
        "apps/server/src/x/xRepo.ts":
          'import { sql } from "drizzle-orm";\n\nexport const query = sql`select 1`;\n',
      });

      expect(errorRuleIds(messages, "apps/server/src/x/xRepo.ts")).not.toContain(
        "no-restricted-imports",
      );
    });
  });

  // TP-0.8x (added): the remaining restricted imports F-1 rule 1 lists, and what stays allowed.
  describe("TP-0.8x: the other restricted imports in F-1 rule 1", () => {
    it.each([
      [
        "drizzle-orm/pg-core",
        'import { text } from "drizzle-orm/pg-core";\n\nexport const t = text;\n',
      ],
      ["pg", 'import { Pool } from "pg";\n\nexport const P = Pool;\n'],
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

    it.each([
      ["pg", 'import { Pool } from "pg";\n\nexport const P = Pool;\n'],
      [
        "**/db/client.js",
        'import { client } from "../db/client.js";\n\nexport const c = client;\n',
      ],
    ])("TP-0.8x: a service importing %s is an error", async (_label, source) => {
      const messages = await lintFixture({
        "apps/server/src/db/client.ts": DB_CLIENT,
        "apps/server/src/x/xService.ts": source,
      });

      expect(errorRuleIds(messages, "apps/server/src/x/xService.ts")).toContain(
        "no-restricted-imports",
      );
    });

    it("TP-0.8x: a service importing a repo is allowed", async () => {
      const messages = await lintFixture({
        "apps/server/src/x/xRepo.ts": REPO,
        "apps/server/src/x/xService.ts":
          'import { findX } from "./xRepo.js";\n\nexport const run = findX;\n',
      });

      expect(errorRuleIds(messages, "apps/server/src/x/xService.ts")).not.toContain(
        "no-restricted-imports",
      );
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
  });
});
