// F-137 FX jobs, F-138 enqueueRatesAdded and F-139 fxGapCheck on template copies. TP-9.9 to
// TP-9.11, TP-9.14 and TP-9.19, plus extra cases TP-9.22x. IDs ending in "x" are test-architect
// additions, not LLD test-plan IDs.
//
// Handlers are reached through buildHandlerMap(c) and run with a JobContext built here, so
// `createdOn` and the container's clock are set per case. Providers are fakes given through the
// container's `fxProviders` override (F-96); the registry is the template's (production jobs plus
// the test subscriber test.fx-rates-added).
import { Temporal, fixedClock } from "@budmon/shared";
import { afterEach, describe, expect, it } from "vitest";
import { buildHandlerMap } from "../../../src/platform/queue/handlers.js";
import { TEST_FX_RATES_ADDED, templateJobRegistry } from "../../support/jobs.js";
import { query } from "../../support/postgres.js";
import { recordingLogger } from "../../support/platform.js";
import { buildWorkerContainer, type BuiltWorker } from "../../support/worker.js";
import { fxGapCheck } from "../../../src/platform/fx/fxJobs.js";
import { RatesAddedPayload } from "../../../src/platform/fx/fxService.js";
import { type FxProvider, FxProviderError } from "../../../src/platform/fx/providers.js";
import { fakeProvider, queuedJobs, storeDay, storedRates } from "../../support/s9.js";

const FETCH = "platform.fx-rates-fetch";
const BACKFILL = "platform.fx-backfill";

let built: BuiltWorker | undefined;

afterEach(async () => {
  await built?.close();
  built = undefined;
});

async function worker(now: string, primary: FxProvider, fallback: FxProvider) {
  built = await buildWorkerContainer("general", {
    clock: fixedClock(now),
    registry: templateJobRegistry(),
    fxProviders: { primary, fallback },
  });
  // Enqueueing needs the container's pg-boss started (no workers run here, A-271).
  await built.container.boss.start();
  return built;
}

async function run(b: BuiltWorker, name: string, payload: unknown, createdOn: string) {
  const handler = buildHandlerMap(b.container).get(name);
  if (handler === undefined) throw new Error(`no handler for ${name}`);
  return handler(payload, {
    jobId: "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0b",
    attempt: 1,
    createdOn: Temporal.Instant.from(createdOn),
    logger: b.container.logger,
    signal: new AbortController().signal,
  });
}

async function metricSum(b: BuiltWorker, name: string, labels: Record<string, string> = {}) {
  const metric = (await b.obs.collect()).get(name);
  return (metric?.dataPoints ?? [])
    .filter((p) => Object.entries(labels).every(([k, v]) => p.attributes[k] === v))
    .reduce((sum, p) => sum + (typeof p.value === "number" ? p.value : 0), 0);
}

function events(b: BuiltWorker, event: string): Record<string, unknown>[] {
  return b.obs.capture.records().filter((l) => l["event"] === event);
}

const rates = (r: Record<string, string>) => () => Promise.resolve(new Map(Object.entries(r)));
const failWith = (reason: "not_found" | "http" | "network" | "invalid", status?: number) => () => {
  throw new FxProviderError(reason, status);
};

