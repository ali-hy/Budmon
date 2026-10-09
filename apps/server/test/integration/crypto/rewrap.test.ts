// F-117 rewrapApiSecrets / rewrapApiSecretsCommand, F-118 platform.capture-rewrap, F-96's
// sealedColumns feeding secrets:rewrap-api (A-26). TP-8.7, TP-8.8 and TP-8.16.
//
// TP-8.7's "one row updated concurrently between select and update" has no hook in F-117; the
// test wraps the database so that, just before the rewrap's UPDATE of the chosen row runs, another
// connection changes that row (re-sealed under k2), so the rewrap's `AND <col> = $old` matches 0.
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCli } from "../../../src/main/cli.js";
import { createApiContainer, createWorkerContainer } from "../../../src/platform/container.js";
import { createSealedColumnRegistry } from "../../../src/platform/crypto/sealedColumns.js";
import type { Database } from "../../../src/platform/db/types.js";
import { buildHandlerMap } from "../../../src/platform/queue/handlers.js";
import { buildApiContainer, observed, testApiConfigFor } from "../../support/api.js";
import { devApi, withFile, type Fixture } from "../../support/configEnv.js";
import { query } from "../../support/postgres.js";
import { recordingLogger } from "../../support/platform.js";
import {
  type ApiSecretsCipher,
  createApiSecretsCipher,
} from "../../../src/platform/crypto/apiSecrets.js";
import { createCaptureSealer } from "../../../src/platform/crypto/captureSealer.js";
import {
  type CaptureUnsealer,
  createLocalCaptureUnsealer,
} from "../../../src/platform/crypto/captureUnsealer.js";
import { keyVersionOf } from "../../../src/platform/crypto/envelope.js";
import { rewrapApiSecrets, rewrapApiSecretsCommand } from "../../../src/platform/crypto/rewrap.js";
import { createTestDatabase, type TestDatabase } from "../../support/testDatabase.js";
import { testWorkerConfig } from "../../support/worker.js";

const K1 = randomBytes(32);
const K2 = randomBytes(32);
const COLUMN_API = {
  table: "sealed_test",
  idColumn: "id",
  column: "secret",
  purpose: "test.secret",
  provider: "api" as const,
};
const IDS = [1, 2, 3, 4].map((n) => `0190a0b0-1c2d-7e3f-8a4b-${String(n).padStart(12, "0")}`);

async function sealedTable(testDb: TestDatabase, grantTo: string): Promise<void> {
  const url = testDb.urlAs("budmon_migrator");
  await query(url, "CREATE TABLE sealed_test (id uuid PRIMARY KEY, secret bytea)");
  await query(url, `GRANT SELECT, UPDATE ON sealed_test TO ${grantTo}`);
}

async function rows(testDb: TestDatabase): Promise<{ id: string; secret: Buffer }[]> {
  return (
    await query<{ id: string; secret: Buffer }>(
      testDb.urlAs("budmon_migrator"),
      "SELECT id::text AS id, secret FROM sealed_test ORDER BY id",
    )
  ).map((r) => ({ id: r.id, secret: Buffer.from(r.secret) }));
}

async function insert(testDb: TestDatabase, id: string, secret: Buffer): Promise<void> {
  await query(
    testDb.urlAs("budmon_migrator"),
    "INSERT INTO sealed_test (id, secret) VALUES ($1, $2)",
    [id, secret],
  );
}

function ciphers() {
  return {
    k1Only: createApiSecretsCipher({ current: "k1", keys: new Map([["k1", K1]]) }),
    current: createApiSecretsCipher({
      current: "k2",
      keys: new Map([
        ["k1", K1],
        ["k2", K2],
      ]),
    }),
  };
}

const ctx = (id: string) => ({ table: "sealed_test", rowId: id, purpose: "test.secret" });

/**
 * `db` with a hook: before any statement whose text starts with UPDATE and whose values include
 * `rowId`, `before()` runs once (another connection's change).
 */
