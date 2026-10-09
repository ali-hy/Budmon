// S-6 test support (jobs and workers), owned by the test-architect.
//
// The test jobs are plain JobDefinition literals; the template database (globalSetup →
// schemaStepInput) syncs their queues next to the production ones (A-202), so every test
// database copy has `test.*` queues and both dead-letter queues.
import type { PgBoss } from "pg-boss";
import { z } from "zod";
import type { Database } from "../../src/platform/db/types.js";
import { buildJobRegistry } from "../../src/platform/queue/appRegistry.js";
import type { JobDefinition, WorkerRole } from "../../src/platform/queue/jobs.js";
import { createJobRegistry, type JobRegistry } from "../../src/platform/queue/registry.js";

export type { WorkerContainer } from "../../src/platform/container.js";
export type { JobDefinition, WorkerRole } from "../../src/platform/queue/jobs.js";
export type { JobRegistry } from "../../src/platform/queue/registry.js";
export type { JobContext } from "../../src/platform/queue/wrapper.js";
export type { JobHandler } from "../../src/platform/queue/workers.js";
export type PgBossLike = PgBoss;

/** A JobRegistry over `defs`, with F-71's dead-letter names (no validation: tests build it). */
export function registryOf(defs: readonly JobDefinition<unknown>[]): JobRegistry {
  return {
    all: () => defs,
    forRole: (r: WorkerRole) => defs.filter((d) => d.role === r),
    get: (name: string) => defs.find((d) => d.name === name),
    deadLetterQueue: (r: WorkerRole) => `dead-letter.${r}`,
  };
}

function job<P>(
  name: string,
  role: WorkerRole,
  payload: z.ZodType<P>,
  extra: Partial<JobDefinition<P>> = {},
): JobDefinition<P> {
  return {
    name,
    role,
    payload,
    retryLimit: 5,
    retryDelaySeconds: 30,
    retryBackoff: true,
    expireInSeconds: 900,
    policy: "standard",
    ...extra,
  };
}

/** The test jobs every template copy has queues for. Handlers are given per test. */
export const TEST_JOBS = {
  /** TP-6.5, TP-6.7: a general job that succeeds. */
  ok: job("test.ok", "general", z.object({ n: z.number().int() }), { retryLimit: 0 }),
  /** TP-6.7, TP-6.11: fails every attempt; one retry, no delay. */
  fail: job("test.fail", "general", z.object({ n: z.number().int() }), {
    retryLimit: 1,
    retryDelaySeconds: 0,
    retryBackoff: false,
  }),
  /** TP-6.8: a capture job. */
  capture: job("test.capture", "capture", z.object({ n: z.number().int() }), { retryLimit: 0 }),
  /** TP-6.7 (A-207): fails every attempt; two retries, no delay. */
  fail3: job("test.fail3", "general", z.object({ n: z.number().int() }), {
    retryLimit: 2,
    retryDelaySeconds: 0,
    retryBackoff: false,
  }),
  /** TP-6.13: the fixture's handler takes 2 s. */
  slow: job("test.slow", "general", z.object({ n: z.number().int() }), { retryLimit: 0 }),
  /** TP-6.13 (A-180): the fixture's handler never finishes. */
  forever: job("test.forever", "general", z.object({ n: z.number().int() }), { retryLimit: 0 }),
  /** TP-6.15: the fixture's handler runs SELECT 1. */
  select: job("test.select", "general", z.object({ n: z.number().int() }), { retryLimit: 0 }),
} satisfies Record<string, JobDefinition<{ n: number }>>;

/** The test definitions the template's registry adds to the production ones (A-202). */
export const TEST_JOB_DEFINITIONS: readonly JobDefinition<unknown>[] = Object.values(TEST_JOBS);

export const TEST_JOB_REGISTRY: JobRegistry = registryOf(TEST_JOB_DEFINITIONS);

/** Rows of pgboss.job for `name`, read through `database` (budmon_app has SELECT, F-74). */
export async function jobRows(
  database: Database,
  name: string,
): Promise<{ id: string; state: string; data: unknown; output: unknown }[]> {
  const { rows } = await database.handle.executeSql(
    "SELECT id::text AS id, state::text AS state, data, output FROM pgboss.job WHERE name = $1 ORDER BY created_on",
    [name],
  );
  return rows.map((r) => ({
    id: String(r["id"]),
    state: String(r["state"]),
    data: r["data"],
    output: r["output"],
  }));
}

/** Polls `check` every 200 ms until it returns true or `timeoutMs` passes. */
export async function waitFor(
  check: () => Promise<boolean>,
  timeoutMs = 30_000,
  what = "condition",
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/** The template's registry (A-202): every production definition plus the test ones. */
export function templateJobRegistry(): JobRegistry {
  return createJobRegistry([...buildJobRegistry().all(), ...TEST_JOB_DEFINITIONS]);
}
