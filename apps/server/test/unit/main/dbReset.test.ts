// F-94 runDbResetCli (A-58). TP-2.24 (e) to (g) and TP-2.29.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { runDbResetCli, seedAll } from "../../../src/main/dbReset.js";
import { createWorkerContainer } from "../../../src/platform/container.js";
import { seeders } from "../../../src/platform/db/seed.js";
import { ResetRefusedError, seedDevelopmentDatabase } from "../../../src/platform/db/reset.js";

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const REPO_ROOT = path.resolve(SERVER_DIR, "../..");
const SUPERUSER_URL = "postgres://postgres:postgres@localhost:5432/postgres";
const ROLES_JSON = JSON.stringify({
  budmon_app: { password: "a" },
  budmon_capture: { password: "c" },
  budmon_queue: { password: "q" },
  budmon_monitor: { password: "mo" },
  budmon_migrator: { password: "m" },
});

// TP-2.29 (g): a spy in place of the composition root's createWorkerContainer.
vi.mock("../../../src/platform/container.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/platform/container.js")>();
  return { ...actual, createWorkerContainer: vi.fn(actual.createWorkerContainer) };
});

type Deps = Parameters<typeof runDbResetCli>[1];

interface Harness {
  deps: Deps;
  reset: ReturnType<typeof vi.fn>;
  seed: ReturnType<typeof vi.fn>;
  seedAll: () => Promise<void>;
  readFile: ReturnType<typeof vi.fn>;
  stderr: string[];
}

function harness(
  env: Record<string, string | undefined> = { DEV_SUPERUSER_URL: SUPERUSER_URL },
  resetBehaviour: () => Promise<void> = () => Promise.resolve(),
): Harness {
  const stderr: string[] = [];
  const reset = vi.fn(resetBehaviour);
  const seed = vi.fn(() => Promise.resolve());
  const readFile = vi.fn(() => ROLES_JSON);
  const seedAll = (): Promise<void> => Promise.resolve();
  const deps = {
    env,
    readFile,
    resetDevelopmentDatabase: reset,
    seedDevelopmentDatabase: seed,
    seedAll,
    stderr: (line: string) => stderr.push(line),
  } as unknown as Deps;
  return { deps, reset, seed, seedAll, readFile, stderr };
}

describe("TP-2.24: runDbResetCli and --seed-only", () => {
  it("TP-2.24 (e): --seed-only calls only seedDevelopmentDatabase, with seedAll, and exits 0", async () => {
    const h = harness();

    const code = await runDbResetCli(["--seed-only"], h.deps);

    expect(code).toBe(0);
    expect(h.seed).toHaveBeenCalledTimes(1);
    expect(h.seed).toHaveBeenCalledWith(
      { appEnv: "development", superuserUrl: SUPERUSER_URL },
      { seed: h.seedAll },
    );
    expect(h.reset).not.toHaveBeenCalled();
    expect(h.readFile).not.toHaveBeenCalled();
  });

  it("TP-2.24 (f): no arguments calls only resetDevelopmentDatabase, with seed: true", async () => {
    const h = harness();

    const code = await runDbResetCli([], h.deps);

    expect(code).toBe(0);
    expect(h.reset).toHaveBeenCalledTimes(1);
    expect(h.reset.mock.calls[0]?.[0]).toMatchObject({ seed: true });
    expect(h.seed).not.toHaveBeenCalled();
  });

  it("TP-2.24 (g): --seed-only with --no-seed calls neither, prints the message and exits 64 without reading", async () => {
    const h = harness();

    const code = await runDbResetCli(["--seed-only", "--no-seed"], h.deps);

    expect(code).toBe(64);
    expect(h.stderr).toContain("--seed-only and --no-seed can't be combined");
    expect(h.reset).not.toHaveBeenCalled();
    expect(h.seed).not.toHaveBeenCalled();
    expect(h.readFile).not.toHaveBeenCalled();
  });
});

describe("TP-2.29: runDbResetCli arguments and environment", () => {
  it("TP-2.29 (a): an unknown argument exits 64 and reads nothing", async () => {
    const h = harness();

    const code = await runDbResetCli(["--bogus"], h.deps);

    expect(code).toBe(64);
    expect(h.stderr).toContain("Unknown argument: --bogus");
    expect(h.readFile).not.toHaveBeenCalled();
    expect(h.reset).not.toHaveBeenCalled();
    expect(h.seed).not.toHaveBeenCalled();
  });

  it("TP-2.29 (b): DEV_SUPERUSER_URL unset exits 64 and reads nothing", async () => {
    const h = harness({});

    const code = await runDbResetCli([], h.deps);

    expect(code).toBe(64);
    expect(h.stderr).toContain("DEV_SUPERUSER_URL is not set");
    expect(h.readFile).not.toHaveBeenCalled();
    expect(h.reset).not.toHaveBeenCalled();
  });

  it("TP-2.29 (c): defaults: roles from <repo>/.data/dev-secrets/roles.json, database budmon, development", async () => {
    const h = harness();

    await runDbResetCli([], h.deps);

    expect(h.readFile).toHaveBeenCalledWith(path.join(REPO_ROOT, ".data/dev-secrets/roles.json"));
    expect(h.reset).toHaveBeenCalledTimes(1);
    expect(h.reset.mock.calls[0]?.[0]).toMatchObject({
      superuserUrl: SUPERUSER_URL,
      databaseName: "budmon",
      appEnv: "development",
      migratorPassword: "m",
      seed: true,
    });
    expect(h.reset.mock.calls[0]?.[1]).toMatchObject({ seed: h.seedAll });
  });

  it("TP-2.29 (d): --no-seed with APP_ENV=test and DB_NAME=x", async () => {
    const h = harness({ DEV_SUPERUSER_URL: SUPERUSER_URL, APP_ENV: "test", DB_NAME: "x" });

    await runDbResetCli(["--no-seed"], h.deps);

    expect(h.reset.mock.calls[0]?.[0]).toMatchObject({
      appEnv: "test",
      databaseName: "x",
      seed: false,
    });
  });

  it("TP-2.29 (e): a ResetRefusedError exits 2", async () => {
    // A real ResetRefusedError, from F-20's own guard.
    const refused: unknown = await seedDevelopmentDatabase(
      { appEnv: "production", superuserUrl: SUPERUSER_URL },
      { seed: () => Promise.resolve() },
    ).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(refused).toBeInstanceOf(ResetRefusedError);
    if (!(refused instanceof ResetRefusedError)) throw new Error("expected a ResetRefusedError");
    const h = harness(undefined, () => Promise.reject(refused));

    expect(await runDbResetCli([], h.deps)).toBe(2);
  });

  it('TP-2.29 (f): another error, Error("y"), exits 1', async () => {
    const h = harness(undefined, () => Promise.reject(new Error("y")));

    expect(await runDbResetCli([], h.deps)).toBe(1);
  });

  it("TP-2.49x: ROLE_SECRETS_FILE, when set, is the file read", async () => {
    const h = harness({ DEV_SUPERUSER_URL: SUPERUSER_URL, ROLE_SECRETS_FILE: "/tmp/roles.json" });

    await runDbResetCli([], h.deps);

    expect(h.readFile).toHaveBeenCalledWith("/tmp/roles.json");
  });

  it("TP-2.29 (g): the real seedAll with an empty seeder list resolves without building a worker container (A-72)", async () => {
    expect(seeders).toEqual([]);

    await expect(seedAll({})).resolves.toBeUndefined();

    expect(vi.mocked(createWorkerContainer)).not.toHaveBeenCalled();
  });
});
