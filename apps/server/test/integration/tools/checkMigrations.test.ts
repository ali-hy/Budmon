// F-182 checkMigrationsReproduceSchema (check (i)). TP-14.4. Fixture projects are throwaway copies of
// the server project (support/s14.ts) whose drizzle/ folder is built per case; Postgres is a
// container started for this file (F-182 bootstraps clusters, so its contract takes a superuser).
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type ServerFixture,
  type StartedPostgres,
  generatePlain,
  loadCheckMigrations,
  serverFixture,
  startPostgres,
} from "../../support/s14.js";

let pg: StartedPostgres;
const fixtures: ServerFixture[] = [];

beforeAll(async () => {
  pg = await startPostgres();
}, 180_000);
afterAll(async () => {
  for (const f of fixtures) f.remove();
  await pg.stop();
});

/** startPostgres hands out the file's container; F-182 may stop it, which this ignores. */
const deps = {
  startPostgres: () =>
    Promise.resolve({
      superuserUrl: pg.superuserUrl,
      stop: () => Promise.resolve(),
    }),
};

function fixtureWithBaseline(): ServerFixture {
  const f = serverFixture();
  fixtures.push(f);
  generatePlain(f.dir, "v0.1.0");
  return f;
}

const sqlFile = (f: ServerFixture) => {
  const name = readdirSync(f.drizzle).find((n) => n.endsWith(".sql"));
  if (name === undefined) throw new Error("no migration generated");
  return path.join(f.drizzle, name);
};

describe("TP-14.4: migrations reproduce the schema (F-182)", () => {
  it("TP-14.4: migrations generated from the current schema: ok, snapshotClean, no diff", async () => {
    const { checkMigrationsReproduceSchema } = await loadCheckMigrations();
    const f = fixtureWithBaseline();

    expect(await checkMigrationsReproduceSchema({ serverDir: f.dir }, deps)).toEqual({
      ok: true,
      snapshotClean: true,
      dumpDiff: "",
    });
  }, 300_000);

  it("TP-14.4: a migration missing a column: not ok, and dumpDiff mentions the column", async () => {
    const { checkMigrationsReproduceSchema } = await loadCheckMigrations();
    const f = fixtureWithBaseline();
    const file = sqlFile(f);
    // Drop idempotency_records.response_status from the migration only (the snapshot keeps it).
    const sql = readFileSync(file, "utf8");
    const edited = sql.replace(/\n\t"response_status" smallint,/, "");
    expect(edited).not.toBe(sql);
    writeFileSync(file, edited);

    const result = await checkMigrationsReproduceSchema({ serverDir: f.dir }, deps);

    expect(result.ok).toBe(false);
    expect(result.snapshotClean).toBe(true);
    expect(result.dumpDiff).toMatch(/response_status/);
  }, 300_000);

  it("TP-14.4: a stale snapshot: snapshotClean false and not ok", async () => {
    const { checkMigrationsReproduceSchema } = await loadCheckMigrations();
    const f = fixtureWithBaseline();
    const snapshot = path.join(f.drizzle, "meta/0000_snapshot.json");
    const json = JSON.parse(readFileSync(snapshot, "utf8")) as {
      tables: Record<string, { columns: Record<string, unknown> }>;
    };
    const records = json.tables["public.idempotency_records"];
    if (records === undefined) throw new Error("no public.idempotency_records in the snapshot");
    Reflect.deleteProperty(records.columns, "response_status");
    writeFileSync(snapshot, JSON.stringify(json, null, 2));

    const result = await checkMigrationsReproduceSchema({ serverDir: f.dir }, deps);

    expect(result.snapshotClean).toBe(false);
    expect(result.ok).toBe(false);
  }, 300_000);

  it("TP-14.4: no migrations at all: ok, snapshotClean, no diff, without starting Postgres", async () => {
    const { checkMigrationsReproduceSchema } = await loadCheckMigrations();
    const f = serverFixture();
    fixtures.push(f);
    let started = 0;

    const result = await checkMigrationsReproduceSchema(
      { serverDir: f.dir },
      {
        startPostgres: () => {
          started += 1;
          return deps.startPostgres();
        },
      },
    );

    expect(result).toEqual({ ok: true, snapshotClean: true, dumpDiff: "" });
    expect(started).toBe(0);
  }, 120_000);
});
