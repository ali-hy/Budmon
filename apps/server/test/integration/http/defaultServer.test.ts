// The API server with its default contract and router (F-55, F-58, F-52, F-38). TP-4.7, TP-4.14,
// TP-4.15 and TP-4.17.
import { API_VERSION } from "@budmon/contract";
import { CANARIES, scanForCanaries } from "@budmon/test-support";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiServer } from "../../../src/platform/http/server.js";
import {
  buildApiContainer,
  injectJson,
  observed,
  type BuiltContainer,
  type Observed,
} from "../../support/api.js";

let built: BuiltContainer;
let app: FastifyInstance;
let obs: Observed;

beforeAll(async () => {
  obs = observed();
  built = await buildApiContainer(obs.overrides, {
    CLIENT_MIN_ANDROID: "3",
    CLIENT_LATEST_ANDROID: "5",
  });
  app = await createApiServer(built.container);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await built.close();
});

const NOT_FOUND = { defined: true, code: "NOT_FOUND", status: 404, message: "Not found" };

describe("TP-4.7: GET /api/v1/meta/client-config", () => {
  it("TP-4.7: 200 with the exact body, X-Request-Id (32 hex) and X-Budmon-API-Version", async () => {
    const res = await injectJson(app, "GET", "/api/v1/meta/client-config");

    expect(res.status).toBe(200);
    expect(res.json()).toEqual({
      apiVersion: API_VERSION,
      android: { minimumVersionCode: 3, latestVersionCode: 5, downloadUrl: null },
      web: { minimumBuild: 0 },
    });
    expect(String(res.headers["x-request-id"])).toMatch(/^[0-9a-f]{32}$/);
    expect(res.headers["x-budmon-api-version"]).toBe(API_VERSION);
  });
});

describe("TP-4.14: no CORS", () => {
  it("TP-4.14: OPTIONS with a foreign Origin is a 404 envelope with no Access-Control-* headers", async () => {
    const res = await injectJson(app, "OPTIONS", "/api/v1/meta/client-config", undefined, {
      origin: "https://evil.example",
      "access-control-request-method": "GET",
    });

    expect(res.status).toBe(404);
    expect(res.json()).toEqual(NOT_FOUND);
    expect(
      Object.keys(res.headers).filter((h) => h.toLowerCase().startsWith("access-control-")),
    ).toEqual([]);
  });
});

describe("TP-4.15: unknown route", () => {
  it("TP-4.15: GET /api/v1/nope is 404 with exactly the NOT_FOUND envelope", async () => {
    const res = await injectJson(app, "GET", "/api/v1/nope");

    expect(res.status).toBe(404);
    expect(res.json()).toEqual(NOT_FOUND);
  });
});

describe("TP-4.17: request log", () => {
  it("TP-4.17: one http_request line with the route template, status 200, no query field or canary; the counter incremented", async () => {
    const before = obs.capture.records().length;

    const res = await injectJson(app, "GET", `/api/v1/meta/client-config?x=${CANARIES.token}`);

    expect(res.status).toBe(200);
    const lines = obs.capture
      .records()
      .slice(before)
      .filter((l) => l["event"] === "http_request");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ route: "/meta/client-config", status: 200 });
    expect(lines[0]).not.toHaveProperty("x");
    expect(scanForCanaries([{ name: "log", text: obs.capture.text() }], CANARIES)).toEqual([]);
    const counter = (await obs.collect()).get("http_server_requests_total");
    const point = counter?.dataPoints.find(
      (p) => p.attributes["http_route"] === "/meta/client-config",
    );
    expect(point?.value).toBeGreaterThanOrEqual(1);
  });
});
