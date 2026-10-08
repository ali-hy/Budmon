// F-90: the API process. S-2 delivers start-up and configuration handling; the server arrives
// with S-4.
import { readFileSync } from "node:fs";
import { describeFailure } from "../platform/observability/describeFailure.js";
import { createLogger } from "../platform/observability/logger.js";
import { EXIT_CONFIG, loadConfigOrReport } from "../platform/config/startup.js";

function main(): void {
  const config = loadConfigOrReport("api", process.env, readFileSync, (line) =>
    process.stderr.write(`${line}\n`),
  );
  if (config === null) {
    process.exitCode = EXIT_CONFIG;
    return;
  }
  process.stderr.write("api: configuration is valid; the HTTP server arrives with S-4\n");
}

try {
  main();
} catch (error) {
  createLogger({
    service: "api",
    release: process.env["BUDMON_RELEASE"] ?? "dev",
    level: "error",
  }).error("startup_failed", describeFailure(error));
  process.exitCode = 1;
}
