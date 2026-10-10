// F-217: web Sentry with F-35's allowlist: no PII, no Replay, no browser tracing.
import * as Sentry from "@sentry/solid";

type Json = Record<string, unknown>;

const ERROR_KEY = /^[A-Z][A-Z0-9_]{1,63}$/;
const FRAME_FUNCTION = /^(?:(?:async|new) )?[A-Za-z_$][A-Za-z0-9_$.<>[\]]{0,99}$/;
const FRAME_FILENAME = /^[A-Za-z0-9_@./<>:-]{1,200}$/;
const HEX32 = /^[0-9a-f]{32}$/;
const HEX16 = /^[0-9a-f]{16}$/;

function isObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A URL without its query or fragment (kept relative when it was). */
export function stripToPath(url: string): string {
  return url.replace(/[?#].*$/s, "");
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function scrubFrames(stacktrace: unknown): Json | undefined {
  if (!isObject(stacktrace) || !Array.isArray(stacktrace["frames"])) return undefined;
  const frames = (stacktrace["frames"] as unknown[]).filter(isObject).flatMap((f) => {
    const filename = str(f["filename"]);
    const fn = str(f["function"]);
    if (filename !== undefined && !FRAME_FILENAME.test(stripToPath(filename))) return [];
    if (fn !== undefined && !FRAME_FUNCTION.test(fn)) return [];
    const out: Json = {};
    if (filename !== undefined) out["filename"] = stripToPath(filename);
    if (fn !== undefined) out["function"] = fn;
    for (const k of ["lineno", "colno"]) if (typeof f[k] === "number") out[k] = f[k];
    if (typeof f["in_app"] === "boolean") out["in_app"] = f["in_app"];
    return [out];
  });
  return { frames };
}

/** F-35's breadcrumb rule for the web: navigation and fetch/xhr only, URLs reduced to the path. */
export function scrubWebBreadcrumb(b: Json): Json | null {
  const category = str(b["category"]);
  if (category !== "navigation" && category !== "fetch" && category !== "xhr") return null;
  const out: Json = { category };
  for (const k of ["timestamp", "type", "level"]) if (b[k] !== undefined) out[k] = b[k];
  const data = isObject(b["data"]) ? b["data"] : {};
  const kept: Json = {};
  for (const k of ["url", "from", "to"]) {
    const v = str(data[k]);
    if (v !== undefined) kept[k] = stripToPath(v);
  }
  const method = str(data["method"]);
  if (method !== undefined && /^[A-Z]{1,10}$/.test(method)) kept["method"] = method;
  if (typeof data["status_code"] === "number") kept["status_code"] = data["status_code"];
  if (Object.keys(kept).length > 0) out["data"] = kept;
  return out;
}

/** F-35's allowlist, plus the request URL and transaction without their queries. */
export function scrubWebEvent(e: Json): Json | null {
  const out: Json = {};
  for (const k of ["event_id", "timestamp", "platform", "level", "release", "environment"]) {
    if (e[k] !== undefined) out[k] = e[k];
  }
  const transaction = str(e["transaction"]);
  if (transaction !== undefined) out["transaction"] = stripToPath(transaction);
  if (isObject(e["request"])) {
    const url = str(e["request"]["url"]);
    if (url !== undefined) out["request"] = { url: stripToPath(url) };
  }
  if (isObject(e["exception"]) && Array.isArray(e["exception"]["values"])) {
    out["exception"] = {
      values: (e["exception"]["values"] as unknown[]).filter(isObject).map((v) => {
        const type = str(v["type"]) ?? "Error";
        const value = str(v["value"]);
        // Never the message: the error key when it is one, else the class name.
        const entry: Json = {
          type,
          value: value !== undefined && ERROR_KEY.test(value) ? value : type,
        };
        const stacktrace = scrubFrames(v["stacktrace"]);
        if (stacktrace !== undefined) entry["stacktrace"] = stacktrace;
        return entry;
      }),
    };
  }
  const trace = isObject(e["contexts"]) ? e["contexts"]["trace"] : undefined;
  if (isObject(trace)) {
    const traceId = str(trace["trace_id"]);
    const spanId = str(trace["span_id"]);
    const kept: Json = {};
    if (traceId !== undefined && HEX32.test(traceId)) kept["trace_id"] = traceId;
    if (spanId !== undefined && HEX16.test(spanId)) kept["span_id"] = spanId;
    if (Object.keys(kept).length > 0) out["contexts"] = { trace: kept };
  }
  const crumbs = e["breadcrumbs"];
  const list = Array.isArray(crumbs)
    ? crumbs
    : isObject(crumbs) && Array.isArray(crumbs["values"])
      ? (crumbs["values"] as unknown[])
      : undefined;
  if (list !== undefined) {
    out["breadcrumbs"] = list
      .filter(isObject)
      .map(scrubWebBreadcrumb)
      .filter((b): b is Json => b !== null);
  }
  return out;
}

export function initWebSentry(cfg: { dsn?: string; release: string; environment: string }): void {
  if (cfg.dsn === undefined || cfg.dsn === "") return;
  const options = {
    dsn: cfg.dsn,
    release: cfg.release,
    environment: cfg.environment,
    // F-217 names sendDefaultPii; Sentry 11 dropped it for dataCollection, which does the work.
    // It's passed too, so the intent stays visible in the options.
    sendDefaultPii: false,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
      frameContextLines: 0,
    },
    // The defaults only: no browser tracing (no client spans, D-24) and no Replay.
    integrations: (defaults: { name: string }[]) =>
      defaults.filter((i) => !/replay|tracing/i.test(i.name)),
    beforeSend: (event: unknown) => scrubWebEvent(event as Json),
    beforeBreadcrumb: (crumb: unknown) => scrubWebBreadcrumb(crumb as Json),
  };
  Sentry.init(options as unknown as Parameters<typeof Sentry.init>[0]);
}
