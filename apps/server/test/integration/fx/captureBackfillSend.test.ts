// A-283: capture's INSERT policy on the platform.fx-backfill queue pins singleton_key to
// data->>'rateDate', state to 'created' and policy to the queue's. TP-9.22 (a) to (e), plus extra
// cases TP-9.23x. IDs ending in "x" are test-architect additions, not LLD test-plan IDs. (f) is a
// unit case (unit/fx/captureSingletonKey.test.ts); TP-6.8's capture cases run in
// queue/workers.test.ts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgBoss } from "../../../src/platform/queue/workers.js";
import type { PgBossLike } from "../../support/jobs.js";
import { failureState, query } from "../../support/postgres.js";
import { createTestDatabase, type TestDatabase } from "../../support/testDatabase.js";
import { testWorkerConfig } from "../../support/worker.js";
import { queuedJobs } from "../../support/s9.js";

const BACKFILL = "platform.fx-backfill";

describe("TP-9.22: capture sends to platform.fx-backfill (F-75 6b, A-283)", () => {
  let testDb: TestDatabase;
  let capture: PgBossLike | undefined;

  beforeAll(async () => {
    testDb = await createTestDatabase("budmon_capture");
    const c = createPgBoss(testWorkerConfig(testDb.endpoint, testDb.name, "capture"), "capture");
    await c.start();
    capture = c;
  }, 60_000);

  afterAll(async () => {
    await capture?.stop({ graceful: false });
    await testDb.drop();
  });

  function boss(): PgBossLike {
    if (capture === undefined) throw new Error("pg-boss didn't start");
    return capture;
  }

  const asCapture = (sql: string, values: unknown[] = []) =>
    query(testDb.urlAs("budmon_capture"), sql, values);

  /**
   * A direct INSERT as budmon_capture that matches an honest send (the queue's dead_letter, A-230)
   * except for `state` and `policy`; `policy` null means the queue's own.
   */
  const insertAsCapture = (rateDate: string, state: string, policy: string | null) =>
    asCapture(
      `INSERT INTO pgboss.job (name, data, singleton_key, state, policy, dead_letter)
       SELECT q.name, jsonb_build_object('rateDate', $2::text), $2, $3::pgboss.job_state,
              coalesce($4, q.policy), q.dead_letter
       FROM pgboss.queue q WHERE q.name = $1`,
      [BACKFILL, rateDate, state, policy],
    );

  it("TP-9.22 (a): a send with singletonKey = rateDate returns an id; the same send again returns null and leaves one queued row", async () => {
    const first = await boss().send(
      BACKFILL,
      { rateDate: "2026-10-01" },
      { singletonKey: "2026-10-01" },
    );
    const second = await boss().send(
      BACKFILL,
      { rateDate: "2026-10-01" },
      { singletonKey: "2026-10-01" },
    );

    expect(first).toEqual(expect.any(String));
    expect(second).toBeNull();
    const rows = (await queuedJobs(testDb, BACKFILL)).filter(
      (j) => (j.data as { rateDate?: unknown }).rateDate === "2026-10-01",
    );
    expect(rows).toHaveLength(1);
  });

  it("TP-9.22 (b): a send whose singletonKey isn't the rateDate is 42501", async () => {
    expect(
      await failureState(() =>
        boss().send(BACKFILL, { rateDate: "2026-10-02" }, { singletonKey: "x" }),
      ),
    ).toBe("42501");
  });

  it("TP-9.22 (c): a send with no singletonKey is 42501", async () => {
    expect(await failureState(() => boss().send(BACKFILL, { rateDate: "2026-10-03" }))).toBe(
      "42501",
    );
  });

  it("TP-9.22 (d): a direct INSERT with the matching key but state 'retry' is 42501", async () => {
    expect(await failureState(() => insertAsCapture("2026-10-04", "retry", null))).toBe("42501");
  });

  it("TP-9.22 (e): a direct INSERT with the matching key and state 'created' but policy 'standard' is 42501", async () => {
    const [queue] = await query<{ policy: string }>(
      testDb.urlAs("budmon_queue"),
      "SELECT policy FROM pgboss.queue WHERE name = $1",
      [BACKFILL],
    );
    expect(queue?.policy).toBe("short");

    expect(await failureState(() => insertAsCapture("2026-10-05", "created", "standard"))).toBe(
      "42501",
    );
  });

  it("TP-9.23x: the same direct INSERT with state 'created' and the queue's policy is allowed (so (d) and (e) are refused by A-283's pins)", async () => {
    expect(
      await failureState(() => insertAsCapture("2026-10-06", "created", null)),
    ).toBeUndefined();
  });

  it("TP-9.23x: nothing refused above reached the queue", async () => {
    const dates = (await queuedJobs(testDb, BACKFILL)).map(
      (j) => (j.data as { rateDate?: unknown }).rateDate,
    );

    for (const refused of ["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"]) {
      expect(dates).not.toContain(refused);
    }
  });
});
