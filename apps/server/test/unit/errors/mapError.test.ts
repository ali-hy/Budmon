// F-52 mapError. TP-4.9, plus extra cases TP-4.34x (every zod code's fixed message, the other
// oRPC built-ins, every database-unavailable code). IDs ending in "x" are test-architect additions,
// not LLD test-plan IDs.
import { ValidationError } from "@orpc/contract";
import { ORPCError } from "@orpc/server";
import { CANARIES, scanForCanaries } from "@budmon/test-support";
import { describe, expect, it } from "vitest";
import { BudmonError } from "../../../src/platform/errors/BudmonError.js";
import { mapError } from "../../../src/platform/errors/interceptor.js";
import { RateLimitedError } from "../../../src/platform/errors/platformErrors.js";

const NOT_COMMITTED = { committed: false };
const COMMITTED = { committed: true };

function envelope(error: ORPCError<string, unknown>) {
  return {
    defined: error.defined,
    code: error.code,
    status: error.status,
    message: error.message,
    data: error.data,
  };
}

function noCanary(value: unknown): void {
  expect(scanForCanaries([{ name: "error", text: JSON.stringify(value) }], CANARIES)).toEqual([]);
}

function inputValidationError(
  issues: { code: string; path: (string | number)[]; message: string; input?: unknown }[],
): ORPCError<string, unknown> {
  return new ORPCError("BAD_REQUEST", {
    message: "Input validation failed",
    cause: new ValidationError({ message: "Input validation failed", issues }),
  });
}

function pgError(code: string): Error {
  return Object.assign(new Error(`terminating connection ${CANARIES.message}`), {
    code,
    severity: "FATAL",
  });
}

describe("TP-4.9: mapError", () => {
  it("TP-4.9: a BudmonError keeps its key, status, message and details; not reported", () => {
    const { error, report } = mapError(
      new BudmonError("CONFLICT", 409, "Conflict", { field: "name" }),
      NOT_COMMITTED,
    );

    expect(envelope(error)).toEqual({
      defined: true,
      code: "CONFLICT",
      status: 409,
      message: "Conflict",
      data: { field: "name" },
    });
    expect(report).toBe(false);
  });

  it("TP-4.9: an input validation failure is VALIDATION_FAILED with fixed issue messages and no canary", () => {
    const { error, report } = mapError(
      inputValidationError([
        {
          code: "invalid_type",
          path: ["payee"],
          message: `Expected number, received "${CANARIES.payee}"`,
          input: CANARIES.payee,
        },
      ]),
      NOT_COMMITTED,
    );

    expect(envelope(error)).toEqual({
      defined: true,
      code: "VALIDATION_FAILED",
      status: 400,
      message: "Validation failed",
      data: { issues: [{ path: ["payee"], code: "invalid_type", message: "Invalid type" }] },
    });
    expect(error.cause).toBeUndefined();
    expect(report).toBe(false);
    noCanary(envelope(error));
  });

  it("TP-4.9: an output validation failure (committed) is INTERNAL { outcome: unknown }, reported", () => {
    const err = new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "Output validation failed",
      cause: new ValidationError({
        message: "Output validation failed",
        issues: [{ path: ["amount"], message: `bad ${CANARIES.amountMinor}` }],
      }),
    });

    const { error, report } = mapError(err, COMMITTED);

    expect(envelope(error)).toEqual({
      defined: true,
      code: "INTERNAL",
      status: 500,
      message: "Internal error",
      data: { outcome: "unknown" },
    });
    expect(report).toBe(true);
  });

  it("TP-4.9: oRPC NOT_FOUND is NOT_FOUND 404, not reported", () => {
    const { error, report } = mapError(new ORPCError("NOT_FOUND"), NOT_COMMITTED);

    expect(envelope(error)).toEqual({
      defined: true,
      code: "NOT_FOUND",
      status: 404,
      message: "Not found",
      data: undefined,
    });
    expect(report).toBe(false);
  });

  it("TP-4.9: pg 57P01 is SERVICE_UNAVAILABLE 503 { outcome }, reported", () => {
    const { error, report } = mapError(pgError("57P01"), NOT_COMMITTED);

    expect(envelope(error)).toEqual({
      defined: true,
      code: "SERVICE_UNAVAILABLE",
      status: 503,
      message: "Service unavailable",
      data: { outcome: "not_applied" },
    });
    expect(report).toBe(true);
    noCanary(envelope(error));
  });

  it.each([
    ["not committed", NOT_COMMITTED, "not_applied"],
    ["committed", COMMITTED, "unknown"],
  ] as const)(
    "TP-4.9: a plain Error (%s) is INTERNAL { outcome: %s }, reported",
    (_l, state, outcome) => {
      const { error, report } = mapError(new Error(CANARIES.message), state);

      expect(envelope(error)).toEqual({
        defined: true,
        code: "INTERNAL",
        status: 500,
        message: "Internal error",
        data: { outcome },
      });
      expect(report).toBe(true);
      noCanary(envelope(error));
    },
  );
});

