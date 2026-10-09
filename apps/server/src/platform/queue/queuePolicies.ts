// F-75b (A-227, A-228): row-level security on pgboss.job and pgboss.job_common (schema step 6b, after F-75, as
// budmon_queue). budmon_capture sees and changes only capture jobs, and may enqueue only into
// capture queues and general queues flagged sendableFromCapture; budmon_app reads and sends to any
// queue. Not FORCEd: the owner, budmon_queue (the general worker and the CLI), is unaffected.
import type { DbHandle } from "../db/types.js";
import type { JobRegistry } from "./registry.js";

/** A-228: statements through the partitioned parent see only the parent's policies, so both
 * tables carry the same ones. */
const TABLES = ["pgboss.job", "pgboss.job_common"] as const;
const POLICIES = [
  "capture_select",
  "capture_update",
  "capture_delete",
  "capture_insert",
  "app_select",
  "app_insert",
] as const;

/** A SQL array literal of queue names (names follow F-70's pattern; quotes are doubled anyway). */
function nameArray(names: readonly string[]): string {
  const items = [...new Set(names)].sort().map((n) => `'${n.replaceAll("'", "''")}'`);
  return `ARRAY[${items.join(", ")}]::text[]`;
}

export function queuePolicyStatements(registry: JobRegistry): string[] {
  const own = nameArray([
    ...registry.forRole("capture").map((d) => d.name),
    registry.deadLetterQueue("capture"),
  ]);
  // A-228: SELECT covers what capture may send too (pg-boss sends with INSERT … RETURNING).
  const visible = nameArray([
    ...registry.forRole("capture").map((d) => d.name),
    registry.deadLetterQueue("capture"),
    ...registry
      .forRole("general")
      .filter((d) => d.sendableFromCapture === true)
      .map((d) => d.name),
  ]);
  const statements = ["SET LOCAL ROLE budmon_queue;"];
  for (const table of TABLES) {
    statements.push(
      `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`,
      ...POLICIES.map((p) => `DROP POLICY IF EXISTS ${p} ON ${table};`),
      `CREATE POLICY capture_select ON ${table} FOR SELECT TO budmon_capture USING (name = ANY(${visible}));`,
      `CREATE POLICY capture_insert ON ${table} FOR INSERT TO budmon_capture WITH CHECK (name = ANY(${visible}));`,
      `CREATE POLICY capture_update ON ${table} FOR UPDATE TO budmon_capture USING (name = ANY(${own})) WITH CHECK (name = ANY(${own}));`,
      `CREATE POLICY capture_delete ON ${table} FOR DELETE TO budmon_capture USING (name = ANY(${own}));`,
      `CREATE POLICY app_select ON ${table} FOR SELECT TO budmon_app USING (true);`,
      `CREATE POLICY app_insert ON ${table} FOR INSERT TO budmon_app WITH CHECK (true);`,
    );
  }
  return statements;
}

/** Drops and recreates the policies from the registry, in one implicit transaction. */
export async function applyQueuePolicies(migrator: DbHandle, registry: JobRegistry): Promise<void> {
  await migrator.executeSql(queuePolicyStatements(registry).join("\n"));
}
