// F-142 the filesystem object store and F-145 the development objects route, through a development
// API container (F-96's objectStore) and its server (F-55 step 6). TP-10.2, plus extra cases
// TP-10.11x. IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { canonicalJson, fixedClock } from "@budmon/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiServer } from "../../../src/platform/http/server.js";
import { buildApiContainer, injectJson, type BuiltContainer } from "../../support/api.js";
import { devApi, withFile } from "../../support/configEnv.js";
import { type ObjectStore } from "../../../src/platform/storage/objectStore.js";
import { EXPORT_ID, USER, exportKey, failure, keysOf } from "../../support/s10.js";
import { buildWorkerContainer } from "../../support/worker.js";

const NOW = "2026-10-07T12:00:00Z";
const NOT_FOUND = { defined: true, code: "NOT_FOUND", status: 404, message: "Not found" };
const NAME = "budmon-export-2026-10-07.zip";
const OTHER_USER = "0190a0b0-1c2d-7e3f-8a4b-00000000beef";
const OTHER_KEY = exportKey("0190a0b0-1c2d-7e3f-8a4b-00000000cafe", "zip", OTHER_USER);

const signingKey = randomBytes(32);
const root = mkdtempSync(path.join(tmpdir(), "budmon-objects-"));
const clock = fixedClock(NOW);
let built: BuiltContainer;
let app: FastifyInstance;
let store: ObjectStore;

beforeAll(async () => {
  built = await buildApiContainer(
    { clock },
    { OBJECT_STORE_KIND: "fs", OBJECT_STORE_FS_ROOT: root },
    () => {
      const f = devApi();
      withFile(f, "DEV_OBJECTS_SIGNING_KEY_FILE", signingKey.toString("base64"));
      return f;
    },
  );
  store = built.container.objectStore;
  app = await createApiServer(built.container);
  await app.ready();
}, 60_000);

afterAll(async () => {
  await app.close();
  await built.close();
  rmSync(root, { recursive: true, force: true });
});

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** The token in a presigned /dev/objects URL, split into its parts. */
function tokenOf(url: URL): {
  token: string;
  payloadPart: string;
  signature: string;
  payload: Record<string, unknown>;
} {
  const token = url.pathname.slice("/dev/objects/".length);
  const [payloadPart = "", signature = ""] = token.split(".");
  return {
    token,
    payloadPart,
    signature,
    payload: JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >,
  };
}

/** A token for `payload`, signed with the test signing key as F-142 signs. */
function signed(payload: Record<string, unknown>): string {
  const payloadPart = b64url(canonicalJson(payload));
  return `${payloadPart}.${b64url(createHmac("sha256", signingKey).update(payloadPart).digest())}`;
}

describe("TP-10.2: the filesystem store (F-142, F-140)", () => {
  it("TP-10.2: put writes <root>/<bucket>/<key>; list gives the key with the file's mtime; delete and a missing delete; deletePrefix counts", async () => {
    const other = "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0d";
    await store.put("exports", exportKey(), Buffer.from("zip-bytes"), "application/zip");
    await store.put("exports", exportKey(other, "csv"), Buffer.from("csv"), "text/csv");
    const file = path.join(root, "exports", exportKey());

    expect(readFileSync(file, "utf8")).toBe("zip-bytes");
    const listed: { key: string; ns: bigint }[] = [];
    for await (const e of store.list("exports", `users/${USER}/`)) {
      listed.push({ key: e.key, ns: e.lastModified.epochNanoseconds });
    }
    expect(listed.map((e) => e.key).sort()).toEqual([exportKey(), exportKey(other, "csv")].sort());
    // A-292: not rounded, from a bigint fs.stat.
    expect(listed.find((e) => e.key === exportKey())?.ns).toBe(
      statSync(file, { bigint: true }).mtimeNs,
    );

    await store.delete("exports", exportKey(other, "csv"));
    await expect(store.delete("exports", exportKey(other, "csv"))).resolves.toBeUndefined();
    expect(await keysOf(store, "exports", "users/")).toEqual([exportKey()]);

    const extra = exportKey("0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0e", "json");
    await store.put("exports", extra, Buffer.from("{}"), "application/json");
    expect(await store.deletePrefix("exports", `users/${USER}/`)).toBe(2);
    expect(existsSync(file)).toBe(false);
  });
});

