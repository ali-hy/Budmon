// F-22 / F-95: `pnpm dev`, the local development stack.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import path from "node:path";
import { parseEnv } from "node:util";
import { pathToFileURL } from "node:url";
import pg from "pg";
import type { DbLoginRole } from "../platform/config/schema.js";
import { resetDevelopmentDatabase } from "../platform/db/reset.js";
import { runSchemaStep } from "../platform/db/schemaStep.js";
import { repoRoot, seedAll } from "./dbReset.js";

const ROLES: readonly DbLoginRole[] = [
  "budmon_app",
  "budmon_capture",
  "budmon_queue",
  "budmon_monitor",
  "budmon_migrator",
];

/**
 * Step 0 (A-63): creates `.env` from `.env.example` when it's missing (never overwriting it),
 * parses it, and returns it merged under `processEnv` (a variable set in the shell wins).
 */
export function ensureDevEnv(
  root: string,
  processEnv: Readonly<Record<string, string | undefined>>,
  deps: {
    exists(path: string): boolean;
    copyFile(from: string, to: string): void;
    readFile(path: string): string;
    log(line: string): void;
  },
): Record<string, string> {
  const envFile = path.join(root, ".env");
  if (!deps.exists(envFile)) {
    deps.copyFile(path.join(root, ".env.example"), envFile);
    deps.log("Created .env from .env.example");
  }
  const parsed = parseEnv(deps.readFile(envFile)) as Record<string, string>;
  const merged: Record<string, string> = { ...parsed };
  for (const [name, value] of Object.entries(processEnv)) {
    if (value !== undefined) merged[name] = value;
  }
  return merged;
}

function log(line: string): void {
  process.stderr.write(`[dev] ${line}\n`);
}

function compose(root: string, args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync(
    "docker",
    ["compose", "-p", "budmon-dev", "-f", path.join(root, "infra", "compose.yaml"), ...args],
    { encoding: "utf8" },
  );
}

async function waitForPostgres(root: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = compose(root, ["exec", "-T", "postgres", "pg_isready", "-U", "postgres"]);
    if (result.status === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Postgres didn't become ready within 60 s");
}

function randomSecret(bytes: number): string {
  return randomBytes(bytes).toString("base64");
}

/** Step 2: `.data/dev-secrets/*` with random values, only where a file is missing. */
export function ensureDevSecrets(root: string): void {
  const dir = path.join(root, ".data", "dev-secrets");
  mkdirSync(dir, { recursive: true });
  const write = (name: string, content: () => string): void => {
    const file = path.join(dir, name);
    if (!existsSync(file)) writeFileSync(file, content(), { mode: 0o600 });
  };
  const rolePasswords = Object.fromEntries(
    ROLES.map((role) => [role, randomBytes(18).toString("base64url")]),
  ) as Record<DbLoginRole, string>;
  write("roles.json", () =>
    JSON.stringify(
      Object.fromEntries(ROLES.map((role) => [role, { password: rolePasswords[role] }])),
      null,
      2,
    ),
  );
  const roles = JSON.parse(readFileSync(path.join(dir, "roles.json"), "utf8")) as Record<
    DbLoginRole,
    { password: string }
  >;
  write("db_password", () => `${roles.budmon_app.password}\n`);
  write("queue_password", () => `${roles.budmon_queue.password}\n`);
  for (const name of ["cursor_key", "rate_limit_key", "mailbox_key", "dev_objects_key"]) {
    write(name, () => `${randomSecret(32)}\n`);
  }
  for (const name of ["api_secrets.json", "recovery_keys.json"]) {
    write(name, () => JSON.stringify({ current: "k1", keys: { k1: randomSecret(32) } }));
  }
  if (!existsSync(path.join(dir, "capture_public.pem"))) {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 3072 });
    write("capture_public.pem", () => publicKey.export({ type: "spki", format: "pem" }).toString());
    write("capture_private.pem", () =>
      privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    );
  }
}

async function databaseExists(superuserUrl: string, name: string): Promise<boolean> {
  const client = new pg.Client({ connectionString: superuserUrl });
  await client.connect();
  try {
    const result = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    return result.rowCount !== 0;
  } finally {
    await client.end();
  }
}

function startProcess(
  name: string,
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
): ChildProcess {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: "pipe" });
  const prefix = (stream: NodeJS.ReadableStream, out: NodeJS.WriteStream): void => {
    let pending = "";
    stream.on("data", (chunk: Buffer) => {
      const lines = (pending + chunk.toString("utf8")).split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) out.write(`[${name}] ${line}\n`);
    });
  };
  prefix(child.stdout, process.stdout);
  prefix(child.stderr, process.stderr);
  return child;
}

async function main(): Promise<number> {
  const root = repoRoot();
  const env = ensureDevEnv(root, process.env, {
    exists: existsSync,
    copyFile: copyFileSync,
    readFile: (file) => readFileSync(file, "utf8"),
    log,
  });

  if (spawnSync("docker", ["info"], { stdio: "ignore" }).status !== 0) {
    log("Docker isn't running");
    return 1;
  }
  compose(root, ["up", "-d"]);
  await waitForPostgres(root);
  ensureDevSecrets(root);

  const superuserUrl = env["DEV_SUPERUSER_URL"];
  if (superuserUrl === undefined) {
    log("DEV_SUPERUSER_URL is not set");
    return 1;
  }
  const databaseName = env["DB_NAME"] ?? "budmon";
  if (!(await databaseExists(superuserUrl, databaseName))) {
    const roleSecrets = JSON.parse(
      readFileSync(path.join(root, ".data", "dev-secrets", "roles.json"), "utf8"),
    ) as Record<DbLoginRole, { password: string }>;
    await resetDevelopmentDatabase(
      {
        appEnv: "development",
        superuserUrl,
        databaseName,
        migratorPassword: roleSecrets.budmon_migrator.password,
        roleSecrets,
        seed: true,
      },
      { runSchemaStep, seed: () => seedAll(env) },
    );
  }

  const serverDir = path.join(root, "apps", "server");
  const children = [
    startProcess("api", "pnpm", ["exec", "tsx", "watch", "src/main/api.ts"], serverDir, env),
    startProcess("worker", "pnpm", ["exec", "tsx", "watch", "src/main/worker.ts"], serverDir, {
      ...env,
      WORKER_ROLES: "capture,general",
    }),
  ];
  const webDir = path.join(root, "apps", "web");
  if (existsSync(path.join(webDir, "package.json"))) {
    children.push(startProcess("web", "pnpm", ["exec", "vite"], webDir, env));
  }
  const stop = (): void => {
    for (const child of children) child.kill("SIGTERM");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await Promise.all(
    children.map(
      (child) =>
        new Promise<void>((resolve) =>
          child.once("exit", () => {
            resolve();
          }),
        ),
    ),
  );
  return 0;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  process.exitCode = await main();
}
