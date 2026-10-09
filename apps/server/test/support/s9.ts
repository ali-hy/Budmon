// S-9 test support (FX rates and conversion), owned by the test-architect: data helpers for
// exchange_rates and pgboss.job, and a fake FxProvider.
import type { FxProvider, FxProviderName } from "../../src/platform/fx/providers.js";
import { query } from "./postgres.js";
import type { TestDatabase } from "./testDatabase.js";

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
