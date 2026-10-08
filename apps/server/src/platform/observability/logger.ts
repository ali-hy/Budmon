// F-31: the structured logger. One JSON line per call through pino, carrying only the fixed keys,
// F-30's sanitised fields and F-33's sanitised error.
import pino from "pino";
import { sanitizeFields, TOKEN, type SafeFields } from "./safeFields.js";
import { sanitizeError } from "./sanitize.js";

export type { SafeFields } from "./safeFields.js";

export type DestinationStream = pino.DestinationStream;

export interface Logger {
  debug(event: string, fields?: SafeFields): void;
  info(event: string, fields?: SafeFields): void;
  warn(event: string, fields?: SafeFields, err?: unknown): void;
  error(event: string, fields?: SafeFields, err?: unknown): void;
  child(bindings: SafeFields): Logger;
}

type Level = "debug" | "info" | "warn" | "error";

const FIXED_KEYS = new Set(["level", "time", "service", "release", "event"]);

/** A field named like a fixed key is dropped and counted (A-113). */
function withoutFixedKeys(
  sanitized: ReturnType<typeof sanitizeFields>,
): ReturnType<typeof sanitizeFields> {
  const fields: Record<string, string | number | boolean> = {};
  let dropped = sanitized.dropped;
  for (const [key, value] of Object.entries(sanitized.fields)) {
    if (FIXED_KEYS.has(key)) dropped += 1;
    else fields[key] = value;
  }
  return { fields, dropped };
}

export function createLogger(opts: {
  service: string;
  release: string;
  level: Level;
  destination?: pino.DestinationStream;
  onDrop?: (n: number) => void;
}): Logger {
  const base = pino(
    {
      base: null,
      level: opts.level,
      timestamp: () => `,"time":"${new Date().toISOString()}"`,
      formatters: { level: (label) => ({ level: label }) },
      // Nothing is ever serialised beyond what this module builds.
      serializers: { err: (value: unknown) => value },
    },
    opts.destination ?? pino.destination({ fd: 1, sync: true }),
  );

  const make = (bindings: Record<string, string | number | boolean>): Logger => {
    const write = (level: Level, event: string, fields?: SafeFields, err?: unknown): void => {
      try {
        if (!base.isLevelEnabled(level)) return;
        const validEvent = TOKEN.test(event);
        const sanitized = withoutFixedKeys(sanitizeFields(fields ?? {}));
        const dropped = sanitized.dropped + (validEvent ? 0 : 1);
        // The fixed keys are written last, so they always win (A-113).
        const line: Record<string, unknown> = {
          ...bindings,
          ...sanitized.fields,
          service: opts.service,
          release: opts.release,
          event: validEvent ? event : "invalid_event",
        };
        if (err !== undefined) line["err"] = sanitizeError(err);
        if (dropped > 0) {
          line["dropped"] = dropped;
          opts.onDrop?.(dropped);
        }
        base[level](line);
      } catch {
        // A logger never throws on bad input.
      }
    };
    return {
      debug: (event, fields) => {
        write("debug", event, fields);
      },
      info: (event, fields) => {
        write("info", event, fields);
      },
      warn: (event, fields, err) => {
        write("warn", event, fields, err);
      },
      error: (event, fields, err) => {
        write("error", event, fields, err);
      },
      child: (childBindings) => {
        const sanitized = withoutFixedKeys(sanitizeFields(childBindings));
        if (sanitized.dropped > 0) opts.onDrop?.(sanitized.dropped);
        return make({ ...bindings, ...sanitized.fields });
      },
    };
  };
  return make({});
}
