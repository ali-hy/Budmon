// F-7 checkEnvExample. TP-2.7, plus extra cases TP-2.43x (parsing rules, and the repository's
// own .env.example against F-10's allConfigKeys).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { allConfigKeys } from "../../../apps/server/src/platform/config/schema.js";
import { checkEnvExample } from "../checkEnvExample.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("TP-2.7: checkEnvExample", () => {
  it("TP-2.7: keys [A, B] against A=1 lists B as missing", () => {
    expect(checkEnvExample(["A", "B"], "A=1")).toEqual({
      missingInExample: ["B"],
      unknownInExample: [],
    });
  });

  it("TP-2.7: keys [A, B] against A=1, B=2, C=3 lists C as unknown", () => {
    expect(checkEnvExample(["A", "B"], "A=1\nB=2\nC=3")).toEqual({
      missingInExample: [],
      unknownInExample: ["C"],
    });
  });

  it("TP-2.43x: comments and blank lines are ignored, and an empty value counts as present", () => {
    const example = "# Database\n\nA=1\n  # indented comment\nB=\n";

    expect(checkEnvExample(["A", "B"], example)).toEqual({
      missingInExample: [],
      unknownInExample: [],
    });
  });

  it("TP-2.43x: the repository's .env.example lists exactly F-10's variables", () => {
    const example = readFileSync(path.join(ROOT, ".env.example"), "utf8");

    expect(checkEnvExample(allConfigKeys(), example)).toEqual({
      missingInExample: [],
      unknownInExample: [],
    });
  });

  it("TP-2.43x: allConfigKeys is sorted and includes the variables of every kind", () => {
    const keys = allConfigKeys();

    expect(keys).toEqual([...keys].sort());
    for (const key of [
      "APP_ENV",
      "DB_HOST",
      "ROLE_SECRETS_FILE",
      "WORKER_ROLES",
      "CURSOR_KEY_FILE",
      "SMTP_URL",
      "GOOGLE_SIGNIN_CLIENT_ID",
    ]) {
      expect(keys).toContain(key);
    }
  });
});