describe("TP-9.9: the daily fetch and the rates-added fan-out (F-137, F-138)", () => {
  it("TP-9.9: at 2026-10-05T00:30Z the fetch stores 2026-10-04 from openexchangerates, enqueues one subscriber job {2026-10-04, 2026-10-04, 2026-10-06} in the same transaction, and a second run doesn't fetch", async () => {
    const primary = fakeProvider("openexchangerates", rates({ EGP: "48.5", JPY: "149.25" }));
    const fallback = fakeProvider("fawazahmed0", rates({}));
    const b = await worker("2026-10-05T00:30:00Z", primary, fallback);
    b.container.fx.registerRatesAddedSubscriber({
      ...TEST_FX_RATES_ADDED,
      payload: RatesAddedPayload,
    });
    // A later day already stored (a simulated backfill).
    await storeDay(b.testDb, "2026-10-07", { EGP: "48.7" }, "fawazahmed0");

    await run(b, FETCH, {}, "2026-10-05T00:30:00Z");

    expect(primary.calls).toEqual(["2026-10-04"]);
    expect(fallback.calls).toEqual([]);
    expect((await storedRates(b.testDb)).filter((r) => r.rateDate === "2026-10-04")).toEqual([
      {
        code: "EGP",
        rateDate: "2026-10-04",
        unitsPerUsd: "48.500000000000",
        provider: "openexchangerates",
      },
      {
        code: "JPY",
        rateDate: "2026-10-04",
        unitsPerUsd: "149.250000000000",
        provider: "openexchangerates",
      },
    ]);
    const jobs = await queuedJobs(b.testDb, TEST_FX_RATES_ADDED.name);
    expect(jobs.map((j) => j.data)).toEqual([
      { rateDate: "2026-10-04", affectedFrom: "2026-10-04", affectedTo: "2026-10-06" },
    ]);
    // Same transaction: the day's rows and the subscriber job carry the same xmin.
    const [rateTx] = await query<{ x: string }>(
      b.testDb.urlAs("budmon_migrator"),
      "SELECT DISTINCT xmin::text AS x FROM exchange_rates WHERE rate_date = '2026-10-04'",
    );
    const [jobTx] = await query<{ x: string }>(
      b.testDb.urlAs("budmon_queue"),
      "SELECT xmin::text AS x FROM pgboss.job WHERE name = $1",
      [TEST_FX_RATES_ADDED.name],
    );
    expect(rateTx?.x).toBeDefined();
    expect(jobTx?.x).toBe(rateTx?.x);

    await run(b, FETCH, {}, "2026-10-05T00:30:00Z");

    expect(primary.calls).toHaveLength(1);
    expect(await queuedJobs(b.testDb, TEST_FX_RATES_ADDED.name)).toHaveLength(1);
  });

  it("TP-9.22x: fx_rates_fetched_total{provider} +1 and one fx_day_stored line {rateDate, provider, inserted, rejected}; affectedTo is null with no later day", async () => {
    const primary = fakeProvider("openexchangerates", rates({ EGP: "48.5", JPY: "149.25" }));
    const b = await worker("2026-10-05T00:30:00Z", primary, fakeProvider("fawazahmed0", rates({})));
    b.container.fx.registerRatesAddedSubscriber({
      ...TEST_FX_RATES_ADDED,
      payload: RatesAddedPayload,
    });

    await run(b, FETCH, {}, "2026-10-05T00:30:00Z");

    expect(await metricSum(b, "fx_rates_fetched_total", { provider: "openexchangerates" })).toBe(1);
    const stored = events(b, "fx_day_stored");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      rateDate: "2026-10-04",
      provider: "openexchangerates",
      inserted: 2,
      rejected: 0,
    });
    expect((await queuedJobs(b.testDb, TEST_FX_RATES_ADDED.name)).map((j) => j.data)).toEqual([
      { rateDate: "2026-10-04", affectedFrom: "2026-10-04", affectedTo: null },
    ]);
  });

  it("TP-9.22x: the rate day comes from createdOn, not the clock: a retry a day later still fetches 2026-10-04", async () => {
    const primary = fakeProvider("openexchangerates", rates({ EGP: "48.5" }));
    const b = await worker("2026-10-05T05:00:00Z", primary, fakeProvider("fawazahmed0", rates({})));

    await run(b, FETCH, {}, "2026-10-05T00:30:00Z");

    expect(primary.calls).toEqual(["2026-10-04"]);
  });
});

describe("TP-9.10: the fallback after 6 hours (F-137)", () => {
  it("TP-9.10: createdOn 6 h 1 min before now with a failing primary: the fallback is used and the day stored with provider fawazahmed0", async () => {
    const primary = fakeProvider("openexchangerates", failWith("http", 500));
    const fallback = fakeProvider("fawazahmed0", rates({ EGP: "48.6" }));
    const b = await worker("2026-10-05T06:31:00Z", primary, fallback);

    await run(b, FETCH, {}, "2026-10-05T00:30:00Z");

    expect(fallback.calls).toEqual(["2026-10-04"]);
    expect(primary.calls).toEqual([]);
    expect(await storedRates(b.testDb)).toEqual([
      {
        code: "EGP",
        rateDate: "2026-10-04",
        unitsPerUsd: "48.600000000000",
        provider: "fawazahmed0",
      },
    ]);
  });

  it("TP-9.22x: at 5 h 59 min the primary is still used, and its failure throws for a retry", async () => {
    const primary = fakeProvider("openexchangerates", failWith("http", 500));
    const fallback = fakeProvider("fawazahmed0", rates({ EGP: "48.6" }));
    const b = await worker("2026-10-05T06:29:00Z", primary, fallback);

    await expect(run(b, FETCH, {}, "2026-10-05T00:30:00Z")).rejects.toBeInstanceOf(FxProviderError);
    expect(primary.calls).toEqual(["2026-10-04"]);
    expect(fallback.calls).toEqual([]);
    expect(await storedRates(b.testDb)).toEqual([]);
  });
});

