// F-33 sanitizeError and F-37 stripQuery. TP-3.4 and TP-3.9, plus extra cases TP-3.17x (status
// sources, reasons, frame rules, properties never copied) and TP-3.18x (stripQuery).
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
// TP-3.4 uses F-50 BudmonError, which S-3 delivers (A-100).
import { CANARIES, scanForCanaries } from "@budmon/test-support";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { BudmonError } from "../../../src/platform/errors/BudmonError.js";
import { sanitizeError, stripQuery } from "../../../src/platform/observability/sanitize.js";

function noCanary(value: unknown): void {
  expect(scanForCanaries([{ name: "result", text: JSON.stringify(value) }], CANARIES)).toEqual([]);
}

function withStack(err: Error, lines: readonly string[]): Error {
  err.stack = lines.join("\n");
  return err;
}

function databaseError(code: string): pg.DatabaseError {
  const err = new pg.DatabaseError(`duplicate key ${CANARIES.payee}`, 100, "error");
  return Object.assign(err, {
    code,
    detail: `Key (payee)=(${CANARIES.payee}) already exists.`,
    where: `SQL statement ${CANARIES.message}`,
    schema: "public",
    table: "entries",
    constraint: "entries_payee_key",
  });
}

const TOKEN = `ya29.${CANARIES.token}`;

function gaxiosLike(): Record<string, unknown> {
  return {
    response: {
      status: 403,
      data: { error: { errors: [{ reason: "rateLimitExceeded", message: CANARIES.message }] } },
    },
    config: {
      headers: { Authorization: `Bearer ${TOKEN}` },
      url: `https://x.io/?q=${CANARIES.email}`,
    },
  };
}

describe("TP-3.4: sanitizeError", () => {
  it('TP-3.4: BudmonError("NOT_FOUND", 404) gives class BudmonError and key NOT_FOUND', () => {
    expect(sanitizeError(new BudmonError("NOT_FOUND", 404))).toMatchObject({
      class: "BudmonError",
      key: "NOT_FOUND",
    });
  });

  it("TP-3.4: a pg DatabaseError with code 23505 gives its class and code, and none of its detail", () => {
    const result = sanitizeError(databaseError("23505"));

    expect(result).toMatchObject({ class: "DatabaseError", code: "23505" });
    noCanary(result);
  });

  it("TP-3.4: a Node system error ECONNREFUSED gives code ECONNREFUSED", () => {
    const result = sanitizeError(Object.assign(new Error("x"), { code: "ECONNREFUSED" }));

    expect(result).toMatchObject({ class: "Error", code: "ECONNREFUSED" });
  });

  it("TP-3.4: a Gaxios-like error gives status 403 and reason rateLimitExceeded, never the token", () => {
    const result = sanitizeError(gaxiosLike());

    expect(result).toMatchObject({ status: 403, reason: "rateLimitExceeded" });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    noCanary(result);
  });

  it("TP-3.4: a stack line with canary text is dropped, the well-formed frames kept", () => {
    const err = withStack(new Error(CANARIES.message), [
      `Error: ${CANARIES.message}`,
      `continued message ${CANARIES.email}`,
      "    at handler (/app/dist/main/api.js:10:5)",
      `    at Object.<anonymous> (/app/x.js:1:2) ${CANARIES.payee} (extra)`,
      `    at ${CANARIES.token} (${CANARIES.email} (y):3:4)`,
      "    at node:internal/process/task_queues:105:5",
    ]);

    const result = sanitizeError(err);

    expect(result.frames).toEqual([
      "at handler (/app/dist/main/api.js:10:5)",
      "at node:internal/process/task_queues:105:5",
    ]);
    noCanary(result);
  });

  // Code review B-2: V8 puts the whole message at the top of `stack`, so message lines shaped like
  // frames would pass the frame rule unless the message part is skipped.
  it("TP-3.4: frame-shaped message lines carrying canaries never reach frames", () => {
    const err = new Error(
      `boom\n    at ${CANARIES.payee} (/app/${CANARIES.token}.js:1:2)\n    at ${CANARIES.message}`,
    );

    const result = sanitizeError(err);

    noCanary(result.frames);
    noCanary(result);
  });

  it("TP-3.4: an AggregateError gives class AggregateError and nothing from its errors", () => {
    const err = new AggregateError(
      [new Error(CANARIES.message), Object.assign(new Error("y"), { code: "ECONNRESET" })],
      CANARIES.payee,
    );

    const result = sanitizeError(err);

    expect(result.class).toBe("AggregateError");
    expect(result).not.toHaveProperty("code");
    noCanary(result);
  });

  it('TP-3.4: a thrown string "str" gives class NonError', () => {
    expect(sanitizeError("str")).toEqual({ class: "NonError", frames: [] });
  });

  it("TP-3.4: no canary anywhere across all of them", () => {
    const results = [
      sanitizeError(new BudmonError("NOT_FOUND", 404, CANARIES.message)),
      sanitizeError(databaseError("23505")),
      sanitizeError(gaxiosLike()),
      sanitizeError(new AggregateError([new Error(CANARIES.message)], CANARIES.payee)),
      sanitizeError(CANARIES.token),
    ];

    noCanary(results);
  });
});

