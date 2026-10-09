// F-79: the worker's heartbeat, read by the healthcheck entry (F-175) and exported as a gauge.
import { writeFileSync } from "node:fs";
import type { Clock } from "@budmon/shared";
import type { Logger } from "../observability/logger.js";
import type { PlatformMetrics } from "../observability/metrics.js";

export function startHeartbeat(deps: {
  metrics: PlatformMetrics;
  logger: Logger;
  clock: Clock;
  service: string;
  intervalMs?: number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  writeFile?: (path: string, data: string) => void;
  path?: string;
}): { stop(): void; last(): number } {
  const file = deps.path ?? "/tmp/heartbeat";
  const write =
    deps.writeFile ??
    ((p: string, data: string) => {
      writeFileSync(p, data);
    });
  let last = 0;
  let warned = false;
  const beat = (): void => {
    last = deps.clock.now().epochMilliseconds / 1000;
    try {
      write(file, String(Math.floor(last)));
    } catch {
      if (!warned) {
        warned = true;
        deps.logger.warn("heartbeat_write_failed");
      }
    }
  };
  beat();
  const timer = (deps.setInterval ?? setInterval)(beat, deps.intervalMs ?? 15_000);
  deps.metrics.observeWorkerHeartbeat(() => [{ value: last, labels: { service: deps.service } }]);
  return {
    stop: () => {
      if (typeof timer === "object" && timer !== null && "unref" in timer) {
        clearInterval(timer as NodeJS.Timeout);
      } else if (typeof timer === "number") {
        clearInterval(timer);
      }
    },
    last: () => last,
  };
}
