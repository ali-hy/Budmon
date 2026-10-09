// F-91: the worker process, started as `node --import ./dist/main/instrument.js
// dist/main/worker.js` (A-147). S-2 and S-3 deliver start-up, configuration handling and the process's
// fatal-error handlers (A-118); the rest arrives with S-4 (api) and S-6 (worker).
import { readFileSync } from "node:fs";
import { EXIT_CONFIG, loadConfigOrReport } from "../platform/config/startup.js";
import { describeFailure } from "../platform/observability/describeFailure.js";
import { installFatalHandlers, startupState } from "../platform/observability/fatal.js";
import { createLogger } from "../platform/observability/logger.js";
import { initSentry } from "../platform/observability/sentry.js";
import { getTelemetry } from "../platform/observability/telemetryHandle.js";

const state = startupState("worker", process.env);
installFatalHandlers(state);

function main(): void {
  const config = loadConfigOrReport("worker", process.env, readFileSync, (line) =>
    process.stderr.write(`${line}\n`),
  );
  if (config === null) {
    process.exitCode = EXIT_CONFIG;
    return;
  }
  state.logger = createLogger({
    service: "worker",
    release: config.release,
    level: config.logLevel,
    appEnv: config.appEnv,
  });
  state.reporter = initSentry({
    ...(config.sentryDsn === undefined ? {} : { dsn: config.sentryDsn }),
    environment: config.appEnv,
    release: config.release,
    service: "worker",
  });
  process.stderr.write("worker: configuration is valid; the queue workers arrive with S-6\n");
  // Telemetry was started by the `--import` preload (F-89, A-147); nothing runs yet, so it stops.
  void getTelemetry().shutdown();
}

try {
  main();
} catch (error) {
  state.logger.error("startup_failed", describeFailure(error));
  process.exitCode = 1;
}
