// F-33 sanitizeError and F-37 stripQuery: what may leave the process about an error or a URL.
import { BudmonError } from "../errors/BudmonError.js";
import { ERROR_KEY, TOKEN } from "./safeFields.js";

export interface SanitizedError {
  class: string;
  key?: string;
  code?: string;
  status?: number;
  reason?: string;
  frames: string[];
}

const SQLSTATE = /^[0-9A-Z]{5}$/;
const SYSTEM_CODE = /^E[A-Z0-9_]{1,30}$/;
const FRAME = /^at [^()]{0,200}( \([^()]*:\d+:\d+\))?$/;
const MAX_FRAMES = 30;

function get(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return (value as Record<string, unknown>)[key];
}

function validStatus(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : undefined;
}

function token(value: unknown): string | undefined {
  return typeof value === "string" && TOKEN.test(value) ? value : undefined;
}

export function sanitizeError(err: unknown): SanitizedError {
  const isError = err instanceof Error;
  const result: SanitizedError = {
    class: isError ? (token(err.constructor.name) ?? "Error") : "NonError",
    frames: [],
  };

  if (err instanceof BudmonError && ERROR_KEY.test(err.key)) result.key = err.key;

  const code = get(err, "code");
  if (typeof code === "string" && (SQLSTATE.test(code) || SYSTEM_CODE.test(code))) {
    result.code = code;
  }

  const status =
    validStatus(get(err, "status")) ??
    validStatus(get(get(err, "response"), "status")) ??
    validStatus(get(err, "statusCode"));
  if (status !== undefined) result.status = status;

  const googleError = get(get(get(err, "response"), "data"), "error");
  if (googleError !== undefined) {
    const errors = get(googleError, "errors");
    const first: unknown = Array.isArray(errors) ? errors[0] : undefined;
    const reason = token(get(first, "reason")) ?? token(get(googleError, "status"));
    if (reason !== undefined) result.reason = reason;
  }

  if (isError && typeof err.stack === "string") {
    // V8's stack starts with String(err), the class line and the message, which can itself
    // contain lines shaped like frames. Frames are taken only after those lines (B-1).
    result.frames = err.stack
      .split("\n")
      .slice(headerLineCount(err))
      .filter((line) => line.startsWith("    at "))
      .map((line) => line.trim())
      .filter((line) => FRAME.test(line))
      .slice(0, MAX_FRAMES);
  }
  return result;
}

function headerLineCount(err: Error): number {
  let message = "";
  try {
    message = typeof err.message === "string" ? err.message : "";
  } catch {
    message = "";
  }
  // The class line holds the first line of the message; each further message line is one more.
  return message.split("\n").length;
}

/** `scheme://host[:port]/path`, without user info, query or fragment. */
export function stripQuery(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.host === "") return "[invalid-url]";
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return "[invalid-url]";
  }
}
