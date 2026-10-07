// F-20 guards. TP-2.16 (a) (the refusals; (b) is integration/db/reset.test.ts) and TP-2.24 (a)
// to (d) for seedDevelopmentDatabase, plus extra cases TP-2.35x for the rest of step 1's guard.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  ResetRefusedError,
  resetDevelopmentDatabase,
  seedDevelopmentDatabase,
} from "../../../src/platform/db/reset.js";
import { testRoleSecrets } from "../../support/postgres.js";

const RESET_MESSAGE = "db:reset only runs against a local development or test database";
const SEED_MESSAGE = "db:seed only runs against a local development or test database";

type ResetInput = Parameters<typeof resetDevelopmentDatabase>[0];
type ResetDeps = Parameters<typeof resetDevelopmentDatabase>[1];

function resetInput(appEnv: ResetInput["appEnv"], host: string): ResetInput {
  return {
    appEnv,
    superuserUrl: `postgres://postgres:postgres@${host}:5432/postgres`,
    databaseName: "budmon",
    migratorPassword: "migrator-password",
    roleSecrets: testRoleSecrets(),
    seed: true,
  };
}

function fakeResetDeps(): {
  runSchemaStep: Mock<ResetDeps["runSchemaStep"]>;
  seed: Mock<ResetDeps["seed"]>;
} {
  return { runSchemaStep: vi.fn<ResetDeps["runSchemaStep"]>(), seed: vi.fn<ResetDeps["seed"]>() };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

beforeEach(() => {
  vi.stubEnv("TESTCONTAINERS", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("TP-2.16 (a): resetDevelopmentDatabase refuses before any connection", () => {
  it.each([
    ['appEnv "production" on localhost', "production", "localhost"],
    ["host db.example.com in development", "development", "db.example.com"],
  ])(
    "TP-2.16 (a): %s throws ResetRefusedError and calls no dependency",
    async (_label, appEnv, host) => {
      const deps = fakeResetDeps();

      const error = await rejection(
        resetDevelopmentDatabase(resetInput(appEnv as ResetInput["appEnv"], host), deps),
      );

      expect(error).toBeInstanceOf(ResetRefusedError);
      expect((error as Error).message).toBe(RESET_MESSAGE);
      expect(deps.runSchemaStep).not.toHaveBeenCalled();
      expect(deps.seed).not.toHaveBeenCalled();
    },
  );

  it.each([["rehearsal"]])("TP-2.35x: appEnv %s is refused", async (appEnv) => {
    const deps = fakeResetDeps();

    const error = await rejection(
      resetDevelopmentDatabase(resetInput(appEnv as ResetInput["appEnv"], "localhost"), deps),
    );

    expect(error).toBeInstanceOf(ResetRefusedError);
    expect(deps.runSchemaStep).not.toHaveBeenCalled();
  });
});

describe("TP-2.24: seedDevelopmentDatabase", () => {
  function seedInput(appEnv: string, host: string) {
    return {
      appEnv: appEnv as ResetInput["appEnv"],
      superuserUrl: `postgres://postgres:postgres@${host}:5432/postgres`,
    };
  }

  it("TP-2.24 (a): development on localhost calls seed once", async () => {
    const seed = vi.fn(() => Promise.resolve());

    await seedDevelopmentDatabase(seedInput("development", "localhost"), { seed });

    expect(seed).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["(b) production on localhost", "production", "localhost"],
    ["(c) development on db.example.com", "development", "db.example.com"],
  ])("TP-2.24 %s throws ResetRefusedError and doesn't seed", async (_label, appEnv, host) => {
    const seed = vi.fn(() => Promise.resolve());

    const error = await rejection(seedDevelopmentDatabase(seedInput(appEnv, host), { seed }));

    expect(error).toBeInstanceOf(ResetRefusedError);
    expect((error as Error).message).toBe(SEED_MESSAGE);
    expect(seed).not.toHaveBeenCalled();
  });

  it("TP-2.24 (d): a failing seed rejects with that error", async () => {
    const failure = new Error("x");
    const seed = vi.fn(() => Promise.reject(failure));

    const error = await rejection(
      seedDevelopmentDatabase(seedInput("development", "localhost"), { seed }),
    );

    expect(error).toBe(failure);
  });

  it.each([["127.0.0.1"], ["[::1]"], ["host.docker.internal"]])(
    "TP-2.35x: the local host %s is allowed in test",
    async (host) => {
      const seed = vi.fn(() => Promise.resolve());

      await seedDevelopmentDatabase(seedInput("test", host), { seed });

      expect(seed).toHaveBeenCalledTimes(1);
    },
  );

  it("TP-2.35x: TESTCONTAINERS=1 allows another host", async () => {
    vi.stubEnv("TESTCONTAINERS", "1");
    const seed = vi.fn(() => Promise.resolve());

    await seedDevelopmentDatabase(seedInput("test", "db.example.com"), { seed });

    expect(seed).toHaveBeenCalledTimes(1);
  });

  it("TP-2.35x: TESTCONTAINERS=1 doesn't allow production", async () => {
    vi.stubEnv("TESTCONTAINERS", "1");
    const seed = vi.fn(() => Promise.resolve());

    const error = await rejection(
      seedDevelopmentDatabase(seedInput("production", "db.example.com"), { seed }),
    );

    expect(error).toBeInstanceOf(ResetRefusedError);
    expect(seed).not.toHaveBeenCalled();
  });
});
