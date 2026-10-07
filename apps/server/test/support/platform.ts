// Builders for the platform objects integration tests pass around (§10.1).
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "../../src/platform/config/schema.js";
import { createDatabase } from "../../src/platform/db/client.js";
import type { runSchemaStep } from "../../src/platform/db/schemaStep.js";
import type { Database } from "../../src/platform/db/types.js";
import iso4217 from "../../src/platform/fx/iso4217.json" with { type: "json" };
import { Secret } from "../../src/platform/observability/redaction.js";
import type { Endpoint } from "./postgres.js";
import { testRoleSecrets } from "./postgres.js";

export const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

type SchemaStepInput = Parameters<typeof runSchemaStep>[0];
export type TestLogger = SchemaStepInput["logger"];

export interface LoggedLine {
  level: "debug" | "info" | "warn" | "error";
  event: string;
  fields: unknown;
}

/** A Logger (F-31's interface) that records calls instead of writing them. */
export function recordingLogger(lines: LoggedLine[] = []): TestLogger & { lines: LoggedLine[] } {
  const make = (bindings: unknown): TestLogger & { lines: LoggedLine[] } => ({
    lines,
    debug: (event, fields) => lines.push({ level: "debug", event, fields: { bindings, fields } }),
    info: (event, fields) => lines.push({ level: "info", event, fields: { bindings, fields } }),
    warn: (event, fields) => lines.push({ level: "warn", event, fields: { bindings, fields } }),
    error: (event, fields) => lines.push({ level: "error", event, fields: { bindings, fields } }),
    child: (childBindings) => make(childBindings),
  });
  return make(undefined);
}

export function dbConfig(
  endpoint: Endpoint,
  user: string,
  password: string,
  name: string,
): Config["db"] {
  return {
    host: endpoint.host,
    port: endpoint.port,
    name,
    user,
    password: Secret.of(password),
    sslmode: "disable",
    poolMax: 4,
  };
}

export function connectDatabase(
  endpoint: Endpoint,
  user: string,
  password: string,
  name: string,
): Database {
  return createDatabase(dbConfig(endpoint, user, password, name), {
    applicationName: `budmon-test-${user}`,
  });
}

export function referenceData(): SchemaStepInput["referenceData"] {
  return { currencies: iso4217 };
}

/**
 * runSchemaStep's input for a test cluster: password-form role secrets, appEnv "test", the
 * server's (empty) drizzle folder, the ISO 4217 file and a recording logger.
 */
export function schemaStepInput(
  database: Database,
  mode: "push" | "migrate",
  logger: TestLogger = recordingLogger(),
): SchemaStepInput {
  return {
    mode,
    database,
    migrationsFolder: path.join(SERVER_DIR, "drizzle"),
    roleSecrets: testRoleSecrets(),
    appEnv: "test",
    referenceData: referenceData(),
    logger,
  };
}