describe("TP-3.17x: sanitizeError, further cases (F-33)", () => {
  it.each([
    ["err.status", { status: 503 }, 503],
    ["err.response.status", { response: { status: 429 } }, 429],
    ["err.statusCode", { statusCode: 404 }, 404],
  ])("TP-3.17x: status comes from %s", (_label, props, status) => {
    expect(sanitizeError(Object.assign(new Error("m"), props)).status).toBe(status);
  });

  it.each([
    ["99", 99],
    ["600", 600],
    ["a fraction", 404.5],
    ["a string", "404"],
  ])("TP-3.17x: a status of %s is left out", (_label, status) => {
    expect(sanitizeError(Object.assign(new Error("m"), { status }))).not.toHaveProperty("status");
  });

  it("TP-3.17x: the reason falls back to response.data.error.status", () => {
    const err = { response: { status: 403, data: { error: { status: "PERMISSION_DENIED" } } } };

    expect(sanitizeError(err)).toMatchObject({ status: 403, reason: "PERMISSION_DENIED" });
  });

  it("TP-3.17x: a reason that fails the token rule falls back, then is left out", () => {
    const fallback = {
      response: { data: { error: { errors: [{ reason: "has space" }], status: "UNAVAILABLE" } } },
    };
    const neither = {
      response: { data: { error: { errors: [{ reason: CANARIES.email }], status: "a b" } } },
    };

    expect(sanitizeError(fallback).reason).toBe("UNAVAILABLE");
    expect(sanitizeError(neither)).not.toHaveProperty("reason");
  });

  it("TP-3.17x: with frame-shaped message lines, the real frames are still kept", () => {
    const err = new Error(`boom\n    at ${CANARIES.payee} (/app/x.js:1:2)`);

    const frames = sanitizeError(err).frames;

    expect(frames.length).toBeGreaterThan(0);
    expect(frames.some((frame) => frame.includes("sanitize.test.ts"))).toBe(true);
    noCanary(frames);
  });

  it("TP-3.17x: at most 30 frames", () => {
    const frames = Array.from(
      { length: 40 },
      (_v, i) => `    at f${String(i)} (/app/a.js:${String(i + 1)}:1)`,
    );

    const result = sanitizeError(withStack(new Error("m"), ["Error: m", ...frames]));

    expect(result.frames).toHaveLength(30);
    expect(result.frames[0]).toBe("at f0 (/app/a.js:1:1)");
  });

  it("TP-3.17x: a frame without a location is kept when it matches the rule", () => {
    const result = sanitizeError(
      withStack(new Error("m"), ["Error: m", "    at async Promise.all"]),
    );

    expect(result.frames).toEqual(["at async Promise.all"]);
  });

  it("TP-3.17x: a code that is neither a SQLSTATE nor a system code is left out", () => {
    for (const code of ["23505X", "econnrefused", "has space", CANARIES.token]) {
      expect(sanitizeError(Object.assign(new Error("m"), { code }))).not.toHaveProperty("code");
    }
  });

  it("TP-3.17x: message, detail, where, parameters, config, cause and response.data never reach the result", () => {
    const err = Object.assign(new Error(CANARIES.message, { cause: new Error(CANARIES.token) }), {
      detail: CANARIES.payee,
      where: CANARIES.email,
      parameters: [CANARIES.amountMinor],
      config: { headers: { Authorization: TOKEN } },
      response: { status: 500, data: { body: CANARIES.email } },
      extra: CANARIES.payee,
    });

    const result = sanitizeError(err);

    expect(Object.keys(result).sort()).toEqual(["class", "frames", "status"]);
    noCanary(result);
  });

  it("TP-3.17x: a BudmonError's message isn't copied", () => {
    const result = sanitizeError(new BudmonError("CONFLICT", 409, CANARIES.message));

    expect(result).toMatchObject({ class: "BudmonError", key: "CONFLICT" });
    noCanary(result);
  });

  it.each([[null], [undefined], [42], [{}]])("TP-3.17x: %o gives class NonError", (value) => {
    expect(sanitizeError(value).class).toBe("NonError");
  });
});

describe("TP-3.9: stripQuery", () => {
  it("TP-3.9: https://x.io/a/b?app_id=1#f gives https://x.io/a/b", () => {
    expect(stripQuery("https://x.io/a/b?app_id=1#f")).toBe("https://x.io/a/b");
  });

  it("TP-3.9: nope gives [invalid-url]", () => {
    expect(stripQuery("nope")).toBe("[invalid-url]");
  });
});

describe("TP-3.18x: stripQuery, further cases (F-37)", () => {
  it.each([
    ["a port", "http://localhost:8080/v1/x?token=abc", "http://localhost:8080/v1/x"],
    ["user info", `https://u:${CANARIES.token}@x.io/a?b=1`, "https://x.io/a"],
    ["a fragment only", "https://x.io/a#frag", "https://x.io/a"],
    ["no query", "https://x.io/a/b", "https://x.io/a/b"],
  ])("TP-3.18x: a URL with %s", (_label, input, expected) => {
    expect(stripQuery(input)).toBe(expected);
  });

  it.each([[""], ["/relative/path?x=1"], ["http://"]])(
    "TP-3.18x: %j gives [invalid-url]",
    (input) => {
      expect(stripQuery(input)).toBe("[invalid-url]");
    },
  );
});
