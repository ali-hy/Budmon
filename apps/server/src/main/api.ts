// F-90: the API process.
import { readFileSync } from "node:fs";
import { EXIT_CONFIG, loadConfigOrReport } from "../platform/config/startup.js";
import { createApiContainer } from "../platform/container.js";
import { createApiServer } from "../platform/http/server.js";
import { describeFailure } from "../platform/observability/describeFailure.js";
import { installFatalHandlers, startupState } from "../platform/observability/fatal.js";
import { createLogger } from "../platform/observability/logger.js";
import { startTelemetry } from "../platform/observability/otel.js";

const state = startupState("api", process.env);
installFatalHandlers(state);

/** Runs `fn`, giving up after `ms` (each shutdown step has a 10 s deadline). */
async function withDeadline(fn: () => Promise<unknown>, ms: number): Promise<void> {
  await Promise.race([fn(), new Promise((resolve) => setTimeout(resolve, ms))]);
}

async function main(): Promise<number | null> {
  const config = loadConfigOrReport("api", process.env, readFileSync, (line) =>
    process.stderr.write(`${line}\n`),
  );
  if (config?.api === undefined) return EXIT_CONFIG;

  const logger = createLogger({ service: "api", release: config.release, level: config.logLevel });
  state.logger = logger;
  // Telemetry first, so its instrumentations patch pg, http and Fastify as they load.
  const telemetry = startTelemetry(
    {
      ...(config.otlpEndpoint === undefined ? {} : { endpoint: config.otlpEndpoint }),
      service: "api",
      release: config.release,
      environment: config.appEnv,
    },
    {
      onDrop: (signal, kind, n) => {
        container.metrics.telemetryAttributesDropped.add(n, { signal, drop_kind: kind });
      },
    },
  );
  const container = createApiContainer(config, { logger });
  state.reporter = container.reporter;
  const app = await createApiServer(container);
  await app.listen({ port: config.api.port, host: config.api.host });
  logger.info("api_started", { release: config.release, service: "api" });

  const stop = (): void => {
    void (async () => {
      await withDeadline(() => app.close(), 10_000);
      await withDeadline(() => container.close(), 10_000);
      await withDeadline(() => telemetry.shutdown(), 10_000);
      process.exit(0);
    })();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  return null;
}

main().then(
  (code) => {
    if (code !== null) process.exitCode = code;
  },
  (error: unknown) => {
    state.logger.error("startup_failed", describeFailure(error), error);
    process.exitCode = 1;
  },
);
