// F-340 to F-345: the wire schemas, the API version, the error map, creates, lists and the meta
// contract. Extra cases TP-4.26x (these functions have no LLD test case of their own beyond TP-4.2
// to TP-4.6). IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it } from "vitest";
import {
  API_MAJOR,
  API_MINOR,
  API_VERSION,
  CreatedResultSchema,
  CurrencyCodeSchema,
  CursorSchema,
  InstantWire,
  MoneyAmount,
  MoneySchema,
  OutcomeSchema,
  PLATFORM_ERRORS,
  PlainDateWire,
  UuidSchema,
  contract,
  listInput,
  listOutput,
} from "../src/index.js";
import { arr, generate, obj } from "./fixtures/generate.js";

const ok = (schema: { safeParse(v: unknown): { success: boolean } }, v: unknown) =>
  schema.safeParse(v).success;

describe("TP-4.26x: F-340 wire schemas", () => {
  it.each([[0], [-9007199254740991], [9007199254740991], [123]])(
    "TP-4.26x: MoneyAmount accepts %d",
    (v) => {
      expect(ok(MoneyAmount, v)).toBe(true);
    },
  );

  it.each([[1.5], [9007199254740992], [-9007199254740992], ["1"], [Number.NaN]])(
    "TP-4.26x: MoneyAmount refuses %o",
    (v) => {
      expect(ok(MoneyAmount, v)).toBe(false);
    },
  );

  it("TP-4.26x: CurrencyCodeSchema and MoneySchema", () => {
    expect(ok(CurrencyCodeSchema, "EGP")).toBe(true);
    expect(ok(CurrencyCodeSchema, "egp")).toBe(false);
    expect(ok(CurrencyCodeSchema, "EG")).toBe(false);
    expect(ok(MoneySchema, { amount: 1050, currency: "EGP" })).toBe(true);
    expect(ok(MoneySchema, { amount: 10.5, currency: "EGP" })).toBe(false);
  });

  it.each([
    ["2026-02-28", true],
    ["2024-02-29", true],
    ["2026-02-29", false],
    ["2026-13-01", false],
    ["2026-1-01", false],
  ])("TP-4.26x: PlainDateWire %s is valid: %s", (v, valid) => {
    expect(ok(PlainDateWire, v)).toBe(valid);
  });

  it.each([
    ["2026-10-05T12:00:00.000Z", true],
    ["2026-10-05T12:00:00+02:00", false],
    ["2026-10-05", false],
  ])("TP-4.26x: InstantWire %s is valid: %s", (v, valid) => {
    expect(ok(InstantWire, v)).toBe(valid);
  });

  it("TP-4.26x: UuidSchema takes lower-case UUIDs", () => {
    expect(ok(UuidSchema, "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0b")).toBe(true);
    expect(ok(UuidSchema, "not-a-uuid")).toBe(false);
  });
});

describe("TP-4.26x: F-341 API version", () => {
  it("TP-4.26x: API_VERSION is 1.<API_MINOR>", () => {
    expect(API_MAJOR).toBe(1);
    expect(Number.isInteger(API_MINOR) && API_MINOR >= 0).toBe(true);
    expect(API_VERSION).toBe(`1.${String(API_MINOR)}`);
  });
});

describe("TP-4.26x: F-342 error map", () => {
  it("TP-4.26x: PLATFORM_ERRORS has §6's keys and statuses", () => {
    const statuses = Object.fromEntries(
      Object.entries(PLATFORM_ERRORS as Record<string, { status?: number }>).map(([k, v]) => [
        k,
        v.status,
      ]),
    );

    expect(statuses).toEqual({
      VALIDATION_FAILED: 400,
      CLIENT_UPDATE_REQUIRED: 400,
      UNAUTHENTICATED: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      CONFLICT: 409,
      IDEMPOTENCY_KEY_REUSED: 409,
      PAYLOAD_TOO_LARGE: 413,
      RATE_LIMITED: 429,
      INTERNAL: 500,
      SERVICE_UNAVAILABLE: 503,
    });
  });

  it("TP-4.26x: OutcomeSchema is not_applied or unknown", () => {
    expect(OutcomeSchema.options).toEqual(["not_applied", "unknown"]);
  });
});

describe("TP-4.26x: F-343 and F-344 creates and lists", () => {
  it("TP-4.26x: CreatedResultSchema is { id: uuid, createdAt: instant }", () => {
    expect(
      ok(CreatedResultSchema, {
        id: "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0b",
        createdAt: "2026-10-05T12:00:00.000Z",
      }),
    ).toBe(true);
    expect(ok(CreatedResultSchema, { id: "x", createdAt: "2026-10-05T12:00:00.000Z" })).toBe(false);
  });

  it("TP-4.26x: listInput defaults limit to 50 and bounds it to 1..100; the cursor is at most 512 characters", () => {
    const input = listInput({});

    expect(input.parse({})).toEqual({ limit: 50 });
    expect(ok(input, { limit: 0 })).toBe(false);
    expect(ok(input, { limit: 101 })).toBe(false);
    expect(ok(input, { limit: 100, cursor: "c".repeat(512) })).toBe(true);
    expect(ok(input, { cursor: "c".repeat(513) })).toBe(false);
    expect(ok(CursorSchema, "abc")).toBe(true);
  });

  it("TP-4.26x: listOutput is { items, nextCursor: string | null }", () => {
    const output = listOutput(UuidSchema);

    expect(ok(output, { items: [], nextCursor: null })).toBe(true);
    expect(ok(output, { items: [] })).toBe(false);
  });

  it("TP-4.26x: a create route is POST, 201, with a required uuid Idempotency-Key header and x-budmon-kind create", async () => {
    const { createRoute } = await import("../src/index.js");
    const doc = await generate({ make: createRoute("/things") });
    const post = obj(doc, "paths", "/things", "post");

    expect(post["x-budmon-kind"]).toBe("create");
    expect(Object.keys(obj(post, "responses"))).toContain("201");
    const header = arr(post, "parameters")
      .map((p) => obj(p))
      .find((p) => p["name"] === "Idempotency-Key");
    expect(header).toMatchObject({ in: "header", required: true });
    expect(obj(header, "schema")).toMatchObject({ type: "string", format: "uuid" });
  });
});

describe("TP-4.26x: F-345 and F-346 the meta contract", () => {
  it("TP-4.26x: the contract root has meta.clientConfig, GET /meta/client-config", async () => {
    const doc = await generate(contract);

    expect(Object.keys(contract)).toContain("meta");
    expect(Object.keys(obj(doc, "paths", "/meta/client-config"))).toEqual(["get"]);
  });
});
