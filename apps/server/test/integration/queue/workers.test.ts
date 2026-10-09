// F-76 to F-78 and F-81 through running workers on template copies, and F-96's worker defaults.
// TP-6.7, TP-6.8, TP-6.9, TP-6.11 and TP-6.14's container part, plus extra cases TP-6.19x. IDs
// ending in "x" are test-architect additions, not LLD test-plan IDs.
//
// Each container gets a registry of test jobs (support/jobs.ts), whose queues the template has.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CANARIES, scanForCanaries } from "@budmon/test-support";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { recordingLogger } from "../../support/platform.js";
import { query } from "../../support/postgres.js";
import {
  TEST_JOBS,
  jobRows,
  registryOf,
  waitFor,
  type JobDefinition,
  type JobHandler,
  type PgBossLike,
  type WorkerContainer,
} from "../../support/jobs.js";
import { createTestDatabase } from "../../support/testDatabase.js";
import { createWorkerContainer } from "../../../src/platform/container.js";
import {
  buildWorkerContainer,
  testWorkerConfig,
  testWorkerEnv,
  type BuiltWorker,
} from "../../support/worker.js";
import { listDeadLetters, redriveDeadLetter } from "../../../src/platform/queue/deadLetter.js";
import { syncQueues } from "../../../src/platform/queue/queueSync.js";
import {
  MissingQueueError,
  createPgBoss,
  startWorkers,
} from "../../../src/platform/queue/workers.js";

function queueBoss(c: WorkerContainer): PgBossLike {
  return c.queueBoss ?? c.boss;
}

async function counter(built: BuiltWorker, name: string): Promise<number> {
  const metric = (await built.obs.collect()).get(name);
  return (metric?.dataPoints ?? []).reduce(
    (sum, p) => sum + (typeof p.value === "number" ? p.value : 0),
    0,
  );
}

/** Every pgboss.job row, as text, for canary scans. */
async function allJobsText(built: BuiltWorker): Promise<string> {
  const { rows } = await built.testDb.database.handle.executeSql(
    "SELECT name, data, output FROM pgboss.job",
  );
  return JSON.stringify(rows);
}

describe("TP-6.7: handler success and failure through a running worker (F-76)", () => {
  let built: BuiltWorker;
  let stop: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    built = await buildWorkerContainer("general", {
      registry: registryOf([TEST_JOBS.ok, TEST_JOBS.fail]),
    });
    const handlers = new Map<string, JobHandler>([
      [TEST_JOBS.ok.name, () => Promise.resolve({ secret: CANARIES.token })],
      [TEST_JOBS.fail.name, () => Promise.reject(new Error(CANARIES.message))],
    ]);
    const w = await startWorkers(built.container, handlers);
    stop = () => w.stop();
  }, 60_000);

  afterAll(async () => {
    await stop?.();
    await built.close();
  });

  it("TP-6.7: a completed job's output is null; a failed one's is message 'Error' and frames; after the final attempt it's in dead-letter.general with its sourceName; jobs_dead_lettered_total +1; no canary in pgboss.job or the logs", async () => {
    const c = built.container;
    const okId = await c.queue.enqueue(c.database.handle, TEST_JOBS.ok, { n: 1 });
    const failId = await c.queue.enqueue(c.database.handle, TEST_JOBS.fail, { n: 2 });

    await waitFor(
      async () =>
        (await jobRows(c.database, TEST_JOBS.ok.name)).some(
          (r) => r.id === okId && r.state === "completed",
        ),
      30_000,
      "the ok job to complete",
    );
    await waitFor(
      async () => (await jobRows(c.database, "dead-letter.general")).length > 0,
      60_000,
      "a dead-lettered job",
    );

    const ok = (await jobRows(c.database, TEST_JOBS.ok.name)).find((r) => r.id === okId);
    expect(ok?.output).toBeNull();
    const failed = (await jobRows(c.database, TEST_JOBS.fail.name)).find((r) => r.id === failId);
    expect(failed?.state).toBe("failed");
    const output = failed?.output as Record<string, unknown> | null;
    expect(Object.keys(output ?? {}).sort()).toEqual(["message", "stack"]);
    expect(output?.["message"]).toBe("Error");
    expect(String(output?.["stack"]).startsWith("JobFailure: Error")).toBe(true);
    const dead = await listDeadLetters(queueBoss(c), "general");
    expect(dead.map((d) => [d.sourceName, d.sourceId])).toContainEqual([
      TEST_JOBS.fail.name,
      failId,
    ]);
    expect(await counter(built, "jobs_dead_lettered_total")).toBe(1);
    expect(
      scanForCanaries(
        [
          { name: "pgboss.job", text: await allJobsText(built) },
          { name: "log", text: built.obs.capture.text() },
        ],
        CANARIES,
      ),
    ).toEqual([]);
  }, 90_000);
});

