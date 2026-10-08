// The built entries (F-24) under plain Node. TP-2.6: api with DB_HOST unset (F-90, F-11).
// TP-2.37: migrate's failure log on stderr with stdout empty, and on success exactly the report
// line on stdout (F-92, A-81, A-109). Both share one build: two files building into the
// same dist/ in parallel would race. Extra case TP-2.75x; IDs ending in "x" are test-architect
// additions, not LLD test-plan IDs.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapCluster } from "../../../src/platform/db/clusterBootstrap.js";
import { runSchemaStep } from "../../../src/platform/db/schemaStep.js";
import { connectDatabase, schemaStepInput } from "../../support/platform.js";
import {
  TEST_ROLE_PASSWORDS,
  startFreshPostgres,
  type FreshPostgres,
} from "../../support/postgres.js";

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const REPO_ROOT = path.resolve(SERVER_DIR, "../..");

function freePort(): Promise<number> {
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

function portAcceptsConnections(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      resolve(false);
    });
  });
}

beforeAll(() => {
  const build = spawnSync("pnpm", ["--filter", "@budmon/server", "build"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (build.status !== 0) {
    throw new Error(`pnpm --filter @budmon/server build failed:\n${build.stdout}${build.stderr}`);
  }
}, 180_000);

describe("TP-2.6: node dist/main/api.js with DB_HOST unset", () => {
  it("TP-2.6: prints the configuration problems, exits 78 and opens no port", async () => {
    const port = await freePort();
    const env: Record<string, string> = {
      PATH: process.env["PATH"] ?? "",
      APP_ENV: "development",
      PORT: String(port),
      HOST: "127.0.0.1",
    };

    const result = spawnSync(process.execPath, ["dist/main/api.js"], {
      cwd: SERVER_DIR,
      env,
      encoding: "utf8",
      timeout: 30_000,
    });

    expect(result.status, result.stderr).toBe(78);
    expect(result.stderr).toContain("Configuration invalid:");
    expect(result.stderr.split("\n")).toContain("  - DB_HOST: required");
    expect(`${result.stdout}${result.stderr}`).not.toContain("api_started");
    expect(await portAcceptsConnections(port)).toBe(false);
  });
});

// ---- TP-2.37 ----

const MIGRATOR_PASSWORD = "bundle-migrator-Rk4pass";
const WRONG_PASSWORD = "wrong-Zt8pSECRET";
const DATABASE = "budmon_bundle_migrate";
const OK_DATABASE = "budmon_bundle_ok";

describe("TP-2.37: node dist/main/migrate.js failure logs (A-81)", () => {
  let pg: FreshPostgres;
  let dir: string;

  beforeAll(async () => {
    pg = await startFreshPostgres();
    const client = await pg.superuserClient();
    try {
      await bootstrapCluster(client, {
        databaseName: DATABASE,
        migrator: { password: MIGRATOR_PASSWORD },
      });
    } finally {
      await client.end();
    }
    dir = mkdtempSync(path.join(tmpdir(), "budmon-migrate-bundle-"));
  });

  afterAll(async () => {
    rmSync(dir, { recursive: true, force: true });
    await pg.stop();
  });

  /** A valid development migrate configuration (absolute *_FILE paths) for host and port. */
  function migrateEnv(
    host: string,
    port: number,
    password: string,
    database: string = DATABASE,
  ): Record<string, string> {
    const passwordFile = path.join(dir, `password-${String(port)}`);
    const rolesFile = path.join(dir, "roles.json");
    writeFileSync(passwordFile, `${password}\n`);
    writeFileSync(
      rolesFile,
      JSON.stringify(
        Object.fromEntries(
          ["budmon_app", "budmon_capture", "budmon_queue", "budmon_monitor", "budmon_migrator"].map(
            (role) => [role, { password: role === "budmon_migrator" ? password : `pw-${role}` }],
          ),
        ),
      ),
    );
    return {
      PATH: process.env["PATH"] ?? "",
      APP_ENV: "development",
      DB_HOST: host,
      DB_PORT: String(port),
      DB_NAME: database,
      DB_USER: "budmon_migrator",
      DB_PASSWORD_FILE: passwordFile,
      ROLE_SECRETS_FILE: rolesFile,
    };
  }

  function runMigrateBundle(env: Record<string, string>): {
    status: number | null;
    stdout: string;
    stderr: string;
  } {
    const result = spawnSync(process.execPath, ["dist/main/migrate.js"], {
      cwd: SERVER_DIR,
      env,
      encoding: "utf8",
      timeout: 60_000,
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  /** Every JSON line of the output whose event is startup_failed. */
  function startupFailures(output: string): Record<string, unknown>[] {
    return output
      .split("\n")
      .flatMap((line): Record<string, unknown>[] => {
        try {
          const parsed: unknown = JSON.parse(line);
          return isRecord(parsed) ? [parsed] : [];
        } catch {
          return [];
        }
      })
      .filter((entry) => entry["event"] === "startup_failed");
  }

  function expectNoEndpoint(output: string, host: string, port: number, password: string): void {
    expect(output).not.toContain(password);
    expect(output).not.toContain(host);
    expect(output).not.toMatch(new RegExp(`(?<![0-9])${String(port)}(?![0-9])`));
  }

  it("TP-2.37 (a): a wrong password exits 1 with one startup_failed line carrying errorCode 28P01", () => {
    const env = migrateEnv(pg.host, pg.port, WRONG_PASSWORD);

    const { status, stdout, stderr } = runMigrateBundle(env);
    const output = `${stdout}${stderr}`;

    expect(status, output).toBe(1);
    // A-109: the log goes to stderr; stdout carries only migrate's report, so it's empty here.
    expect(stdout).toBe("");
    const failures = startupFailures(stderr);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.["errorCode"]).toBe("28P01");
    expectNoEndpoint(output, pg.host, pg.port, WRONG_PASSWORD);
  });

  it("TP-2.37 (b): DB_HOST at a closed port exits 1 with one startup_failed line carrying errorCode ECONNREFUSED", async () => {
    const closedPort = await freePort();
    const env = migrateEnv("127.0.0.1", closedPort, MIGRATOR_PASSWORD);

    const { status, stdout, stderr } = runMigrateBundle(env);
    const output = `${stdout}${stderr}`;

    expect(status, output).toBe(1);
    expect(stdout).toBe("");
    const failures = startupFailures(stderr);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.["errorCode"]).toBe("ECONNREFUSED");
    expectNoEndpoint(output, "127.0.0.1", closedPort, MIGRATOR_PASSWORD);
  });

  // The control for (a): with the right password the run gets past authentication. What happens
  // next (the schema step on a bare bootstrapped database) isn't what this case is about.
  it("TP-2.75x: the right password on the same database isn't a 28P01 failure", () => {
    const { stdout, stderr } = runMigrateBundle(migrateEnv(pg.host, pg.port, MIGRATOR_PASSWORD));

    const codes = startupFailures(`${stdout}${stderr}`).map((entry) => entry["errorCode"]);
    expect(codes).not.toContain("28P01");
  });

  // A-109 / F-92 step 4: on success, stdout holds exactly the report line. A database of its own,
  // bootstrapped and pushed (as the global setup does), so migrate mode has everything it needs.
  describe("TP-2.37: on success stdout is exactly the report line (A-109)", () => {
    let okPg: FreshPostgres;

    beforeAll(async () => {
      okPg = await startFreshPostgres();
      const client = await okPg.superuserClient();
      try {
        await bootstrapCluster(client, {
          databaseName: OK_DATABASE,
          migrator: { password: TEST_ROLE_PASSWORDS.budmon_migrator },
        });
      } finally {
        await client.end();
      }
      const migrator = connectDatabase(
        okPg,
        "budmon_migrator",
        TEST_ROLE_PASSWORDS.budmon_migrator,
        OK_DATABASE,
      );
      try {
        await runSchemaStep(schemaStepInput(migrator, "push"));
      } finally {
        await migrator.close();
      }
    });

    afterAll(async () => {
      await okPg.stop();
    });

    it("TP-2.37: exit 0, stdout one JSON report line with zero migrations applied", () => {
      const { status, stdout, stderr } = runMigrateBundle(
        migrateEnv(okPg.host, okPg.port, TEST_ROLE_PASSWORDS.budmon_migrator, OK_DATABASE),
      );

      expect(status, `${stdout}${stderr}`).toBe(0);
      const lines = stdout.split("\n").filter((line) => line !== "");
      expect(lines).toHaveLength(1);
      const report: unknown = JSON.parse(lines[0] ?? "");
      expect(report).toMatchObject({ migrationsApplied: 0 });
      expect(startupFailures(stdout)).toEqual([]);
    });
  });
});
