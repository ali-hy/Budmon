// F-36 startTelemetry and F-40 AllowlistSpanExporter: traces and metrics that carry only
// allowlisted attributes.
import { FastifyOtelInstrumentation } from "@fastify/otel";
import {
  ExportResultCode,
  W3CTraceContextPropagator,
  type ExportResult,
} from "@opentelemetry/core";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { metrics as metricsApi, type Attributes } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  PeriodicExportingMetricReader,
  createAllowListAttributesProcessor,
  type MetricReader,
} from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  BatchSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import type { AppEnv } from "../config/schema.js";
import { createMetrics, METRIC_LABELS, type Metrics } from "./metrics.js";

/** What the pinned instrumentations emit beyond the allowlist (F-40). Entries ending in "." are
 * prefixes. */
export const EXPECTED_DROPPED_SPAN_ATTRIBUTES: readonly string[] = [
  "url.full",
  "url.query",
  "url.original",
  "user_agent.original",
  "client.address",
  "client.port",
  "network.peer.address",
  "network.peer.port",
  "network.local.address",
  "network.local.port",
  "network.transport",
  "network.type",
  "http.request.body.size",
  "http.response.body.size",
  "http.request.resend_count",
  "http.request.header.",
  "http.response.header.",
  "http.url",
  "http.target",
  "http.host",
  "http.scheme",
  "http.flavor",
  "http.user_agent",
  "http.method",
  "http.status_code",
  "http.client_ip",
  "net.",
  "db.user",
  "db.connection_string",
  "db.system",
  "db.name",
  "db.statement",
  "db.postgresql.",
  "messaging.",
  "fastify.",
  "hook.",
  "service.name",
  "error.type",
  "exception.",
];

export const SPAN_ATTRIBUTE_ALLOWLIST: ReadonlySet<string> = new Set([
  "http.request.method",
  "http.response.status_code",
  "http.route",
  "url.scheme",
  "url.path",
  "server.address",
  "server.port",
  "network.protocol.version",
  "db.system.name",
  "db.namespace",
  "db.operation.name",
  "db.collection.name",
  "db.query.text",
  "rpc.system",
  "rpc.method",
  "budmon.job.name",
  "budmon.queue",
  "budmon.error.key",
  "budmon.outcome",
  "budmon.client.kind",
]);

export const METRIC_ATTRIBUTE_ALLOWLIST: readonly string[] = [
  ...METRIC_LABELS,
  "http.request.method",
  "http.response.status_code",
  "http.route",
  "url.scheme",
  "server.address",
  "server.port",
  "network.protocol.version",
  "db.system.name",
  "db.namespace",
  "db.operation.name",
  "error.type",
];

function isExpectedDrop(key: string): boolean {
  return EXPECTED_DROPPED_SPAN_ATTRIBUTES.some((entry) =>
    entry.endsWith(".") ? key.startsWith(entry) : key === entry,
  );
}

export class AllowlistSpanExporter implements SpanExporter {
  constructor(
    private readonly inner: SpanExporter,
    private readonly allowlist: ReadonlySet<string>,
    private readonly onDrop: (kind: "expected" | "unexpected", n: number) => void,
  ) {}

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    let expected = 0;
    let unexpected = 0;
    const filtered = spans.map((span): ReadableSpan => {
      const attributes: Attributes = {};
      for (const [key, value] of Object.entries(span.attributes)) {
        if (!this.allowlist.has(key)) {
          if (isExpectedDrop(key)) expected += 1;
          else unexpected += 1;
          continue;
        }
        attributes[key] =
          key === "url.path" && typeof value === "string" ? (value.split(/[?#]/)[0] ?? "") : value;
      }
      for (const event of span.events) {
        if (event.name === "exception") expected += 1;
        else unexpected += 1;
      }
      return {
        name: span.name,
        kind: span.kind,
        spanContext: () => span.spanContext(),
        ...(span.parentSpanContext === undefined
          ? {}
          : { parentSpanContext: span.parentSpanContext }),
        startTime: span.startTime,
        endTime: span.endTime,
        status: { code: span.status.code, message: "" },
        attributes,
        links: span.links,
        events: [],
        duration: span.duration,
        ended: span.ended,
        resource: span.resource,
        instrumentationScope: span.instrumentationScope,
        droppedAttributesCount: span.droppedAttributesCount,
        droppedEventsCount: span.droppedEventsCount,
        droppedLinksCount: span.droppedLinksCount,
      };
    });
    if (expected > 0) this.onDrop("expected", expected);
    if (unexpected > 0) this.onDrop("unexpected", unexpected);
    this.inner.export(filtered, resultCallback);
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve();
  }
}

/** A SpanExporter that drops everything (used only when nothing should leave the process). */
const noExport: SpanExporter = {
  export: (_spans, cb) => {
    cb({ code: ExportResultCode.SUCCESS });
  },
  shutdown: () => Promise.resolve(),
};

export function startTelemetry(
  cfg: { endpoint?: URL; service: string; release: string; environment: AppEnv },
  deps: {
    onDrop: (signal: "traces" | "metrics", kind: "expected" | "unexpected", n: number) => void;
    traceExporter?: SpanExporter;
    metricReader?: MetricReader;
  },
): { metrics: Metrics; shutdown(): Promise<void> } {
  const endpoint = cfg.endpoint?.toString().replace(/\/$/, "");
  const innerTraceExporter =
    deps.traceExporter ??
    (endpoint === undefined ? undefined : new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }));
  const metricReader =
    deps.metricReader ??
    (endpoint === undefined
      ? undefined
      : new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
          exportIntervalMillis: 60_000,
        }));

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      "service.name": cfg.service,
      "service.version": cfg.release,
      "deployment.environment.name": cfg.environment,
    }),
    // Nothing is configured from the environment: no detectors, no default exporters.
    autoDetectResources: false,
    resourceDetectors: [],
    spanProcessors:
      innerTraceExporter === undefined && deps.traceExporter === undefined
        ? []
        : [
            new BatchSpanProcessor(
              new AllowlistSpanExporter(
                innerTraceExporter ?? noExport,
                SPAN_ATTRIBUTE_ALLOWLIST,
                (kind, n) => {
                  deps.onDrop("traces", kind, n);
                },
              ),
            ),
          ],
    metricReaders: metricReader === undefined ? [] : [metricReader],
    logRecordProcessors: [],
    views: [
      {
        instrumentName: "*",
        attributesProcessors: [createAllowListAttributesProcessor([...METRIC_ATTRIBUTE_ALLOWLIST])],
      },
    ],
    textMapPropagator: new W3CTraceContextPropagator(),
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => (req.url ?? "").startsWith("/health/"),
        headersToSpanAttributes: {
          client: { requestHeaders: [], responseHeaders: [] },
          server: { requestHeaders: [], responseHeaders: [] },
        },
      }),
      new UndiciInstrumentation(),
      new PgInstrumentation({ enhancedDatabaseReporting: false, requireParentSpan: true }),
      new FastifyOtelInstrumentation(),
    ],
  });
  sdk.start();

  const metrics = createMetrics(metricsApi.getMeter("budmon"), (n) => {
    deps.onDrop("metrics", "unexpected", n);
  });
  return { metrics, shutdown: () => sdk.shutdown() };
}
