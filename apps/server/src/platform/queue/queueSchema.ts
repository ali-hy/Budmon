// F-74: pg-boss's schema, owned by budmon_queue (schema step 3).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { getConstructionPlans, getMigrationPlans } from "pg-boss";
import { SchemaStepError } from "../db/schemaStepError.js";
import type { DbHandle } from "../db/types.js";

const SCHEMA = "pgboss";
const USERS = "budmon_app, budmon_capture";

/** `pgboss.schema` from pg-boss's package.json: the schema version this release needs. */
export function targetQueueSchemaVersion(): number {
  let dir = path.dirname(createRequire(import.meta.url).resolve("pg-boss"));
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as {
        name?: string;
        pgboss?: { schema?: number };
      };
      if (pkg.name === "pg-boss" && typeof pkg.pgboss?.schema === "number")
        return pkg.pgboss.schema;
    } catch {
      // No package.json here: keep walking up.
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("pg-boss package.json not found");
    dir = parent;
  }
}

/**
 * pg-boss's plans are wrapped in BEGIN … COMMIT. Without those, the statements run as one implicit
 * transaction (a multi-statement simple query): all or nothing, and a failure leaves the pooled
 * connection clean. The role and the grants go inside it.
 */
function asQueueRole(plan: string): string {
  const begin = /^\s*BEGIN;/;
  const commit = /COMMIT;\s*$/;
  if (!begin.test(plan) || !commit.test(plan)) throw new Error("unexpected pg-boss plan shape");
  return [
    // budmon_queue has no CREATE on the database; the migrator (its owner) creates the schema
    // for it, so pg-boss's own CREATE SCHEMA IF NOT EXISTS is a no-op.
    `CREATE SCHEMA IF NOT EXISTS ${SCHEMA} AUTHORIZATION budmon_queue;`,
    "SET LOCAL ROLE budmon_queue;",
    plan.replace(begin, "").replace(commit, ""),
    `GRANT USAGE ON SCHEMA ${SCHEMA} TO ${USERS};`,
    `GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA ${SCHEMA} TO ${USERS};`,
    `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${SCHEMA} TO ${USERS};`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA ${SCHEMA} GRANT SELECT, INSERT, UPDATE ON TABLES TO ${USERS};`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA ${SCHEMA} GRANT EXECUTE ON FUNCTIONS TO ${USERS};`,
  ].join("\n");
}

export async function installOrUpgradeQueueSchema(
  migrator: DbHandle,
): Promise<"installed" | "upgraded" | "current"> {
  const target = targetQueueSchemaVersion();
  const schema = await migrator.executeSql(
    "SELECT to_regclass('pgboss.version') IS NOT NULL AS present",
  );
  if (schema.rows[0]?.["present"] !== true) {
    await migrator.executeSql(asQueueRole(getConstructionPlans(SCHEMA)));
    return "installed";
  }
  const { rows } = await migrator.executeSql("SELECT version FROM pgboss.version");
  const current = Number.parseInt(String(rows[0]?.["version"]), 10);
  if (current > target) throw new SchemaStepError("queue_schema_ahead");
  if (current === target) return "current";
  await migrator.executeSql(asQueueRole(getMigrationPlans(SCHEMA, current)));
  return "upgraded";
}
