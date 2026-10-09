// F-74 installOrUpgradeQueueSchema, F-73 createJobQueue, F-75 syncQueues. TP-6.4 to TP-6.6, plus
// extra cases TP-6.18x. IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
//
// TP-6.4 and TP-6.5 use template copies (their pgboss schema and test.* queues come from the
// template's schema step). TP-6.6 needs a database with the queue schema and no queue at all, so
// it uses a fresh cluster: bootstrap, roles (F-15), then F-74 directly.
import { CANARIES } from "@budmon/test-support";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { bootstrapCluster } from "../../../src/platform/db/clusterBootstrap.js";
import { applyRolesAndPrivileges } from "../../../src/platform/db/roles.js";
import { SchemaStepError } from "../../../src/platform/db/schemaStep.js";
import { withTransaction } from "../../../src/platform/db/transaction.js";
import type { Database } from "../../../src/platform/db/types.js";
import { testApiConfigFor } from "../../support/api.js";
import {
  TEST_JOBS,
  policyQueues,
  queuePolicies,
  jobRows,
  registryOf,
  type JobDefinition,
  type PgBossLike,
  NOT_SENDABLE,
} from "../../support/jobs.js";
import { connectDatabase, recordingLogger } from "../../support/platform.js";
import {
  TEST_ROLE_PASSWORDS,
  query,
  startFreshPostgres,
  testRoleSecrets,
  type FreshPostgres,
} from "../../support/postgres.js";
import { createTestDatabase, type TestDatabase } from "../../support/testDatabase.js";
import { testWorkerConfig } from "../../support/worker.js";
import { JobPayloadInvalidError, createJobQueue } from "../../../src/platform/queue/jobQueue.js";
import { UnsafeJobPayloadError } from "../../../src/platform/queue/payloadSafety.js";
import { installOrUpgradeQueueSchema } from "../../../src/platform/queue/queueSchema.js";
import { syncQueues } from "../../../src/platform/queue/queueSync.js";
import { createPgBoss } from "../../../src/platform/queue/workers.js";

describe("TP-6.4: the queue schema (F-74)", () => {
  let testDb: TestDatabase;
  let migrator: Database;
  let boss: PgBossLike | undefined;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    migrator = testDb.connectAs("budmon_migrator");
  });

  afterAll(async () => {
    await boss?.stop({ graceful: false });
    await migrator.close();
    await testDb.drop();
  });

  /** The api's send-only pg-boss on this database, started once. */
  async function startBoss(): Promise<PgBossLike> {
    if (boss === undefined) {
      const b = createPgBoss(testApiConfigFor(testDb), "send-only");
      await b.start();
      boss = b;
    }
    return boss;
  }

  it("TP-6.4: schema pgboss belongs to budmon_queue", async () => {
    const [row] = await query<{ owner: string }>(
      testDb.urlAs("budmon_migrator"),
      "SELECT nspowner::regrole::text AS owner FROM pg_namespace WHERE nspname = 'pgboss'",
    );

    expect(row?.owner).toBe("budmon_queue");
  });

  it("TP-6.4: running F-74 again reports current", async () => {
    expect(await installOrUpgradeQueueSchema(migrator.handle)).toBe("current");
  });

  it("TP-6.4: budmon_app (the api's send-only pg-boss) sends a job", async () => {
    const boss = await startBoss();

    const id = await boss.send(TEST_JOBS.ok.name, { n: 1 });

    expect(typeof id).toBe("string");
    expect((await jobRows(testDb.database, TEST_JOBS.ok.name)).map((r) => r.id)).toContain(id);
  });

  it.each([
    ["UPDATE pgboss.job_common", "UPDATE pgboss.job_common SET name = name WHERE false"],
    ["DELETE FROM pgboss.job_common", "DELETE FROM pgboss.job_common WHERE false"],
    ["UPDATE pgboss.queue", "UPDATE pgboss.queue SET name = name WHERE false"],
  ])("TP-6.4: (A-227) as budmon_app, %s is 42501", async (_label, sql) => {
    const code = await query(testDb.urlAs("budmon_app"), sql).then(
      () => "allowed",
      (error: unknown) => String((error as { code?: unknown }).code),
    );

    expect(code).toBe("42501");
  });

  it("TP-6.4: (A-227) budmon_app still sends", async () => {
    const id = await (await startBoss()).send(TEST_JOBS.ok.name, { n: 2 });

    expect(typeof id).toBe("string");
  });

  it("TP-6.18x: budmon_capture and budmon_app can use the schema; budmon_monitor can't", async () => {
    const counts = async (role: "budmon_app" | "budmon_capture" | "budmon_monitor") =>
      query(testDb.urlAs(role), "SELECT count(*)::int AS n FROM pgboss.job").then(
        () => "ok",
        (error: unknown) => String((error as { code?: unknown }).code),
      );

    expect(await counts("budmon_app")).toBe("ok");
    expect(await counts("budmon_capture")).toBe("ok");
    expect(await counts("budmon_monitor")).toBe("42501");
  });
});

