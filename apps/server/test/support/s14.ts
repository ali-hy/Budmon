// S-14 helpers (test-architect): loaders for the release-migration tools (F-180 to F-182, F-184),
// which don't exist yet, and throwaway copies of the server project for drizzle-kit to work in.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { POSTGRES_IMAGE } from "../setup/postgresImage.js";
import { POSTGRES_COMMAND } from "./postgres.js";
import { SERVER_DIR } from "./platform.js";

// ---- Hand-declared shapes (F-180 to F-184) ----

/** The parts of node-pty's IPty that F-180 uses. */
export interface PtyLike {
  onData: (listener: (data: string) => void) => { dispose: () => void };
  onExit: (listener: (e: { exitCode: number; signal?: number }) => void) => { dispose: () => void };
  write: (data: string) => void;
  kill: (signal?: string) => void;
}
export type SpawnPty = (
  file: string,
  args: string[] | string,
  options: {
    cols?: number;
    rows?: number;
    cwd?: string;
    env?: Record<string, string | undefined>;
    name?: string;
  },
) => PtyLike;

export interface ReleaseMigrationModule {
  generateReleaseMigration: (
    input: { version: string; serverDir: string; timeoutMs?: number },
    deps: { spawnPty: SpawnPty },
  ) => Promise<{ file: string | null; ambiguities: string[] }>;
  /** A-361: F-181's deps are `{ spawnPty }`; input takes an optional timeoutMs. */
  pendingSchemaReport: (
    input: { serverDir: string; timeoutMs?: number },
    deps: { spawnPty: SpawnPty },
  ) => Promise<{ sql: string; ambiguities: string[] }>;
}

export interface StartedPostgres {
  superuserUrl: string;
  stop: () => Promise<void>;
}

export interface CheckMigrationsModule {
  checkMigrationsReproduceSchema: (
    input: { serverDir: string },
    deps: { startPostgres: () => Promise<StartedPostgres> },
  ) => Promise<{ ok: boolean; snapshotClean: boolean; dumpDiff: string }>;
}

export interface CheckRiskyModule {
  checkRiskyStatements: (sql: string) => { line: number; pattern: string }[];
}

const TOOLS = "../../tools";

async function load<T>(spec: string): Promise<T> {
  return (await import(/* @vite-ignore */ spec)) as T;
}

export const loadReleaseMigration = () =>
  load<ReleaseMigrationModule>(`${TOOLS}/releaseMigration.ts`);
export const loadCheckMigrations = () => load<CheckMigrationsModule>(`${TOOLS}/checkMigrations.ts`);
export const loadCheckRisky = () => load<CheckRiskyModule>(`${TOOLS}/checkRisky.ts`);

/** node-pty's spawn, loaded at run time (it arrives with S-14). */
export async function realSpawnPty(): Promise<SpawnPty> {
  const pty = await load<{ spawn: SpawnPty }>("node-pty");
  return pty.spawn;
}

// ---- Server project fixtures ----

export interface ServerFixture {
  dir: string;
  drizzle: string;
  remove: () => void;
}

/**
 * A throwaway server project: package.json and drizzle.config.ts copied, node_modules and src
 * linked to the real ones, and an empty drizzle/ folder. drizzle-kit runs in it as in apps/server.
 */
export function serverFixture(parent = tmpdir()): ServerFixture {
  const dir = mkdtempSync(path.join(parent, "budmon-server-fixture-"));
  for (const file of ["package.json", "drizzle.config.ts", "tsconfig.json"]) {
    cpSync(path.join(SERVER_DIR, file), path.join(dir, file));
  }
  symlinkSync(path.join(SERVER_DIR, "node_modules"), path.join(dir, "node_modules"));
  symlinkSync(path.join(SERVER_DIR, "src"), path.join(dir, "src"));
  const drizzle = path.join(dir, "drizzle");
  mkdirSync(drizzle);
  return {
    dir,
    drizzle,
    remove: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** `drizzle-kit generate --name <name>` without a pty (fine when no prompt can appear). */
export function generatePlain(dir: string, name: string): string {
  const result = spawnSync(
    path.join(dir, "node_modules/.bin/drizzle-kit"),
    ["generate", "--name", name],
    { cwd: dir, encoding: "utf8", env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" } },
  );
  if (result.status !== 0) {
    throw new Error(`drizzle-kit generate failed: ${result.stdout}${result.stderr}`);
  }
  return `${result.stdout}${result.stderr}`;
}

/**
 * A Postgres container for F-182 and F-6b, whose contract hands them a superuser URL (they
 * bootstrap clusters). Started and removed by the test that asks for it.
 */
export async function startPostgres(): Promise<StartedPostgres> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withCommand(POSTGRES_COMMAND)
    .start();
  return {
    superuserUrl: container.getConnectionUri(),
    stop: async () => {
      await container.stop();
    },
  };
}
