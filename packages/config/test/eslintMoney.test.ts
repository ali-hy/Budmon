// F-1 rule 3, money. TP-0.4, plus the extra cases TP-0.10x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it } from "vitest";
import { errorRuleIds, lintFixture } from "./support/lintFixture.js";

const SERVER_FILE = "apps/server/src/x/money.ts";
const REQUIRE_DESCRIPTION = /(^|\/)eslint-comments\/require-description$/;

const PARSE_FLOAT = "declare const a: string;\n\nexport const n = parseFloat(a);\n";
const NUMBER_CALL = "declare const a: string;\n\nexport const n = Number(a);\n";
const BIGINT_NUMBER_MODE =
  'declare function bigint(config: { mode: string }): unknown;\n\nexport const c = bigint({ mode: "number" });\n';

describe("F-1 money", () => {
  describe("TP-0.4", () => {
    it("TP-0.4: parseFloat is a no-restricted-globals error", async () => {
      const messages = await lintFixture({ [SERVER_FILE]: PARSE_FLOAT });

      expect(errorRuleIds(messages, SERVER_FILE)).toContain("no-restricted-globals");
    });

    it("TP-0.4: Number() is a no-restricted-syntax error", async () => {
      const messages = await lintFixture({ [SERVER_FILE]: NUMBER_CALL });

      expect(errorRuleIds(messages, SERVER_FILE)).toContain("no-restricted-syntax");
    });

    it('TP-0.4: bigint({ mode: "number" }) is a no-restricted-syntax error', async () => {
      const messages = await lintFixture({ [SERVER_FILE]: BIGINT_NUMBER_MODE });

      expect(errorRuleIds(messages, SERVER_FILE)).toContain("no-restricted-syntax");
    });

    it("TP-0.4: a disable comment with a described reason before Number() passes", async () => {
      const messages = await lintFixture({
        [SERVER_FILE]:
          "declare const a: string;\n\n" +
          "// eslint-disable-next-line no-restricted-syntax -- reason\n" +
          "export const n = Number(a);\n",
      });

      const ruleIds = errorRuleIds(messages, SERVER_FILE);
      expect(ruleIds).not.toContain("no-restricted-syntax");
      expect(ruleIds.filter((id) => id !== null && REQUIRE_DESCRIPTION.test(id))).toEqual([]);
    });

    it("TP-0.4: the same disable comment without a reason is a require-description error", async () => {
      const messages = await lintFixture({
        [SERVER_FILE]:
          "declare const a: string;\n\n" +
          "// eslint-disable-next-line no-restricted-syntax\n" +
          "export const n = Number(a);\n",
      });

      const ruleIds = errorRuleIds(messages, SERVER_FILE);
      expect(ruleIds.filter((id) => id !== null && REQUIRE_DESCRIPTION.test(id))).toHaveLength(1);
    });
  });

  // TP-0.10x (added): F-1 rule 3 applies in all three source trees it names, and doesn't catch
  // what it recommends instead.
  describe("TP-0.10x: where the money rules apply", () => {
    it.each([["packages/shared/src/money.ts"], ["apps/web/src/money.ts"]])(
      "TP-0.10x: parseFloat, Number() and bigint number mode are errors in %s",
      async (file) => {
        const parseFloatFile = file.replace("money.ts", "a.ts");
        const numberFile = file.replace("money.ts", "b.ts");
        const bigintFile = file.replace("money.ts", "c.ts");
        const messages = await lintFixture({
          [parseFloatFile]: PARSE_FLOAT,
          [numberFile]: NUMBER_CALL,
          [bigintFile]: BIGINT_NUMBER_MODE,
        });

        expect(errorRuleIds(messages, parseFloatFile)).toContain("no-restricted-globals");
        expect(errorRuleIds(messages, numberFile)).toContain("no-restricted-syntax");
        expect(errorRuleIds(messages, bigintFile)).toContain("no-restricted-syntax");
      },
    );

    it("TP-0.10x: Number.parseInt with a radix is not a money-rule error", async () => {
      const messages = await lintFixture({
        [SERVER_FILE]: "declare const a: string;\n\nexport const n = Number.parseInt(a, 10);\n",
      });

      const ruleIds = errorRuleIds(messages, SERVER_FILE);
      expect(ruleIds).not.toContain("no-restricted-syntax");
      expect(ruleIds).not.toContain("no-restricted-globals");
    });

    it('TP-0.10x: bigint({ mode: "bigint" }) is not a money-rule error', async () => {
      const messages = await lintFixture({
        [SERVER_FILE]:
          'declare function bigint(config: { mode: string }): unknown;\n\nexport const c = bigint({ mode: "bigint" });\n',
      });

      expect(errorRuleIds(messages, SERVER_FILE)).not.toContain("no-restricted-syntax");
    });
  });
});