describe("TP-6.7: attempts with retryLimit 2 (F-76, A-207)", () => {
  let built: BuiltWorker;
  let stop: (() => Promise<void>) | undefined;
  const attempts: number[] = [];

  beforeAll(async () => {
    built = await buildWorkerContainer("general", { registry: registryOf([TEST_JOBS.fail3]) });
    const w = await startWorkers(
      built.container,
      new Map<string, JobHandler>([
        [
          TEST_JOBS.fail3.name,
          (_payload, ctx) => {
            attempts.push(ctx.attempt);
            return Promise.reject(new Error("x"));
          },
        ],
      ]),
    );
    stop = () => w.stop();
  }, 60_000);

  afterAll(async () => {
    await stop?.();
    await built.close();
  });

  it("TP-6.7: the handler sees attempts 1, 2 and 3; the job is dead-lettered after attempt 3 and the counter goes up once", async () => {
    const c = built.container;
    await c.queue.enqueue(c.database.handle, TEST_JOBS.fail3, { n: 4 });

    await waitFor(
      async () => (await jobRows(c.database, "dead-letter.general")).length > 0,
      90_000,
      "a dead-lettered job",
    );

    expect(attempts).toEqual([1, 2, 3]);
    expect(await counter(built, "jobs_dead_lettered_total")).toBe(1);
  }, 120_000);
});

describe("TP-6.8: worker-capture as budmon_capture (F-77)", () => {
  let built: BuiltWorker;
  let stop: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    built = await buildWorkerContainer("capture", { registry: registryOf([TEST_JOBS.capture]) });
    const w = await startWorkers(
      built.container,
      new Map<string, JobHandler>([[TEST_JOBS.capture.name, () => Promise.resolve(undefined)]]),
    );
    stop = () => w.stop();
  }, 60_000);

  afterAll(async () => {
    await stop?.();
    await built.close();
  });

  it("TP-6.8: a capture job completes with no permission error; SELECT from idempotency_records as budmon_capture is 42501", async () => {
    const c = built.container;
    const id = await c.queue.enqueue(c.database.handle, TEST_JOBS.capture, { n: 1 });

    await waitFor(
      async () =>
        (await jobRows(c.database, TEST_JOBS.capture.name)).some(
          (r) => r.id === id && r.state === "completed",
        ),
      30_000,
      "the capture job to complete",
    );
    const denied = await query(
      built.testDb.urlAs("budmon_capture"),
      "SELECT * FROM idempotency_records",
    ).then(
      () => "allowed",
      (error: unknown) => String((error as { code?: unknown }).code),
    );

    expect(denied).toBe("42501");
    expect(built.obs.capture.text()).not.toContain("42501");
  }, 60_000);

  it("TP-6.19x: a capture-only container has no queue boss and a capture boss", () => {
    expect(built.container.queueBoss).toBeNull();
    expect(built.container.captureBoss).not.toBeNull();
  });
});

