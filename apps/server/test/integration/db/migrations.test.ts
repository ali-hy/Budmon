// F-18 applyCommittedMigrations and readJournal. TP-2.13 (fresh container, fixture folder
// test/fixtures/migrations with two migrations), plus extra cases TP-2.40x.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapCluster } from "../../../src/platform/db/clusterBootstrap.js";
import {
  UnknownMigrationError,
  applyCommittedMigrations,
  readJournal,
} from "../../../src/platform/db/migrations.js";
import type { Database } from "../../../src/platform/db/types.js";
import { connectDatabase } from "../../support/platform.js";
import { query, startFreshPostgres, type FreshPostgres } from "../../support/postgres.js";

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/migrations",
);
const MIGRATOR_PASSWORD = "migrations-migrator-password";

let pg: FreshPostgres;

beforeAll(async () => {
  pg = await startFreshPostgres();
});

afterAll(async () => {
  await pg.stop();
});

async function freshDatabase(name: string): Promise<Database> {
  const client = await pg.superuserClient();
  try {
    await bootstrapCluster(client, {
      databaseName: name,
      migrator: { password: MIGRATOR_PASSWORD },
    });
  } finally {
    await client.end();
  }
  return connectDatabase(pg, "budmon_migrator", MIGRATOR_PASSWORD, name);
}

function sha256(file: string): string {
  return createHash("sha256")
    .update(readFileSync(path.join(FIXTURE, file), "utf8"))
    .digest("hex");
}

describe("TP-2.13: applyCommittedMigrations", () => {
  it("TP-2.13: applies both migrations, then on a second run applies none and verifies both", async () => {
    const database = await freshDatabase("migrate_twice");
    try {
      const first = await applyCommittedMigrations(database, FIXTURE);
      const second = await applyCommittedMigrations(database, FIXTURE);

      expect(first).toMatchObject({ applied: 2 });
      expect(second).toEqual({ applied: 0, verified: 2 });
      const tables = await query(
        pg.superuserUrl("migrate_twice"),
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
      );
      expect(tables).toEqual([{ tablename: "fixture_first" }, { tablename: "fixture_second" }]);
    } finally {
      await database.close();
    }
  });

  it("TP-2.13: a recorded migration that isn't in the folder throws UnknownMigrationError", async () => {
    const database = await freshDatabase("migrate_unknown");
    try {
      await applyCommittedMigrations(database, FIXTURE);
      await database.handle.executeSql(
        "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)",
        ["0".repeat(64), 1760000200000],
      );

      await expect(applyCommittedMigrations(database, FIXTURE)).rejects.toBeInstanceOf(
        UnknownMigrationError,
      );
    } finally {
      await database.close();
    }
  });
});

describe("TP-2.40x: readJournal", () => {
  it("TP-2.40x: lists tag, when and the SHA-256 hex of each migration file", () => {
    expect(readJournal(FIXTURE)).toEqual([
      { tag: "0000_first", when: 1760000000000, hash: sha256("0000_first.sql") },
      { tag: "0001_second", when: 1760000100000, hash: sha256("0001_second.sql") },
    ]);
  });
});
