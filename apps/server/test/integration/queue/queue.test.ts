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
  jobRows,
  registryOf,
  s6,
  type JobDefinition,
  type PgBossLike,
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

  it("TP-6.4: schema pgboss belongs to budmon_queue", async () => {
    const [row] = await query<{ owner: string }>(
      testDb.urlAs("budmon_migrator"),
      "SELECT nspowner::regrole::text AS owner FROM pg_namespace WHERE nspname = 'pgboss'",
    );

    expect(row?.owner).toBe("budmon_queue");
  });

  it("TP-6.4: running F-74 again reports current", async () => {
    const { installOrUpgradeQueueSchema } = await s6.queueSchema();

    expect(await installOrUpgradeQueueSchema(migrator.handle)).toBe("current");
  });

  it("TP-6.4: budmon_app (the api's send-only pg-boss) sends a job", async () => {
    const { createPgBoss } = await s6.workers();
    boss = createPgBoss(testApiConfigFor(testDb), "send-only");
    await boss.start();

    const id = await boss.send(TEST_JOBS.ok.name, { n: 1 });

    expect(typeof id).toBe("string");
    expect((await jobRows(testDb.database, TEST_JOBS.ok.name)).map((r) => r.id)).toContain(id);
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
    const { createPgBoss } = await s6.workers();
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

  async function queue() {
    const { createJobQueue } = await s6.jobQueue();
    return createJobQueue({ boss: started(), registry: registryOf([TEST_JOBS.ok]) });
  }

  it("TP-6.5: enqueued in a transaction, then committed: the job row exists", async () => {
    const q = await queue();

    const id = await withTransaction(testDb.database, (tx) =>
      q.enqueue(tx, TEST_JOBS.ok, { n: 51 }),
    );

    const rows = await jobRows(testDb.database, TEST_JOBS.ok.name);
    expect(rows.find((r) => r.id === id)?.data).toEqual({ n: 51 });
  });

  it("TP-6.5: enqueued in a transaction, then rolled back: no row", async () => {
    const q = await queue();

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
    const q = await queue();
    const { JobPayloadInvalidError } = await s6.jobQueue();

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
    const q = await queue();
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
    const { createJobQueue } = await s6.jobQueue();
    const { UnsafeJobPayloadError } = await s6.payloadSafety();
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

  const a: JobDefinition = {
    name: "sync.a",
    role: "general",
    payload: z.object({}),
    retryLimit: 3,
    retryDelaySeconds: 10,
    retryBackoff: false,
    expireInSeconds: 600,
    policy: "standard",
  };
  const b: JobDefinition = { ...a, name: "sync.b", role: "capture", policy: "singleton" };

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
    const { installOrUpgradeQueueSchema } = await s6.queueSchema();
    expect(await installOrUpgradeQueueSchema(m.handle)).toBe("installed");
    const { createPgBoss } = await s6.workers();
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
    const { syncQueues } = await s6.queueSync();
    const registry = registryOf([a, b]);

    const first = await syncQueues(started(), registry);
    const second = await syncQueues(started(), registry);

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

  it("TP-6.6: a changed option is updated; a changed policy throws SchemaStepError queue_policy_changed", async () => {
    const { syncQueues } = await s6.queueSync();

    await syncQueues(started(), registryOf([{ ...a, retryLimit: 4 }, b]));
    expect(await started().getQueue("sync.a")).toMatchObject({ retryLimit: 4 });

    const error = await syncQueues(started(), registryOf([{ ...a, policy: "stately" }, b])).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(SchemaStepError);
    expect(error).toMatchObject({ code: "queue_policy_changed", subject: "sync.a" });
  });

  it("TP-6.6: a queue other.x created by hand is left alone", async () => {
    const { syncQueues } = await s6.queueSync();
    await started().createQueue("other.x", { policy: "standard", retryLimit: 9 });

    await syncQueues(started(), registryOf([a, b]));

    expect(await started().getQueue("other.x")).toMatchObject({ retryLimit: 9 });
  });
});
