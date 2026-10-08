// A test contract and router for the API server tests (S-4 AC 1: createApiServer takes a test
// contract and router). The platform contract plus `test.*` procedures implemented directly with
// oRPC, so their handlers can throw what each test needs. Owned by the test-architect.
import { CreatedResultSchema, base, contract, createRoute } from "@budmon/contract";
import { implement } from "@orpc/server";
import { vi } from "vitest";
import { z } from "zod";
import { RateLimitedError } from "../../src/platform/errors/platformErrors.js";
import type { RequestContext } from "../../src/platform/http/context.js";
import { metaRouter } from "../../src/platform/http/meta.js";

export const testContract = {
  ...contract,
  test: {
    ping: base.route({ method: "GET", path: "/test/ping" }).output(z.object({ ok: z.boolean() })),
    rateLimited: base
      .route({ method: "GET", path: "/test/rate-limited" })
      .output(z.object({ ok: z.boolean() })),
    boom: base.route({ method: "GET", path: "/test/boom" }).output(z.object({ ok: z.boolean() })),
    query: base.route({ method: "GET", path: "/test/query" }).output(z.object({ ok: z.boolean() })),
    createThing: createRoute("/test/things").input(z.strictObject({ name: z.string().max(100) })),
  },
};

export interface TestRouter {
  router: Record<string, unknown>;
  /** Called once per invocation of test.createThing's handler. */
  createHandler: ReturnType<typeof vi.fn>;
  /** What test.boom throws. */
  boomError: Error;
}

export function testRouter(boomError: Error = new Error("boom")): TestRouter {
  const os = implement(testContract).$context<RequestContext>();
  const createHandler = vi.fn(() => ({
    id: "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0d",
    createdAt: "2026-10-05T12:00:00.000Z",
  }));
  const router = {
    meta: metaRouter,
    test: {
      ping: os.test.ping.handler(() => ({ ok: true })),
      rateLimited: os.test.rateLimited.handler(() => {
        throw new RateLimitedError(30);
      }),
      boom: os.test.boom.handler(() => {
        throw boomError;
      }),
      query: os.test.query.handler(async ({ context }) => {
        await context.container.database.handle.executeSql("SELECT 1");
        return { ok: true };
      }),
      createThing: os.test.createThing.handler(() => CreatedResultSchema.parse(createHandler())),
    },
  };
  return { router, createHandler, boomError };
}
