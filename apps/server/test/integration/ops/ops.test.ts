// F-150 verifyRestore and F-93's erasure:replay and restore:verify. TP-10.8 to TP-10.10, plus
// extra cases TP-10.11x. IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Temporal, fixedClock } from "@budmon/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCli } from "../../../src/main/cli.js";
import { runSchemaStep } from "../../../src/platform/db/schemaStep.js";
import type { Database } from "../../../src/platform/db/types.js";
import { SERVER_DIR, recordingLogger, schemaStepInput } from "../../support/platform.js";
import { devMigrate, withFile } from "../../support/configEnv.js";
import { TEST_ROLE_PASSWORDS, query } from "../../support/postgres.js";
import { s10 } from "../../support/s10.js";
import { createTestDatabase, type TestDatabase } from "../../support/testDatabase.js";
import { testWorkerEnv } from "../../support/worker.js";

const EMPTY_JOURNAL = path.join(SERVER_DIR, "test/fixtures/migrations-empty");
const MIGRATIONS_ONE = path.join(SERVER_DIR, "test/fixtures/migrations-one");
const REPO_MIGRATIONS = path.join(SERVER_DIR, "drizzle");

/** runCli (F-93) with recorded stdout and stderr; `deps` as A-288 documents. */
async function runWith(
  argv: string[],
  env: Readonly<Record<string, string | undefined>>,
  deps?: { migrationsFolder?: string },
) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io = { stdout: (l: string) => stdout.push(l), stderr: (l: string) => stderr.push(l) };
  const code = await (deps === undefined ? runCli(argv, env, io) : runCli(argv, env, io, deps));
  return { code, stdout, stderr };
}
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

  const cli = (argv: string[]) => runWith(argv, env);

  it("TP-10.8: --since before the records with no erasure handler registered exits 2", async () => {
    const { code, stderr } = await cli(["erasure:replay", "--since", "2026-10-01T00:00:00Z"]);

    expect(code, stderr.join("\n")).toBe(2);
  });

  it.each([
    ["no --since", ["erasure:replay"]],
    ["a date with no time", ["erasure:replay", "--since", "2026-10-01"]],
    ["a time with no offset", ["erasure:replay", "--since", "2026-10-01T00:00:00"]],
    ["an extra argument", ["erasure:replay", "--since", "2026-10-01T00:00:00Z", "extra"]],
  ])(
    "TP-10.8 (A-294): %s exits 64 with the usage text, reading no configuration",
    async (_label, argv) => {
      // The usage text, as an unknown command prints it after its own line.
      const usage = (await runWith(["no-such-command"], {})).stderr.slice(1).join("\n");

      // An empty environment: reading the configuration would fail with another exit code.
      const { code, stderr } = await runWith(argv, {});

      expect(usage).toContain("erasure:replay");
      expect(code).toBe(64);
      expect(stderr.join("\n")).toContain(usage);
    },
  );

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

  it("TP-10.9: ok, schema ok, no amcheck failures; indexesChecked is the count of leaf B-tree indexes (relkind 'i') in public and pgboss, partitioned parents excluded (A-291); every table counted; pgboss.job counts 3 jobs and job_common isn't listed", async () => {
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

describe("TP-10.10: restore:verify (F-93, F-150, A-288, A-289)", () => {
  let testDb: TestDatabase;
  let dir: string;
  let env: Record<string, string>;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    const migrator = testDb.connectAs("budmon_migrator");
    try {
      // A release-path database, migrated with the repository's (empty) journal.
      await runSchemaStep(schemaStepInput(migrator, "migrate", recordingLogger(), REPO_MIGRATIONS));
    } finally {
      await migrator.close();
    }
    dir = mkdtempSync(path.join(tmpdir(), "budmon-restore-cli-"));
    // A-289: a migrate-kind environment, connected as budmon_migrator.
    const f = devMigrate();
    withFile(f, "DB_PASSWORD_FILE", `${TEST_ROLE_PASSWORDS.budmon_migrator}\n`);
    env = {};
    for (const [key, value] of Object.entries(f.env)) {
      if (value === undefined) continue;
      const content = f.files.get(value);
      if (content === undefined) {
        env[key] = value;
      } else {
        const file = path.join(dir, key.toLowerCase());
        writeFileSync(file, content);
        env[key] = file;
      }
    }
    Object.assign(env, {
      DB_HOST: testDb.endpoint.host,
      DB_PORT: String(testDb.endpoint.port),
      DB_NAME: testDb.name,
      DB_USER: "budmon_migrator",
    });
  }, 120_000);

  afterAll(async () => {
    rmSync(dir, { recursive: true, force: true });
    await testDb.drop();
  });

  it("TP-10.10: with a migrations folder holding one migration the database lacks, exit 6 and a report with schema behind and ok false", async () => {
    const { code, stdout, stderr } = await runWith(["restore:verify"], env, {
      migrationsFolder: MIGRATIONS_ONE,
    });

    expect(code, stderr.join("\n")).toBe(6);
    expect(stdout).toHaveLength(1);
    expect(JSON.parse(stdout[0] ?? "null")).toMatchObject({ schema: "behind", ok: false });
  });

  it("TP-10.10: with the default (repository) folder, exit 0 and schema ok", async () => {
    const { code, stdout, stderr } = await runWith(["restore:verify"], env);

    expect(code, stderr.join("\n")).toBe(0);
    expect(JSON.parse(stdout[0] ?? "null")).toMatchObject({ schema: "ok", ok: true });
  });
});
