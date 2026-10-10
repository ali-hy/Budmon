// F-150 verifyRestore and F-93's erasure:replay and restore:verify. TP-10.8 to TP-10.10, plus
// extra cases TP-10.11x. IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Temporal, fixedClock } from "@budmon/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCli } from "../../../src/main/cli.js";
import { runSchemaStep } from "../../../src/platform/db/schemaStep.js";
import type { Database } from "../../../src/platform/db/types.js";
import { SERVER_DIR, recordingLogger, schemaStepInput } from "../../support/platform.js";
import { query } from "../../support/postgres.js";
import { s10 } from "../../support/s10.js";
import { createTestDatabase, type TestDatabase } from "../../support/testDatabase.js";
import { testWorkerEnv } from "../../support/worker.js";

const EMPTY_JOURNAL = path.join(SERVER_DIR, "test/fixtures/migrations-empty");
const U1 = "0190a0b0-1c2d-7e3f-8a4b-000000000001";
const U2 = "0190a0b0-1c2d-7e3f-8a4b-000000000002";

describe("TP-10.8: erasure:replay (F-93, F-151)", () => {
  let testDb: TestDatabase;
  let dir: string;
  let env: Record<string, string>;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    dir = mkdtempSync(path.join(tmpdir(), "budmon-erasure-cli-"));
    env = testWorkerEnv(dir, testDb.endpoint, testDb.name, "general");
    const root = env["OBJECT_STORE_FS_ROOT"] ?? path.join(dir, "objects");
    mkdirSync(root, { recursive: true });
    // Two records in the worker's filesystem store, as identity's erasure would leave them.
    const { createFsObjectStore } = await s10.fsObjectStore();
    const { createErasureLog } = await s10.erasureLog();
    const log = createErasureLog(
      createFsObjectStore({
        root,
        publicOrigin: new URL("http://localhost:5173"),
        signingKey: Buffer.alloc(32, 1),
        clock: fixedClock("2026-10-08T00:00:00Z"),
      }),
    );
    await log.append({ userId: U1, erasedAt: Temporal.Instant.from("2026-10-05T12:00:00Z") });
    await log.append({ userId: U2, erasedAt: Temporal.Instant.from("2026-10-06T12:00:00Z") });
  }, 60_000);

  afterAll(async () => {
    rmSync(dir, { recursive: true, force: true });
    await testDb.drop();
  });

  async function cli(argv: string[]) {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runCli(argv, env, {
      stdout: (l) => stdout.push(l),
      stderr: (l) => stderr.push(l),
    });
    return { code, stdout, stderr };
  }

  it("TP-10.8: --since before the records with no erasure handler registered exits 2", async () => {
    const { code, stderr } = await cli(["erasure:replay", "--since", "2026-10-01T00:00:00Z"]);

    expect(code, stderr.join("\n")).toBe(2);
  });

  it('TP-10.11x: --since after every record prints {"replayed":0} and exits 0', async () => {
    const { code, stdout, stderr } = await cli([
      "erasure:replay",
      "--since",
      "2026-10-07T00:00:00Z",
    ]);

    expect(code, stderr.join("\n")).toBe(0);
    expect(stdout.map((l) => JSON.parse(l) as unknown)).toEqual([{ replayed: 0 }]);
  });
});

describe("TP-10.9: verifyRestore on a migrated database (F-150, A-229)", () => {
  let testDb: TestDatabase;
  let migrator: Database;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    migrator = testDb.connectAs("budmon_migrator");
    await runSchemaStep(schemaStepInput(migrator, "migrate", recordingLogger(), EMPTY_JOURNAL));
    await migrator.handle.executeSql(
      "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('h0', 1760000000000)",
    );
    // Three jobs, inserted as the queue's owner (RLS hides them from budmon_migrator, A-229).
    for (const n of [1, 2, 3]) {
      await query(
        testDb.urlAs("budmon_queue"),
        "INSERT INTO pgboss.job (name, data) VALUES ('test.ok', jsonb_build_object('n', $1::int))",
        [n],
      );
    }
  }, 120_000);

  afterAll(async () => {
    await migrator.close();
    await testDb.drop();
  });

  it("TP-10.9: ok, schema ok, no amcheck failures; indexesChecked is the count of B-tree indexes in public and pgboss; every table counted; pgboss.job counts 3 jobs and job_common isn't listed", async () => {
    const { verifyRestore } = await s10.restoreVerify();

    const report = await verifyRestore({
      database: migrator,
      journal: [{ hash: "h0", when: 1760000000000 }],
    });

    const [indexes] = await query<{ n: number }>(
      testDb.urlAs("budmon_migrator"),
      `SELECT count(*)::int AS n FROM pg_index i
         JOIN pg_class c ON c.oid = i.indexrelid
         JOIN pg_am am ON am.oid = c.relam
         JOIN pg_namespace ns ON ns.oid = c.relnamespace
       WHERE am.amname = 'btree' AND c.relkind = 'i' AND ns.nspname IN ('public', 'pgboss')`,
    );
    expect(report.ok).toBe(true);
    expect(report.schema).toBe("ok");
    expect(report.amcheck.failures).toEqual([]);
    expect(report.amcheck.indexesChecked).toBe(indexes?.n);
    expect(report.tables).toContainEqual({ schema: "pgboss", table: "job", rows: 3 });
    expect(report.tables.some((t) => t.schema === "pgboss" && t.table === "job_common")).toBe(
      false,
    );
    const [currencies] = await query<{ n: number }>(
      testDb.urlAs("budmon_migrator"),
      "SELECT count(*)::int AS n FROM currencies",
    );
    expect(report.tables).toContainEqual({
      schema: "public",
      table: "currencies",
      rows: currencies?.n,
    });
    expect(report.tables.every((t) => t.schema === "public" || t.schema === "pgboss")).toBe(true);
  });

  it("TP-10.11x: a journal one entry ahead of the database is schema behind and ok false", async () => {
    const { verifyRestore } = await s10.restoreVerify();

    const report = await verifyRestore({
      database: migrator,
      journal: [
        { hash: "h0", when: 1760000000000 },
        { hash: "h1", when: 1760000100000 },
      ],
    });

    expect(report.schema).toBe("behind");
    expect(report.ok).toBe(false);
  });
});

describe("TP-10.10: restore:verify on a database missing one journal migration (F-93)", () => {
  // The CLI reads the repository's journal, which is empty until the first release, and F-93
  // defines no way to give it another; how the test reaches "behind" is with the planner.
  it.todo("TP-10.10: restore:verify exits 6 with a report whose schema is behind");
});
