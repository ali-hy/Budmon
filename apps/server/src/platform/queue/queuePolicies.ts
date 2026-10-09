// F-75b (A-227): row-level security on pgboss.job_common (schema step 6b, after F-75, as
// budmon_queue). budmon_capture sees and changes only capture jobs, and may enqueue only into
// capture queues and general queues flagged sendableFromCapture; budmon_app reads and sends to any
// queue. Not FORCEd: the owner, budmon_queue (the general worker and the CLI), is unaffected.
import type { DbHandle } from "../db/types.js";
import type { JobRegistry } from "./registry.js";

const TABLE = "pgboss.job_common";

/** A SQL array literal of queue names (names follow F-70's pattern, so no quoting is needed
 * beyond the standard doubling). */
function nameArray(names: readonly string[]): string {
  const items = [...new Set(names)].sort().map((n) => `'${n.replaceAll("'", "''")}'`);
  return `ARRAY[${items.join(", ")}]::text[]`;
}

export function queuePolicyStatements(registry: JobRegistry): string[] {
  const capture = [
    ...registry.forRole("capture").map((d) => d.name),
    registry.deadLetterQueue("capture"),
  ];
  const sendable = [
    ...capture,
    ...registry
      .forRole("general")
      .filter((d) => d.sendableFromCapture === true)
      .map((d) => d.name),
  ];
  const policies = [
    "capture_select",
    "capture_update",
    "capture_delete",
    "capture_insert",
    "app_select",
    "app_insert",
  ];
  return [
    "SET LOCAL ROLE budmon_queue;",
    `ALTER TABLE ${TABLE} ENABLE ROW LEVEL SECURITY;`,
    ...policies.map((p) => `DROP POLICY IF EXISTS ${p} ON ${TABLE};`),
    `CREATE POLICY capture_select ON ${TABLE} FOR SELECT TO budmon_capture USING (name = ANY(${nameArray(capture)}));`,
    `CREATE POLICY capture_update ON ${TABLE} FOR UPDATE TO budmon_capture USING (name = ANY(${nameArray(capture)})) WITH CHECK (name = ANY(${nameArray(capture)}));`,
    `CREATE POLICY capture_delete ON ${TABLE} FOR DELETE TO budmon_capture USING (name = ANY(${nameArray(capture)}));`,
    `CREATE POLICY capture_insert ON ${TABLE} FOR INSERT TO budmon_capture WITH CHECK (name = ANY(${nameArray(sendable)}));`,
    `CREATE POLICY app_select ON ${TABLE} FOR SELECT TO budmon_app USING (true);`,
    `CREATE POLICY app_insert ON ${TABLE} FOR INSERT TO budmon_app WITH CHECK (true);`,
  ];
}

/** Drops and recreates the policies from the registry, in one implicit transaction. */
export async function applyQueuePolicies(migrator: DbHandle, registry: JobRegistry): Promise<void> {
  await migrator.executeSql(queuePolicyStatements(registry).join("\n"));
}
