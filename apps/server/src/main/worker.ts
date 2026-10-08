// F-91: the worker process. S-2 delivers start-up and configuration handling; the workers
// arrive with S-6.
import { readFileSync } from "node:fs";
import { describeFailure } from "../platform/observability/describeFailure.js";
import { createLogger } from "../platform/observability/logger.js";
import { EXIT_CONFIG, loadConfigOrReport } from "../platform/config/startup.js";

function main(): void {
  const config = loadConfigOrReport("worker", process.env, readFileSync, (line) =>
    process.stderr.write(`${line}\n`),
  );
  if (config === null) {
    process.exitCode = EXIT_CONFIG;
    return;
  }
  process.stderr.write("worker: configuration is valid; the queue workers arrive with S-6\n");
}

try {
  main();
} catch (error) {
  createLogger({
    service: "worker",
    release: process.env["BUDMON_RELEASE"] ?? "dev",
    level: "error",
  }).error("startup_failed", describeFailure(error));
  process.exitCode = 1;
}
