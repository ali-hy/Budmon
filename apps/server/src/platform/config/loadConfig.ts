// F-11: reads every `*_FILE`, validates (F-10) and returns a deep-frozen Config.
import { parseConfig, type Config, type ConfigProblem, type ProcessKind } from "./schema.js";

export class ConfigError extends Error {
  readonly problems: readonly ConfigProblem[];

  constructor(problems: readonly ConfigProblem[]) {
    super(`Configuration invalid: ${problems.map((p) => p.variable).join(", ")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
}

function deepFreeze<T>(value: T, seen = new Set<unknown>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  if (value instanceof URL || value instanceof Map || value instanceof Set) return value;
  if (ArrayBuffer.isView(value)) return value;
  if (Object.getPrototypeOf(value) !== Object.prototype && !Array.isArray(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function trimOneNewline(text: string): string {
  if (text.endsWith("\r\n")) return text.slice(0, -2);
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

export function loadConfig(
  kind: ProcessKind,
  env: Readonly<Record<string, string | undefined>>,
  readFile: (path: string) => Buffer,
): Config {
  const files: Record<string, string | null> = {};
  for (const [name, value] of Object.entries(env)) {
    if (!name.endsWith("_FILE") || value === undefined || value === "") continue;
    try {
      files[value] = trimOneNewline(readFile(value).toString("utf8"));
    } catch {
      files[value] = null;
    }
  }
  const result = parseConfig(kind, { env, files });
  if (!result.ok) {
    throw new ConfigError(result.problems);
  }
  return deepFreeze(result.config);
}

/** The text every entry point prints for a ConfigError (F-11). Names only, never values. */
export function describeConfigError(error: ConfigError): string[] {
  return ["Configuration invalid:", ...error.problems.map((p) => `  - ${p.variable}: ${p.rule}`)];
}
