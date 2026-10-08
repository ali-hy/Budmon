// F-34: the error reporter interface, the report event, and the in-memory reporter for tests and
// the canary suite.
import { isUuid } from "@budmon/shared";
import { ERROR_KEY, JOB_NAME, REQUEST_ID, ROUTE } from "./safeFields.js";
import { buildErrorEvent, stripPathQuery } from "./sanitize.js";
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

function valid(value: string | undefined, rule: RegExp): string | undefined {
  return value !== undefined && rule.test(value) ? value : undefined;
}

/** The context values that pass F-30's rules; a failing value is dropped (A-112). */
export function checkedContext(ctx: ErrorContext): ErrorContext {
  const route = ctx.route === undefined ? undefined : valid(stripPathQuery(ctx.route), ROUTE);
  const checked: ErrorContext = {};
  const requestId = valid(ctx.requestId, REQUEST_ID);
  const userId = ctx.userId !== undefined && isUuid(ctx.userId) ? ctx.userId : undefined;
  const jobName = valid(ctx.jobName, JOB_NAME);
  const errorKey = valid(ctx.errorKey, ERROR_KEY);
  if (requestId !== undefined) checked.requestId = requestId;
  if (userId !== undefined) checked.userId = userId;
  if (route !== undefined) checked.route = route;
  if (jobName !== undefined) checked.jobName = jobName;
  if (errorKey !== undefined) checked.errorKey = errorKey;
  return checked;
}

/** The Sentry event for a report: built from F-33's parts and the checked context only, never
 * from the error object itself. */
export function buildReportEvent(err: unknown, ctx: ErrorContext): Record<string, unknown> {
  const checked = checkedContext(ctx);
  const tags: Record<string, string> = {};
  if (checked.route !== undefined) tags["route"] = checked.route;
  if (checked.jobName !== undefined) tags["job"] = checked.jobName;
  if (checked.errorKey !== undefined) tags["error_key"] = checked.errorKey;
  if (checked.requestId !== undefined) tags["request_id"] = checked.requestId;
  return {
    level: "error",
    exception: { values: [buildErrorEvent(err)] },
    tags,
    ...(checked.userId === undefined ? {} : { user: { id: checked.userId } }),
  };
}

export function createMemoryErrorReporter(): ErrorReporter & {
  readonly events: readonly Record<string, unknown>[];
} {
  const events: Record<string, unknown>[] = [];
  return {
    events,
    report(err, ctx) {
      const event = scrubSentryEvent(buildReportEvent(err, ctx));
      if (event !== null) events.push(event);
    },
    flush: () => Promise.resolve(),
  };
}
