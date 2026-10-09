// F-92: the migrate process (`pnpm db:migrate`, image entry `node dist/main/migrate.js`).
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { EXIT_CONFIG, loadConfigOrReport } from "../platform/config/startup.js";
import type { Config, DbLoginRole } from "../platform/config/schema.js";
import { serverRoot } from "../platform/config/serverRoot.js";
import { createDatabase } from "../platform/db/client.js";
import {
  JournalInvalidError,
  MigrationFailedError,
  readJournal,
  UnknownMigrationError,
} from "../platform/db/migrations.js";
import { runSchemaStep, SchemaStepError } from "../platform/db/schemaStep.js";
import iso4217 from "../platform/fx/iso4217.json" with { type: "json" };
import { describeFailure } from "../platform/observability/describeFailure.js";
import { createLogger, type Logger } from "../platform/observability/logger.js";
import type { Secret } from "../platform/observability/redaction.js";
import type { Database } from "../platform/db/types.js";

const stderr = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

async function connect(
  config: Config,
  password: Secret<string>,
  logger: Logger,
): Promise<{ database: Database; ok: true } | { database: Database; ok: false; code: unknown }> {
  const database = createDatabase(
    { ...config.db, password },
    {
      applicationName: "budmon-migrate",
      onError: () => {
        logger.error("database_pool_error");
      },
    },
  );
  try {
    await database.handle.executeSql("SELECT 1");
    return { database, ok: true };
  } catch (error) {
    return { database, ok: false, code: (error as { code?: unknown }).code };
  }
}

/** F-92 as a function: returns the exit code. */
export async function runMigrate(
  env: Readonly<Record<string, string | undefined>>,
): Promise<number> {
  const config = loadConfigOrReport("migrate", env, readFileSync, stderr);
  if (config?.migrate === undefined) return EXIT_CONFIG;
  const logger = createLogger({
    service: "migrate",
    release: config.release,
    level: config.logLevel,
    appEnv: config.appEnv,
    // stdout carries only the report.
    destination: { write: (line: string) => process.stderr.write(line) },
  });
  if (config.db.user !== "budmon_migrator") {
    logger.error("startup_failed", { reason: "DB_USER must be budmon_migrator" });
    return 1;
  }
  const migrationsFolder = path.join(serverRoot(), "drizzle");
  // A-160: the journal is checked before the database is touched (read again by F-18).
  try {
    readJournal(migrationsFolder);
  } catch (error) {
    logger.error("startup_failed", describeFailure(error));
    return error instanceof JournalInvalidError ? 5 : 1;
  }

  let attempt = await connect(config, config.db.password, logger);
  const previous = config.migrate.previousPassword;
  if (!attempt.ok && attempt.code === "28P01" && previous !== undefined) {
    // A rotated migrator password: the schema step below applies the new verifier.
    await attempt.database.close();
    logger.warn("migrator_previous_password_used");
    attempt = await connect(config, previous, logger);
  }
  const { database } = attempt;
  try {
    const roleSecrets = Object.fromEntries(
      Object.entries(config.migrate.roleSecrets).map(([role, secret]) => [
        role,
        "verifier" in secret ? secret : { password: secret.password.reveal() },
      ]),
    ) as Record<DbLoginRole, { verifier: string } | { password: string }>;
    const report = await runSchemaStep({
      mode: "migrate",
      database,
      migrationsFolder,
      roleSecrets,
      appEnv: config.appEnv,
      referenceData: { currencies: iso4217 },
      logger,
    });
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return 0;
  } catch (error) {
    logger.error("startup_failed", describeFailure(error));
    if (error instanceof SchemaStepError) return 3;
    if (error instanceof UnknownMigrationError) return 4;
    if (error instanceof MigrationFailedError || error instanceof JournalInvalidError) return 5;
    return 1;
  } finally {
    await database.close();
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  process.exitCode = await runMigrate(process.env);
}
