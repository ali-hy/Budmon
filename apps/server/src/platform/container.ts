// F-96: the composition root, base members only (S-2). Later slices add the rest.
import { systemClock, uuidv7Generator, type Clock, type IdGenerator } from "@budmon/shared";
import type { Config } from "./config/schema.js";
import { createDatabase } from "./db/client.js";
import type { Database } from "./db/types.js";
import { createLogger, type Logger } from "./observability/logger.js";

export interface BaseContainer {
  config: Config;
  logger: Logger;
  clock: Clock;
  ids: IdGenerator;
  database: Database;
  close(): Promise<void>;
}

export type WorkerContainer = BaseContainer;
export type ApiContainer = BaseContainer;

function createBase(
  config: Config,
  service: string,
  overrides: Partial<BaseContainer>,
): BaseContainer {
  const logger =
    overrides.logger ?? createLogger({ service, release: config.release, level: config.logLevel });
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
    close: async () => {
      await database.close();
    },
  };
}

export function createApiContainer(
  config: Config,
  overrides: Partial<ApiContainer> = {},
): ApiContainer {
  return createBase(config, "api", overrides);
}

export function createWorkerContainer(
  config: Config,
  overrides: Partial<WorkerContainer> = {},
): WorkerContainer {
  return createBase(config, "worker", overrides);
}
