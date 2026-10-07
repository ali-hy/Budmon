// F-20 resetDevelopmentDatabase against a real cluster. TP-2.16's third case ("localhost +
// development: deps called in order"), on a fresh container, plus extra cases TP-2.42x.
// The refusals are unit tests (unit/db/reset.test.ts).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDevelopmentDatabase } from "../../../src/platform/db/reset.js";
import {
  TEST_ROLE_PASSWORDS,
  query,
  startFreshPostgres,
  testRoleSecrets,
  type FreshPostgres,
} from "../../support/postgres.js";

const DATABASE = "budmon";

type ResetDeps = Parameters<typeof resetDevelopmentDatabase>[1];

let pg: FreshPostgres;

beforeAll(async () => {
  pg = await startFreshPostgres();
});

afterAll(async () => {
  await pg.stop();
});

beforeEach(() => {
  // The container's host may not be one of F-20's local names; F-20 allows TESTCONTAINERS=1.
  vi.stubEnv("TESTCONTAINERS", "1");
  return () => {
    vi.unstubAllEnvs();
  };
});

function input(seed: boolean): Parameters<typeof resetDevelopmentDatabase>[0] {
  return {
    appEnv: "development",
    superuserUrl: pg.superuserUrl("postgres"),
    databaseName: DATABASE,
    migratorPassword: TEST_ROLE_PASSWORDS.budmon_migrator,
    roleSecrets: testRoleSecrets(),
    seed,
  };
}

function recordingDeps(calls: string[]): ResetDeps {
  return {
    runSchemaStep: vi.fn((schemaInput: { mode: string }) => {
      calls.push(`runSchemaStep:${schemaInput.mode}`);
      return Promise.resolve({
        migrationsApplied: 0,
        pushedStatements: 0,
        queueSchema: "current",
        currenciesUpserted: 0,
        queuesCreated: 0,
        queuesUpdated: 0,
      });
    }),
    seed: vi.fn(() => {
      calls.push("seed");
      return Promise.resolve();
    }),
  } as unknown as ResetDeps;
}

describe("TP-2.16: resetDevelopmentDatabase on a local development database", () => {
  it("TP-2.16: drops the database, recreates it and calls runSchemaStep (push) then seed, in order", async () => {
    await query(pg.superuserUrl("postgres"), `CREATE DATABASE ${DATABASE}`);
    await query(pg.superuserUrl(DATABASE), "CREATE TABLE marker (id int)");
    const calls: string[] = [];

    await resetDevelopmentDatabase(input(true), recordingDeps(calls));

    expect(calls).toEqual(["runSchemaStep:push", "seed"]);
    const [owner] = await query(
      pg.superuserUrl("postgres"),
      `SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = '${DATABASE}'`,
    );
    expect(owner).toEqual({ owner: "budmon_migrator" });
    expect(
      await query(
        pg.superuserUrl(DATABASE),
        "SELECT count(*)::int AS n FROM pg_tables WHERE tablename = 'marker'",
      ),
    ).toEqual([{ n: 0 }]);
  });

  it("TP-2.42x: with seed false, runSchemaStep runs and seed doesn't", async () => {
    const calls: string[] = [];

    await resetDevelopmentDatabase(input(false), recordingDeps(calls));

    expect(calls).toEqual(["runSchemaStep:push"]);
  });

  it("TP-2.42x: open connections to the database don't stop the reset", async () => {
    const pgModule = await import("pg");
    const holder = new pgModule.default.Client({ connectionString: pg.superuserUrl(DATABASE) });
    await holder.connect();
    holder.on("error", () => undefined);
    const calls: string[] = [];

    await resetDevelopmentDatabase(input(false), recordingDeps(calls));

    expect(calls).toEqual(["runSchemaStep:push"]);
    await holder.end().catch(() => undefined);
  });
});
