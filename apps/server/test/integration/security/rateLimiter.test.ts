// F-63 createRateLimiter and F-64 rateLimitRepo, against a real database. TP-5.5 and TP-5.8, plus
// extra cases TP-5.12x (the bucket key and expiry, F-63's RangeErrors). IDs ending in "x" are
// test-architect additions, not LLD test-plan IDs.
//
// Written before the modules exist (S-5): they are loaded by variable specifiers so typecheck
// passes until then, and typed here from F-63's and F-64's signatures.
import { createHmac } from "node:crypto";
import { fixedClock, type Clock } from "@budmon/shared";
import { CANARIES, scanForCanaries } from "@budmon/test-support";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { withTransaction } from "../../../src/platform/db/transaction.js";
import type { Database, DbHandle } from "../../../src/platform/db/types.js";
import {
  createTestDatabase,
  resetBetweenTests,
  type TestDatabase,
} from "../../support/testDatabase.js";

interface RateLimitSpec {
  limiter: string;
  limit: number;
  windowSeconds: number;
}
interface RateLimiter {
  hit: (
    spec: RateLimitSpec,
    subject: string,
  ) => Promise<{ allowed: boolean; retryAfterSeconds: number; hits: number }>;
}
interface RateLimiterModule {
  createRateLimiter: (deps: { db: Database; key: Buffer; clock: Clock }) => RateLimiter;
}
interface RateLimitRepoModule {
  incrementWindow: (
    h: DbHandle,
    bucketKey: string,
    windowStart: Date,
    expiresAt: Date,
  ) => Promise<number>;
  deleteExpired: (h: DbHandle, now: Date, batchSize: number) => Promise<number>;
}

const RATE_LIMITER = "../../../src/platform/security/rateLimiter.js";
const RATE_LIMIT_REPO = "../../../src/platform/security/rateLimitRepo.js";

async function rateLimiterModule(): Promise<RateLimiterModule> {
  return (await import(/* @vite-ignore */ RATE_LIMITER)) as RateLimiterModule;
}
async function rateLimitRepo(): Promise<RateLimitRepoModule> {
  return (await import(/* @vite-ignore */ RATE_LIMIT_REPO)) as RateLimitRepoModule;
}

const KEY = Buffer.from("tp-5.5-rate-limit-key-32-bytes!!");
const SPEC: RateLimitSpec = { limiter: "test", limit: 2, windowSeconds: 60 };

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb.drop();
});

beforeEach(async () => {
  await resetBetweenTests(testDb);
});

async function counterRows(): Promise<Record<string, unknown>[]> {
  const { rows } = await testDb.database.handle.executeSql(
    "SELECT bucket_key, window_start, hits, expires_at FROM rate_limit_counters ORDER BY window_start",
  );
  return rows;
}

describe("TP-5.5: createRateLimiter (F-63)", () => {
  it("TP-5.5: within the limit, exceeded with retryAfterSeconds 50, a new window, and a rolled-back hit still counts", async () => {
    const { createRateLimiter } = await rateLimiterModule();
    const clock = fixedClock("2026-10-09T12:00:10Z");
    const limiter = createRateLimiter({ db: testDb.database, key: KEY, clock });

    const first = await limiter.hit(SPEC, CANARIES.email);
    const second = await limiter.hit(SPEC, CANARIES.email);
    const third = await limiter.hit(SPEC, CANARIES.email);

    expect(first).toEqual({ allowed: true, retryAfterSeconds: 0, hits: 1 });
    expect(second).toEqual({ allowed: true, retryAfterSeconds: 0, hits: 2 });
    expect(third).toEqual({ allowed: false, retryAfterSeconds: 50, hits: 3 });

    clock.advance({ seconds: 60 });
    const newWindow = await limiter.hit(SPEC, CANARIES.email);
    expect(newWindow).toEqual({ allowed: true, retryAfterSeconds: 0, hits: 1 });

    await expect(
      withTransaction(testDb.database, async () => {
        await limiter.hit(SPEC, CANARIES.email);
        throw new Error("rolled back");
      }),
    ).rejects.toThrow("rolled back");
    const afterRollback = await limiter.hit(SPEC, CANARIES.email);
    // 1 before, 1 inside the rolled-back transaction (autocommit, so it stays), this one.
    expect(afterRollback).toEqual({ allowed: false, retryAfterSeconds: 50, hits: 3 });

    const rows = await counterRows();
    expect(
      scanForCanaries([{ name: "rate_limit_counters", text: JSON.stringify(rows) }], CANARIES),
    ).toEqual([]);
  });
});

