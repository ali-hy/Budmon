// F-34 initSentry and ErrorReporter. TP-3.6, plus extra cases TP-3.20x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
//
// The "Sentry test transport" is a local HTTP server: the DSN points at it, so the real Sentry
// client sends its envelopes there and the test reads exactly what would leave the process.
import { createServer, type Server } from "node:http";
import { gunzipSync } from "node:zlib";
import { CANARIES, scanForCanaries } from "@budmon/test-support";
import { afterEach, describe, expect, it } from "vitest";
import { initSentry } from "../../../src/platform/observability/sentry.js";

interface FakeSentry {
  dsn: string;
  bodies: string[];
  close(): Promise<void>;
}

async function fakeSentry(): Promise<FakeSentry> {
  const bodies: string[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks);
      const body = req.headers["content-encoding"] === "gzip" ? gunzipSync(raw) : raw;
      bodies.push(body.toString("utf8"));
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return {
    dsn: `http://publickey@127.0.0.1:${String(port)}/1`,
    bodies,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
}

/** The event items of every envelope received (an envelope is newline-delimited JSON). */
function eventsOf(bodies: readonly string[]): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = [];
  for (const body of bodies) {
    const lines = body.split("\n").filter((l) => l !== "");
    for (let i = 1; i + 1 < lines.length; i += 2) {
      const header = JSON.parse(lines[i] ?? "{}") as { type?: string };
      if (header.type === "event")
        events.push(JSON.parse(lines[i + 1] ?? "{}") as Record<string, unknown>);
    }
  }
  return events;
}

let servers: FakeSentry[] = [];

afterEach(async () => {
  await Promise.all(servers.map((s) => s.close()));
  servers = [];
});

async function server(): Promise<FakeSentry> {
  const s = await fakeSentry();
  servers.push(s);
  return s;
}

const CFG = { environment: "production", release: "v1.2.3", service: "api" } as const;

describe("TP-3.6: ErrorReporter through Sentry", () => {
  it("TP-3.6: report sends one event with type Error and value Error, and no canary anywhere", async () => {
    const sentry = await server();
    const reporter = initSentry({ ...CFG, dsn: sentry.dsn });

    reporter.report(new Error(CANARIES.message), { requestId: "r1" });
    await reporter.flush(5_000);

    const events = eventsOf(sentry.bodies);
    expect(events).toHaveLength(1);
    const exception = (events[0]?.["exception"] as { values: Record<string, unknown>[] }).values[0];
    expect(exception).toMatchObject({ type: "Error", value: "Error" });
    expect(
      scanForCanaries(
        sentry.bodies.map((text, i) => ({ name: `envelope ${String(i)}`, text })),
        CANARIES,
      ),
    ).toEqual([]);
  });

  it("TP-3.6: without a DSN, report is a no-op", async () => {
    const sentry = await server();
    const reporter = initSentry({ ...CFG });

    expect(() => {
      reporter.report(new Error(CANARIES.message), { requestId: "r1" });
    }).not.toThrow();
    await reporter.flush(500);

    expect(sentry.bodies).toEqual([]);
  });
});

describe("TP-3.20x: ErrorReporter, further cases (F-34)", () => {
  it("TP-3.20x: the event carries the context as tags route, job, error_key and user.id, never the canary", async () => {
    const sentry = await server();
    const reporter = initSentry({ ...CFG, dsn: sentry.dsn });
    const err = Object.assign(new Error(CANARIES.message, { cause: new Error(CANARIES.token) }), {
      code: "ECONNREFUSED",
      detail: CANARIES.payee,
    });

    reporter.report(err, {
      requestId: "r1",
      userId: "u1",
      route: "/v1/entries/{id}",
      jobName: "fx.fetch",
      errorKey: "SERVICE_UNAVAILABLE",
    });
    await reporter.flush(5_000);

    const [event] = eventsOf(sentry.bodies);
    expect(event?.["tags"]).toMatchObject({
      route: "/v1/entries/{id}",
      job: "fx.fetch",
      error_key: "SERVICE_UNAVAILABLE",
    });
    expect(event?.["user"]).toEqual({ id: "u1" });
    const exception = (event?.["exception"] as { values: Record<string, unknown>[] }).values[0];
    expect(exception).toMatchObject({ type: "Error", value: "ECONNREFUSED" });
    expect(
      scanForCanaries([{ name: "envelope", text: sentry.bodies.join("\n") }], CANARIES),
    ).toEqual([]);
  });

  it("TP-3.20x: the event's environment and release come from the configuration", async () => {
    const sentry = await server();
    const reporter = initSentry({ ...CFG, dsn: sentry.dsn });

    reporter.report(new Error("x"), {});
    await reporter.flush(5_000);

    expect(eventsOf(sentry.bodies)[0]).toMatchObject({
      environment: "production",
      release: "v1.2.3",
    });
  });

  it("TP-3.20x: a thrown string is reported as NonError", async () => {
    const sentry = await server();
    const reporter = initSentry({ ...CFG, dsn: sentry.dsn });

    reporter.report(CANARIES.message, {});
    await reporter.flush(5_000);

    const [event] = eventsOf(sentry.bodies);
    const exception = (event?.["exception"] as { values: Record<string, unknown>[] }).values[0];
    expect(exception).toMatchObject({ type: "NonError", value: "NonError" });
    expect(sentry.bodies.join("\n")).not.toContain(CANARIES.message);
  });
});
