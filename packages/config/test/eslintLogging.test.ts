// F-1 rule 2, logging. TP-0.3, plus the extra cases TP-0.9x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it } from "vitest";
import { errorRuleIds, errorsIn, lintFixture } from "./support/lintFixture.js";

const PINO_IMPORT = 'import pino from "pino";\n\nexport const logger = pino();\n';
const CONSOLE_LOG = 'export function report(): void {\n  console.log("x");\n}\n';

describe("F-1 logging", () => {
  describe("TP-0.3", () => {
    it("TP-0.3: importing pino in platform/http is an error that the same import in platform/observability doesn't get", async () => {
      const messages = await lintFixture({
        "apps/server/src/platform/http/x.ts": PINO_IMPORT,
        "apps/server/src/platform/observability/x.ts": PINO_IMPORT,
      });

      const allowed = new Set(
        errorRuleIds(messages, "apps/server/src/platform/observability/x.ts"),
      );
      const restricted = errorsIn(messages, "apps/server/src/platform/http/x.ts").filter(
        (m) => !allowed.has(m.ruleId),
      );
      expect(restricted.length).toBeGreaterThan(0);
    });

    it("TP-0.3: console.log in platform code is a no-console error", async () => {
      const messages = await lintFixture({ "apps/server/src/platform/x.ts": CONSOLE_LOG });

      expect(errorRuleIds(messages, "apps/server/src/platform/x.ts")).toContain("no-console");
    });

    it("TP-0.3: console.log under main/ is allowed", async () => {
      const messages = await lintFixture({ "apps/server/src/main/x.ts": CONSOLE_LOG });

      expect(errorRuleIds(messages, "apps/server/src/main/x.ts")).not.toContain("no-console");
    });
  });

  // TP-0.9x (added): F-1 rule 2's other locations.
  describe("TP-0.9x: the rest of F-1 rule 2", () => {
    it("TP-0.9x: importing pino under platform/observability raises no import restriction", async () => {
      const messages = await lintFixture({
        "apps/server/src/platform/observability/logger.ts": PINO_IMPORT,
      });

      expect(
        errorRuleIds(messages, "apps/server/src/platform/observability/logger.ts"),
      ).not.toContain("no-restricted-imports");
    });

    it("TP-0.9x: importing pino in a module's service is an error", async () => {
      const messages = await lintFixture({
        "apps/server/src/x/xService.ts": PINO_IMPORT,
        "apps/server/src/platform/observability/x.ts": PINO_IMPORT,
      });

      const allowed = new Set(
        errorRuleIds(messages, "apps/server/src/platform/observability/x.ts"),
      );
      const restricted = errorsIn(messages, "apps/server/src/x/xService.ts").filter(
        (m) => !allowed.has(m.ruleId),
      );
      expect(restricted.length).toBeGreaterThan(0);
    });

    it("TP-0.9x: console.log under tools/ is allowed", async () => {
      const messages = await lintFixture({ "tools/ci/x.ts": CONSOLE_LOG });

      expect(errorRuleIds(messages, "tools/ci/x.ts")).not.toContain("no-console");
    });

    it("TP-0.9x: console.log in a shared package is a no-console error", async () => {
      const messages = await lintFixture({ "packages/shared/src/x.ts": CONSOLE_LOG });

      expect(errorRuleIds(messages, "packages/shared/src/x.ts")).toContain("no-console");
    });
  });
});
