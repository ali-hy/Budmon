// F-100 createIdempotency and F-101 idempotencyRepo on a real database. TP-7.1 to TP-7.6 and
// TP-7.8 (the canonical request hash, checked against the stored row), plus extra cases TP-7.17x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { createHash } from "node:crypto";
import { Temporal, canonicalJson, fixedClock } from "@budmon/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { withTransaction } from "../../../src/platform/db/transaction.js";
import { IdempotencyKeyReusedError } from "../../../src/platform/errors/platformErrors.js";
import { observed, type Observed } from "../../support/api.js";
import { s7, type CreatedResult, type Idempotency } from "../../support/s7.js";
import { createTestDatabase, type TestDatabase } from "../../support/testDatabase.js";

const USER_A = "0190a0b0-1c2d-7e3f-8a4b-00000000000a";
const USER_B = "0190a0b0-1c2d-7e3f-8a4b-00000000000b";
const NOW = "2026-10-09T12:00:00Z";

let testDb: TestDatabase;
let obs: Observed;
let idempotency: Idempotency;

beforeAll(async () => {
  testDb = await createTestDatabase();
  obs = observed();
  const { createIdempotency } = await s7.idempotency();
  idempotency = createIdempotency({ clock: fixedClock(NOW), metrics: obs.metrics });
});

afterAll(async () => {
  await testDb.drop();
});

let keys = 0;
function newKey(): string {
  keys += 1;
  return `0190a0b0-1c2d-7e3f-8a4b-${keys.toString(16).padStart(12, "0")}`;
}

function created(n: number): CreatedResult {
  return {
    id: `0190a0b0-1c2d-7e3f-9a4b-${n.toString(16).padStart(12, "0")}`,
    createdAt: Temporal.Instant.from(NOW),
  };
}

function run(
  userId: string,
  key: string,
  input: unknown,
  work: () => Promise<CreatedResult>,
  procedure = "test.create",
) {
  return withTransaction(testDb.database, (tx) =>
    idempotency.run(tx, { userId, key, procedure, input }, work),
  );
}

async function record(userId: string, key: string): Promise<Record<string, unknown> | undefined> {
  const { rows } = await testDb.database.handle.executeSql(
    "SELECT procedure, request_hash, response_status, result, expires_at FROM idempotency_records WHERE user_id = $1 AND idempotency_key = $2",
    [userId, key],
  );
  return rows[0];
}

async function replays(): Promise<number> {
  const metric = (await obs.collect()).get("idempotent_replays_total");
  return (metric?.dataPoints ?? []).reduce(
    (sum, p) => sum + (typeof p.value === "number" ? p.value : 0),
    0,
  );
}

describe("TP-7.1 to TP-7.3: first run, replay, key reuse (F-100)", () => {
  const key = newKey();
  const input = { name: "a", amount: 1 };

  it("TP-7.1: the first run calls work once, returns replayed false and status 201, and stores the result with expires_at now + 90 days", async () => {
    const work = vi.fn(() => Promise.resolve(created(1)));

    const out = await run(USER_A, key, input, work);

    expect(work).toHaveBeenCalledTimes(1);
    expect(out.replayed).toBe(false);
    expect(out.status).toBe(201);
    expect(out.result.id).toBe(created(1).id);
    const row = await record(USER_A, key);
    expect(row?.["procedure"]).toBe("test.create");
    expect(row?.["response_status"]).toBe(201);
    expect(row?.["result"]).toEqual({ id: created(1).id, createdAt: "2026-10-09T12:00:00Z" });
    expect((row?.["expires_at"] as Date).toISOString()).toBe("2027-01-07T12:00:00.000Z");
  });

  it("TP-7.2: the same key and input returns the stored result with replayed true; work isn't called; idempotent_replays_total +1", async () => {
    const before = await replays();
    const work = vi.fn(() => Promise.resolve(created(2)));

    const out = await run(USER_A, key, input, work);

    expect(work).not.toHaveBeenCalled();
    expect(out.replayed).toBe(true);
    expect(out.status).toBe(201);
    expect(out.result.id).toBe(created(1).id);
    expect(out.result.createdAt.toString()).toBe("2026-10-09T12:00:00Z");
    expect(await replays()).toBe(before + 1);
  });

  it("TP-7.3: the same key with a different input throws IdempotencyKeyReusedError", async () => {
    await expect(
      run(USER_A, key, { name: "b", amount: 1 }, () => Promise.resolve(created(3))),
    ).rejects.toBeInstanceOf(IdempotencyKeyReusedError);
  });

  it("TP-7.3: the same key and input under a different procedure throws IdempotencyKeyReusedError", async () => {
    await expect(
      run(USER_A, key, input, () => Promise.resolve(created(4)), "test.other"),
    ).rejects.toBeInstanceOf(IdempotencyKeyReusedError);
  });
});