describe("TP-10.2: the development objects route (F-145, A-22)", () => {
  beforeAll(async () => {
    await store.put("exports", exportKey(), Buffer.from("zip-bytes"), "application/zip");
  });

  it("TP-10.2: presign then GET: 200, the body, Cache-Control no-store, exactly Content-Disposition attachment, and a token payload without n", async () => {
    const url = await store.presignGet("exports", exportKey(), 600);

    const res = await app.inject({ method: "GET", url: url.pathname });

    expect(url.pathname.startsWith("/dev/objects/")).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("zip-bytes");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["content-disposition"]).toBe("attachment");
    const { payload } = tokenOf(url);
    expect(payload).toMatchObject({ b: "exports", k: exportKey() });
    expect("n" in payload).toBe(false);
    // A-290: exp is integer epoch seconds, floor(now / 1000) + ttl.
    expect(payload["exp"]).toBe(Math.floor(clock.now().epochMilliseconds / 1000) + 600);
  });

  it(`TP-10.2: presign with downloadName ${NAME} then GET: Content-Disposition attachment; filename="${NAME}"`, async () => {
    const url = await store.presignGet("exports", exportKey(), 600, { downloadName: NAME });

    const res = await app.inject({ method: "GET", url: url.pathname });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toBe(`attachment; filename="${NAME}"`);
    expect(tokenOf(url).payload["n"]).toBe(NAME);
  });

  it("TP-10.2: a tampered token (its last character) is a 404 NOT_FOUND envelope", async () => {
    const url = await store.presignGet("exports", exportKey(), 600);
    const { token } = tokenOf(url);
    const last = token.at(-1) === "A" ? "B" : "A";

    const res = await injectJson(app, "GET", `/dev/objects/${token.slice(0, -1)}${last}`);

    expect(res.status).toBe(404);
    expect(res.json()).toEqual(NOT_FOUND);
  });

  // Review B-4: the payload changed, the original signature part kept.
  it("TP-10.11x (B-4): (a) k set to another user's existing export, with the original signature, is a 404 NOT_FOUND envelope", async () => {
    await store.put("exports", OTHER_KEY, Buffer.from("not yours"), "application/zip");
    const url = await store.presignGet("exports", exportKey(), 600);
    const { payload, signature } = tokenOf(url);

    const res = await injectJson(
      app,
      "GET",
      `/dev/objects/${b64url(canonicalJson({ ...payload, k: OTHER_KEY }))}.${signature}`,
    );

    expect(res.status).toBe(404);
    expect(res.json()).toEqual(NOT_FOUND);
  });

  it("TP-10.11x (B-4): (b) exp + 3600 with the original signature is a 404 NOT_FOUND envelope", async () => {
    const url = await store.presignGet("exports", exportKey(), 600);
    const { payload, signature } = tokenOf(url);

    const res = await injectJson(
      app,
      "GET",
      `/dev/objects/${b64url(canonicalJson({ ...payload, exp: Number(payload["exp"]) + 3600 }))}.${signature}`,
    );

    expect(res.status).toBe(404);
    expect(res.json()).toEqual(NOT_FOUND);
  });

  it("TP-10.11x (B-4): (c) one character flipped in the middle of the signature is a 404 NOT_FOUND envelope", async () => {
    const url = await store.presignGet("exports", exportKey(), 600);
    const { payloadPart, signature } = tokenOf(url);
    const mid = Math.floor(signature.length / 2);
    const flipped = `${signature.slice(0, mid)}${signature[mid] === "A" ? "B" : "A"}${signature.slice(mid + 1)}`;

    const res = await injectJson(app, "GET", `/dev/objects/${payloadPart}.${flipped}`);

    expect(res.status).toBe(404);
    expect(res.json()).toEqual(NOT_FOUND);
  });

  it('TP-10.2: a token correctly signed with the test key whose n is a"b is a 404 NOT_FOUND envelope', async () => {
    const url = await store.presignGet("exports", exportKey(), 600, { downloadName: NAME });
    const { payload } = tokenOf(url);

    const res = await injectJson(app, "GET", `/dev/objects/${signed({ ...payload, n: 'a"b' })}`);

    expect(res.status).toBe(404);
    expect(res.json()).toEqual(NOT_FOUND);
  });

  it('TP-10.11x: the same payload re-signed with the test key (n unchanged) is served, so the a"b refusal is the n check', async () => {
    const url = await store.presignGet("exports", exportKey(), 600, { downloadName: NAME });

    const res = await app.inject({
      method: "GET",
      url: `/dev/objects/${signed(tokenOf(url).payload)}`,
    });

    expect(res.statusCode).toBe(200);
  });

  it("TP-10.11x: a valid token for a key with no file is a 404 NOT_FOUND envelope", async () => {
    const missing = exportKey(EXPORT_ID.replace(/c$/, "f"), "csv");
    const url = await store.presignGet("exports", missing, 600);

    const res = await injectJson(app, "GET", url.pathname);

    expect(res.status).toBe(404);
    expect(res.json()).toEqual(NOT_FOUND);
  });

  it("TP-10.2 (A-304): a 100-character downloadName (a token over 100 characters) is served with that name", async () => {
    const name = `${"a".repeat(96)}.zip`;
    const url = await store.presignGet("exports", exportKey(), 600, { downloadName: name });

    const res = await app.inject({ method: "GET", url: url.pathname });

    expect(url.pathname.length - "/dev/objects/".length).toBeGreaterThan(100);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toBe(`attachment; filename="${name}"`);
  });

  it("TP-10.2 (A-304): an empty token is a 404 NOT_FOUND envelope", async () => {
    const res = await injectJson(app, "GET", "/dev/objects/");

    expect(res.status).toBe(404);
    expect(res.json()).toEqual(NOT_FOUND);
  });

  // Review B-5: tokens that pass the HMAC, so only the A-304 bounds can refuse them.
  it("TP-10.2 (A-304): a valid token followed by /x is a 404 NOT_FOUND envelope", async () => {
    const url = await store.presignGet("exports", exportKey(), 600);

    const res = await injectJson(app, "GET", `${url.pathname}/x`);

    expect(res.status).toBe(404);
    expect(res.json()).toEqual(NOT_FOUND);
  });

  it("TP-10.2 (A-304): a correctly signed token padded to exactly 2048 characters is served; padded past 2048 it's a 404 NOT_FOUND envelope", async () => {
    const url = await store.presignGet("exports", exportKey(), 600);
    const { payload } = tokenOf(url);
    // base64url can't produce every length: 2048 is reachable, 2049 isn't, so 2050 is "over".
    const padded = (length: number): string => {
      for (let n = 0; n < 4096; n += 1) {
        const token = signed({ ...payload, pad: "x".repeat(n) });
        if (token.length === length) return token;
        if (token.length > length) break;
      }
      throw new Error(`no padding gives a ${String(length)}-character token`);
    };

    const atLimit = await app.inject({ method: "GET", url: `/dev/objects/${padded(2048)}` });
    const over = await injectJson(app, "GET", `/dev/objects/${padded(2050)}`);

    expect(atLimit.statusCode).toBe(200);
    expect(over.status).toBe(404);
    expect(over.json()).toEqual(NOT_FOUND);
  });

  // Last: it moves the shared clock. Review B-3: F-145 accepts while exp >= floor(now / 1000).
  it("TP-10.2 (A-290): a fresh token is served at exactly exp seconds and at exp s + 999 ms; at exp + 1 s it's a 404 NOT_FOUND envelope", async () => {
    const url = await store.presignGet("exports", exportKey(), 60);
    const exp = Number(tokenOf(url).payload["exp"]);
    clock.advance({ milliseconds: exp * 1000 - clock.now().epochMilliseconds });

    const atExp = await app.inject({ method: "GET", url: url.pathname });
    clock.advance({ milliseconds: 999 });
    const lastMs = await app.inject({ method: "GET", url: url.pathname });
    clock.advance({ milliseconds: 1 });
    const after = await injectJson(app, "GET", url.pathname);

    expect(atExp.statusCode).toBe(200);
    expect(lastMs.statusCode).toBe(200);
    expect(after.status).toBe(404);
    expect(after.json()).toEqual(NOT_FOUND);
  });
});

