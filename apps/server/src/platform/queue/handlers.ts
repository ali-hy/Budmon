// F-91's handler map: the platform's handlers plus each module's (A-26). Modules add theirs in
// their own slices.
import type { WorkerContainer } from "../container.js";
import { captureRewrapJob, rewrapCaptureSecrets } from "../crypto/rewrap.js";
import { maintenanceHandlers } from "../maintenance/maintenanceJobs.js";
import type { JobHandler } from "./workers.js";

export function buildHandlerMap(c: WorkerContainer): ReadonlyMap<string, JobHandler> {
  return new Map<string, JobHandler>([
    ...maintenanceHandlers(c),
    [
      captureRewrapJob.name,
      async (_payload, ctx) => {
        await rewrapCaptureSecrets(c, ctx.logger);
      },
    ],
  ]);
}
