// The built entries (F-24) under plain Node. TP-2.6: api with DB_HOST unset (F-90, F-11), also
// through the production start command `node --import ./dist/main/instrument.js` (A-147).
// TP-4.24: the built api, started with that command, exports server spans to an OTLP recorder.
// TP-2.37: migrate's failure log on stderr with stdout empty, and on success exactly the report
// line on stdout (F-92, A-81, A-109). Both share one build: two files building into the
// same dist/ in parallel would race. Extra case TP-2.75x; IDs ending in "x" are test-architect
// additions, not LLD test-plan IDs.
import { spawn, spawnSync } from "node:child_process";
import { createServer as createHttpServer, type Server } from "node:http";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapCluster } from "../../../src/platform/db/clusterBootstrap.js";
import { runSchemaStep } from "../../../src/platform/db/schemaStep.js";
import { devApi } from "../../support/configEnv.js";
import { connectDatabase, schemaStepInput } from "../../support/platform.js";
import {
  TEST_ROLE_PASSWORDS,
  startFreshPostgres,
  type FreshPostgres,
} from "../../support/postgres.js";
import { createTestDatabase, type TestDatabase } from "../../support/testDatabase.js";

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

const START_COMMAND = ["--import", "./dist/main/instrument.js", "dist/main/api.js"];

