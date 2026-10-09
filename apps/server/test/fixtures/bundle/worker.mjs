// Test fixture (A-201), owned by the test-architect: the built worker with test jobs.
//
// Spawned as `node --import ./dist/main/instrument.js test/fixtures/bundle/worker.mjs` from
// apps/server: F-89 strips `.mjs`, so this process gets worker telemetry. It imports runWorker
// from the bundle (importing doesn't run worker.js's entry guard) and passes the test registry
// and handlers for TP-6.13 and TP-6.15. The test.* queues exist in every template copy (A-202).
import { readFileSync } from "node:fs";
import pg from "pg";
import { z } from "zod";
import { runWorker } from "../../../dist/main/worker.js";

function job(name) {
  return {
    name,
    role: "general",
    payload: z.object({ n: z.number().int() }),
    retryLimit: 0,
    retryDelaySeconds: 30,
    retryBackoff: false,
    expireInSeconds: 900,
    policy: "standard",
  };
}

const definitions = [job("test.slow"), job("test.forever"), job("test.select")];

const registry = {
  all: () => definitions,
  forRole: (role) => definitions.filter((d) => d.role === role),
  get: (name) => definitions.find((d) => d.name === name),
  deadLetterQueue: (role) => `dead-letter.${role}`,
};

const handlers = new Map([
  // TP-6.13: a 2 s job.
  ["test.slow", () => new Promise((resolve) => setTimeout(resolve, 2000))],
  // TP-6.13 (A-180): a job that never finishes.
  ["test.forever", () => new Promise(() => undefined)],
  // TP-6.15: SELECT 1 on a connection of its own, inside the job's span.
  [
    "test.select",
    async () => {
      const client = new pg.Client({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT),
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: readFileSync(process.env.DB_PASSWORD_FILE, "utf8").trim(),
      });
      await client.connect();
      try {
        await client.query("SELECT 1");
      } finally {
        await client.end();
      }
    },
  ],
]);

await runWorker(process.env, { registry, handlers });