describe("TP-6.5: createJobQueue (F-73)", () => {
  let testDb: TestDatabase;
  let boss: PgBossLike | undefined;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    boss = createPgBoss(testApiConfigFor(testDb), "send-only");
    await boss.start();
  });

  afterAll(async () => {
    await boss?.stop({ graceful: false });
    await testDb.drop();
  });

  function started(): PgBossLike {
    if (boss === undefined) throw new Error("pg-boss didn't start");
    return boss;
  }

  function queue() {
    return createJobQueue({ boss: started(), registry: registryOf([TEST_JOBS.ok]) });
  }

  it("TP-6.5: enqueued in a transaction, then committed: the job row exists", async () => {
    const q = queue();

    const id = await withTransaction(testDb.database, (tx) =>
      q.enqueue(tx, TEST_JOBS.ok, { n: 51 }),
    );

    const rows = await jobRows(testDb.database, TEST_JOBS.ok.name);
    expect(rows.find((r) => r.id === id)?.data).toEqual({ n: 51 });
  });

  it("TP-6.5: enqueued in a transaction, then rolled back: no row", async () => {
    const q = queue();

    await expect(
      withTransaction(testDb.database, async (tx) => {
        await q.enqueue(tx, TEST_JOBS.ok, { n: 52 });
        throw new Error("roll back");
      }),
    ).rejects.toThrow("roll back");

    const rows = await jobRows(testDb.database, TEST_JOBS.ok.name);
    expect(rows.filter((r) => (r.data as { n?: unknown }).n === 52)).toEqual([]);
  });

  it("TP-6.5: an invalid payload throws JobPayloadInvalidError whose message has paths and codes only", async () => {
    const q = queue();

    const error = await q
      .enqueue(testDb.database.handle, TEST_JOBS.ok, { n: CANARIES.payee } as unknown as {
        n: number;
      })
      .then(
        () => undefined,
        (e: unknown) => e,
      );

    expect(error).toBeInstanceOf(JobPayloadInvalidError);
    expect((error as Error).message).toContain("n");
    expect((error as Error).message).not.toContain(CANARIES.payee);
  });

  it("TP-6.5: an unregistered definition throws Error('job not registered: <name>')", async () => {
    const q = queue();
    const other: JobDefinition<{ n: number }> = { ...TEST_JOBS.ok, name: "test.unregistered" };

    await expect(q.enqueue(testDb.database.handle, other, { n: 1 })).rejects.toThrow(
      "job not registered: test.unregistered",
    );
  });

  it("TP-6.18x: an unsafe payload value (F-72) propagates UnsafeJobPayloadError", async () => {
    const free: JobDefinition<{ s: string }> = {
      ...TEST_JOBS.ok,
      payload: z.object({ s: z.string() }),
    };
    const q = createJobQueue({ boss: started(), registry: registryOf([free]) });

    await expect(
      q.enqueue(testDb.database.handle, free, { s: "has space" }),
    ).rejects.toBeInstanceOf(UnsafeJobPayloadError);
  });
});

