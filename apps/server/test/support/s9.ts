// S-9 test support (FX rates and conversion), owned by the test-architect.
//
// The S-9 modules arrive with S-9's code. Until then this file declares their shapes from the LLD
// (F-130 to F-139) and loads them through variable specifiers, so typecheck passes before the code
// exists; once it lands the loaders become static imports, as with S-7 and S-8.
import type { Clock, CurrencyCode, Money, Temporal } from "@budmon/shared";
import type { z } from "zod";
import type { WorkerContainer } from "../../src/platform/container.js";
import type { Database, DbHandle } from "../../src/platform/db/types.js";
import type { Logger } from "../../src/platform/observability/logger.js";
import type { PlatformMetrics } from "../../src/platform/observability/metrics.js";
import type { Secret } from "../../src/platform/observability/redaction.js";
import type { JobDefinition } from "../../src/platform/queue/jobs.js";
import type { JobQueue } from "../../src/platform/queue/jobQueue.js";
import { query } from "./postgres.js";
import type { TestDatabase } from "./testDatabase.js";

// ---- F-130 ----
export interface DecimalModule {
  parseJsonKeepingNumberText: (text: string) => unknown;
  normaliseRate: (raw: string) => string | null;
}

// ---- F-131 ----
export interface FxRepoModule {
  latestDayOnOrBefore: (h: DbHandle, date: string) => Promise<string | null>;
  ratesOn: (h: DbHandle, date: string, codes: readonly string[]) => Promise<Map<string, string>>;
  dayExists: (h: DbHandle, date: string) => Promise<boolean>;
  nextStoredDayAfter: (h: DbHandle, date: string) => Promise<string | null>;
  insertDay: (
    h: DbHandle,
    rows: readonly { code: string; unitsPerUsd: string }[],
    rateDate: string,
    provider: string,
    fetchedAt: Date,
  ) => Promise<number>;
  currencies: (h: DbHandle) => Promise<Map<string, { minorUnits: number; active: boolean }>>;
}

// ---- F-132 ----
export type NoRate = { kind: "no_rate"; reason: "no_day" | "currency_missing" };
export type ConversionResult =
  { kind: "converted"; money: Money; rateDate: Temporal.PlainDate; provisional: boolean } | NoRate;
export type SumResult = { kind: "converted"; total: Money; provisional: boolean } | NoRate;
export interface RatesAddedPayload {
  rateDate: string;
  affectedFrom: string;
  affectedTo: string | null;
}
export interface FxService {
  convert: (
    m: Money,
    to: CurrencyCode,
    onDate: Temporal.PlainDate,
    h?: DbHandle,
  ) => Promise<ConversionResult>;
  convertSum: (
    items: readonly { money: Money; onDate: Temporal.PlainDate }[],
    to: CurrencyCode,
    h?: DbHandle,
  ) => Promise<SumResult>;
  registerRatesAddedSubscriber: (def: JobDefinition<RatesAddedPayload>) => void;
  subscribers: () => readonly JobDefinition<RatesAddedPayload>[];
}
export interface FxServiceModule {
  UnknownCurrencyError: new (...args: never[]) => Error;
  RatesAddedPayload: z.ZodType<RatesAddedPayload>;
  FX_FALLBACK_FIRST_DATE: string;
  createFxService: (deps: {
    database: Database;
    queue: JobQueue;
    clock: Clock;
    logger: Logger;
    metrics: PlatformMetrics;
  }) => FxService;
}

// ---- F-133 ----
export type FxProviderName = "openexchangerates" | "fawazahmed0" | "fixed";
export interface FxProvider {
  readonly name: FxProviderName;
  fetchDay: (date: string, signal: AbortSignal) => Promise<Map<string, string>>;
}
export interface FxProviders {
  primary: FxProvider;
  fallback: FxProvider;
}
export type FxProviderErrorReason = "not_found" | "http" | "network" | "invalid";
export interface ProvidersModule {
  FxProviderError: new (
    reason: FxProviderErrorReason,
    status?: number,
  ) => Error & { readonly reason: FxProviderErrorReason; readonly status?: number };
  createOpenExchangeRates: (
    cfg: { baseUrl: URL; appId: Secret<string> },
    deps: { fetch: typeof fetch },
  ) => FxProvider;
  createFawazahmed0: (
    cfg: { baseUrl: string; mirrorUrl: string },
    deps: { fetch: typeof fetch },
  ) => FxProvider;
  createFixedProvider: () => FxProvider;
}

