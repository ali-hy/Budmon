// Test helpers for the API server (LLD §10.1, S-4): `buildApiContainer(overrides)`,
// `testPrincipal(overrides)` (A-1), `injectJson(app, method, url, body?, headers?)`, and
// `observed()`, which gives a container a log capture, a memory error reporter and in-memory
// metrics the tests can read. Owned by the test-architect.
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
  type MetricData,
} from "@opentelemetry/sdk-metrics";
import type { FastifyInstance } from "fastify";
import { vi, type Mock } from "vitest";
import { loadConfig } from "../../src/platform/config/loadConfig.js";
import type { Config } from "../../src/platform/config/schema.js";
import { createApiContainer, type ApiContainer } from "../../src/platform/container.js";
import type { Principal } from "../../src/platform/http/context.js";
import {
  createMemoryErrorReporter,
  type ErrorReporter,
} from "../../src/platform/observability/errorReporter.js";
import { createLogger } from "../../src/platform/observability/logger.js";
import {
  createMetrics,
  registerPlatformMetrics,
  type PlatformMetrics,
} from "../../src/platform/observability/metrics.js";
import { devApi, readFileFrom } from "./configEnv.js";
import { logCapture, type LogCapture } from "./telemetry.js";
import { createTestDatabase, type TestDatabase } from "./testDatabase.js";

export const TEST_USER_ID = "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0b";
export const TEST_SESSION_ID = "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0c";

/** A Principal with fixed UUIDv7s (A-1); every fake auth hook builds its principal with this. */
export function testPrincipal(overrides: Partial<Principal> = {}): Principal {
  return { userId: TEST_USER_ID, isOwner: false, sessionId: TEST_SESSION_ID, ...overrides };
}

export interface Observed {
  capture: LogCapture;
  reporter: ErrorReporter & { readonly events: readonly Record<string, unknown>[] };
  metrics: PlatformMetrics;
  onDrop: Mock<(n: number) => void>;
  /** Every metric exported so far, by name. */
  collect(): Promise<Map<string, MetricData>>;
  /** Container overrides wiring the three in. */
  overrides: Pick<ApiContainer, "logger" | "reporter" | "metrics">;
}

export function observed(): Observed {
  const capture = logCapture();
  const reporter = createMemoryErrorReporter();
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 3_600_000 });
  const provider = new MeterProvider({ readers: [reader] });
  const onDrop = vi.fn<(n: number) => void>();
  const metrics = registerPlatformMetrics(createMetrics(provider.getMeter("test"), onDrop));
  const logger = createLogger({
    service: "api",
    release: "v1.2.3",
    level: "debug",
    destination: capture,
  });
  return {
    capture,
    reporter,
    metrics,
    onDrop,
    collect: async () => {
      await reader.forceFlush();
      const byName = new Map<string, MetricData>();
      for (const rm of exporter.getMetrics()) {
        for (const sm of rm.scopeMetrics)
          for (const m of sm.metrics) byName.set(m.descriptor.name, m);
      }
      return byName;
    },
    overrides: { logger, reporter, metrics },
  };
}

/** An api configuration from the development fixture, with `env` applied on top. */
export function testApiConfig(env: Record<string, string | undefined> = {}): Config {
  const f = devApi();
  Object.assign(f.env, env);
  return loadConfig("api", f.env, readFileFrom(f.files));
}

export interface BuiltContainer {
  container: ApiContainer;
  testDb: TestDatabase;
  close(): Promise<void>;
}

/**
 * An ApiContainer (F-96) on a fresh copy of the template database, connected as budmon_app, with
 * a silent observed logger, reporter and metrics unless `overrides` replaces them.
 */
export async function buildApiContainer(
  overrides: Partial<ApiContainer> = {},
  env: Record<string, string | undefined> = {},
): Promise<BuiltContainer> {
  const testDb = await createTestDatabase("budmon_app");
  const container = createApiContainer(testApiConfig(env), {
    ...observed().overrides,
    database: testDb.database,
    ...overrides,
  });
  return {
    container,
    testDb,
    close: async () => {
      await container.close();
      await testDb.drop();
    },
  };
}

export interface InjectedResponse {
  status: number;
  headers: Record<string, string | string[] | number | undefined>;
  body: string;
  json(): unknown;
}

/** Fastify's `inject` with a JSON body and string headers. */
export async function injectJson(
  app: FastifyInstance,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS",
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<InjectedResponse> {
  const response = await app.inject({
    method,
    url,
    headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
    ...(body === undefined
      ? {}
      : { payload: typeof body === "string" ? body : JSON.stringify(body) }),
  });
  return {
    status: response.statusCode,
    headers: response.headers,
    body: response.body,
    json: () => JSON.parse(response.body) as unknown,
  };
}
