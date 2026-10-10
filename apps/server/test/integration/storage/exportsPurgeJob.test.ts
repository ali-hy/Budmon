// F-80's platform.exports-purge (A-215): registered with F-144's handler in S-10. Extra cases
// TP-10.11x (the LLD tests F-144 itself in TP-10.5). IDs ending in "x" are test-architect
// additions, not LLD test-plan IDs.
import { Temporal, fixedClock } from "@budmon/shared";
import { describe, expect, it } from "vitest";
import { platformMaintenanceJobs } from "../../../src/platform/maintenance/maintenanceJobs.js";
import { buildHandlerMap } from "../../../src/platform/queue/handlers.js";
import { buildWorkerContainer } from "../../support/worker.js";
import { exportKey, keysOf, s10 } from "../../support/s10.js";

describe("TP-10.11x: platform.exports-purge (F-80, A-215)", () => {
  it("TP-10.11x: the definition is general, cron 15 * * * *, with an empty payload", () => {
    const def = platformMaintenanceJobs.find((d) => d.name === "platform.exports-purge");

    expect(def).toMatchObject({ role: "general", cron: "15 * * * *" });
    expect(def?.payload.safeParse({}).success).toBe(true);
  });

  it("TP-10.11x: the general worker's handler purges exports older than 7 days from its objectStore", async () => {
    const { createMemoryObjectStore } = await s10.memoryObjectStore();
    const clock = fixedClock("2026-09-29T12:00:00Z");
    const store = createMemoryObjectStore(clock);
    const old = exportKey("0190a0b0-1c2d-7e3f-8a4b-000000000008");
    const recent = exportKey("0190a0b0-1c2d-7e3f-8a4b-000000000006");
    await store.put("exports", old, Buffer.from("old"), "application/zip");
    clock.advance({ days: 2 });
    await store.put("exports", recent, Buffer.from("recent"), "application/zip");
    clock.advance({ days: 6 });
    const built = await buildWorkerContainer("general", {
      clock,
      ...({ objectStore: store } as object),
    });
    try {
      const handler = buildHandlerMap(built.container).get("platform.exports-purge");
      expect(handler).toBeDefined();

      await handler?.(
        {},
        {
          jobId: "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0b",
          attempt: 1,
          createdOn: Temporal.Instant.from("2026-10-07T12:00:00Z"),
          logger: built.container.logger,
          signal: new AbortController().signal,
        },
      );

      expect(await keysOf(store, "exports", "users/")).toEqual([recent]);
      expect(built.obs.capture.records().filter((l) => l["event"] === "exports_purged")).toEqual([
        expect.objectContaining({ count: 1 }),
      ]);
    } finally {
      await built.close();
    }
  });
});
