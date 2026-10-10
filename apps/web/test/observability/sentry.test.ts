// F-217 web Sentry: init options and scrubbing. TP-11.25, plus extra cases TP-11.32x. IDs ending in
// "x" are test-architect additions, not LLD test-plan IDs.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadSentry } from "../support/s11b.js";

const sentry = vi.hoisted(() => ({ init: vi.fn() }));
vi.mock("@sentry/solid", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  init: sentry.init,
}));

// A privacy canary (F-198's shape) standing in for user data in an error message.
const CANARY = "CANARY-web-tp-11-25-7f3a";

interface InitOptions {
  dsn?: string;
  release?: string;
  environment?: string;
  sendDefaultPii?: boolean;
  dataCollection?: Record<string, unknown>;
  integrations?: unknown;
  beforeSend?: (e: Record<string, unknown>, hint?: unknown) => unknown;
  beforeBreadcrumb?: (b: Record<string, unknown>, hint?: unknown) => unknown;
  replaysSessionSampleRate?: number;
  replaysOnErrorSampleRate?: number;
}

beforeEach(() => {
  sentry.init.mockClear();
});

async function initOptions(): Promise<InitOptions> {
  const { initWebSentry } = await loadSentry();
  initWebSentry({ dsn: "https://k@o1.ingest.sentry.io/2", release: "web@7", environment: "test" });
  expect(sentry.init).toHaveBeenCalledTimes(1);
  return sentry.init.mock.calls[0]?.[0] as InitOptions;
}

function integrationNames(integrations: unknown): string[] {
  const list: unknown =
    typeof integrations === "function"
      ? // Defaults that include what must be removed, so the filter is exercised.
        (integrations as (d: unknown[]) => unknown)([
          { name: "Breadcrumbs" },
          { name: "Replay" },
          { name: "BrowserTracing" },
        ])
      : integrations;
  return Array.isArray(list)
    ? list.map((i) => {
        const name = (i as { name?: unknown }).name;
        return typeof name === "string" ? name : "";
      })
    : [];
}

describe("TP-11.25: web Sentry scrubbing (F-217)", () => {
  it("TP-11.25: scrubWebEvent strips the query from request.url and replaces exception.value (a canary)", async () => {
    const { scrubWebEvent } = await loadSentry();
    const event = {
      event_id: "0123456789abcdef0123456789abcdef",
      request: { url: "https://budmon.example/api/v1/things?token=abc&q=" + CANARY },
      exception: { values: [{ type: "TypeError", value: `Cannot read ${CANARY}` }] },
    };

    const scrubbed = scrubWebEvent(event);

    expect(scrubbed).not.toBeNull();
    const text = JSON.stringify(scrubbed);
    expect(text).not.toContain(CANARY);
    expect(text).not.toContain("token=abc");
    const url = (scrubbed?.["request"] as { url?: string } | undefined)?.url ?? "";
    expect(url).not.toContain("?");
    expect(url).toMatch(/\/api\/v1\/things$/);
    const values = (scrubbed?.["exception"] as { values?: { value?: string }[] } | undefined)
      ?.values;
    expect(values?.[0]?.value).toBe("TypeError");
  });

  it("TP-11.32x: the transaction name loses its query", async () => {
    const { scrubWebEvent } = await loadSentry();

    const scrubbed = scrubWebEvent({ transaction: `/things?q=${CANARY}` });

    expect(JSON.stringify(scrubbed)).not.toContain(CANARY);
  });

  it("TP-11.25 (A-371): init options: dataCollection with every flag off, no sendDefaultPii key, no Replay or browser tracing, release and environment as given, beforeSend and beforeBreadcrumb set", async () => {
    const options = await initOptions();

    expect(options.dsn).toBe("https://k@o1.ingest.sentry.io/2");
    expect(options.release).toBe("web@7");
    expect(options.environment).toBe("test");
    expect(Object.keys(options)).not.toContain("sendDefaultPii");
    const collection = options.dataCollection;
    expect(collection).toBeDefined();
    for (const [flag, value] of Object.entries(collection ?? {})) {
      const off = value === false || value === 0 || (Array.isArray(value) && value.length === 0);
      expect(off, `dataCollection.${flag} = ${JSON.stringify(value)}`).toBe(true);
    }
    const names = integrationNames(options.integrations);
    expect(names.filter((n) => /replay|tracing/i.test(n))).toEqual([]);
    expect(options.replaysSessionSampleRate ?? 0).toBe(0);
    expect(options.replaysOnErrorSampleRate ?? 0).toBe(0);
    expect(options.beforeSend).toBeTypeOf("function");
    expect(options.beforeBreadcrumb).toBeTypeOf("function");

    const sent = options.beforeSend?.({
      request: { url: `https://budmon.example/x?q=${CANARY}` },
    });
    expect(JSON.stringify(sent)).not.toContain(CANARY);
  });

  it("TP-11.25 (A-371): without a DSN, init isn't called", async () => {
    const { initWebSentry } = await loadSentry();

    initWebSentry({ release: "web@7", environment: "test" });

    expect(sentry.init).not.toHaveBeenCalled();
  });

  it("TP-11.32x: beforeBreadcrumb keeps navigation and fetch/xhr with the URL path only, and drops other categories", async () => {
    const options = await initOptions();
    const crumb = options.beforeBreadcrumb;
    expect(crumb).toBeTypeOf("function");
    if (crumb === undefined) return;

    expect(crumb({ category: "console", message: CANARY })).toBeNull();
    expect(crumb({ category: "ui.click", message: CANARY })).toBeNull();
    for (const category of ["fetch", "xhr"]) {
      const kept = crumb({
        category,
        data: { method: "GET", url: `https://budmon.example/api/v1/things?q=${CANARY}` },
      });
      expect(kept).not.toBeNull();
      expect(JSON.stringify(kept)).not.toContain(CANARY);
      expect(JSON.stringify(kept)).toContain("/api/v1/things");
    }
    const nav = crumb({ category: "navigation", data: { from: "/a?x=1", to: `/b?q=${CANARY}` } });
    expect(nav).not.toBeNull();
    expect(JSON.stringify(nav)).not.toContain(CANARY);
  });
});
