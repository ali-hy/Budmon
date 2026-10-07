// Postgres for integration tests (§10.1), owned by the test-architect.
//
// - POSTGRES_IMAGE: postgres 18, pinned by digest. §10.1 asks for the same digest as
//   images/postgres's base; that image arrives in S-15, which must keep the two equal.
// - POSTGRES_COMMAND: pg_stat_statements loaded with track_utility off (F-15, TP-2.10).
// - TEST_ROLE_PASSWORDS: the password form of every login role, used by the global setup's schema
//   step and by tests that log in as a role (appEnv "test", so password forms are allowed).
// - startFreshPostgres(): a container of its own, for the cases whose setup is "fresh container"
//   or "empty database" and which need the superuser (TP-2.9, TP-2.10, TP-2.12, TP-2.13, TP-2.15).
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";

export const POSTGRES_IMAGE =
  "postgres:18@sha256:74935e72241653ca55e0414067e6d8763aceb8a810eb51b452253ec3dcfc4336";

export const POSTGRES_COMMAND = [
  "postgres",
  "-c",
  "shared_preload_libraries=pg_stat_statements",
  "-c",
  "pg_stat_statements.track_utility=off",
];

export type LoginRole =
  "budmon_app" | "budmon_capture" | "budmon_queue" | "budmon_monitor" | "budmon_migrator";

export const LOGIN_ROLES: readonly LoginRole[] = [
  "budmon_app",
  "budmon_capture",
  "budmon_queue",
  "budmon_monitor",
  "budmon_migrator",
];

export const TEST_ROLE_PASSWORDS: Readonly<Record<LoginRole, string>> = {
  budmon_app: "test-app-password",
  budmon_capture: "test-capture-password",
  budmon_queue: "test-queue-password",
  budmon_monitor: "test-monitor-password",
  budmon_migrator: "test-migrator-password",
};

/** Role secrets in F-15's password form, for runSchemaStep / applyRolesAndPrivileges. */
export function testRoleSecrets(): Record<LoginRole, { password: string }> {
  return Object.fromEntries(
    LOGIN_ROLES.map((role) => [role, { password: TEST_ROLE_PASSWORDS[role] }]),
  ) as Record<LoginRole, { password: string }>;
}

export interface Endpoint {
  host: string;
  port: number;
}

export function connectionString(
  endpoint: Endpoint,
  user: string,
  password: string,
  database: string,
): string {
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${endpoint.host}:${String(endpoint.port)}/${encodeURIComponent(database)}`;
}

/** Runs one statement on a short-lived client and returns its rows. */
export async function query<R extends Record<string, unknown> = Record<string, unknown>>(
  url: string,
  text: string,
  values: readonly unknown[] = [],
): Promise<R[]> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const result = await client.query<R>(text, [...values]);
    return result.rows;
  } finally {
    await client.end();
  }
}

export interface FreshPostgres extends Endpoint {
  superuserUrl: (database?: string) => string;
  superuserClient: (database?: string) => Promise<pg.Client>;
  stop: () => Promise<void>;
}

export async function startFreshPostgres(): Promise<FreshPostgres> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withCommand(POSTGRES_COMMAND)
    .start();
  const endpoint = { host: container.getHost(), port: container.getPort() };
  const superuserUrl = (database = "postgres"): string =>
    connectionString(endpoint, container.getUsername(), container.getPassword(), database);
  return {
    ...endpoint,
    superuserUrl,
    superuserClient: async (database?: string) => {
      const client = new pg.Client({ connectionString: superuserUrl(database) });
      await client.connect();
      return client;
    },
    stop: async () => {
      await container.stop();
    },
  };
}

/** A pg error's SQLSTATE, for asserting e.g. 42501 (insufficient_privilege). */
export function sqlState(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

/** Awaits `operation` and returns the SQLSTATE it failed with (undefined if it succeeded). */
export async function failureState(operation: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await operation();
  } catch (error) {
    return sqlState(error) ?? "non-sql-error";
  }
  return undefined;
}
