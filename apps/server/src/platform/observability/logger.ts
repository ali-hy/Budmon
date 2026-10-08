// F-31: the structured logger. One JSON line per call through pino, carrying only the fixed keys,
// F-30's sanitised fields and F-33's sanitised error.
import pino from "pino";
import { sanitizeFields, TOKEN, type SafeFields } from "./safeFields.js";
import { sanitizeError } from "./sanitize.js";

export type { SafeFields } from "./safeFields.js";

export interface Logger {
  debug(event: string, fields?: SafeFields): void;
  info(event: string, fields?: SafeFields): void;
  warn(event: string, fields?: SafeFields, err?: unknown): void;
  error(event: string, fields?: SafeFields, err?: unknown): void;
  child(bindings: SafeFields): Logger;
}

type Level = "debug" | "info" | "warn" | "error";

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
        const sanitized = sanitizeFields(fields ?? {});
        const dropped = sanitized.dropped + (validEvent ? 0 : 1);
        const line: Record<string, unknown> = {
          service: opts.service,
          release: opts.release,
          event: validEvent ? event : "invalid_event",
          ...bindings,
          ...sanitized.fields,
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
        const sanitized = sanitizeFields(childBindings);
        if (sanitized.dropped > 0) opts.onDrop?.(sanitized.dropped);
        return make({ ...bindings, ...sanitized.fields });
      },
    };
  };
  return make({});
}
