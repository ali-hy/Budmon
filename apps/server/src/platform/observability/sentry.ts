// F-34 initSentry and F-35's scrubbers: the only fields that may reach Sentry.
import * as Sentry from "@sentry/node";
import type { AppEnv } from "../config/schema.js";
import { buildErrorEvent, type ErrorReporter } from "./errorReporter.js";
import { ERROR_KEY } from "./safeFields.js";
import { stripQuery } from "./sanitize.js";

type Json = Record<string, unknown>;

function record(value: unknown): Json | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : undefined;
}

function pick(source: Json | undefined, keys: readonly string[]): Json {
  const out: Json = {};
  if (source === undefined) return out;
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

const EVENT_KEYS = ["event_id", "timestamp", "platform", "level", "release", "environment"];
const FRAME_KEYS = ["filename", "function", "lineno", "colno", "in_app"];
const TAG_KEYS = ["route", "job", "client_kind", "error_key"];

export function scrubBreadcrumb(b: Record<string, unknown>): Record<string, unknown> | null {
  const category = b["category"];
  if (category !== "http" && category !== "navigation") return null;
  const out: Json = { category, ...pick(b, ["timestamp", "type", "level"]) };
  const data = record(b["data"]);
  if (data !== undefined) {
    const kept: Json = {};
    if (typeof data["url"] === "string") kept["url"] = stripQuery(data["url"]);
    if (data["method"] !== undefined) kept["method"] = data["method"];
    if (data["status_code"] !== undefined) kept["status_code"] = data["status_code"];
    out["data"] = kept;
  }
  return out;
}

export function scrubSentryEvent(event: Record<string, unknown>): Record<string, unknown> | null {
  const out: Json = pick(event, EVENT_KEYS);

  const exception = record(event["exception"]);
  const values = exception?.["values"];
  if (Array.isArray(values)) {
    out["exception"] = {
      values: values.map((raw: unknown) => {
        const entry = record(raw) ?? {};
        const type = entry["type"];
        const value = entry["value"];
        // Every value becomes its type, except an API error key (A-101).
        const kept: Json = {
          ...(type === undefined ? {} : { type }),
          value: typeof value === "string" && ERROR_KEY.test(value) ? value : type,
        };
        const frames = record(entry["stacktrace"])?.["frames"];
        if (Array.isArray(frames)) {
          kept["stacktrace"] = { frames: frames.map((f: unknown) => pick(record(f), FRAME_KEYS)) };
        }
        return kept;
      }),
    };
  }

  const tags = pick(record(event["tags"]), TAG_KEYS);
  if (Object.keys(tags).length > 0) out["tags"] = tags;

  const userId = record(event["user"])?.["id"];
  if (userId !== undefined) out["user"] = { id: userId };

  const trace = record(record(event["contexts"])?.["trace"]);
  if (trace !== undefined) out["contexts"] = { trace: pick(trace, ["trace_id", "span_id"]) };

  const crumbs = record(event["breadcrumbs"])?.["values"];
  if (Array.isArray(crumbs)) {
    out["breadcrumbs"] = {
      values: crumbs
        .map((c: unknown) => scrubBreadcrumb(record(c) ?? {}))
        .filter((c): c is Json => c !== null),
    };
  }
  return out;
}

export function initSentry(cfg: {
  dsn?: string;
  environment: AppEnv;
  release: string;
  service: string;
  httpsProxy?: string;
}): ErrorReporter {
  if (cfg.dsn === undefined || cfg.dsn === "") {
    return { report: () => undefined, flush: () => Promise.resolve() };
  }
  const client = Sentry.init({
    dsn: cfg.dsn,
    environment: cfg.environment,
    release: cfg.release,
    // Sentry 11's form of `sendDefaultPii: false`: collect nothing about users, requests or
    // frames beyond what the event built from F-33 carries.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      frameContextLines: 0,
    },
    includeLocalVariables: false,
    maxBreadcrumbs: 20,
    defaultIntegrations: false,
    enableOpenTelemetrySetup: false,
    integrations: [
      Sentry.linkedErrorsIntegration({ limit: 1 }),
      Sentry.onUncaughtExceptionIntegration(),
      Sentry.onUnhandledRejectionIntegration(),
    ],
    beforeSend: (event, hint) => {
      // Events Sentry built itself (uncaught exceptions, unhandled rejections) carry frames parsed
      // from err.stack, which can hold message text. Their exception is rebuilt from the original
      // error through F-33, so Sentry's own parsing is never used (B-1).
      const raw = event as unknown as Json;
      const source =
        hint.originalException === undefined
          ? raw
          : { ...raw, exception: buildErrorEvent(hint.originalException, {})["exception"] };
      return scrubSentryEvent(source) as unknown as typeof event;
    },
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb as unknown as Json),
    ...(cfg.httpsProxy === undefined ? {} : { transportOptions: { proxy: cfg.httpsProxy } }),
  });
  return {
    report(err, ctx) {
      // The original error object never reaches Sentry: only the event built from F-33.
      client?.captureEvent(buildErrorEvent(err, ctx));
    },
    async flush(timeoutMs) {
      await client?.flush(timeoutMs);
    },
  };
}
