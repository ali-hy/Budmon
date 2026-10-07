// devMigrate.ts devMigrateEnv (A-83). TP-2.38, plus extra cases TP-2.71x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
// Importing main/devMigrate.ts must not run a migration (an entry guard, as in F-94).
import { describe, expect, it } from "vitest";
import { devMigrateEnv } from "../../../src/main/devMigrate.js";

const MIGRATOR = "budmon_migrator";
const PASSWORD_FILE = ".data/dev-secrets/migrator_password";

describe("TP-2.38: devMigrateEnv", () => {
  it("TP-2.38: an empty environment gets the migrator's user and password file", () => {
    const env = devMigrateEnv({});

    expect(env["DB_USER"]).toBe(MIGRATOR);
    expect(env["DB_PASSWORD_FILE"]).toBe(PASSWORD_FILE);
  });

  it('TP-2.38: DB_USER "x" from the shell is kept', () => {
    const env = devMigrateEnv({ DB_USER: "x" });

    expect(env["DB_USER"]).toBe("x");
    expect(env["DB_PASSWORD_FILE"]).toBe(PASSWORD_FILE);
  });

  it('TP-2.38: DB_PASSWORD_FILE "/p" from the shell is kept', () => {
    const env = devMigrateEnv({ DB_PASSWORD_FILE: "/p" });

    expect(env["DB_PASSWORD_FILE"]).toBe("/p");
    expect(env["DB_USER"]).toBe(MIGRATOR);
  });
});

describe("TP-2.71x: devMigrateEnv, further cases (A-83)", () => {
  it("TP-2.71x: every other variable passes through unchanged", () => {
    const input = { DB_HOST: "localhost", DB_NAME: "budmon", APP_ENV: "development" };

    expect(devMigrateEnv(input)).toEqual({
      ...input,
      DB_USER: MIGRATOR,
      DB_PASSWORD_FILE: PASSWORD_FILE,
    });
  });
});
