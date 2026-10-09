// F-132 rates-added subscribers. TP-9.15, plus extra cases TP-9.21x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
//
// F-132: "each must be registered in the job registry with role general and payload
// RatesAddedPayload, or it throws TypeError". createFxService's deps have no registry, so these
// cases check the definition itself: its role and its payload schema.
import { fixedClock } from "@budmon/shared";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Database } from "../../../src/platform/db/types.js";
import type { JobQueue } from "../../../src/platform/queue/jobQueue.js";
import { observed } from "../../support/api.js";
import { recordingLogger } from "../../support/platform.js";
import { s9, type RatesAddedPayload } from "../../support/s9.js";

async function service() {
  const { createFxService } = await s9.fxService();
  return createFxService({
    database: {} as Database,
    queue: {} as JobQueue,
    clock: fixedClock("2026-10-05T00:30:00Z"),
    logger: recordingLogger(),
    metrics: observed().metrics,
  });
}

function subscriber(role: "general" | "capture", payload: z.ZodType<RatesAddedPayload>) {
  return {
    name: "test.fx-rates-added",
    role,
    payload,
    retryLimit: 5,
    retryDelaySeconds: 30,
    retryBackoff: true,
    expireInSeconds: 900,
    policy: "standard" as const,
  };
}

describe("TP-9.15: subscriber validation (F-132)", () => {
  it("TP-9.15: a subscriber with role capture throws TypeError", async () => {
    const { RatesAddedPayload } = await s9.fxService();
    const fx = await service();

    expect(() => {
      fx.registerRatesAddedSubscriber(subscriber("capture", RatesAddedPayload));
    }).toThrow(TypeError);
    expect(fx.subscribers()).toEqual([]);
  });

  it("TP-9.21x: a general subscriber with RatesAddedPayload is stored and listed", async () => {
    const { RatesAddedPayload } = await s9.fxService();
    const fx = await service();
    const def = subscriber("general", RatesAddedPayload);

    fx.registerRatesAddedSubscriber(def);

    expect(fx.subscribers()).toEqual([def]);
  });

  it("TP-9.21x: a general subscriber with another payload schema throws TypeError", async () => {
    const fx = await service();
    const other = z.object({
      rateDate: z.string(),
      affectedFrom: z.string(),
      affectedTo: z.string().nullable(),
    });

    expect(() => {
      fx.registerRatesAddedSubscriber(subscriber("general", other));
    }).toThrow(TypeError);
  });

  it("TP-9.21x: RatesAddedPayload takes {rateDate, affectedFrom, affectedTo} with affectedTo nullable", async () => {
    const { RatesAddedPayload } = await s9.fxService();

    expect(
      RatesAddedPayload.safeParse({
        rateDate: "2026-10-04",
        affectedFrom: "2026-10-04",
        affectedTo: null,
      }).success,
    ).toBe(true);
    expect(
      RatesAddedPayload.safeParse({
        rateDate: "2026-10-04",
        affectedFrom: "2026-10-04",
        affectedTo: "2026-10-06",
      }).success,
    ).toBe(true);
    expect(RatesAddedPayload.safeParse({ rateDate: "2026-10-04" }).success).toBe(false);
  });
});
