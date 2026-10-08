// The privacy canary suite (LLD §10.1). TP-3.10: the baseline flow. An error carrying every canary
// in its message, cause and properties goes through the logger (F-31) and the error reporter
// (F-34's memory reporter); nothing captured contains a canary. Later slices add their flows to
// this directory (TP-4.9, TP-5.2, TP-6.7, TP-8.12, TP-9.11).
import { CANARIES, scanForCanaries, type Canaries } from "@budmon/test-support";
import { describe, expect, it } from "vitest";
import { createMemoryErrorReporter } from "../../src/platform/observability/errorReporter.js";
import { createLogger } from "../../src/platform/observability/logger.js";
import type { SafeFields } from "../../src/platform/observability/safeFields.js";
import { logCapture } from "../support/telemetry.js";

function allCanaries(): string {
  return (Object.keys(CANARIES) as (keyof Canaries)[]).map((k) => CANARIES[k]).join(" ");
}

/** An error with every canary in its message, its cause chain and its own properties. */
function canaryError(): Error {
  const cause = Object.assign(new Error(`cause ${allCanaries()}`), {
    detail: allCanaries(),
    code: CANARIES.token,
  });
  const inner = new AggregateError([new Error(allCanaries())], `aggregate ${allCanaries()}`);
  return Object.assign(new Error(`failed: ${allCanaries()}`, { cause }), {
    ...CANARIES,
    detail: allCanaries(),
    where: allCanaries(),
    parameters: Object.values(CANARIES),
    config: { headers: { Authorization: `Bearer ${CANARIES.token}` }, data: allCanaries() },
    response: { status: 500, data: { error: { message: allCanaries() } } },
    errors: [inner],
  });
}

describe("TP-3.10: baseline canary flow", () => {
  it("TP-3.10: the logger and the reporter capture nothing that scanForCanaries finds", () => {
    const capture = logCapture();
    const logger = createLogger({
      service: "api",
      release: "v1.2.3",
      level: "debug",
      destination: capture,
    });
    const reporter = createMemoryErrorReporter();
    const err = canaryError();
    // A caller bypassing the types, with canaries in unknown and known-but-invalid fields.
    const fields = {
      payee: CANARIES.payee,
      email: CANARIES.email,
      userId: CANARIES.email,
      route: `/x?token=${CANARIES.token}`,
      reason: allCanaries(),
    } as unknown as SafeFields;

    logger.error("op_failed", fields, err);
    logger.warn("op_retry", fields, err);
    logger.child(fields).info("op_child", fields);
    reporter.report(err, { requestId: "r1", route: "/v1/entries/{id}", errorKey: "CONFLICT" });

    expect(capture.lines().length).toBeGreaterThanOrEqual(3);
    expect(reporter.events).toHaveLength(1);
    const hits = scanForCanaries(
      [
        { name: "logs", text: capture.text() },
        { name: "reporter", text: JSON.stringify(reporter.events) },
      ],
      CANARIES,
    );
    expect(hits).toEqual([]);
  });
});