describe("TP-2.6: node dist/main/api.js with DB_HOST unset", () => {
  it("TP-2.6: through the production start command, the same: exit 78 and the problems (A-147)", async () => {
    const port = await freePort();

    const result = spawnSync(process.execPath, START_COMMAND, {
      cwd: SERVER_DIR,
      env: {
        PATH: process.env["PATH"] ?? "",
        APP_ENV: "development",
        PORT: String(port),
        HOST: "127.0.0.1",
      },
      encoding: "utf8",
      timeout: 30_000,
    });

    expect(result.status, result.stderr).toBe(78);
    expect(result.stderr).toContain("Configuration invalid:");
    expect(result.stderr.split("\n")).toContain("  - DB_HOST: required");
    expect(await portAcceptsConnections(port)).toBe(false);
  });

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

// ---- TP-2.13 (A-150, A-160): migrate exits 5 on an invalid journal ----

describe("TP-2.13: node dist/main/migrate.js with an invalid journal (A-150, A-160)", () => {
  /**
   * A copy of the built server (package.json and dist, node_modules linked) whose drizzle/ holds
   * the given journal and .sql files, so serverRoot()'s drizzle folder is the test's. The database
   * points at a closed port: exit 5 shows the journal was read before any connection.
   */
  async function migrateWith(journal: string, sqlFiles: readonly string[]) {
    const dir = mkdtempSync(path.join(tmpdir(), "budmon-migrate-journal-"));
    try {
      writeFileSync(path.join(dir, "package.json"), '{"name":"@budmon/server","type":"module"}\n');
      cpSync(path.join(SERVER_DIR, "dist"), path.join(dir, "dist"), { recursive: true });
      symlinkSync(path.join(SERVER_DIR, "node_modules"), path.join(dir, "node_modules"));
      mkdirSync(path.join(dir, "drizzle", "meta"), { recursive: true });
      writeFileSync(path.join(dir, "drizzle", "meta", "_journal.json"), journal);
      for (const file of sqlFiles) writeFileSync(path.join(dir, "drizzle", file), "SELECT 1;\n");
      const passwordFile = path.join(dir, "password");
      const rolesFile = path.join(dir, "roles.json");
      writeFileSync(passwordFile, "pw\n");
      writeFileSync(
        rolesFile,
        JSON.stringify(
          Object.fromEntries(
            [
              "budmon_app",
              "budmon_capture",
              "budmon_queue",
              "budmon_monitor",
              "budmon_migrator",
            ].map((role) => [role, { password: `pw-${role}` }]),
          ),
        ),
      );
      const port = await freePort();
      return spawnSync(process.execPath, ["dist/main/migrate.js"], {
        cwd: dir,
        env: {
          PATH: process.env["PATH"] ?? "",
          APP_ENV: "development",
          DB_HOST: "127.0.0.1",
          DB_PORT: String(port),
          DB_NAME: "budmon",
          DB_USER: "budmon_migrator",
          DB_PASSWORD_FILE: passwordFile,
          ROLE_SECRETS_FILE: rolesFile,
        },
        encoding: "utf8",
        timeout: 60_000,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it.each([
    ["{}", "{}", []],
    ["not json", "not json CANARYMESSAGE7f3a", []],
    ["a bad tag", JSON.stringify({ entries: [{ idx: 0, tag: "bad tag", when: 1 }] }), []],
    [
      "a non-integer when",
      JSON.stringify({ entries: [{ idx: 0, tag: "0000_a", when: "x" }] }),
      ["0000_a.sql"],
    ],
    ["a missing .sql file", JSON.stringify({ entries: [{ idx: 0, tag: "0000_a", when: 1 }] }), []],
  ] as const)(
    "TP-2.13: a journal with %s makes migrate exit 5, before touching the database",
    async (_label, journal, sql) => {
      const result = await migrateWith(journal, sql);

      expect(result.status, `${result.stdout}${result.stderr}`).toBe(5);
      expect(`${result.stdout}${result.stderr}`).not.toContain("CANARY");
      expect(`${result.stdout}${result.stderr}`).not.toContain("ECONNREFUSED");
    },
  );
});

// ---- TP-4.24 ----

interface OtlpRequest {
  path: string;
  body: unknown;
}

interface ExportedSpan {
  scope: string;
  kind: number;
  name: string;
  spanId: string;
  parentSpanId: string;
  attributes: Record<string, unknown>;
}

/** Every span in the recorded OTLP/HTTP JSON trace exports. */
function exportedSpans(requests: readonly OtlpRequest[]): ExportedSpan[] {
  const spans: ExportedSpan[] = [];
  for (const r of requests.filter((x) => x.path.endsWith("/v1/traces"))) {
    const body = r.body as {
      resourceSpans?: {
        scopeSpans?: {
          scope?: { name?: string };
          spans?: {
            kind?: number;
            name?: string;
            spanId?: string;
            parentSpanId?: string;
            attributes?: { key: string; value: Record<string, unknown> }[];
          }[];
        }[];
      }[];
    };
    for (const rs of body.resourceSpans ?? []) {
      for (const ss of rs.scopeSpans ?? []) {
        for (const span of ss.spans ?? []) {
          spans.push({
            scope: ss.scope?.name ?? "",
            kind: span.kind ?? 0,
            name: span.name ?? "",
            spanId: span.spanId ?? "",
            parentSpanId: span.parentSpanId ?? "",
            attributes: Object.fromEntries(
              (span.attributes ?? []).map((a) => [a.key, Object.values(a.value)[0]]),
            ),
          });
        }
      }
    }
  }
  return spans;
}

/** Whether `ancestorId` is on `span`'s parent chain. */
function hasAncestor(
  span: ExportedSpan,
  ancestorId: string,
  all: readonly ExportedSpan[],
): boolean {
  const byId = new Map(all.map((s) => [s.spanId, s]));
  let current: ExportedSpan | undefined = span;
  for (let i = 0; i < 50 && current !== undefined; i++) {
    if (current.parentSpanId === ancestorId) return true;
    current = byId.get(current.parentSpanId);
  }
  return false;
}

/** The recorded values of telemetry_attributes_dropped_total with drop_kind "unexpected". */
function unexpectedDrops(requests: readonly OtlpRequest[]): number[] {
  const values: number[] = [];
  for (const r of requests.filter((x) => x.path.endsWith("/v1/metrics"))) {
    const body = r.body as {
      resourceMetrics?: {
        scopeMetrics?: {
          metrics?: {
            name?: string;
            sum?: {
              dataPoints?: {
                asInt?: number | string;
                asDouble?: number;
                attributes?: { key: string; value: Record<string, unknown> }[];
              }[];
            };
          }[];
        }[];
      }[];
    };
    for (const rm of body.resourceMetrics ?? []) {
      for (const sm of rm.scopeMetrics ?? []) {
        for (const m of sm.metrics ?? []) {
          if (m.name !== "telemetry_attributes_dropped_total") continue;
          for (const p of m.sum?.dataPoints ?? []) {
            const kind = (p.attributes ?? []).find((a) => a.key === "drop_kind");
            if (kind !== undefined && Object.values(kind.value)[0] === "unexpected") {
              values.push(Number(p.asInt ?? p.asDouble ?? 0));
            }
          }
        }
      }
    }
  }
  return values;
}

const SPAN_KIND_SERVER = 2;

describe("TP-4.24: the built api exports spans through the production start command (A-147)", () => {
  let recorder: Server;
  let recorderPort: number;
  const received: OtlpRequest[] = [];
  let testDb: TestDatabase;
  let configDir: string;

  beforeAll(async () => {
    recorder = createHttpServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let body: unknown = null;
        try {
          body = JSON.parse(text);
        } catch {
          body = null;
        }
        received.push({ path: req.url ?? "", body });
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
      });
    });
    await new Promise<void>((resolve) => recorder.listen(0, "127.0.0.1", resolve));
    const address = recorder.address();
    recorderPort = typeof address === "object" && address !== null ? address.port : 0;
    testDb = await createTestDatabase("budmon_app");
    configDir = mkdtempSync(path.join(tmpdir(), "budmon-api-otel-"));
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      recorder.close(() => {
        resolve();
      });
    });
    await testDb.drop();
    rmSync(configDir, { recursive: true, force: true });
  });

  /** The development api fixture, with its secret files written to configDir, for APP_ENV test. */
  function apiEnv(port: number): Record<string, string> {
    const f = devApi();
    const env: Record<string, string> = { PATH: process.env["PATH"] ?? "" };
    for (const [key, value] of Object.entries(f.env)) {
      if (value === undefined) continue;
      const content = f.files.get(value);
      if (content === undefined) {
        env[key] = value;
      } else {
        const file = path.join(configDir, path.basename(value));
        writeFileSync(file, content);
        env[key] = file;
      }
    }
    const passwordFile = path.join(configDir, "app_password");
    writeFileSync(passwordFile, `${TEST_ROLE_PASSWORDS.budmon_app}\n`);
    return {
      ...env,
      APP_ENV: "test",
      PORT: String(port),
      HOST: "127.0.0.1",
      DB_HOST: testDb.endpoint.host,
      DB_PORT: String(testDb.endpoint.port),
      DB_NAME: testDb.name,
      DB_USER: "budmon_app",
      DB_PASSWORD_FILE: passwordFile,
      OBJECT_STORE_FS_ROOT: path.join(configDir, "objects"),
      OTEL_EXPORTER_OTLP_ENDPOINT: `http://localhost:${String(recorderPort)}`,
    };
  }

  /** Starts the built api with `args`, makes one request, stops it with SIGTERM. */
  async function runApi(
    args: readonly string[],
  ): Promise<{ status: number; code: number | null; output: string }> {
    const port = await freePort();
    const child = spawn(process.execPath, args, {
      cwd: SERVER_DIR,
      env: apiEnv(port),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (c: Buffer) => (output += c.toString()));
    child.stderr.on("data", (c: Buffer) => (output += c.toString()));
    const exited = new Promise<number | null>((resolve) => {
      child.on("exit", (code) => {
        resolve(code);
      });
    });
    try {
      const deadline = Date.now() + 30_000;
      while (!(await portAcceptsConnections(port))) {
        if (Date.now() > deadline || child.exitCode !== null) {
          throw new Error(`the api didn't start:\n${output}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const res = await fetch(`http://127.0.0.1:${String(port)}/api/v1/meta/client-config`);
      await res.text();
      child.kill("SIGTERM");
      return { status: res.status, code: await exited, output };
    } finally {
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  }

  it("TP-4.24: with --import, one http SERVER span GET /api/v1/*, @fastify/otel's request under it, hooks named by hook, no unexpected drops, metrics (A-163, A-164)", async () => {
    received.length = 0;

    const run = await runApi(START_COMMAND);

    expect(run.status, run.output).toBe(200);
    const all = exportedSpans(received);
    const seen = JSON.stringify(all.map((s) => [s.scope, s.kind, s.name]));
    const servers = all.filter(
      (s) => s.kind === SPAN_KIND_SERVER && s.scope === "@opentelemetry/instrumentation-http",
    );
    expect(servers, seen).toHaveLength(1);
    const server = servers[0];
    expect(server?.name).toBe("GET /api/v1/*");
    const fastify = all.filter((s) => s.scope === "@fastify/otel");
    const requests = fastify.filter((s) => s.name === "request");
    expect(requests.length, seen).toBeGreaterThanOrEqual(1);
    expect(
      requests.some((s) => hasAncestor(s, server?.spanId ?? "", all)),
      seen,
    ).toBe(true);
    for (const span of fastify) expect(span.name, seen).toMatch(/^[A-Za-z]+$/);
    expect(
      all.filter((s) => s.name === "span"),
      seen,
    ).toEqual([]);
    expect(unexpectedDrops(received).filter((v) => v > 0)).toEqual([]);
    expect(received.some((r) => r.path.endsWith("/v1/metrics"))).toBe(true);
  }, 90_000);

  it("TP-4.24: without --import, no server span arrives (guards the start command)", async () => {
    received.length = 0;

    const run = await runApi(["dist/main/api.js"]);

    expect(run.status, run.output).toBe(200);
    expect(exportedSpans(received).filter((s) => s.kind === SPAN_KIND_SERVER)).toEqual([]);
  }, 90_000);
});
