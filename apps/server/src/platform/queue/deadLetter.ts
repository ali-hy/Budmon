// F-81: listing and redriving dead-lettered jobs (CLI: F-93).
import type { PgBoss } from "pg-boss";
import type { WorkerRole } from "./jobs.js";

export interface DeadLetterEntry {
  id: string;
  sourceName: string | null;
  sourceId: string | null;
  createdOn: string;
  sourceRetryCount: number | null;
  /** The sanitised key or class from F-76's JobFailure. */
  failure: string | null;
}

const ROLES: readonly WorkerRole[] = ["general", "capture"];

export async function listDeadLetters(
  boss: PgBoss,
  role?: WorkerRole,
  limit = 100,
): Promise<DeadLetterEntry[]> {
  const entries: { entry: DeadLetterEntry; at: number }[] = [];
  for (const r of role === undefined ? ROLES : [role]) {
    for (const job of await boss.findJobs(`dead-letter.${r}`)) {
      const message = (job.sourceOutput as { message?: unknown } | null)?.message;
      entries.push({
        at: job.createdOn.getTime(),
        entry: {
          id: job.id,
          sourceName: job.sourceName,
          sourceId: job.sourceId,
          createdOn: job.createdOn.toISOString(),
          sourceRetryCount: job.sourceRetryCount,
          failure: typeof message === "string" ? message : null,
        },
      });
    }
  }
  return entries
    .sort((a, b) => b.at - a.at)
    .slice(0, limit)
    .map(({ entry }) => entry);
}

export async function redriveDeadLetter(
  boss: PgBoss,
  role: WorkerRole,
  id: string,
): Promise<number> {
  return boss.redrive(`dead-letter.${role}`, { ids: [id] });
}
