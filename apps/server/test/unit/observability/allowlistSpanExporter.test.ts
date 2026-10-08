// F-40 AllowlistSpanExporter. TP-3.7, plus extra cases TP-3.21x (classification by prefix, the
// allowlist itself, status messages, delegation). IDs ending in "x" are test-architect additions,
// not LLD test-plan IDs.
import { SpanStatusCode, type Attributes } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import { CANARIES, scanForCanaries } from "@budmon/test-support";
import { describe, expect, it, vi } from "vitest";
import {
  AllowlistSpanExporter,
  EXPECTED_DROPPED_SPAN_ATTRIBUTES,
} from "../../../src/platform/observability/otel.js";
import { RecordingSpanExporter } from "../../support/telemetry.js";

/** F-40's allowlist. */
const ALLOWLIST: ReadonlySet<string> = new Set([
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

interface SpanSpec {
  attributes: Attributes;
  events?: { name: string; attributes?: Attributes }[];
  exception?: Error;
  statusMessage?: string;
}

/** Real finished spans from the SDK, collected by an in-memory exporter. */
function makeSpans(specs: readonly SpanSpec[]): ReadableSpan[] {
  const source = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(source)] });
  const tracer = provider.getTracer("test");
  for (const spec of specs) {
    const span = tracer.startSpan("GET /a/{id}", { attributes: spec.attributes });
    if (spec.exception !== undefined) span.recordException(spec.exception);
    for (const event of spec.events ?? []) span.addEvent(event.name, event.attributes);
    if (spec.statusMessage !== undefined) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: spec.statusMessage });
    }
    span.end();
  }
  return source.getFinishedSpans();
}

function exportThrough(spans: ReadableSpan[], allowlist: ReadonlySet<string> = ALLOWLIST) {
  const inner = new RecordingSpanExporter();
  const onDrop = vi.fn<(kind: "expected" | "unexpected", n: number) => void>();
  const exporter = new AllowlistSpanExporter(inner, allowlist, onDrop);
  const results: unknown[] = [];
  exporter.export(spans, (result: unknown) => results.push(result));
  const sums = { expected: 0, unexpected: 0 };
  for (const [kind, n] of onDrop.mock.calls) sums[kind] += n;
  return { inner, onDrop, sums, results, exporter };
}

describe("TP-3.7: AllowlistSpanExporter", () => {
  function tp37Span(): ReadableSpan[] {
    return makeSpans([
      {
        attributes: {
          "http.route": "/a/{id}",
          "url.full": `https://x.io/a/1?token=${CANARIES.token}`,
          "http.request.header.cookie": [`sid=${CANARIES.token}`],
          "user.email": CANARIES.email,
        },
        exception: new Error(CANARIES.message),
        events: [{ name: "custom", attributes: { payee: CANARIES.payee } }],
      },
    ]);
  }

  it("TP-3.7: the exported span keeps http.route only, and no events", () => {
    const { inner } = exportThrough(tp37Span());

    expect(inner.spans).toHaveLength(1);
    expect(inner.spans[0]?.attributes).toEqual({ "http.route": "/a/{id}" });
    expect(inner.spans[0]?.events).toEqual([]);
  });

  it('TP-3.7: onDrop("expected", 3) for url.full, the header and the exception event', () => {
    const { onDrop, sums } = exportThrough(tp37Span());

    expect(onDrop).toHaveBeenCalledWith("expected", 3);
    expect(sums.expected).toBe(3);
  });

  it('TP-3.7: onDrop("unexpected", 2) for user.email and the custom event', () => {
    const { onDrop, sums } = exportThrough(tp37Span());

    expect(onDrop).toHaveBeenCalledWith("unexpected", 2);
    expect(sums.unexpected).toBe(2);
  });

  it("TP-3.7: nothing exported carries a canary", () => {
    const { inner } = exportThrough(tp37Span());

    const text = JSON.stringify(
      inner.spans.map((s) => ({ attributes: s.attributes, events: s.events, status: s.status })),
    );
    expect(scanForCanaries([{ name: "spans", text }], CANARIES)).toEqual([]);
  });
});

describe("TP-3.21x: AllowlistSpanExporter, further cases (F-40)", () => {
  it("TP-3.21x: every allowlisted attribute is kept", () => {
    const attributes = Object.fromEntries([...ALLOWLIST].map((key) => [key, "v"]));
    const { inner, sums } = exportThrough(makeSpans([{ attributes }]));

    expect(inner.spans[0]?.attributes).toEqual({ ...attributes, "url.path": expect.any(String) });
    expect(sums).toEqual({ expected: 0, unexpected: 0 });
  });

  it.each([
    ["an exact entry", "client.address"],
    ["a prefix entry (net.)", "net.peer.name"],
    ["a prefix entry (db.postgresql.)", "db.postgresql.plan"],
    ["a prefix entry (http.response.header.)", "http.response.header.set_cookie"],
    ["a prefix entry (exception.)", "exception.message"],
  ])("TP-3.21x: %s (%s) is an expected drop", (_label, key) => {
    const { inner, sums } = exportThrough(makeSpans([{ attributes: { [key]: "x" } }]));

    expect(inner.spans[0]?.attributes).toEqual({});
    expect(sums).toEqual({ expected: 1, unexpected: 0 });
  });

  it.each([
    ["a key only sharing a prefix without the dot", "netx"],
    ["a key extending an exact (non-dot) entry", "url.fullx"],
    ["an unknown budmon key", "budmon.payee"],
  ])("TP-3.21x: %s (%s) is an unexpected drop", (_label, key) => {
    const { sums } = exportThrough(makeSpans([{ attributes: { [key]: "x" } }]));

    expect(sums).toEqual({ expected: 0, unexpected: 1 });
  });

  it("TP-3.21x: the status message is cleared, the status code kept", () => {
    const { inner } = exportThrough(
      makeSpans([{ attributes: {}, statusMessage: `failed for ${CANARIES.email}` }]),
    );

    expect(inner.spans[0]?.status).toEqual({ code: SpanStatusCode.ERROR, message: "" });
  });

  it("TP-3.21x: the span name is left as is", () => {
    const { inner } = exportThrough(makeSpans([{ attributes: {} }]));

    expect(inner.spans[0]?.name).toBe("GET /a/{id}");
  });

  it("TP-3.21x: drops are summed across the spans of one export", () => {
    const spans = makeSpans([
      { attributes: { "url.full": "https://x.io/" } },
      { attributes: { "url.query": "a=1", "user.id": "u1" } },
    ]);

    const { sums } = exportThrough(spans);

    expect(sums).toEqual({ expected: 2, unexpected: 1 });
  });

  it("TP-3.21x: the inner exporter's result reaches the callback, and shutdown is delegated", async () => {
    const { results, inner, exporter } = exportThrough(makeSpans([{ attributes: {} }]));

    await exporter.shutdown();

    expect(results).toEqual([{ code: 0 }]);
    expect(inner.shutdowns).toBe(1);
  });

  it("TP-3.21x: EXPECTED_DROPPED_SPAN_ATTRIBUTES is F-40's list", () => {
    expect([...EXPECTED_DROPPED_SPAN_ATTRIBUTES].sort()).toEqual(
      [
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
      ].sort(),
    );
  });
});
