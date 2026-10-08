// The API server with a test contract and router (S-4 AC 1). TP-4.10 (F-52's interceptor),
// TP-4.11's integration part (F-56's middleware) and TP-4.19 (body handling, F-55 step 5 with
// F-62), plus extra cases TP-4.34x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { CANARIES, scanForCanaries } from "@budmon/test-support";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApiServer } from "../../../src/platform/http/server.js";
import {
  buildApiContainer,
  injectJson,
  observed,
  type BuiltContainer,
  type Observed,
} from "../../support/api.js";
import { testContract, testRouter, type TestRouter } from "../../support/testRouter.js";

let built: BuiltContainer;
let app: FastifyInstance;
let obs: Observed;
let routes: TestRouter;

beforeAll(async () => {
  obs = observed();
  built = await buildApiContainer(obs.overrides, {
    CLIENT_MIN_ANDROID: "5",
    CLIENT_LATEST_ANDROID: "5",
    CLIENT_MIN_WEB: "2",
  });
  routes = testRouter(new Error(CANARIES.message));
  app = await createApiServer(built.container, {
    contract: testContract,
    router: routes.router as never,
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await built.close();
});

beforeEach(() => {
  routes.createHandler.mockClear();
});

const IDEMPOTENCY = { "idempotency-key": "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0e" };

describe("TP-4.10: the error interceptor through HTTP", () => {
  it("TP-4.10: RateLimitedError(30) is 429 with Retry-After: 30 and no report", async () => {
    const reportsBefore = obs.reporter.events.length;

    const res = await injectJson(app, "GET", "/api/v1/test/rate-limited");

    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBe("30");
    expect(res.json()).toEqual({
      defined: true,
      code: "RATE_LIMITED",
      status: 429,
      message: "Too many requests",
      data: { retryAfterSeconds: 30 },
    });
    expect(obs.reporter.events.length).toBe(reportsBefore);
  });

  it("TP-4.10: an Error carrying a canary is the exact INTERNAL envelope, one report without the canary, one request_failed line", async () => {
    const reportsBefore = obs.reporter.events.length;
    const linesBefore = obs.capture.records().length;

    const res = await injectJson(app, "GET", "/api/v1/test/boom");

    expect(res.status).toBe(500);
    expect(res.json()).toEqual({
      defined: true,
      code: "INTERNAL",
      status: 500,
      message: "Internal error",
      data: { outcome: "not_applied" },
    });
    expect(obs.reporter.events.length).toBe(reportsBefore + 1);
    const failed = obs.capture
      .records()
      .slice(linesBefore)
      .filter((l) => l["event"] === "request_failed");
    expect(failed).toHaveLength(1);
    expect(
      scanForCanaries(
        [
          { name: "reports", text: JSON.stringify(obs.reporter.events) },
          { name: "logs", text: obs.capture.text() },
          { name: "body", text: res.body },
        ],
        CANARIES,
      ),
    ).toEqual([]);
  });
});

describe("TP-4.11: the client version check through HTTP", () => {
  it.each([
    ["android/4", 400, { minimumVersion: 5 }],
    ["android/5", 200, undefined],
    ["web/1", 400, { minimumVersion: 2 }],
    ["ios/1", 200, undefined],
  ] as const)("TP-4.11: X-Budmon-Client %s on test.ping gives %i", async (header, status, data) => {
    const res = await injectJson(app, "GET", "/api/v1/test/ping", undefined, {
      "x-budmon-client": header,
    });

    expect(res.status).toBe(status);
    if (data !== undefined) {
      expect(res.json()).toEqual({
        defined: true,
        code: "CLIENT_UPDATE_REQUIRED",
        status: 400,
        message: "Client update required",
        data,
      });
    }
  });

  it("TP-4.11: no X-Budmon-Client header passes", async () => {
    expect((await injectJson(app, "GET", "/api/v1/test/ping")).status).toBe(200);
  });

  it("TP-4.11: android/1 on meta.clientConfig passes (exempt)", async () => {
    const res = await injectJson(app, "GET", "/api/v1/meta/client-config", undefined, {
      "x-budmon-client": "android/1",
    });

    expect(res.status).toBe(200);
  });

  it("TP-4.34x: a blocked request increments client_update_required_total", async () => {
    await injectJson(app, "GET", "/api/v1/test/ping", undefined, {
      "x-budmon-client": "android/2",
    });

    const metric = (await obs.collect()).get("client_update_required_total");
    const android = metric?.dataPoints.find((p) => p.attributes["client_kind"] === "android");
    expect(android?.value).toBeGreaterThanOrEqual(1);
  });
});

describe("TP-4.19: body handling, Fastify's parser before oRPC", () => {
  it("TP-4.19: valid JSON creates: 201", async () => {
    const res = await injectJson(app, "POST", "/api/v1/test/things", { name: "x" }, IDEMPOTENCY);

    expect(res.status).toBe(201);
    expect(routes.createHandler).toHaveBeenCalledTimes(1);
  });

  it("TP-4.19: malformed JSON is F-62's 400 invalid_json and the handler never runs", async () => {
    const res = await injectJson(app, "POST", "/api/v1/test/things", '{"name": "x"', IDEMPOTENCY);

    expect(res.status).toBe(400);
    expect(res.json()).toEqual({
      defined: true,
      code: "VALIDATION_FAILED",
      status: 400,
      message: "Validation failed",
      data: {
        issues: [{ path: [], code: "invalid_json", message: "Request body is not valid JSON." }],
      },
    });
    expect(routes.createHandler).not.toHaveBeenCalled();
  });

  it("TP-4.19: a body of 100 KiB + 1 is 413 and the handler never runs", async () => {
    const name = "x".repeat(102_401 - '{"name":""}'.length);

    const res = await injectJson(
      app,
      "POST",
      "/api/v1/test/things",
      `{"name":"${name}"}`,
      IDEMPOTENCY,
    );

    expect(res.status).toBe(413);
    expect(res.json()).toMatchObject({ defined: true, code: "PAYLOAD_TOO_LARGE", status: 413 });
    expect(routes.createHandler).not.toHaveBeenCalled();
  });

  it("TP-4.19: an unknown field is oRPC's 400 VALIDATION_FAILED with code unrecognized_keys", async () => {
    const res = await injectJson(
      app,
      "POST",
      "/api/v1/test/things",
      { name: "x", extra: 1 },
      IDEMPOTENCY,
    );

    expect(res.status).toBe(400);
    const body = res.json() as { code: string; data: { issues: { code: string }[] } };
    expect(body.code).toBe("VALIDATION_FAILED");
    expect(body.data.issues.map((i) => i.code)).toContain("unrecognized_keys");
    expect(routes.createHandler).not.toHaveBeenCalled();
  });
});
