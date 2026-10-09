// S-6 test support (jobs and workers), owned by the test-architect.
//
// The queue modules arrive with S-6's code, and pg-boss isn't installed yet. Until then this file
// declares their shapes from the LLD (F-70 to F-81, F-78b, F-96's worker members) and loads them
// through variable specifiers, so typecheck passes before the code exists. Once it lands the
// loaders can become static imports.
//
// It also defines the test jobs as plain JobDefinition literals (no defineJob import), and a
// literal JobRegistry, so the template database (globalSetup → schemaStepInput) can create their
// queues: every test database copy then has `test.*` queues and both dead-letter queues.
import type { Clock } from "@budmon/shared";
import { z } from "zod";
import type { Config } from "../../src/platform/config/schema.js";
import type { BaseContainer } from "../../src/platform/container.js";
import type { Database, DbHandle } from "../../src/platform/db/types.js";
import type { ErrorReporter } from "../../src/platform/observability/errorReporter.js";
import type { Logger } from "../../src/platform/observability/logger.js";
import type { PlatformMetrics } from "../../src/platform/observability/metrics.js";

// ---- F-70, F-71: definitions and the registry ----

export type WorkerRole = "capture" | "general";
export type QueuePolicy = "standard" | "stately" | "singleton" | "short";

export interface JobDefinition<P = unknown> {
  readonly name: string;
  readonly role: WorkerRole;
  readonly payload: z.ZodType<P>;
  readonly retryLimit: number;
  readonly retryDelaySeconds: number;
  readonly retryBackoff: boolean;
  readonly expireInSeconds: number;
  readonly policy: QueuePolicy;
  readonly cron?: string;
}

export interface JobRegistry {
  all: () => readonly JobDefinition[];
  forRole: (r: WorkerRole) => readonly JobDefinition[];
  get: (name: string) => JobDefinition | undefined;
  deadLetterQueue: (r: WorkerRole) => string;
}