function interceptUpdate(db: Database, rowId: string, before: () => Promise<void>): Database {
  let fired = false;
  const hook = async (text: unknown, values: unknown): Promise<void> => {
    const inner = typeof text === "string" ? undefined : (text as { text?: unknown }).text;
    const sql = typeof text === "string" ? text : typeof inner === "string" ? inner : "";
    const params = Array.isArray(values) ? values : ((text as { values?: unknown[] }).values ?? []);
    if (!fired && /^\s*update/i.test(sql) && params.some((v) => v === rowId)) {
      fired = true;
      await before();
    }
  };
  const wrapClient = <C extends { query: (...args: never[]) => unknown }>(client: C): C =>
    new Proxy(client, {
      get(target, prop, receiver) {
        if (prop === "query") {
          return async (text: unknown, values?: unknown) => {
            await hook(text, values);
            return (target.query as (...a: unknown[]) => unknown).call(target, text, values);
          };
        }
        const value: unknown = Reflect.get(target, prop, receiver);
        return typeof value === "function"
          ? (value as (...a: unknown[]) => unknown).bind(target)
          : value;
      },
    });
  const pool = new Proxy(db.pool, {
    get(target, prop, receiver) {
      if (prop === "connect") {
        return async () => wrapClient(await target.connect());
      }
      if (prop === "query") {
        return async (text: unknown, values?: unknown) => {
          await hook(text, values);
          return (target.query as (...a: unknown[]) => unknown).call(target, text, values);
        };
      }
      const value: unknown = Reflect.get(target, prop, receiver);
      return typeof value === "function"
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  });
  const handle = new Proxy(db.handle, {
    get(target, prop, receiver) {
      if (prop === "executeSql") {
        return async (text: string, values?: readonly unknown[]) => {
          await hook(text, values);
          return target.executeSql(text, values);
        };
      }
      return Reflect.get(target, prop, receiver) as unknown;
    },
  });
  return { ...db, pool, handle, close: () => db.close() };
}

describe("TP-8.7: rewrapApiSecrets (F-117)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    await sealedTable(testDb, "budmon_app");
  });

  afterAll(async () => {
    await testDb.drop();
  });

  it("TP-8.7: 3 rows under k1 and 1 under k2, one k1 row changed concurrently: {rewrapped 2, skipped 1}; every row ends under k2 and the rewrapped ones unseal to their plaintext", async () => {
    const { k1Only, current } = ciphers();
    const plaintexts = new Map(IDS.map((id, i) => [id, Buffer.from(`secret-${String(i)}`)]));
    for (const [i, id] of IDS.entries()) {
      const cipher: ApiSecretsCipher = i < 3 ? k1Only : current;
      await insert(testDb, id, cipher.seal(plaintexts.get(id) ?? Buffer.alloc(0), ctx(id)));
    }
    const raced = IDS[1] ?? "";
    const changedTo = Buffer.from("changed concurrently");
    const database = interceptUpdate(testDb.database, raced, async () => {
      await query(
        testDb.urlAs("budmon_migrator"),
        "UPDATE sealed_test SET secret = $2 WHERE id = $1",
        [raced, current.seal(changedTo, ctx(raced))],
      );
    });

    const result = await rewrapApiSecrets({
      database,
      cipher: current,
      columns: [COLUMN_API],
      logger: recordingLogger(),
    });

    expect(result).toEqual({ rewrapped: 2, skipped: 1 });
    for (const row of await rows(testDb)) {
      expect(keyVersionOf(row.secret), row.id).toBe("k2");
      const expected = row.id === raced ? changedTo : plaintexts.get(row.id);
      expect(current.unseal(row.secret, ctx(row.id)), row.id).toEqual(expected);
    }
  });
});

describe("TP-8.8: the platform.capture-rewrap job (F-118)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase("budmon_capture");
    await sealedTable(testDb, "budmon_capture");
  });

  afterAll(async () => {
    await testDb.drop();
  });

  it("TP-8.8: rows sealed under local:1 are re-sealed under local:2 by the job handler", async () => {
    const pem = () => {
      const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 3072 });
      return {
        publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
        privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      };
    };
    const one = pem();
    const two = pem();
    const old = createCaptureSealer({ publicKeyPem: one.publicPem, keyVersion: "local:1" });
    const plain = new Map(IDS.slice(0, 2).map((id) => [id, Buffer.from(`capture-${id}`)]));
    for (const [id, p] of plain) await insert(testDb, id, old.seal(p, ctx(id)));
    // The local unsealer holding both keys (test override): local:1 rows open with key one.
    const unsealOne = createLocalCaptureUnsealer({ privateKeyPem: one.privatePem });
    const unsealTwo = createLocalCaptureUnsealer({ privateKeyPem: two.privatePem });
    const both: CaptureUnsealer = {
      unseal: (envelope, c) =>
        keyVersionOf(envelope) === "local:1"
          ? unsealOne.unseal(envelope, c)
          : unsealTwo.unseal(envelope, c),
    };
    const sealedColumns = createSealedColumnRegistry();
    sealedColumns.register({ ...COLUMN_API, provider: "capture" });
    const obs = observed();
    const config = testWorkerConfig(
      testDb.endpoint,
      testDb.name,
      "capture",
      { CAPTURE_KEY_VERSION: "local:2" },
      { CAPTURE_PUBLIC_KEY_FILE: two.publicPem, CAPTURE_PRIVATE_KEY_FILE: two.privatePem },
    );
    const c = createWorkerContainer(config, {
      ...obs.overrides,
      sealedColumns,
      ...({ captureUnsealer: both } as object),
    });
    try {
      const handler = buildHandlerMap(c).get("platform.capture-rewrap");
      expect(handler).toBeDefined();

      await handler?.(
        {},
        {
          jobId: "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0b",
          attempt: 1,
          createdOn: (await import("@budmon/shared")).Temporal.Now.instant(),
          logger: c.logger,
          signal: new AbortController().signal,
        },
      );

      for (const row of await rows(testDb)) {
        expect(keyVersionOf(row.secret), row.id).toBe("local:2");
        expect(await unsealTwo.unseal(row.secret, ctx(row.id)), row.id).toEqual(plain.get(row.id));
      }
    } finally {
      await c.close();
    }
  });
});

