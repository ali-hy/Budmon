// F-96: the composition root. S-2 built the base members; S-4 adds the reporter, the metrics and
// the API members used so far (auth hook, module routes, A-26). Later slices add the rest.
import { metrics as metricsApi } from "@opentelemetry/api";
import { systemClock, uuidv7Generator, type Clock, type IdGenerator } from "@budmon/shared";
import type { FastifyInstance } from "fastify";
import type { Config } from "./config/schema.js";
import { createDatabase } from "./db/client.js";
import type { Database } from "./db/types.js";
import { noAuthHook, type AuthHook } from "./http/context.js";
import type { ErrorReporter } from "./observability/errorReporter.js";
import { createLogger, type Logger } from "./observability/logger.js";
import {
  createMetrics,
  registerPlatformMetrics,
  type PlatformMetrics,
} from "./observability/metrics.js";
import { initSentry } from "./observability/sentry.js";

export interface BaseContainer {
  config: Config;
  logger: Logger;
  clock: Clock;
  ids: IdGenerator;
  database: Database;
  metrics: PlatformMetrics;
  reporter: ErrorReporter;
  close(): Promise<void>;
}

export type WorkerContainer = BaseContainer;

export interface ApiContainer extends BaseContainer {
  authHook: AuthHook;
  /** A-26: plain Fastify routes modules register (F-55 step 4b). */
  moduleRoutes: ((app: FastifyInstance) => void)[];
}

function platformMetrics(): PlatformMetrics {
  // The drop callback counts into the registered metrics, which exist once registration returns.
  const holder: { metrics?: PlatformMetrics } = {};
  holder.metrics = registerPlatformMetrics(
    createMetrics(metricsApi.getMeter("budmon"), (n) => {
      holder.metrics?.telemetryAttributesDropped.add(n, {
        signal: "metrics",
        drop_kind: "unexpected",
      });
    }),
  );
  return holder.metrics;
}

function createBase(
  config: Config,
  service: string,
  overrides: Partial<BaseContainer>,
): BaseContainer {
  const logger =
    overrides.logger ??
    createLogger({
      service,
      release: config.release,
      level: config.logLevel,
      appEnv: config.appEnv,
    });
  const database =
    overrides.database ??
    createDatabase(config.db, {
      applicationName: `budmon-${service}`,
      onError: () => {
        logger.error("database_pool_error");
      },
    });
  return {
    config,
    logger,
    clock: overrides.clock ?? systemClock,
    ids: overrides.ids ?? uuidv7Generator,
    database,
    metrics: overrides.metrics ?? platformMetrics(),
    reporter:
      overrides.reporter ??
      initSentry({
        ...(config.sentryDsn === undefined ? {} : { dsn: config.sentryDsn }),
        environment: config.appEnv,
        release: config.release,
        service,
      }),
    close: async () => {
      await database.close();
    },
  };
}

export function createApiContainer(
  config: Config,
  overrides: Partial<ApiContainer> = {},
): ApiContainer {
  return {
    ...createBase(config, "api", overrides),
    authHook: overrides.authHook ?? noAuthHook,
    moduleRoutes: overrides.moduleRoutes ?? [],
  };
}

export function createWorkerContainer(
  config: Config,
  overrides: Partial<WorkerContainer> = {},
): WorkerContainer {
  return createBase(config, "worker", overrides);
}
