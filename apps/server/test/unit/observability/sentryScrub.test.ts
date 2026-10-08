// F-35 scrubSentryEvent and scrubBreadcrumb. TP-3.5, plus extra cases TP-3.19x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
//
// TP-3.5 sets exception.values[0].value to CANARIES.message and expects "value = type". The bare
// canary ("CANARYMESSAGE7f3a") passes F-30's token rule, so F-35's rule as written would keep it.
// Until the planner settles that (raised), the value here is a real message with the canary in it,
// which the rule replaces either way.
import { CANARIES, scanForCanaries } from "@budmon/test-support";
import { describe, expect, it } from "vitest";
import { scrubBreadcrumb, scrubSentryEvent } from "../../../src/platform/observability/sentry.js";

const MESSAGE_VALUE = `duplicate key for ${CANARIES.message} (${CANARIES.email})`;

function rawEvent(): Record<string, unknown> {
  return {
    event_id: "0123456789abcdef0123456789abcdef",
    timestamp: 1_760_000_000,
    platform: "node",
    level: "error",
    release: "v1.2.3",
    environment: "production",
    server_name: "laptop-host",
    message: CANARIES.message,
    request: { url: `https://x.io/a?token=${CANARIES.token}`, data: CANARIES.payee },
    extra: { payee: CANARIES.payee },
    user: { id: "u1", email: CANARIES.email, ip_address: "10.1.2.3" },
    tags: { route: "/v1/entries/{id}", job: "fx.fetch", foo: CANARIES.payee },
    exception: {
      values: [
        {
          type: "DatabaseError",
          value: MESSAGE_VALUE,
          mechanism: { type: "generic", data: { x: CANARIES.token } },
          stacktrace: {
            frames: [
              {
                filename: "/app/dist/main/api.js",
                function: "handler",
                lineno: 10,
                colno: 5,
                in_app: true,
                vars: { password: CANARIES.token },
                context_line: `const x = "${CANARIES.payee}"`,
                pre_context: [CANARIES.email],
              },
            ],
          },
        },
      ],
    },
    contexts: {
      trace: { trace_id: "t".repeat(32), span_id: "s".repeat(16), op: CANARIES.message },
      os: { name: "linux" },
    },
    breadcrumbs: {
      values: [
        {
          category: "console",
          message: CANARIES.message,
          timestamp: 1,
          level: "info",
          type: "default",
        },
        {
          category: "http",
          type: "http",
          level: "info",
          timestamp: 2,
          message: CANARIES.message,
          data: {
            url: `https://api.example.com/v1/x?token=${CANARIES.token}#f`,
            method: "GET",
            status_code: 200,
            body: CANARIES.payee,
          },
        },
      ],
    },
  };
}

function noCanary(value: unknown): void {
  expect(scanForCanaries([{ name: "event", text: JSON.stringify(value) }], CANARIES)).toEqual([]);
}

/**
 * Checks a scrubbed breadcrumb: exactly `expected`, plus `category` if kept (F-35 filters on it
 * but doesn't say whether the key itself stays).
 */
function expectBreadcrumb(
  actual: unknown,
  category: string,
  expected: Record<string, unknown>,
): void {
  const crumb = { ...(actual as Record<string, unknown>) };
  if ("category" in crumb) {
    expect(crumb["category"]).toBe(category);
    delete crumb["category"];
  }
  expect(crumb).toEqual(expected);
}

describe("TP-3.5: scrubSentryEvent", () => {
  it("TP-3.5: keeps only the allowlisted keys", () => {
    const { breadcrumbs, ...scrubbed } = scrubSentryEvent(rawEvent()) ?? {};

    const crumbs = (breadcrumbs as { values: unknown[] }).values;
    expect(crumbs).toHaveLength(1);
    expectBreadcrumb(crumbs[0], "http", {
      type: "http",
      level: "info",
      timestamp: 2,
      data: { url: "https://api.example.com/v1/x", method: "GET", status_code: 200 },
    });
    expect(scrubbed).toEqual({
      event_id: "0123456789abcdef0123456789abcdef",
      timestamp: 1_760_000_000,
      platform: "node",
      level: "error",
      release: "v1.2.3",
      environment: "production",
      exception: {
        values: [
          {
            type: "DatabaseError",
            value: "DatabaseError",
            stacktrace: {
              frames: [
                {
                  filename: "/app/dist/main/api.js",
                  function: "handler",
                  lineno: 10,
                  colno: 5,
                  in_app: true,
                },
              ],
            },
          },
        ],
      },
      tags: { route: "/v1/entries/{id}", job: "fx.fetch" },
      user: { id: "u1" },
      contexts: { trace: { trace_id: "t".repeat(32), span_id: "s".repeat(16) } },
    });
  });

  it("TP-3.5: no canary survives", () => {
    noCanary(scrubSentryEvent(rawEvent()));
  });

  it("TP-3.5: the input event isn't changed in place", () => {
    const event = rawEvent();
    const before = JSON.stringify(event);

    scrubSentryEvent(event);

    expect(JSON.stringify(event)).toBe(before);
  });
});

describe("TP-3.19x: scrubSentryEvent and scrubBreadcrumb, further cases (F-35)", () => {
  it("TP-3.19x: a value matching the token rule is kept", () => {
    const event = rawEvent();
    const values = (event["exception"] as { values: Record<string, unknown>[] }).values;
    values[0] = { ...values[0], value: "NOT_FOUND" };

    const scrubbed = scrubSentryEvent(event) as { exception: { values: { value: unknown }[] } };

    expect(scrubbed.exception.values[0]?.value).toBe("NOT_FOUND");
  });

  it("TP-3.19x: tags keep only route, job, client_kind and error_key", () => {
    const event = {
      ...rawEvent(),
      tags: { route: "/a", job: "j", client_kind: "web", error_key: "NOT_FOUND", other: "x" },
    };

    expect((scrubSentryEvent(event) as { tags: unknown }).tags).toEqual({
      route: "/a",
      job: "j",
      client_kind: "web",
      error_key: "NOT_FOUND",
    });
  });

  it.each([["console"], ["query"], ["ui.click"], ["sentry.event"]])(
    "TP-3.19x: a %s breadcrumb is removed",
    (category) => {
      expect(scrubBreadcrumb({ category, message: CANARIES.message, timestamp: 1 })).toBeNull();
    },
  );

  it("TP-3.19x: a navigation breadcrumb keeps timestamp, type, level and the reduced URL", () => {
    expect(
      scrubBreadcrumb({
        category: "navigation",
        type: "navigation",
        level: "info",
        timestamp: 3,
        message: CANARIES.message,
        data: {
          url: `http://localhost:5173/entries?payee=${CANARIES.payee}`,
          from: CANARIES.email,
        },
      }),
    ).not.toBeNull();
    expectBreadcrumb(
      scrubBreadcrumb({
        category: "navigation",
        type: "navigation",
        level: "info",
        timestamp: 3,
        message: CANARIES.message,
        data: {
          url: `http://localhost:5173/entries?payee=${CANARIES.payee}`,
          from: CANARIES.email,
        },
      }),
      "navigation",
      {
        type: "navigation",
        level: "info",
        timestamp: 3,
        data: { url: "http://localhost:5173/entries" },
      },
    );
  });

  it("TP-3.19x: an http breadcrumb with an unparseable URL keeps no URL text", () => {
    const crumb = scrubBreadcrumb({
      category: "http",
      timestamp: 1,
      data: { url: `not a url ${CANARIES.token}`, method: "POST", status_code: 500 },
    });

    noCanary(crumb);
  });
});
