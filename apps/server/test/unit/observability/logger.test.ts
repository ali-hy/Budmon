// F-31 createLogger. TP-3.2, plus extra cases TP-3.15x (the line's fixed keys, levels, child
// bindings and the error shape). IDs ending in "x" are test-architect additions, not LLD
// test-plan IDs.
import { CANARIES, scanForCanaries } from "@budmon/test-support";
import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../../../src/platform/observability/logger.js";
import type { SafeFields } from "../../../src/platform/observability/safeFields.js";
import { logCapture } from "../../support/telemetry.js";

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const SANITIZED_ERROR_KEYS = ["class", "key", "code", "status", "reason", "frames"];

function setup(level: "debug" | "info" | "warn" | "error" = "debug") {
  const capture = logCapture();
  const onDrop = vi.fn<(n: number) => void>();
  const logger = createLogger({
    service: "api",
    release: "v1.2.3",
    level,
    destination: capture,
    onDrop,
  });
  return { capture, onDrop, logger };
}

/** Fields the type system would refuse, as a caller bypassing it would pass them. */
function untyped(fields: Record<string, unknown>): SafeFields {
  return fields;
}

describe("TP-3.2: createLogger", () => {
  it("TP-3.2: an invalid event and an unknown field are written as invalid_event, dropped: 2, onDrop(2)", () => {
    const { capture, onDrop, logger } = setup();

    logger.info("Bad Event!", untyped({ payee: CANARIES.payee }));

    const [line] = capture.records();
    expect(capture.records()).toHaveLength(1);
    expect(line?.["event"]).toBe("invalid_event");
    expect(line?.["dropped"]).toBe(2);
    expect(line).not.toHaveProperty("payee");
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledWith(2);
  });

  it("TP-3.2: error with an Error writes err.class Error and never the message", () => {
    const { capture, logger } = setup();

    logger.error("x_failed", {}, new Error(CANARIES.message));

    const [line] = capture.records();
    expect(line?.["event"]).toBe("x_failed");
    expect(line?.["level"]).toBe("error");
    expect((line?.["err"] as Record<string, unknown> | undefined)?.["class"]).toBe("Error");
  });

  it("TP-3.2: no canary reaches any line", () => {
    const { capture, logger } = setup();

    logger.info("Bad Event!", untyped({ payee: CANARIES.payee }));
    logger.error("x_failed", {}, new Error(CANARIES.message));

    expect(capture.lines()).toHaveLength(2);
    expect(scanForCanaries([{ name: "log", text: capture.text() }], CANARIES)).toEqual([]);
  });
});

describe("TP-3.15x: createLogger, further cases (F-31)", () => {
  it("TP-3.15x: a line holds the fixed keys and the sanitised fields, and nothing else", () => {
    const { capture, logger } = setup();

    logger.info("entry_created", { userId: "u1", count: 2 });

    const [line] = capture.records();
    expect(Object.keys(line ?? {}).sort()).toEqual(
      ["level", "time", "service", "release", "event", "userId", "count"].sort(),
    );
    expect(line).toMatchObject({
      level: "info",
      service: "api",
      release: "v1.2.3",
      event: "entry_created",
      userId: "u1",
      count: 2,
    });
    expect(line?.["time"]).toMatch(ISO_UTC);
  });

  it("TP-3.15x: one JSON line per call", () => {
    const { capture, logger } = setup();

    logger.debug("a_event");
    logger.info("b_event");
    logger.warn("c_event");
    logger.error("d_event");

    expect(capture.records().map((r) => [r["level"], r["event"]])).toEqual([
      ["debug", "a_event"],
      ["info", "b_event"],
      ["warn", "c_event"],
      ["error", "d_event"],
    ]);
  });

  it("TP-3.15x: calls below the configured level are not written", () => {
    const { capture, logger } = setup("warn");

    logger.debug("a_event");
    logger.info("b_event");
    logger.warn("c_event");
    logger.error("d_event");

    expect(capture.records().map((r) => r["event"])).toEqual(["c_event", "d_event"]);
  });

  it("TP-3.15x: a child's bindings appear on its lines", () => {
    const { capture, logger } = setup();

    logger.child({ requestId: "r1" }).info("child_event", { userId: "u1" });

    expect(capture.records()[0]).toMatchObject({
      event: "child_event",
      requestId: "r1",
      userId: "u1",
    });
  });

  it("TP-3.15x: nothing dropped means no dropped key and no onDrop call", () => {
    const { capture, onDrop, logger } = setup();

    logger.info("clean_event", { userId: "u1" });

    expect(capture.records()[0]).not.toHaveProperty("dropped");
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("TP-3.15x: an invalid known field value is [invalid] and counted", () => {
    const { capture, onDrop, logger } = setup();

    logger.info("x_event", untyped({ count: -1 }));

    expect(capture.records()[0]).toMatchObject({ count: "[invalid]", dropped: 1 });
    expect(onDrop).toHaveBeenCalledWith(1);
  });

  it("TP-3.15x: warn with an error writes F-33's sanitised error, with no message, stack or cause", () => {
    const { capture, logger } = setup();
    const err = Object.assign(new Error(CANARIES.message, { cause: new Error(CANARIES.token) }), {
      code: "ECONNREFUSED",
      detail: CANARIES.email,
    });

    logger.warn("db_retry", {}, err);

    const errField = capture.records()[0]?.["err"] as Record<string, unknown>;
    expect(errField).toMatchObject({ class: "Error", code: "ECONNREFUSED" });
    expect(Array.isArray(errField["frames"])).toBe(true);
    for (const key of Object.keys(errField)) expect(SANITIZED_ERROR_KEYS).toContain(key);
    expect(scanForCanaries([{ name: "log", text: capture.text() }], CANARIES)).toEqual([]);
  });

  it("TP-3.15x: a field holding a canary under a known key with an invalid shape is not written", () => {
    const { capture, logger } = setup();

    logger.info("x_event", untyped({ userId: CANARIES.email, route: `/a?t=${CANARIES.token}` }));

    expect(capture.records()[0]).toMatchObject({ userId: "[invalid]", route: "[invalid]" });
    expect(scanForCanaries([{ name: "log", text: capture.text() }], CANARIES)).toEqual([]);
  });

  it("TP-3.15x: bad input never throws", () => {
    const { logger } = setup();

    expect(() => {
      logger.error("", untyped({ x: Symbol("s"), userId: 1n }), "not an error");
    }).not.toThrow();
  });
});
