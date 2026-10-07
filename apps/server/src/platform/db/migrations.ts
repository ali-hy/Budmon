// F-18: applies the committed migrations (schema step 2, migrate mode).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
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
  const journal = JSON.parse(
    readFileSync(path.join(migrationsFolder, "meta", "_journal.json"), "utf8"),
  ) as { entries: { tag: string; when: number }[] };
  return journal.entries.map((entry) => ({
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
  const journal = readJournal(migrationsFolder);
  const table = await database.handle.executeSql(
    "SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present",
  );
  let recorded = 0;
  if (table.rows[0]?.["present"] === true) {
    const { rows } = await database.handle.executeSql(
      "SELECT hash, created_at FROM drizzle.__drizzle_migrations",
    );
    for (const row of rows) {
      const known = journal.some(
        (entry) => entry.hash === row["hash"] && String(entry.when) === String(row["created_at"]),
      );
      if (!known) throw new UnknownMigrationError();
    }
    recorded = rows.length;
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
