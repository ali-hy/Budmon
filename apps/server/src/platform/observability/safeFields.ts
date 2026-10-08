// F-30: the closed set of fields a log line may carry, and their value rules.
export type FieldKind =
  "id" | "token" | "route" | "count" | "duration" | "bool" | "errorKey" | "date";

const kinds = (kind: FieldKind, names: readonly string[]): [string, FieldKind][] =>
  names.map((name) => [name, kind]);

export const SAFE_LOG_FIELDS = Object.freeze(
  Object.fromEntries([
    ...kinds("id", ["requestId", "traceId", "spanId", "userId", "entityId", "jobId"]),
    ...kinds("token", [
      "event",
      "step",
      "jobName",
      "queue",
      "method",
      "statusClass",
      "errorClass",
      "errorCode",
      "clientKind",
      "module",
      "outcome",
      "provider",
      "currency",
      "service",
      "release",
      "role",
      "limiter",
      "signal",
      "reason",
    ]),
    ...kinds("route", ["route"]),
    ...kinds("count", [
      "status",
      "count",
      "attempt",
      "clientVersion",
      "dropped",
      "inserted",
      "rejected",
    ]),
    ...kinds("duration", ["durationMs"]),
    ...kinds("bool", ["retryable", "replayed", "provisional"]),
    ...kinds("errorKey", ["errorKey"]),
    ...kinds("date", ["rateDate"]),
  ]) as Readonly<Record<string, FieldKind>>,
);

export type SafeFieldName =
  | "requestId"
  | "traceId"
  | "spanId"
  | "userId"
  | "entityId"
  | "jobId"
  | "event"
  | "step"
  | "jobName"
  | "queue"
  | "method"
  | "statusClass"
  | "errorClass"
  | "errorCode"
  | "clientKind"
  | "module"
  | "outcome"
  | "provider"
  | "currency"
  | "service"
  | "release"
  | "role"
  | "limiter"
  | "signal"
  | "reason"
  | "route"
  | "status"
  | "count"
  | "attempt"
  | "clientVersion"
  | "dropped"
  | "inserted"
  | "rejected"
  | "durationMs"
  | "retryable"
  | "replayed"
  | "provisional"
  | "errorKey"
  | "rateDate";

export type SafeFields = Partial<Record<SafeFieldName, string | number | boolean>>;

export const TOKEN = /^[A-Za-z0-9_.:-]{1,64}$/;
export const ROUTE = /^\/[A-Za-z0-9_./:{}-]{0,200}$/;
/** A-121: request ids are trace ids (32 lower-case hex); job names are `<module>.<job>`. */
export const REQUEST_ID = /^[0-9a-f]{32}$/;
export const JOB_NAME = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;
export const ERROR_KEY = /^[A-Z][A-Z0-9_]{1,63}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function valid(kind: FieldKind, value: unknown): boolean {
  switch (kind) {
    case "id":
    case "token":
      return typeof value === "string" && TOKEN.test(value);
    case "route":
      return typeof value === "string" && ROUTE.test(value);
    case "count":
      return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
    case "duration":
      return typeof value === "number" && Number.isFinite(value) && value >= 0;
    case "bool":
      return typeof value === "boolean";
    case "errorKey":
      return typeof value === "string" && ERROR_KEY.test(value);
    case "date":
      return typeof value === "string" && DATE.test(value);
  }
}

export function sanitizeFields(fields: Readonly<Record<string, unknown>>): {
  fields: Record<string, string | number | boolean>;
  dropped: number;
} {
  const out: Record<string, string | number | boolean> = {};
  let dropped = 0;
  for (const key of Object.keys(fields)) {
    const kind = Object.hasOwn(SAFE_LOG_FIELDS, key) ? SAFE_LOG_FIELDS[key] : undefined;
    if (kind === undefined) {
      dropped += 1;
      continue;
    }
    const value = fields[key];
    if (valid(kind, value)) {
      out[key] = value as string | number | boolean;
    } else {
      out[key] = "[invalid]";
      dropped += 1;
    }
  }
  return { fields: out, dropped };
}
