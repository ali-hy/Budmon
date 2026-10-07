// F-20: the guarded development database reset, and the guarded seeding.
import pg from "pg";
import { parse as parseConnectionString } from "pg-connection-string";
import { createDatabase } from "./client.js";
import { bootstrapCluster } from "./clusterBootstrap.js";
import { createStderrLogger } from "../observability/logger.js";
import { Secret } from "../observability/redaction.js";
import { serverRoot } from "../config/serverRoot.js";
import iso4217 from "../fx/iso4217.json" with { type: "json" };
import path from "node:path";
import type { AppEnv, DbLoginRole } from "../config/schema.js";
import type { runSchemaStep } from "./schemaStep.js";

export class ResetRefusedError extends Error {
  constructor(command: "db:reset" | "db:seed") {
    super(`${command} only runs against a local development or test database`);
    this.name = "ResetRefusedError";
  }
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "host.docker.internal"]);

/** Whether pg would connect to an acceptable server with this URL. `pg` lets `?host=` and
 * `?hostaddr=` override the URL's host, so those parameters, host lists and socket paths are
 * always refused; the host is the one pg-connection-string reports. `allowNonLocalHost` skips
 * only the allowlist of local hosts. */
function isAcceptableUrl(superuserUrl: string, allowNonLocalHost: boolean): boolean {
  try {
    const query = new URL(superuserUrl).searchParams;
    if (query.has("host") || query.has("hostaddr")) return false;
    const { host } = parseConnectionString(superuserUrl);
    if (typeof host !== "string" || host === "" || host.includes(",") || host.startsWith("/")) {
      return false;
    }
    return allowNonLocalHost || LOCAL_HOSTS.has(host);
  } catch {
    return false;
  }
}

function assertLocalDevelopment(
  command: "db:reset" | "db:seed",
  appEnv: AppEnv,
  superuserUrl: string,
  allowNonLocalHost: boolean,
): void {
  const allowedEnv = appEnv === "development" || appEnv === "test";
  if (!allowedEnv || !isAcceptableUrl(superuserUrl, allowNonLocalHost)) {
    throw new ResetRefusedError(command);
  }
}

export async function resetDevelopmentDatabase(
  input: {
    appEnv: AppEnv;
    superuserUrl: string;
    databaseName: string;
    migratorPassword: string;
    roleSecrets: Record<DbLoginRole, { verifier: string } | { password: string }>;
    seed: boolean;
    /** Skips only the allowlist of local hosts (for test containers). Default false. */
    allowNonLocalHost?: boolean;
  },
  deps: { runSchemaStep: typeof runSchemaStep; seed: () => Promise<void> },
): Promise<void> {
  assertLocalDevelopment(
    "db:reset",
    input.appEnv,
    input.superuserUrl,
    input.allowNonLocalHost === true,
  );

  const superuser = new pg.Client({ connectionString: input.superuserUrl });
  await superuser.connect();
  try {
    await superuser.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [input.databaseName],
    );
    await superuser.query(
      `DROP DATABASE IF EXISTS ${superuser.escapeIdentifier(input.databaseName)} WITH (FORCE)`,
    );
    await bootstrapCluster(superuser, {
      databaseName: input.databaseName,
      migrator: { password: input.migratorPassword },
    });
  } finally {
    await superuser.end();
  }

  const url = new URL(input.superuserUrl);
  const database = createDatabase(
    {
      host: url.hostname.replace(/^\[|\]$/g, ""),
      port: url.port === "" ? 5432 : Number.parseInt(url.port, 10),
      name: input.databaseName,
      user: "budmon_migrator",
      password: Secret.of(input.migratorPassword),
      sslmode: "disable",
      poolMax: 2,
    },
    { applicationName: "budmon-db-reset" },
  );
  try {
    await deps.runSchemaStep({
      mode: "push",
      database,
      migrationsFolder: path.join(serverRoot(), "drizzle"),
      roleSecrets: input.roleSecrets,
      appEnv: input.appEnv,
      referenceData: { currencies: iso4217 },
      logger: createStderrLogger({ service: "db-reset" }),
    });
  } finally {
    await database.close();
  }
  if (input.seed) {
    await deps.seed();
  }
}

export async function seedDevelopmentDatabase(
  input: { appEnv: AppEnv; superuserUrl: string; allowNonLocalHost?: boolean },
  deps: { seed: () => Promise<void> },
): Promise<void> {
  assertLocalDevelopment(
    "db:seed",
    input.appEnv,
    input.superuserUrl,
    input.allowNonLocalHost === true,
  );
  await deps.seed();
}