describe("TP-8.16: the container's sealed-column registry feeds secrets:rewrap-api (F-96, F-117, A-26)", () => {
  const ring = JSON.stringify({
    current: "k2",
    keys: { k1: K1.toString("base64"), k2: K2.toString("base64") },
  });
  const fixture = (): Fixture => {
    const f = devApi();
    withFile(f, "API_SECRETS_KEYS_FILE", ring);
    return f;
  };

  it("TP-8.16: with sealed_test registered through the override, rewrapApiSecretsCommand re-wraps both k1 rows to k2", async () => {
    const { k1Only } = ciphers();
    const sealedColumns = createSealedColumnRegistry();
    sealedColumns.register(COLUMN_API);
    const built = await buildApiContainer({ sealedColumns }, {}, fixture);
    try {
      await sealedTable(built.testDb, "budmon_app");
      for (const id of IDS.slice(0, 2))
        await insert(built.testDb, id, k1Only.seal(Buffer.from(id), ctx(id)));

      const container: unknown = built.container;
      const result = await rewrapApiSecretsCommand(
        container as Parameters<typeof rewrapApiSecretsCommand>[0],
      );

      expect(result).toEqual({ rewrapped: 2, skipped: 0 });
      for (const row of await rows(built.testDb)) expect(keyVersionOf(row.secret)).toBe("k2");
    } finally {
      await built.close();
    }
  });

  it("TP-8.16: createApiContainer(config) with no override has sealedColumns.all() = []", async () => {
    const testDb = await createTestDatabase();
    const c = createApiContainer(
      testApiConfigFor(testDb, "budmon_app", {}, fixture),
      observed().overrides,
    );
    try {
      expect(c.sealedColumns.all()).toEqual([]);
    } finally {
      await c.close();
      await testDb.drop();
    }
  });

  it("TP-8.16 (A-250): CLI secrets:rewrap-api (kind api) on that database (nothing registered) prints {rewrapped:0, skipped:0} and exits 0", async () => {
    const testDb = await createTestDatabase();
    const dir = mkdtempSync(path.join(tmpdir(), "budmon-rewrap-cli-"));
    try {
      await sealedTable(testDb, "budmon_app");
      // A-250: kind api; the helpers' minimal api environment (devApi) with its files written
      // into dir, DB_* for this file's database as budmon_app, and the {current k2, keys k1, k2}
      // API_SECRETS_KEYS_FILE.
      const f = fixture();
      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(f.env)) {
        if (value === undefined) continue;
        const content = f.files.get(value);
        if (content === undefined) env[key] = value;
        else {
          const file = path.join(dir, key.toLowerCase());
          writeFileSync(file, content);
          env[key] = file;
        }
      }
      const passwordFile = path.join(dir, "db_password");
      writeFileSync(
        passwordFile,
        `${(await import("../../support/postgres.js")).TEST_ROLE_PASSWORDS.budmon_app}\n`,
      );
      Object.assign(env, {
        DB_HOST: testDb.endpoint.host,
        DB_PORT: String(testDb.endpoint.port),
        DB_NAME: testDb.name,
        DB_USER: "budmon_app",
        DB_PASSWORD_FILE: passwordFile,
        OBJECT_STORE_FS_ROOT: path.join(dir, "objects"),
      });
      const stdout: string[] = [];
      const stderr: string[] = [];

      const code = await runCli(["secrets:rewrap-api"], env, {
        stdout: (l) => stdout.push(l),
        stderr: (l) => stderr.push(l),
      });

      expect(code, stderr.join("\n")).toBe(0);
      expect(stdout.map((l) => JSON.parse(l) as unknown)).toEqual([{ rewrapped: 0, skipped: 0 }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await testDb.drop();
    }
  });
});