describe("TP-9.11: bad provider data (F-137)", () => {
  it("TP-9.11: EGP valid, XAU (not in the table), ZWL inactive, EUR 0, GBP abc: only EGP stored, fx_rates_rejected_total 2; a provider with only invalid values throws FxProviderError(invalid) and stores nothing", async () => {
    let answer: Record<string, string> = {
      EGP: "48.5",
      XAU: "0.0005",
      ZWL: "322",
      EUR: "0",
      GBP: "abc",
    };
    const primary = fakeProvider("openexchangerates", () =>
      Promise.resolve(new Map(Object.entries(answer))),
    );
    const b = await worker("2026-10-05T00:30:00Z", primary, fakeProvider("fawazahmed0", rates({})));

    await run(b, FETCH, {}, "2026-10-05T00:30:00Z");

    expect(await storedRates(b.testDb)).toEqual([
      {
        code: "EGP",
        rateDate: "2026-10-04",
        unitsPerUsd: "48.500000000000",
        provider: "openexchangerates",
      },
    ]);
    expect(await metricSum(b, "fx_rates_rejected_total", { provider: "openexchangerates" })).toBe(
      2,
    );
    // A-274: the logged count matches; XAU and ZWL are skipped uncounted.
    expect(events(b, "fx_day_stored")).toEqual([
      expect.objectContaining({ rateDate: "2026-10-04", inserted: 1, rejected: 2 }),
    ]);

    answer = { EUR: "0", GBP: "abc", JPY: "-1" };
    // The next day's fetch, still within 6 h of its createdOn (primary).
    (b.container.clock as ReturnType<typeof fixedClock>).advance({ hours: 24 });
    let caught: unknown;
    try {
      await run(b, FETCH, {}, "2026-10-06T00:30:00Z");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(FxProviderError);
    expect((caught as { reason?: unknown }).reason).toBe("invalid");
    expect((await storedRates(b.testDb)).filter((r) => r.rateDate === "2026-10-05")).toEqual([]);
  });
});

describe("TP-9.14: backfill (F-137)", () => {
  it("TP-9.14: a fallback 404 completes with fx_backfill_missing_total 1 and an fx_backfill_missing line; a fallback 200 stores the day with fawazahmed0", async () => {
    let answer: (date: string) => Promise<Map<string, string>> = failWith("not_found");
    const fallback = fakeProvider("fawazahmed0", (date) => answer(date));
    const primary = fakeProvider("openexchangerates", rates({ EGP: "1" }));
    const b = await worker("2026-10-05T12:00:00Z", primary, fallback);

    await run(b, BACKFILL, { rateDate: "2026-09-30" }, "2026-10-05T12:00:00Z");

    expect(await metricSum(b, "fx_backfill_missing_total")).toBe(1);
    expect(events(b, "fx_backfill_missing")).toEqual([
      expect.objectContaining({ rateDate: "2026-09-30" }),
    ]);
    expect(await storedRates(b.testDb)).toEqual([]);

    answer = () => Promise.resolve(new Map([["EGP", "48.3"]]));
    await run(b, BACKFILL, { rateDate: "2026-09-30" }, "2026-10-05T12:00:00Z");

    expect(fallback.calls).toEqual(["2026-09-30", "2026-09-30"]);
    expect(primary.calls).toEqual([]);
    expect(await storedRates(b.testDb)).toEqual([
      {
        code: "EGP",
        rateDate: "2026-09-30",
        unitsPerUsd: "48.300000000000",
        provider: "fawazahmed0",
      },
    ]);
  });

  it("TP-9.22x: a stored day completes without fetching; another provider error throws for a retry", async () => {
    const fallback = fakeProvider("fawazahmed0", failWith("http", 503));
    const b = await worker(
      "2026-10-05T12:00:00Z",
      fakeProvider("openexchangerates", rates({})),
      fallback,
    );
    await storeDay(b.testDb, "2026-09-29", { EGP: "48.2" });

    await run(b, BACKFILL, { rateDate: "2026-09-29" }, "2026-10-05T12:00:00Z");
    expect(fallback.calls).toEqual([]);

    await expect(
      run(b, BACKFILL, { rateDate: "2026-09-30" }, "2026-10-05T12:00:00Z"),
    ).rejects.toBeInstanceOf(FxProviderError);
    expect(await metricSum(b, "fx_backfill_missing_total")).toBe(0);
  });
});

describe("TP-9.14 (A-275): backfill dates out of range", () => {
  it("TP-9.14 (A-275): on 2026-10-05, backfills for 2024-03-01 (before the floor) and 2026-10-05 (today) complete without calling the fallback, each with one fx_backfill_out_of_range warn", async () => {
    const fallback = fakeProvider("fawazahmed0", rates({ EGP: "48.3" }));
    const b = await worker(
      "2026-10-05T12:00:00Z",
      fakeProvider("openexchangerates", rates({})),
      fallback,
    );

    await run(b, BACKFILL, { rateDate: "2024-03-01" }, "2026-10-05T12:00:00Z");
    await run(b, BACKFILL, { rateDate: "2026-10-05" }, "2026-10-05T12:00:00Z");

    expect(fallback.calls).toEqual([]);
    expect(await storedRates(b.testDb)).toEqual([]);
    const warned = events(b, "fx_backfill_out_of_range");
    expect(warned).toHaveLength(2);
    expect(warned.every((l) => l["level"] === "warn")).toBe(true);
  });

  it("TP-9.22x (A-275): the floor itself (2024-03-02) and yesterday (2026-10-04) are in range", async () => {
    const fallback = fakeProvider("fawazahmed0", rates({ EGP: "48.3" }));
    const b = await worker(
      "2026-10-05T12:00:00Z",
      fakeProvider("openexchangerates", rates({})),
      fallback,
    );

    await run(b, BACKFILL, { rateDate: "2024-03-02" }, "2026-10-05T12:00:00Z");
    await run(b, BACKFILL, { rateDate: "2026-10-04" }, "2026-10-05T12:00:00Z");

    expect(fallback.calls).toEqual(["2024-03-02", "2026-10-04"]);
    expect(events(b, "fx_backfill_out_of_range")).toEqual([]);
  });
});

describe("TP-9.19: the gap check (F-139)", () => {
  async function gapCheck(latest: string | null) {
    const b = await worker(
      "2026-10-07T10:00:00Z",
      fakeProvider("openexchangerates", rates({})),
      fakeProvider("fawazahmed0", rates({})),
    );
    if (latest !== null) await storeDay(b.testDb, latest, { EGP: "48.5" });
    const logger = recordingLogger();
    const check = () =>
      fxGapCheck({
        database: b.container.database,
        queue: b.container.queue,
        clock: fixedClock("2026-10-07T10:00:00Z"),
        logger,
      });
    return { b, check, logger };
  }

  it("TP-9.19 (a): an empty exchange_rates enqueues nothing", async () => {
    const { b, check } = await gapCheck(null);

    expect(await check()).toEqual({ enqueued: [] });
    expect(await queuedJobs(b.testDb, BACKFILL)).toEqual([]);
  });

  it("TP-9.19 (b): latest day 2026-10-03 enqueues 2026-10-04 to 2026-10-06 with those singletonKeys; running it twice leaves three jobs", async () => {
    const { b, check, logger } = await gapCheck("2026-10-03");
    const days = ["2026-10-04", "2026-10-05", "2026-10-06"];

    expect(await check()).toEqual({ enqueued: days });
    await check();

    const jobs = await queuedJobs(b.testDb, BACKFILL);
    expect(jobs.map((j) => j.data)).toEqual(days.map((rateDate) => ({ rateDate })));
    expect(jobs.map((j) => j.singletonKey)).toEqual(days);
    expect(
      logger.lines.filter((l) => l.event === "fx_gap_check").map((l) => l.fields),
    ).toContainEqual(expect.objectContaining({ fields: { count: 3 } }));
  });

  it("TP-9.19 (c): latest day 2026-10-06 (yesterday) enqueues nothing", async () => {
    const { b, check } = await gapCheck("2026-10-06");

    expect(await check()).toEqual({ enqueued: [] });
    expect(await queuedJobs(b.testDb, BACKFILL)).toEqual([]);
  });

  it("TP-9.19 (d): latest day 2026-08-01 enqueues the 31 most recent days, 2026-09-06 to 2026-10-06", async () => {
    const { b, check } = await gapCheck("2026-08-01");

    const { enqueued } = await check();

    expect(enqueued).toHaveLength(31);
    expect([...enqueued].sort()[0]).toBe("2026-09-06");
    expect([...enqueued].sort().at(-1)).toBe("2026-10-06");
    expect(await queuedJobs(b.testDb, BACKFILL)).toHaveLength(31);
  });
});