describe("TP-4.9: contract-defined oRPC errors (A-149)", () => {
  it("TP-4.9: a defined CONFLICT passes through with its status and data, not reported", () => {
    const err = new ORPCError("CONFLICT", { status: 409, data: { reason: "x" }, defined: true });

    const { error, report } = mapError(err, NOT_COMMITTED);

    expect([error.defined, error.code, error.status, error.data]).toEqual([
      true,
      "CONFLICT",
      409,
      { reason: "x" },
    ]);
    expect(report).toBe(false);
  });

  it("TP-4.9: the same error without defined is NOT_FOUND 404", () => {
    const { error, report } = mapError(
      new ORPCError("CONFLICT", { status: 409, data: { reason: "x" } }),
      NOT_COMMITTED,
    );

    expect([error.code, error.status, report]).toEqual(["NOT_FOUND", 404, false]);
  });
});

describe("TP-4.34x: mapError, further cases (F-52)", () => {
  it.each([
    ["invalid_type", "Invalid type"],
    ["too_small", "Too small"],
    ["too_big", "Too big"],
    ["invalid_format", "Invalid format"],
    ["invalid_value", "Invalid value"],
    ["unrecognized_keys", "Unknown field"],
    ["custom", "Invalid value"],
    ["invalid_union", "Invalid value"],
  ])("TP-4.34x: zod code %s gets the fixed message %j", (code, message) => {
    const { error } = mapError(
      inputValidationError([{ code, path: ["a", 0], message: CANARIES.message }]),
      NOT_COMMITTED,
    );

    expect((error.data as { issues: unknown[] }).issues).toEqual([
      { path: ["a", 0], code, message },
    ]);
  });

  it.each([["METHOD_NOT_SUPPORTED"], ["NOT_ACCEPTABLE"]])(
    "TP-4.34x: oRPC %s is NOT_FOUND 404",
    (code) => {
      const { error, report } = mapError(new ORPCError(code), NOT_COMMITTED);

      expect([error.code, error.status, report]).toEqual(["NOT_FOUND", 404, false]);
    },
  );

  it.each([
    ["57P01"],
    ["57P02"],
    ["57P03"],
    ["53300"],
    ["ECONNREFUSED"],
    ["ETIMEDOUT"],
    ["ECONNRESET"],
  ])("TP-4.34x: %s is SERVICE_UNAVAILABLE, with outcome unknown once committed", (code) => {
    const { error } = mapError(pgError(code), COMMITTED);

    expect([error.code, error.status, error.data]).toEqual([
      "SERVICE_UNAVAILABLE",
      503,
      { outcome: "unknown" },
    ]);
  });

  it("TP-4.34x: another SQLSTATE (23505) is INTERNAL", () => {
    expect(mapError(pgError("23505"), NOT_COMMITTED).error.code).toBe("INTERNAL");
  });

  it("TP-4.34x: a RateLimitedError is RATE_LIMITED 429 with retryAfterSeconds, not reported", () => {
    const { error, report } = mapError(new RateLimitedError(30), NOT_COMMITTED);

    expect(envelope(error)).toEqual({
      defined: true,
      code: "RATE_LIMITED",
      status: 429,
      message: "Too many requests",
      data: { retryAfterSeconds: 30 },
    });
    expect(report).toBe(false);
  });

  it("TP-4.34x: a thrown non-Error is INTERNAL", () => {
    expect(mapError(CANARIES.message, NOT_COMMITTED).error.code).toBe("INTERNAL");
  });
});