/** A JobRegistry over `defs`, with F-71's dead-letter names (no validation: tests build it). */
export function registryOf(defs: readonly JobDefinition[]): JobRegistry {
  return {
    all: () => defs,
    forRole: (r) => defs.filter((d) => d.role === r),
    get: (name) => defs.find((d) => d.name === name),
    deadLetterQueue: (r) => `dead-letter.${r}`,
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
export const TEST_JOB_DEFINITIONS: readonly JobDefinition[] = Object.values(TEST_JOBS);

export const TEST_JOB_REGISTRY: JobRegistry = registryOf(TEST_JOB_DEFINITIONS);

// ---- pg-boss (12.36.0), only what the tests touch ----

export interface PgBossLike {
  start: () => Promise<unknown>;
  stop: (opts?: { graceful?: boolean; timeout?: number }) => Promise<void>;
  send: (name: string, data: object, opts?: object) => Promise<string | null>;
  getQueue: (name: string) => Promise<Record<string, unknown> | null>;
  getQueues: () => Promise<Record<string, unknown>[]>;
  createQueue: (name: string, opts?: object) => Promise<void>;
  on: (event: "error", handler: (error: Error) => void) => unknown;
}

// ---- F-72 to F-81, F-78b ----

export interface JobContext {
  jobId: string;
  attempt: number;
  createdOn: unknown;
  logger: Logger;
  signal: AbortSignal;
}
export type JobHandler = (payload: unknown, ctx: JobContext) => Promise<unknown>;

export interface JobQueue {
  enqueue: <P>(
    h: DbHandle,
    def: JobDefinition<P>,
    payload: P,
    opts?: { singletonKey?: string },
  ) => Promise<string | null>;
}

/** The worker container as the tests use it (F-96), independent of the code's declared type. */
export interface WorkerContainer {
  config: BaseContainer["config"];
  logger: Logger;
  clock: Clock;
  database: Database;
  metrics: PlatformMetrics;
  reporter: ErrorReporter;
  close: () => Promise<void>;
  roles: ReadonlySet<WorkerRole>;
  registry: JobRegistry;
  queue: JobQueue;
  boss: PgBossLike;
  queueBoss: PgBossLike | null;
  captureBoss: PgBossLike | null;
  erasureHandler: unknown;
  sealedColumns: { all: () => readonly unknown[] };
  onGeneralStarted: (() => Promise<void>)[];
}

export interface JobsModule {
  defineJob: <P>(
    def: { name: string; role: WorkerRole; payload: z.ZodType<P> } & Partial<
      Omit<JobDefinition<P>, "name" | "role" | "payload">
    >,
  ) => JobDefinition<P>;
}
export interface RegistryModule {
  createJobRegistry: (defs: readonly JobDefinition[]) => JobRegistry;
}
export interface PayloadSafetyModule {
  UnsafeJobPayloadError: new (...args: never[]) => Error & { readonly path: string };
  assertPayloadSafe: (payload: unknown) => void;
}
export interface JobQueueModule {
  createJobQueue: (deps: { boss: PgBossLike; registry: JobRegistry }) => JobQueue;
  JobPayloadInvalidError: new (...args: never[]) => Error;
}
export interface QueueSchemaModule {
  installOrUpgradeQueueSchema: (
    migrator: DbHandle,
  ) => Promise<"installed" | "upgraded" | "current">;
}
export interface QueueSyncModule {
  syncQueues: (
    boss: PgBossLike,
    registry: JobRegistry,
    logger: Logger,
  ) => Promise<{ created: number; updated: number }>;
}
export interface WrapperModule {
  JobFailure: new (...args: never[]) => Error;
  wrapHandler: <P>(
    def: JobDefinition<P>,
    handler: (payload: P, ctx: JobContext) => Promise<unknown>,
    deps: { logger: Logger; metrics: PlatformMetrics; reporter: ErrorReporter; clock: Clock },
  ) => (jobs: object[]) => Promise<void>;
}
export interface WorkersModule {
  createPgBoss: (cfg: Config, mode: "send-only" | "capture" | "general") => PgBossLike;
  startWorkers: (
    c: WorkerContainer,
    handlers: ReadonlyMap<string, JobHandler>,
  ) => Promise<{ stop: () => Promise<void> }>;
  runGeneralStartHooks: (
    c: Pick<WorkerContainer, "roles" | "onGeneralStarted" | "logger" | "reporter">,
  ) => Promise<void>;
  MissingQueueError: new (...args: never[]) => Error;
}
export interface HeartbeatModule {
  startHeartbeat: (deps: {
    metrics: PlatformMetrics;
    logger: Logger;
    clock: Clock;
    service: string;
    intervalMs?: number;
    setInterval?: (fn: () => void, ms: number) => unknown;
    writeFile?: (path: string, data: string) => void;
    path?: string;
  }) => { stop: () => void; last: () => number };
}
export interface AppRegistryModule {
  buildJobRegistry: () => JobRegistry;
}
export interface MaintenanceModule {
  platformMaintenanceJobs: readonly JobDefinition[];
  maintenanceHandlers: (c: WorkerContainer) => ReadonlyMap<string, JobHandler>;
}
export interface HandlersModule {
  buildHandlerMap: (c: WorkerContainer) => ReadonlyMap<string, JobHandler>;
}
export interface DeadLetterModule {
  listDeadLetters: (
    boss: PgBossLike,
    role?: WorkerRole,
    limit?: number,
  ) => Promise<
    {
      id: string;
      sourceName: string | null;
      sourceId: string | null;
      createdOn: string;
      sourceRetryCount: number | null;
      failure: string | null;
    }[]
  >;
  redriveDeadLetter: (boss: PgBossLike, role: WorkerRole, id: string) => Promise<number>;
}

const SPECIFIERS = {
  jobs: "../../src/platform/queue/jobs.js",
  registry: "../../src/platform/queue/registry.js",
  payloadSafety: "../../src/platform/queue/payloadSafety.js",
  jobQueue: "../../src/platform/queue/jobQueue.js",
  queueSchema: "../../src/platform/queue/queueSchema.js",
  queueSync: "../../src/platform/queue/queueSync.js",
  wrapper: "../../src/platform/queue/wrapper.js",
  workers: "../../src/platform/queue/workers.js",
  heartbeat: "../../src/platform/queue/heartbeat.js",
  deadLetter: "../../src/platform/queue/deadLetter.js",
  handlers: "../../src/platform/queue/handlers.js",
  appRegistry: "../../src/platform/queue/appRegistry.js",
  maintenance: "../../src/platform/maintenance/maintenanceJobs.js",
} as const;

async function load<T>(specifier: string): Promise<T> {
  return (await import(/* @vite-ignore */ specifier)) as T;
}

export const s6 = {
  jobs: () => load<JobsModule>(SPECIFIERS.jobs),
  registry: () => load<RegistryModule>(SPECIFIERS.registry),
  payloadSafety: () => load<PayloadSafetyModule>(SPECIFIERS.payloadSafety),
  jobQueue: () => load<JobQueueModule>(SPECIFIERS.jobQueue),
  queueSchema: () => load<QueueSchemaModule>(SPECIFIERS.queueSchema),
  queueSync: () => load<QueueSyncModule>(SPECIFIERS.queueSync),
  wrapper: () => load<WrapperModule>(SPECIFIERS.wrapper),
  workers: () => load<WorkersModule>(SPECIFIERS.workers),
  heartbeat: () => load<HeartbeatModule>(SPECIFIERS.heartbeat),
  deadLetter: () => load<DeadLetterModule>(SPECIFIERS.deadLetter),
  handlers: () => load<HandlersModule>(SPECIFIERS.handlers),
  appRegistry: () => load<AppRegistryModule>(SPECIFIERS.appRegistry),
  maintenance: () => load<MaintenanceModule>(SPECIFIERS.maintenance),
};

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

/**
 * The template's registry (A-202): every production definition plus the test ones, through
 * `createJobRegistry([...buildJobRegistry().all(), ...TEST_JOB_DEFINITIONS])`. Until S-6's
 * modules exist it falls back to the test definitions alone (only for a missing module; any
 * other error is thrown), so the rest of the integration suite keeps running meanwhile.
 */
export async function templateJobRegistry(): Promise<JobRegistry> {
  try {
    const { buildJobRegistry } = await s6.appRegistry();
    const { createJobRegistry } = await s6.registry();
    return createJobRegistry([...buildJobRegistry().all(), ...TEST_JOB_DEFINITIONS]);
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    const message = error instanceof Error ? error.message : "";
    if (code === "ERR_MODULE_NOT_FOUND" || message.includes("Cannot find module")) {
      return TEST_JOB_REGISTRY;
    }
    throw error;
  }
}