describe("TP-10.2 (A-303): only the API presigns fs objects", () => {
  it("TP-10.2 (A-303): an API with APP_ENV=test and the fs store presigns, and GET is 200", async () => {
    const testRoot = mkdtempSync(path.join(tmpdir(), "budmon-objects-test-env-"));
    const api = await buildApiContainer(
      {},
      { APP_ENV: "test", OBJECT_STORE_KIND: "fs", OBJECT_STORE_FS_ROOT: testRoot },
      () => {
        const f = devApi();
        withFile(f, "DEV_OBJECTS_SIGNING_KEY_FILE", signingKey.toString("base64"));
        return f;
      },
    );
    const server = await createApiServer(api.container);
    try {
      const s = api.container.objectStore;
      await s.put("exports", exportKey(), Buffer.from("test-env"), "application/zip");
      const url = await s.presignGet("exports", exportKey(), 600);

      const res = await server.inject({ method: "GET", url: url.pathname });

      expect(res.statusCode).toBe(200);
      expect(res.body).toBe("test-env");
    } finally {
      await server.close();
      await api.close();
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  // Review B-6: the route exists only for development or test with the fs store.
  it("TP-10.11x (B-6): an API with APP_ENV=test and OBJECT_STORE_KIND=s3 has no /dev/objects/* route: GET answers the platform 404", async () => {
    const api = await buildApiContainer(
      {},
      {
        APP_ENV: "test",
        OBJECT_STORE_KIND: "s3",
        S3_ENDPOINT: "https://s3.example.invalid",
        S3_REGION: "auto",
        S3_BUCKET_EXPORTS: "budmon-exports",
        S3_BUCKET_ERASURE_LOG: "budmon-erasure-log",
      },
      () => {
        const f = devApi();
        withFile(f, "DEV_OBJECTS_SIGNING_KEY_FILE", signingKey.toString("base64"));
        withFile(f, "S3_ACCESS_KEY_ID_FILE", "access-key-id");
        withFile(f, "S3_SECRET_ACCESS_KEY_FILE", "secret-access-key");
        return f;
      },
    );
    const server = await createApiServer(api.container);
    try {
      const token = signed({ b: "exports", k: exportKey(), exp: 9_999_999_999 });

      const res = await injectJson(server, "GET", `/dev/objects/${token}`);

      expect(server.hasRoute({ method: "GET", url: "/dev/objects/*" })).toBe(false);
      expect(res.status).toBe(404);
      expect(res.json()).toEqual(NOT_FOUND);
    } finally {
      await server.close();
      await api.close();
    }
  });

  it("TP-10.11x (B-6): the development API with the fs store has the /dev/objects/* route (the control for the case above)", () => {
    expect(app.hasRoute({ method: "GET", url: "/dev/objects/*" })).toBe(true);
  });

  it("TP-10.2 (A-303): a worker container's fs store presignGet throws TypeError", async () => {
    const worker = await buildWorkerContainer("general");
    try {
      const s = worker.container.objectStore;
      if (s === null) throw new Error("the general worker has no objectStore");

      expect(await failure(() => s.presignGet("exports", exportKey(), 600))).toBeInstanceOf(
        TypeError,
      );
    } finally {
      await worker.close();
    }
  });
});
