// F-18: applies the committed migrations (schema step 2, migrate mode).
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Database } from "./types.js";

export class UnknownMigrationError extends Error {
  constructor() {
    super("a recorded migration is missing from this image's migrations folder");
    this.name = "UnknownMigrationError";
  }
}

export class MigrationFailedError extends Error {
  constructor(cause: unknown) {
    super("migration failed", { cause });
    this.name = "MigrationFailedError";
  }
}

export function readJournal(
  migrationsFolder: string,
): { tag: string; when: number; hash: string }[] {
  const file = path.join(migrationsFolder, "meta", "_journal.json");
  // No journal means no migrations: the folder holds only .gitkeep until the first release.
  if (!existsSync(file)) return [];
  const journal = JSON.parse(readFileSync(file, "utf8")) as {
    entries?: { tag: string; when: number }[];
  };
  return (journal.entries ?? []).map((entry) => ({
    tag: entry.tag,
    when: entry.when,
    hash: createHash("sha256")
      .update(readFileSync(path.join(migrationsFolder, `${entry.tag}.sql`), "utf8"))
      .digest("hex"),
  }));
}

export async function applyCommittedMigrations(
  database: Database,
  migrationsFolder: string,
): Promise<{ applied: number; verified: number }> {
  // A-146: every migrate-mode database has the table, whatever the journal holds. Drizzle's own
  // definition, so its migrator later finds it unchanged.
  await database.handle.executeSql("CREATE SCHEMA IF NOT EXISTS drizzle");
  await database.handle.executeSql(
    "CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint)",
  );
  const journal = readJournal(migrationsFolder);
  const { rows } = await database.handle.executeSql(
    "SELECT hash, created_at FROM drizzle.__drizzle_migrations",
  );
  for (const row of rows) {
    const known = journal.some(
      (entry) => entry.hash === row["hash"] && String(entry.when) === String(row["created_at"]),
    );
    if (!known) throw new UnknownMigrationError();
  }
  const recorded = rows.length;
  if (journal.length === 0) {
    // Drizzle's migrator needs journal entries; with none, there is nothing to apply (A-80, A-146).
    return { applied: 0, verified: recorded };
  }
  try {
    await migrate(drizzle({ client: database.pool }), { migrationsFolder });
  } catch (error) {
    throw new MigrationFailedError(error);
  }
  const after = await database.handle.executeSql(
    "SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations",
  );
  const total = Number.parseInt(String(after.rows[0]?.["n"]), 10);
  return { applied: total - recorded, verified: recorded };
}
