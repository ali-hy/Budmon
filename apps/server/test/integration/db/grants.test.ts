// F-16 tableGrants and applyTableGrants. TP-2.11, plus extra cases TP-2.47x for §3.3's grant
// table.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyTableGrants, tableGrants } from "../../../src/platform/db/grants.js";
import { SchemaStepError } from "../../../src/platform/db/schemaStep.js";
import type { Database } from "../../../src/platform/db/types.js";
import { failureState } from "../../support/postgres.js";
import { createTestDatabase, type TestDatabase } from "../../support/testDatabase.js";

let testDb: TestDatabase;
let capture: Database;
let migrator: Database;

beforeAll(async () => {
  testDb = await createTestDatabase("budmon_app");
  capture = testDb.connectAs("budmon_capture");
  migrator = testDb.connectAs("budmon_migrator");
});

afterAll(async () => {
  await capture.close();
  await migrator.close();
  await testDb.drop();
});

async function schemaStepError(operation: Promise<unknown>): Promise<SchemaStepError> {
  try {
    await operation;
  } catch (error) {
    if (error instanceof SchemaStepError) return error;
    throw error;
  }
  throw new Error("expected a SchemaStepError");
}

describe("TP-2.47x: §3.3's platform grants", () => {
  it("TP-2.47x: tableGrants lists exactly the four platform tables with §3.3's privileges", () => {
    const normalised = Object.fromEntries(
      Object.entries(tableGrants).map(([table, g]) => [
        table,
        { app: [...g.app].sort(), capture: [...g.capture].sort(), credential: g.credential },
      ]),
    );

    expect(normalised).toEqual({
      currencies: { app: ["SELECT"], capture: ["SELECT"], credential: false },
      exchange_rates: { app: ["INSERT", "SELECT"], capture: ["SELECT"], credential: false },
      idempotency_records: {
        app: ["DELETE", "INSERT", "SELECT", "UPDATE"],
        capture: [],
        credential: false,
      },
      rate_limit_counters: {
        app: ["DELETE", "INSERT", "SELECT", "UPDATE"],
        capture: [],
        credential: false,
      },
    });
  });

  it("TP-2.47x: the template's privileges match tableGrants for both roles", async () => {
    const { rows } = await migrator.handle.executeSql(
      `SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
       WHERE table_schema = 'public' AND grantee IN ('budmon_app', 'budmon_capture', 'budmon_monitor')`,
    );
    const actual = rows
      .map(
        (r) => `${String(r["grantee"])}:${String(r["table_name"])}:${String(r["privilege_type"])}`,
      )
      .sort();
    const expected = Object.entries(tableGrants)
      .flatMap(([table, g]) => [
        ...g.app.map((p) => `budmon_app:${table}:${p}`),
        ...g.capture.map((p) => `budmon_capture:${table}:${p}`),
      ])
      .sort();

    expect(actual).toEqual(expected);
  });
});

// The failing applyTableGrants calls below may revoke privileges before throwing, so the
// privilege checks above run first.
describe("TP-2.11: table grants", () => {
  it("TP-2.11: budmon_app can SELECT from currencies", async () => {
    expect(
      await failureState(() =>
        testDb.database.handle.executeSql("SELECT code FROM currencies LIMIT 1"),
      ),
    ).toBeUndefined();
  });

  it("TP-2.11: budmon_app can't INSERT into currencies (42501)", async () => {
    expect(
      await failureState(() =>
        testDb.database.handle.executeSql(
          "INSERT INTO currencies (code, name, minor_units) VALUES ('ZZZ', 'Test', 2)",
        ),
      ),
    ).toBe("42501");
  });

  it("TP-2.11: budmon_capture can't SELECT from idempotency_records (42501)", async () => {
    expect(
      await failureState(() => capture.handle.executeSql("SELECT 1 FROM idempotency_records")),
    ).toBe("42501");
  });

  it("TP-2.11: a grants map missing currencies throws SchemaStepError table_without_grants", async () => {
    const withoutCurrencies = Object.fromEntries(
      Object.entries(tableGrants).filter(([table]) => table !== "currencies"),
    );

    const error = await schemaStepError(applyTableGrants(migrator.handle, withoutCurrencies));

    expect(error).toMatchObject({ code: "table_without_grants", subject: "currencies" });
  });

  it("TP-2.11: a credential table granted to capture throws SchemaStepError credential_table_granted_to_capture", async () => {
    const grants = {
      ...tableGrants,
      currencies: { app: ["SELECT"] as const, capture: ["SELECT"] as const, credential: true },
    };

    const error = await schemaStepError(applyTableGrants(migrator.handle, grants));

    expect(error).toMatchObject({
      code: "credential_table_granted_to_capture",
      subject: "currencies",
    });
  });
});
