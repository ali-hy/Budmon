// F-31's Logger interface (A-51). `createLogger` (pino) arrives in S-3; until then
// `createStderrLogger` writes one JSON line per call, so process entry points can log.

/** F-30's SafeFields arrive in S-3; until then, any scalar fields. */
export type SafeFields = Partial<Record<string, string | number | boolean>>;

export interface Logger {
  debug(event: string, fields?: SafeFields): void;
  info(event: string, fields?: SafeFields): void;
  warn(event: string, fields?: SafeFields, err?: unknown): void;
  error(event: string, fields?: SafeFields, err?: unknown): void;
  child(bindings: SafeFields): Logger;
}

type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function createStderrLogger(opts: {
  service: string;
  level?: Level;
  write?: (line: string) => void;
  bindings?: SafeFields;
}): Logger {
  const threshold = ORDER[opts.level ?? "info"];
  const write = opts.write ?? ((line: string) => process.stderr.write(`${line}\n`));
  const emit = (level: Level, event: string, fields: SafeFields | undefined): void => {
    if (ORDER[level] < threshold) return;
    write(
      JSON.stringify({
        level,
        time: new Date().toISOString(),
        service: opts.service,
        event,
        ...opts.bindings,
        ...fields,
      }),
    );
  };
  return {
    debug: (event, fields) => {
      emit("debug", event, fields);
    },
    info: (event, fields) => {
      emit("info", event, fields);
    },
    warn: (event, fields) => {
      emit("warn", event, fields);
    },
    error: (event, fields) => {
      emit("error", event, fields);
    },
    child: (bindings) =>
      createStderrLogger({ ...opts, write, bindings: { ...opts.bindings, ...bindings } }),
  };
}