describe("TP-5.8: deleteExpired (F-64)", () => {
  it("TP-5.8: 3 expired and 2 live rows: deleteExpired(h, now, 2) twice deletes 2 then 1; live rows remain", async () => {
    const { deleteExpired } = await rateLimitRepo();
    const now = new Date("2026-10-09T12:00:00Z");
    const h = testDb.database.handle;
    const rows: [string, string][] = [
      ["expired-1", "2026-10-09T11:00:00Z"],
      ["expired-2", "2026-10-09T11:30:00Z"],
      ["expired-3", "2026-10-09T11:59:59Z"],
      ["live-1", "2026-10-09T12:00:01Z"],
      ["live-2", "2026-10-09T13:00:00Z"],
    ];
    for (const [key, expiresAt] of rows) {
      await h.executeSql(
        "INSERT INTO rate_limit_counters (bucket_key, window_start, hits, expires_at) VALUES ($1, $2, 1, $3)",
        [key, "2026-10-09T10:00:00Z", expiresAt],
      );
    }

    const firstPass = await deleteExpired(h, now, 2);
    const secondPass = await deleteExpired(h, now, 2);

    expect([firstPass, secondPass]).toEqual([2, 1]);
    expect((await counterRows()).map((r) => r["bucket_key"]).sort()).toEqual(["live-1", "live-2"]);
  });
});

describe("TP-5.12x: F-63 and F-64, further cases", () => {
  it("TP-5.12x: the row's bucket_key is limiter:base64url(HMAC-SHA-256(key, subject)), window_start the window, expires_at two windows on", async () => {
    const { createRateLimiter } = await rateLimiterModule();
    const limiter = createRateLimiter({
      db: testDb.database,
      key: KEY,
      clock: fixedClock("2026-10-09T12:00:10Z"),
    });

    await limiter.hit(SPEC, CANARIES.email);

    const [row] = await counterRows();
    const mac = createHmac("sha256", KEY).update(CANARIES.email).digest("base64url");
    expect(row?.["bucket_key"]).toBe(`test:${mac}`);
    expect((row?.["window_start"] as Date).toISOString()).toBe("2026-10-09T12:00:00.000Z");
    expect((row?.["expires_at"] as Date).toISOString()).toBe("2026-10-09T12:02:00.000Z");
    expect(row?.["hits"]).toBe(1);
  });

  it("TP-5.12x: two subjects and two limiters count separately", async () => {
    const { createRateLimiter } = await rateLimiterModule();
    const limiter = createRateLimiter({
      db: testDb.database,
      key: KEY,
      clock: fixedClock("2026-10-09T12:00:10Z"),
    });

    await limiter.hit(SPEC, "a");
    await limiter.hit(SPEC, "a");
    const other = await limiter.hit(SPEC, "b");
    const otherLimiter = await limiter.hit({ ...SPEC, limiter: "other" }, "a");

    expect([other.hits, otherLimiter.hits]).toEqual([1, 1]);
  });

  it("TP-5.12x: retryAfterSeconds is at least 1 at the last second of a window", async () => {
    const { createRateLimiter } = await rateLimiterModule();
    const limiter = createRateLimiter({
      db: testDb.database,
      key: KEY,
      clock: fixedClock("2026-10-09T12:00:59.500Z"),
    });

    await limiter.hit({ ...SPEC, limit: 1 }, "s");
    const refused = await limiter.hit({ ...SPEC, limit: 1 }, "s");

    expect(refused).toEqual({ allowed: false, retryAfterSeconds: 1, hits: 2 });
  });

  it.each([
    ["a limiter that isn't a token", { ...SPEC, limiter: "Bad Limiter!" }],
    ["limit 0", { ...SPEC, limit: 0 }],
  ])("TP-5.12x: %s throws RangeError", async (_label, spec) => {
    const { createRateLimiter } = await rateLimiterModule();
    const limiter = createRateLimiter({
      db: testDb.database,
      key: KEY,
      clock: fixedClock("2026-10-09T12:00:10Z"),
    });

    // A synchronous throw or a rejection both count.
    await expect(async () => limiter.hit(spec, "s")).rejects.toThrow(RangeError);
  });

  it("TP-5.12x: incrementWindow inserts 1 and then increments", async () => {
    const { incrementWindow } = await rateLimitRepo();
    const h = testDb.database.handle;
    const start = new Date("2026-10-09T12:00:00Z");
    const expires = new Date("2026-10-09T12:02:00Z");

    expect(await incrementWindow(h, "k", start, expires)).toBe(1);
    expect(await incrementWindow(h, "k", start, expires)).toBe(2);
  });
});
