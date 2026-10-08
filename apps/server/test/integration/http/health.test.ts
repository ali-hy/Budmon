// F-57 health routes and checkReadiness. TP-4.13, plus extra cases TP-4.35x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
//
// (c) runs checkReadiness directly: F-57's registerHealthRoutes deps are not specified, and
// createApiServer reads the journal from the image's drizzle/ folder, so the route itself can't be
// given a journal one entry ahead (raised).
import { createServer } from "node:net";
import type { FastifyInstance } from "fastify";
import { afterAll, describe, expect, it } from "vitest";
import { checkReadiness } from "../../../src/platform/http/health.js";
import { createApiServer } from "../../../src/platform/http/server.js";
import { buildApiContainer, injectJson, type BuiltContainer } from "../../support/api.js";
import { connectDatabase } from "../../support/platform.js";
import { TEST_ROLE_PASSWORDS } from "../../support/postgres.js";

const cleanups: (() => Promise<void>)[] = [];

afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
});

async function serve(built: BuiltContainer): Promise<FastifyInstance> {
  const app = await createApiServer(built.container);
  cleanups.push(
    () => built.close(),
    () => app.close(),
  );
  await app.ready();
  return app;
}

function closedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

describe("TP-4.13 (a): database up", () => {
  it("TP-4.13 (a): /health/ready is 200 ready and /health/live 200 ok, both no-store", async () => {
    const app = await serve(await buildApiContainer());

    const ready = await injectJson(app, "GET", "/health/ready");
    const live = await injectJson(app, "GET", "/health/live");

    expect([ready.status, ready.json()]).toEqual([200, { status: "ready" }]);
    expect([live.status, live.json()]).toEqual([200, { status: "ok" }]);
    expect(ready.headers["cache-control"]).toBe("no-store");
    expect(live.headers["cache-control"]).toBe("no-store");
  });
});

describe("TP-4.13 (b): the pool points at a closed port", () => {
  it("TP-4.13 (b): /health/ready is 503 database_unreachable; /health/live stays 200", async () => {
    const port = await closedPort();
    const unreachable = connectDatabase(
      { host: "127.0.0.1", port },
      "budmon_app",
      TEST_ROLE_PASSWORDS.budmon_app,
      "budmon",
    );
    const built = await buildApiContainer({ database: unreachable });
    const app = await serve(built);

    const ready = await injectJson(app, "GET", "/health/ready");
    const live = await injectJson(app, "GET", "/health/live");

    expect([ready.status, ready.json()]).toEqual([
      503,
      { status: "not_ready", reason: "database_unreachable" },
    ]);
    expect(ready.headers["cache-control"]).toBe("no-store");
    expect([live.status, live.json()]).toEqual([200, { status: "ok" }]);
  }, 30_000);
});

describe("TP-4.13 (c): production with the journal one entry ahead of the database", () => {
  it("TP-4.13 (c): checkReadiness is not ready, schema_behind", async () => {
    const built = await buildApiContainer();
    cleanups.push(() => built.close());
    const migrator = built.testDb.connectAs("budmon_migrator");
    cleanups.push(() => migrator.close());
    await migrator.handle.executeSql("CREATE SCHEMA IF NOT EXISTS drizzle");
    await migrator.handle.executeSql(
      "CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint)",
    );
    await migrator.handle.executeSql(
      "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('h0', 1760000000000)",
    );

    const result = await checkReadiness({
      db: migrator,
      appEnv: "production",
      journal: [
        { hash: "h0", when: 1760000000000 },
        { hash: "h1", when: 1760000100000 },
      ],
    });

    expect(result).toEqual({ ready: false, reason: "schema_behind" });
  });
});

describe("TP-4.35x: checkReadiness, further cases (F-57)", () => {
  it("TP-4.35x: in development a journal ahead of the database is still ready", async () => {
    const built = await buildApiContainer();
    cleanups.push(() => built.close());

    const result = await checkReadiness({
      db: built.container.database,
      appEnv: "development",
      journal: [{ hash: "h1", when: 1760000100000 }],
    });

    expect(result).toEqual({ ready: true });
  });

  it("TP-4.35x: in production with no migrations table and an empty journal, ready", async () => {
    const built = await buildApiContainer();
    cleanups.push(() => built.close());

    expect(
      await checkReadiness({ db: built.container.database, appEnv: "production", journal: [] }),
    ).toEqual({ ready: true });
  });
});
