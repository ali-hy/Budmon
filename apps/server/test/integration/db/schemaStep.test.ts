// F-19 runSchemaStep, push mode, on a fresh container. TP-2.15 (first run), plus extra cases
// TP-2.41x.
//
// Deferred, pending the planner: TP-2.15's second push-mode run (F-17 refuses a non-empty
// database), and the queue fields (queueSchema, queuesCreated, queuesUpdated), which come with
// F-19 steps 3 and 6 in S-6.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapCluster } from "../../../src/platform/db/clusterBootstrap.js";
import { runSchemaStep } from "../../../src/platform/db/schemaStep.js";
import type { Database } from "../../../src/platform/db/types.js";
import {
  connectDatabase,
  recordingLogger,
  referenceData,
  schemaStepInput,
  type LoggedLine,
} from "../../support/platform.js";
import {
  TEST_ROLE_PASSWORDS,
  query,
  startFreshPostgres,
  type FreshPostgres,
} from "../../support/postgres.js";

const DATABASE = "budmon";

let pg: FreshPostgres;
let migrator: Database;
let report: Awaited<ReturnType<typeof runSchemaStep>>;
const lines: LoggedLine[] = [];

beforeAll(async () => {
  pg = await startFreshPostgres();
  const client = await pg.superuserClient();
  try {
    await bootstrapCluster(client, {
      databaseName: DATABASE,
      migrator: { password: TEST_ROLE_PASSWORDS.budmon_migrator },
    });
  } finally {
    await client.end();
  }
  migrator = connectDatabase(pg, "budmon_migrator", TEST_ROLE_PASSWORDS.budmon_migrator, DATABASE);
  report = await runSchemaStep(schemaStepInput(migrator, "push", recordingLogger(lines)));
});

afterAll(async () => {
  await migrator.close();
  await pg.stop();
});

describe("TP-2.15: runSchemaStep in push mode on an empty database", () => {
  it("TP-2.15: the report's fields are populated", () => {
    expect(report.pushedStatements).toBeGreaterThan(0);
    expect(report.migrationsApplied).toBe(0);
    expect(report.currenciesUpserted).toBe(referenceData().currencies.length);
  });

  it("TP-2.41x: roles, tables, grants and reference data are all in place", async () => {
    const url = pg.superuserUrl(DATABASE);
    const [roles] = await query(
      url,
      "SELECT count(*)::int AS n FROM pg_roles WHERE rolname IN ('budmon_app','budmon_capture','budmon_queue','budmon_monitor')",
    );
    const [tables] = await query(
      url,
      "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'",
    );
    const [grant] = await query(
      url,
      "SELECT has_table_privilege('budmon_app', 'public.currencies', 'SELECT') AS can",
    );
    const [egp] = await query(url, "SELECT minor_units FROM currencies WHERE code = 'EGP'");

    expect(roles).toEqual({ n: 4 });
    expect(tables).toEqual({ n: 4 });
    expect(grant).toEqual({ can: true });
    expect(egp).toEqual({ minor_units: 2 });
  });

  it('TP-2.41x: each step is logged as event "schema_step" with step and durationMs', () => {
    const steps = lines.filter((l) => l.event === "schema_step");
    const fields = steps.map(
      (l) => (l.fields as { fields?: { step?: unknown; durationMs?: unknown } }).fields,
    );

    expect(steps.length).toBeGreaterThanOrEqual(4);
    for (const f of fields) {
      expect(typeof f?.step).toBe("string");
      expect(typeof f?.durationMs).toBe("number");
    }
    expect(new Set(fields.map((f) => f?.step)).size).toBe(fields.length);
  });
});