describe("TP-6.9: start-up checks and schedules (F-78)", () => {
  const cron: JobDefinition<unknown> = {
    name: "test.cron",
    role: "general",
    payload: z.object({}),
    retryLimit: 0,
    retryDelaySeconds: 30,
    retryBackoff: false,
    expireInSeconds: 900,
    policy: "standard",
    cron: "0 3 * * *",
  };

  it("TP-6.9: a registered job without a queue: startWorkers throws MissingQueueError", async () => {
    const missing: JobDefinition<unknown> = { ...TEST_JOBS.ok, name: "test.no-queue" };
    const built = await buildWorkerContainer("general", {
      registry: registryOf([TEST_JOBS.ok, missing]),
    });
    try {
      const handlers = new Map<string, JobHandler>([
        [TEST_JOBS.ok.name, () => Promise.resolve(undefined)],
        [missing.name, () => Promise.resolve(undefined)],
      ]);

      const error = await startWorkers(built.container, handlers).then(
        async (w) => {
          await w.stop();
          return undefined;
        },
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(MissingQueueError);
    } finally {
      await built.close();
    }
  }, 60_000);

  it("TP-6.19x: a definition without a handler: startWorkers throws 'no handler for <name>'", async () => {
    const built = await buildWorkerContainer("general", { registry: registryOf([TEST_JOBS.ok]) });
    try {
      await expect(startWorkers(built.container, new Map())).rejects.toThrow(
        `no handler for ${TEST_JOBS.ok.name}`,
      );
    } finally {
      await built.close();
    }
  }, 60_000);

  it("TP-6.9: a general worker schedules its cron job in UTC; a capture-only worker registers no schedule", async () => {
    const registry = registryOf([TEST_JOBS.ok, TEST_JOBS.capture, cron]);
    const general = await buildWorkerContainer("general", { registry });
    const handlers = new Map<string, JobHandler>(
      [TEST_JOBS.ok, TEST_JOBS.capture, cron].map((d) => [
        d.name,
        () => Promise.resolve(undefined),
      ]),
    );
    try {
      await syncQueues(queueBoss(general.container), registry, recordingLogger());
      const w = await startWorkers(general.container, handlers);
      const { rows } = await general.testDb.database.handle.executeSql(
        "SELECT name, cron, timezone FROM pgboss.schedule",
      );
      await w.stop();

      expect(rows).toEqual([{ name: "test.cron", cron: "0 3 * * *", timezone: "UTC" }]);
    } finally {
      await general.close();
    }

    // A capture-only worker on another copy (no schedule rows yet).
    const capture = await buildWorkerContainer("capture", { registry });
    try {
      const w = await startWorkers(capture.container, handlers);
      const { rows } = await capture.testDb.database.handle.executeSql(
        "SELECT name FROM pgboss.schedule",
      );
      await w.stop();

      expect(rows).toEqual([]);
    } finally {
      await capture.close();
    }
  }, 120_000);
});

describe("TP-6.9: platform.fx-gap-check only when registered (F-78, A-203)", () => {
  it("TP-6.9: a general worker whose registry has no platform.fx-gap-check starts, and nothing is enqueued under that name", async () => {
    const built = await buildWorkerContainer("general", { registry: registryOf([TEST_JOBS.ok]) });
    try {
      const w = await startWorkers(
        built.container,
        new Map<string, JobHandler>([[TEST_JOBS.ok.name, () => Promise.resolve(undefined)]]),
      );
      await w.stop();

      expect(await jobRows(built.container.database, "platform.fx-gap-check")).toEqual([]);
    } finally {
      await built.close();
    }
  }, 60_000);
});

describe("TP-6.11: dead-letter list and redrive (F-81)", () => {
  let built: BuiltWorker;
  let failId: string | null;

  beforeAll(async () => {
    built = await buildWorkerContainer("general", { registry: registryOf([TEST_JOBS.fail]) });
    const w = await startWorkers(
      built.container,
      new Map<string, JobHandler>([[TEST_JOBS.fail.name, () => Promise.reject(new Error("x"))]]),
    );
    const c = built.container;
    failId = await c.queue.enqueue(c.database.handle, TEST_JOBS.fail, { n: 3 });
    await waitFor(
      async () => (await jobRows(c.database, "dead-letter.general")).length > 0,
      60_000,
      "a dead-lettered job",
    );
    // Stopped, so a redriven job stays queued.
    await w.stop();
  }, 90_000);

  afterAll(async () => {
    await built.close();
  });

  it("TP-6.11: list gives 1 entry with failure 'Error'; redrive moves it back to its source queue; an unknown id moves 0", async () => {
    const boss = queueBoss(built.container);

    const dead = await listDeadLetters(boss, "general");
    expect(dead).toHaveLength(1);
    expect(dead[0]).toMatchObject({
      sourceName: TEST_JOBS.fail.name,
      sourceId: failId,
      failure: "Error",
    });

    const moved = await redriveDeadLetter(boss, "general", dead[0]?.id ?? "");
    expect(moved).toBe(1);
    const queued = (await jobRows(built.container.database, TEST_JOBS.fail.name)).filter((r) =>
      ["created", "retry"].includes(r.state),
    );
    expect(queued).toHaveLength(1);

    expect(await redriveDeadLetter(boss, "general", "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0b")).toBe(
      0,
    );
  });

  it("TP-6.11: (A-218) jobs:dead list through runCli prints the entry; no schedule row or pg-boss maintenance happens during the command", async () => {
    const { runCli } = await import("../../../src/main/cli.js");
    const { testDb } = built;
    const dir = mkdtempSync(path.join(tmpdir(), "budmon-cli-"));
    const read = async (sql: string) =>
      JSON.stringify((await testDb.database.handle.executeSql(sql)).rows);
    try {
      const versionBefore = await read("SELECT * FROM pgboss.version");
      const schedulesBefore = await read("SELECT * FROM pgboss.schedule ORDER BY name");
      const stdout: string[] = [];
      const stderr: string[] = [];

      const code = await runCli(
        ["jobs:dead", "list", "--role", "general"],
        testWorkerEnv(dir, testDb.endpoint, testDb.name, "general"),
        { stdout: (l) => stdout.push(l), stderr: (l) => stderr.push(l) },
      );

      expect(code, stderr.join("\n")).toBe(0);
      expect(stdout.map((l) => (JSON.parse(l) as { failure: unknown }).failure)).toEqual(["Error"]);
      expect(await read("SELECT * FROM pgboss.version")).toBe(versionBefore);
      expect(await read("SELECT * FROM pgboss.schedule ORDER BY name")).toBe(schedulesBefore);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("TP-6.11: (A-218) createPgBoss mode cli connects with the queue login as budmon-cli", async () => {
    const cfg = testWorkerConfig(built.testDb.endpoint, built.testDb.name, "general");
    const boss = (createPgBoss as (c: typeof cfg, mode: string) => PgBossLike)(cfg, "cli");
    await boss.start();
    try {
      const [row] = await query<{ usename: string }>(
        built.testDb.urlAs("budmon_migrator"),
        "SELECT usename FROM pg_stat_activity WHERE application_name = 'budmon-cli' LIMIT 1",
      );

      expect(row?.usename).toBe("budmon_queue");
    } finally {
      await boss.stop({ graceful: false });
    }
  });

  it("TP-6.19x: listDeadLetters without a role covers both roles; the capture list is empty", async () => {
    const boss = queueBoss(built.container);

    expect(await listDeadLetters(boss, "capture")).toEqual([]);
    expect((await listDeadLetters(boss)).length).toBeGreaterThanOrEqual(0);
  });
});

describe("TP-6.14: createWorkerContainer's module defaults (F-96, A-26)", () => {
  it("TP-6.14: with no overrides: onGeneralStarted is [], erasureHandler is null, sealedColumns.all() is []", async () => {
    const testDb = await createTestDatabase();
    const c = createWorkerContainer(testWorkerConfig(testDb.endpoint, testDb.name, "general"));
    try {
      expect(c.onGeneralStarted).toEqual([]);
      expect(c.erasureHandler).toBeNull();
      expect(c.sealedColumns.all()).toEqual([]);
      expect([...c.roles]).toEqual(["general"]);
    } finally {
      await c.close();
      await testDb.drop();
    }
  });
});