// ---- F-137 to F-139 ----
export interface FxJobsModule {
  enqueueRatesAdded: (
    h: DbHandle,
    fx: FxService,
    queue: JobQueue,
    rateDate: string,
  ) => Promise<number>;
  fxGapCheck: (deps: {
    database: Database;
    queue: JobQueue;
    clock: Clock;
    logger: Logger;
  }) => Promise<{ enqueued: string[] }>;
}

const SPECIFIERS = {
  decimal: "../../src/platform/fx/decimal.js",
  fxRepo: "../../src/platform/fx/fxRepo.js",
  fxService: "../../src/platform/fx/fxService.js",
  providers: "../../src/platform/fx/providers.js",
  fxJobs: "../../src/platform/fx/fxJobs.js",
} as const;

async function load<T>(specifier: string): Promise<T> {
  return (await import(/* @vite-ignore */ specifier)) as T;
}

export const s9 = {
  decimal: () => load<DecimalModule>(SPECIFIERS.decimal),
  fxRepo: () => load<FxRepoModule>(SPECIFIERS.fxRepo),
  fxService: () => load<FxServiceModule>(SPECIFIERS.fxService),
  providers: () => load<ProvidersModule>(SPECIFIERS.providers),
  fxJobs: () => load<FxJobsModule>(SPECIFIERS.fxJobs),
};

// ---- container members S-9 adds (F-96: fx for every role, fxProviders for general) ----

/** F-96's `fx` member. */
export function fxOf(c: WorkerContainer): FxService {
  return (c as unknown as { fx: FxService }).fx;
}

/** Container overrides for S-9 members the WorkerContainer type doesn't declare yet. */
export function fxOverrides(o: { fxProviders?: FxProviders; fx?: FxService }): object {
  return o;
}

// ---- data helpers ----

/** Inserts rates for `rateDate` as budmon_migrator (independent of F-131). */
export async function storeDay(
  testDb: TestDatabase,
  rateDate: string,
  rates: Record<string, string>,
  provider: FxProviderName = "fixed",
): Promise<void> {
  for (const [code, unitsPerUsd] of Object.entries(rates)) {
    await query(
      testDb.urlAs("budmon_migrator"),
      "INSERT INTO exchange_rates (currency_code, rate_date, units_per_usd, provider, fetched_at) VALUES ($1, $2, $3, $4, now())",
      [code, rateDate, unitsPerUsd, provider],
    );
  }
}

/** Every exchange_rates row, as strings, ordered by date then code. */
export async function storedRates(
  testDb: TestDatabase,
): Promise<{ code: string; rateDate: string; unitsPerUsd: string; provider: string }[]> {
  const rows = await query<{
    code: string;
    rate_date: string;
    units_per_usd: string;
    provider: string;
  }>(
    testDb.urlAs("budmon_migrator"),
    "SELECT currency_code AS code, rate_date::text AS rate_date, units_per_usd::text AS units_per_usd, provider FROM exchange_rates ORDER BY rate_date, currency_code",
  );
  return rows.map((r) => ({
    code: r.code,
    rateDate: r.rate_date,
    unitsPerUsd: r.units_per_usd,
    provider: r.provider,
  }));
}

/** pgboss.job rows for `name`: data and singleton key, oldest first. */
export async function queuedJobs(
  testDb: TestDatabase,
  name: string,
): Promise<{ data: unknown; singletonKey: string | null; state: string }[]> {
  const rows = await query<{ data: unknown; singleton_key: string | null; state: string }>(
    testDb.urlAs("budmon_queue"),
    "SELECT data, singleton_key, state::text AS state FROM pgboss.job WHERE name = $1 ORDER BY created_on, id",
    [name],
  );
  return rows.map((r) => ({ data: r.data, singletonKey: r.singleton_key, state: r.state }));
}

/** A fake FxProvider whose fetchDay answers from `answer` and records the dates asked. */
export function fakeProvider(
  name: FxProviderName,
  answer: (date: string) => Promise<Map<string, string>>,
): FxProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    name,
    calls,
    fetchDay: (date: string) => {
      calls.push(date);
      return answer(date);
    },
  };
}
