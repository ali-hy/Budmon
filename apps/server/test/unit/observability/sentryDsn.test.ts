// F-34 initSentry with an invalid DSN (A-131). TP-3.18: the no-op reporter, Sentry never
// initialised, nothing written to the console, stdout or stderr, and the key nowhere.
import * as Sentry from "@sentry/node";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initSentry } from "../../../src/platform/observability/sentry.js";

const BAD_DSN = "https://pub:SECRETKEYabc@o1.ingest.sentry.io/";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TP-3.18: initSentry with an invalid DSN", () => {
  it("TP-3.18: returns the no-op reporter, doesn't initialise Sentry and writes nothing", async () => {
    const written: string[] = [];
    const capture = (...args: unknown[]) => {
      written.push(args.map(String).join(" "));
    };
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation(capture);
    }
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    });

    const reporter = initSentry({
      dsn: BAD_DSN,
      environment: "production",
      release: "v1.2.3",
      service: "api",
    });
    reporter.report(new Error("x"), {});
    await reporter.flush(100);
    vi.restoreAllMocks();

    expect(Sentry.getClient()).toBeUndefined();
    expect(written).toEqual([]);
    expect(JSON.stringify(reporter)).not.toContain("SECRETKEYabc");
  });
});