describe("TP-7.4: the same key for two users (F-100)", () => {
  it("TP-7.4: users A and B each run work", async () => {
    const key = newKey();
    const workA = vi.fn(() => Promise.resolve(created(5)));
    const workB = vi.fn(() => Promise.resolve(created(6)));

    const a = await run(USER_A, key, { x: 1 }, workA);
    const b = await run(USER_B, key, { x: 1 }, workB);

    expect([workA.mock.calls.length, workB.mock.calls.length]).toEqual([1, 1]);
    expect([a.replayed, b.replayed]).toEqual([false, false]);
    expect([a.result.id, b.result.id]).toEqual([created(5).id, created(6).id]);
  });
});

describe("TP-7.5: concurrent duplicates (F-100)", () => {
  it("TP-7.5: the second run waits for the first to commit, then replays; work runs once", async () => {
    const key = newKey();
    let release: () => void = () => undefined;
    const latch = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered: () => void = () => undefined;
    const inWork = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const work = vi.fn(async () => {
      entered();
      await latch;
      return created(7);
    });

    const first = run(USER_A, key, { y: 1 }, work);
    await inWork;
    let secondDone = false;
    const second = run(USER_A, key, { y: 1 }, work).then((r) => {
      secondDone = true;
      return r;
    });
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(secondDone).toBe(false);
    release();
    const [a, b] = await Promise.all([first, second]);

    expect(work).toHaveBeenCalledTimes(1);
    expect(a.replayed).toBe(false);
    expect(b.replayed).toBe(true);
    expect(b.result.id).toBe(a.result.id);
  });
});

describe("TP-7.6: failing work (F-100)", () => {
  it("TP-7.6: work that throws rethrows and leaves no record; a retry runs work", async () => {
    const key = newKey();

    await expect(
      run(USER_A, key, { z: 1 }, () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
    expect(await record(USER_A, key)).toBeUndefined();

    const retry = vi.fn(() => Promise.resolve(created(8)));
    const out = await run(USER_A, key, { z: 1 }, retry);

    expect(retry).toHaveBeenCalledTimes(1);
    expect(out.replayed).toBe(false);
  });
});

describe("TP-7.8: the request hash is canonical (F-100)", () => {
  it("TP-7.8: {a:1,b:2} and {b:2,a:1} hash the same: the second is a replay, and request_hash is sha256(canonicalJson(input))", async () => {
    const key = newKey();

    await run(USER_A, key, { a: 1, b: 2 }, () => Promise.resolve(created(9)));
    const second = await run(USER_A, key, { b: 2, a: 1 }, () => Promise.resolve(created(10)));

    expect(second.replayed).toBe(true);
    const row = await record(USER_A, key);
    expect(Buffer.from(row?.["request_hash"] as Uint8Array)).toEqual(
      createHash("sha256")
        .update(canonicalJson({ a: 1, b: 2 }))
        .digest(),
    );
  });
});

describe("TP-7.17x: F-101 idempotencyRepo", () => {
  it("TP-7.17x: insertIfAbsent is true then false; find before complete has a null status and result; complete sets them", async () => {
    const { insertIfAbsent, find, complete } = await s7.idempotencyRepo();
    const key = newKey();
    const hash = createHash("sha256").update("x").digest();
    const r = {
      userId: USER_B,
      key,
      procedure: "test.repo",
      requestHash: hash,
      expiresAt: new Date("2027-01-01T00:00:00Z"),
    };

    const result = await withTransaction(testDb.database, async (tx) => {
      const first = await insertIfAbsent(tx, r);
      const second = await insertIfAbsent(tx, r);
      const pending = await find(tx, USER_B, key);
      await complete(tx, USER_B, key, 201, {
        id: created(11).id,
        createdAt: "2026-10-09T12:00:00Z",
      });
      const done = await find(tx, USER_B, key);
      return { first, second, pending, done };
    });

    expect([result.first, result.second]).toEqual([true, false]);
    expect(result.pending).toMatchObject({
      procedure: "test.repo",
      responseStatus: null,
      result: null,
    });
    expect(Buffer.from(result.pending?.requestHash ?? [])).toEqual(hash);
    expect(result.done).toMatchObject({
      responseStatus: 201,
      result: { id: created(11).id, createdAt: "2026-10-09T12:00:00Z" },
    });
    expect(await find(testDb.database.handle, USER_B, newKey())).toBeNull();
  });
});
