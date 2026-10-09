// F-19: the schema step as the migrator, in the S-2 shape (A-49): roles, schema, grants and
// reference data. S-6 adds the queue steps.
import type { AppEnv, DbLoginRole } from "../config/schema.js";
import type { Logger } from "../observability/logger.js";
import { applyTableGrants, grantMigrationsTableRead } from "./grants.js";
import { applyCommittedMigrations, readJournal } from "./migrations.js";
import { loadReferenceData, type ReferenceData } from "./referenceData.js";
import { applyRolesAndPrivileges } from "./roles.js";
import type { Database } from "./types.js";

export { SchemaStepError, type SchemaStepCode } from "./schemaStepError.js";

export interface SchemaStepReport {
  migrationsApplied: number;
  pushedStatements: number;
  currenciesUpserted: number;
}

export async function runSchemaStep(input: {
  mode: "migrate" | "push";
  database: Database;
  migrationsFolder: string;
  roleSecrets: Record<DbLoginRole, { verifier: string } | { password: string }>;
  appEnv: AppEnv;
  referenceData: ReferenceData;
  logger: Logger;
}): Promise<SchemaStepReport> {
  const { database, logger } = input;
  const timed = async <T>(step: string, fn: () => Promise<T>): Promise<T> => {
    const started = Date.now();
    const result = await fn();
    logger.info("schema_step", { step, durationMs: Date.now() - started });
    return result;
  };

  await timed("roles", () =>
    applyRolesAndPrivileges(database.handle, input.roleSecrets, input.appEnv, logger),
  );

  let migrationsApplied = 0;
  let pushedStatements = 0;
  if (input.mode === "push") {
    // Loaded on demand: drizzle-kit is a development dependency, so the production bundle
    // never contains or imports it.
    const specifier = "./schemaPush.js";
    const { pushSchemaOntoEmpty } = (await import(
      /* @vite-ignore */ specifier
    )) as typeof import("./schemaPush.js");
    pushedStatements = (await timed("push", () => pushSchemaOntoEmpty(database.handle))).statements;
  } else {
    const migrations = await timed("migrations", () =>
      applyCommittedMigrations(database, input.migrationsFolder),
    );
    migrationsApplied = migrations.applied;
    // 2b (A-179): an empty journal and nothing recorded means no tables yet (every build before
    // the first release): only the migrations table's grant applies, and the step stops here.
    if (readJournal(input.migrationsFolder).length === 0 && migrations.verified === 0) {
      await timed("grants", () => grantMigrationsTableRead(database.handle));
      return { migrationsApplied: 0, pushedStatements: 0, currenciesUpserted: 0 };
    }
  }

  await timed("grants", () => applyTableGrants(database.handle));
  const { upserted } = await timed("reference_data", () =>
    loadReferenceData(database.handle, input.referenceData),
  );
  return { migrationsApplied, pushedStatements, currenciesUpserted: upserted };
}
