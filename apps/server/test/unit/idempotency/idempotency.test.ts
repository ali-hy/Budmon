// F-100 createIdempotency outside a transaction. TP-7.9. (TP-7.8's canonical hash is checked
// against the stored request_hash in test/integration/idempotency/idempotency.test.ts.)
import { fixedClock } from "@budmon/shared";
import { describe, expect, it, vi } from "vitest";
import type { DbHandle } from "../../../src/platform/db/types.js";
import { observed } from "../../support/api.js";
import { s7 } from "../../support/s7.js";

describe("TP-7.9: idempotency needs a transaction (F-100)", () => {
  it("TP-7.9: run on a handle that isn't in a transaction throws, before any statement or work", async () => {
    const { createIdempotency } = await s7.idempotency();
    const executeSql = vi.fn();
    const h = { inTransaction: false, executeSql, db: {} } as unknown as DbHandle;
    const work = vi.fn();
    const idempotency = createIdempotency({
      clock: fixedClock("2026-10-09T12:00:00Z"),
      metrics: observed().metrics,
    });

    await expect(
      idempotency.run(
        h,
        {
          userId: "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0b",
          key: "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0c",
          procedure: "test.create",
          input: {},
        },
        work,
      ),
    ).rejects.toThrow("idempotency requires a transaction");
    expect(executeSql).not.toHaveBeenCalled();
    expect(work).not.toHaveBeenCalled();
  });
});
