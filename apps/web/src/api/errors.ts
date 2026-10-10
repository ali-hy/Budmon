// F-202: any client failure as one of five kinds.
import { ORPCError } from "@orpc/client";

export type AppError =
  | { kind: "defined"; key: string; status: number; data: unknown }
  | { kind: "unavailable" }
  | { kind: "network" }
  | { kind: "timeout" }
  | { kind: "unknown" };

const PROXY_STATUSES = new Set([502, 503, 504]);
/** A-327: the oRPC client may wrap the fetch error, so the cause chain is followed this far. */
const MAX_CAUSE_DEPTH = 3;

function nameOf(value: unknown): unknown {
  return typeof value === "object" && value !== null
    ? (value as { name?: unknown }).name
    : undefined;
}

function isTimeout(err: unknown): boolean {
  let current = err;
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH; depth += 1) {
    if (nameOf(current) === "TimeoutError") return true;
    if (typeof current !== "object" || current === null) return false;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export function toAppError(err: unknown): AppError {
  if (err instanceof ORPCError) {
    const e = err as ORPCError<string, unknown>;
    if (e.defined) return { kind: "defined", key: e.code, status: e.status, data: e.data };
    // A non-envelope gateway answer (Caddy while the API is down or restarting).
    if (PROXY_STATUSES.has(e.status)) return { kind: "unavailable" };
  }
  if (isTimeout(err)) return { kind: "timeout" };
  if (err instanceof TypeError || !navigator.onLine) return { kind: "network" };
  return { kind: "unknown" };
}
