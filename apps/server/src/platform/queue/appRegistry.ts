// A-202: the production job registry: the platform's definitions plus each module's (modules add
// their arrays in their own slices, as with handlers.ts).
import { platformMaintenanceJobs } from "../maintenance/maintenanceJobs.js";
import type { JobDefinition } from "./jobs.js";
import { createJobRegistry, type JobRegistry } from "./registry.js";

export const platformJobDefinitions: readonly JobDefinition<unknown>[] = [
  ...platformMaintenanceJobs,
];

export function buildJobRegistry(): JobRegistry {
  return createJobRegistry([...platformJobDefinitions]);
}