describe("TP-6.6: syncQueues (F-75)", () => {
  const DATABASE = "budmon_sync";
  let pg: FreshPostgres;
  let migrator: Database | undefined;
  let boss: PgBossLike | undefined;

  const a: JobDefinition<unknown> = {
    ...NOT_SENDABLE,
    name: "sync.a",
    role: "general",
    payload: z.object({}),
    retryLimit: 3,
    retryDelaySeconds: 10,
    retryBackoff: false,
    expireInSeconds: 600,
    policy: "standard",
  };
  const b: JobDefinition<unknown> = { ...a, name: "sync.b", role: "capture", policy: "singleton" };

  beforeAll(async () => {
    pg = await startFreshPostgres();
    const client = await pg.superuserClient();
    try {
      await bootstrapCluster(client, {
        databaseName: DATABASE,
        migrator: { password: TEST_ROLE_PASSWORDS.budmon_migrator },
      });
    } finally {
      await client.end();
    }
    const m = connectDatabase(pg, "budmon_migrator", TEST_ROLE_PASSWORDS.budmon_migrator, DATABASE);
    migrator = m;
    await applyRolesAndPrivileges(m.handle, testRoleSecrets(), "test", recordingLogger());
    expect(await installOrUpgradeQueueSchema(m.handle)).toBe("installed");
    boss = createPgBoss(testWorkerConfig(pg, DATABASE, "general"), "general");
    await boss.start();
  }, 120_000);

  afterAll(async () => {
    await boss?.stop({ graceful: false });
    await migrator?.close();
    await pg.stop();
  });

  function started(): PgBossLike {
    if (boss === undefined) throw new Error("pg-boss didn't start");
    return boss;
  }

  it("TP-6.6: sync creates the 2 queues and both dead-letter queues; again creates none; the options match", async () => {
    const registry = registryOf([a, b]);

    const first = await syncQueues(started(), registry, recordingLogger());
    const second = await syncQueues(started(), registry, recordingLogger());

    expect(first.created).toBe(4);
    expect(second.created).toBe(0);
    expect(await started().getQueue("sync.a")).toMatchObject({
      name: "sync.a",
      policy: "standard",
      retryLimit: 3,
      retryDelay: 10,
      retryBackoff: false,
      expireInSeconds: 600,
      deleteAfterSeconds: 604800,
      retentionSeconds: 1209600,
      deadLetter: "dead-letter.general",
    });
    expect(await started().getQueue("sync.b")).toMatchObject({
      policy: "singleton",
      deadLetter: "dead-letter.capture",
    });
    for (const dlq of ["dead-letter.general", "dead-letter.capture"]) {
      expect(await started().getQueue(dlq)).toMatchObject({
        policy: "standard",
        retentionSeconds: 2592000,
        deleteAfterSeconds: 2592000,
      });
    }
  });

  it("TP-6.6: (A-227) step 6b: RLS on job_common (not forced), capture's policy lists match the registry and follow it, every queue non-partitioned", async () => {
    if (migrator === undefined) throw new Error("no migrator");
    const db = migrator;
    const { applyQueuePolicies } = await queuePolicies();
    const registry = registryOf([a, b]);

    await syncQueues(started(), registry, recordingLogger());
    await applyQueuePolicies(db.handle, registry);

    const { rows: rls } = await db.handle.executeSql(
      "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'pgboss.job_common'::regclass",
    );
    expect(rls[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: false });
    expect(await policyQueues(db, "budmon_capture")).toEqual({
      using: ["dead-letter.capture", "sync.b"],
      check: ["dead-letter.capture", "sync.b"],
    });
    const { rows: partitioned } = await db.handle.executeSql(
      "SELECT name FROM pgboss.queue WHERE partition IS DISTINCT FROM false",
    );
    expect(partitioned).toEqual([]);

    // A capture job and a general one marked sendableFromCapture: the lists follow.
    const c: JobDefinition<unknown> = { ...b, name: "sync.c", policy: "standard" };
    const d = { ...a, name: "sync.d", sendableFromCapture: true } as JobDefinition<unknown>;
    const grown = registryOf([a, b, c, d]);
    await syncQueues(started(), grown, recordingLogger());
    await applyQueuePolicies(db.handle, grown);

    expect(await policyQueues(db, "budmon_capture")).toEqual({
      using: ["dead-letter.capture", "sync.b", "sync.c"],
      check: ["dead-letter.capture", "sync.b", "sync.c", "sync.d"],
    });
    const { rows: still } = await db.handle.executeSql(
      "SELECT name FROM pgboss.queue WHERE partition IS DISTINCT FROM false",
    );
    expect(still).toEqual([]);
  });

  it("TP-6.6: a changed option is updated; a changed policy throws SchemaStepError queue_policy_changed", async () => {
    await syncQueues(started(), registryOf([{ ...a, retryLimit: 4 }, b]), recordingLogger());
    expect(await started().getQueue("sync.a")).toMatchObject({ retryLimit: 4 });

    const error = await syncQueues(
      started(),
      registryOf([{ ...a, policy: "stately" }, b]),
      recordingLogger(),
    ).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(SchemaStepError);
    expect(error).toMatchObject({ code: "queue_policy_changed", subject: "sync.a" });
  });

  it("TP-6.6: a queue other.x created by hand is left alone, and queue_unregistered is logged through the passed logger (A-205)", async () => {
    await started().createQueue("other.x", { policy: "standard", retryLimit: 9 });
    const logger = recordingLogger();

    await syncQueues(started(), registryOf([a, b]), logger);

    expect(await started().getQueue("other.x")).toMatchObject({ retryLimit: 9 });
    // A-205: the warning goes through the logger passed in.
    // (sync.c and sync.d from the A-227 case are unregistered here too.)
    const warned = logger.lines.filter(
      (l) =>
        l.event === "queue_unregistered" &&
        (l.fields as { fields?: { queue?: unknown } }).fields?.queue === "other.x",
    );
    expect(warned).toHaveLength(1);
    expect(warned[0]).toMatchObject({ level: "warn" });
  });
});
