// F-34: the error reporter interface, the event built from F-33 only, and the in-memory reporter
// for tests and the canary suite.
import { sanitizeError } from "./sanitize.js";
import { scrubSentryEvent } from "./sentry.js";

export interface ErrorContext {
  requestId?: string;
  userId?: string;
  route?: string;
  jobName?: string;
  errorKey?: string;
}

export interface ErrorReporter {
  report(err: unknown, ctx: ErrorContext): void;
  flush(timeoutMs: number): Promise<void>;
}

const FRAME = /^at (?:(.*?) \((.*):(\d+):(\d+)\)|(.*):(\d+):(\d+))$/;

function parseFrame(line: string): Record<string, unknown> {
  const match = FRAME.exec(line);
  if (match === null) return { function: line.slice(3) };
  if (match[2] !== undefined) {
    return {
      function: match[1],
      filename: match[2],
      lineno: Number.parseInt(match[3] ?? "0", 10),
      colno: Number.parseInt(match[4] ?? "0", 10),
    };
  }
  return {
    filename: match[5],
    lineno: Number.parseInt(match[6] ?? "0", 10),
    colno: Number.parseInt(match[7] ?? "0", 10),
  };
}

/** The Sentry event for an error: built from F-33's result only, never from the error itself. */
export function buildErrorEvent(err: unknown, ctx: ErrorContext): Record<string, unknown> {
  const s = sanitizeError(err);
  const tags: Record<string, string> = {};
  if (ctx.route !== undefined) tags["route"] = ctx.route;
  if (ctx.jobName !== undefined) tags["job"] = ctx.jobName;
  if (ctx.errorKey !== undefined) tags["error_key"] = ctx.errorKey;
  return {
    level: "error",
    exception: {
      values: [
        {
          type: s.class,
          value: s.key ?? s.code ?? s.class,
          // Sentry lists frames oldest first; a stack lists the newest first.
          stacktrace: { frames: [...s.frames].reverse().map(parseFrame) },
        },
      ],
    },
    tags,
    ...(ctx.userId === undefined ? {} : { user: { id: ctx.userId } }),
  };
}

export function createMemoryErrorReporter(): ErrorReporter & {
  readonly events: readonly Record<string, unknown>[];
} {
  const events: Record<string, unknown>[] = [];
  return {
    events,
    report(err, ctx) {
      const event = scrubSentryEvent(buildErrorEvent(err, ctx));
      if (event !== null) events.push(event);
    },
    flush: () => Promise.resolve(),
  };
}
