// F-141 the S3 object store against an S3-compatible Testcontainer. TP-10.3, plus extra cases
// TP-10.11x. IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
//
// Skipped unless BUDMON_S3_TEST_IMAGE names an image: the LLD's MinIO isn't on mirror.gcr.io (A-284's
// CI mirror) and Docker Hub pulls are rate-limited there, so the image choice is with the planner.
// The bucket set-up uses @aws-sdk/client-s3, which F-141 adds to the server's dependencies.
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Secret } from "../../../src/platform/observability/redaction.js";
import { USER, exportKey, failure, keysOf, s10, type ObjectStore } from "../../support/s10.js";

/** The S3-compatible (MinIO) image for TP-10.3, until the planner pins one. */
const S3_TEST_IMAGE = process.env["BUDMON_S3_TEST_IMAGE"];
/** A variable specifier: typecheck doesn't resolve it before F-141 adds the dependency. */
const AWS_S3 = "@aws-sdk/client-s3";

const ACCESS = "budmontest";
const SECRET = "budmontest-secret-key";
const BUCKETS = { exports: "budmon-exports", erasureLog: "budmon-erasure-log" };
const NAME = "budmon-export-2026-10-07.zip";

interface S3Admin {
  S3Client: new (cfg: unknown) => {
    send: (command: unknown) => Promise<unknown>;
    destroy: () => void;
  };
  CreateBucketCommand: new (input: { Bucket: string }) => unknown;
}

describe.skipIf(S3_TEST_IMAGE === undefined)("TP-10.3: the S3 store (F-141, A-22)", () => {
  let container: StartedTestContainer;
  let endpoint: URL;
  let store: ObjectStore;

  const cfg = (buckets = BUCKETS) => ({
    kind: "s3" as const,
    endpoint,
    region: "us-east-1",
    buckets,
    accessKeyId: Secret.of(ACCESS),
    secretAccessKey: Secret.of(SECRET),
  });

  beforeAll(async () => {
    container = await new GenericContainer(S3_TEST_IMAGE ?? "unset")
      .withEnvironment({ MINIO_ROOT_USER: ACCESS, MINIO_ROOT_PASSWORD: SECRET })
      .withCommand(["server", "/data"])
      .withExposedPorts(9000)
      .withWaitStrategy(Wait.forHttp("/minio/health/live", 9000))
      .start();
    endpoint = new URL(`http://${container.getHost()}:${String(container.getMappedPort(9000))}`);
    const { S3Client, CreateBucketCommand } = (await import(/* @vite-ignore */ AWS_S3)) as S3Admin;
    const admin = new S3Client({
      endpoint: endpoint.href,
      region: "us-east-1",
      forcePathStyle: true,
      credentials: { accessKeyId: ACCESS, secretAccessKey: SECRET },
    });
    for (const bucket of Object.values(BUCKETS)) {
      await admin.send(new CreateBucketCommand({ Bucket: bucket }));
    }
    admin.destroy();
    const { createS3ObjectStore } = await s10.s3ObjectStore();
    store = createS3ObjectStore(cfg());
  }, 180_000);

  afterAll(async () => {
    await container.stop();
  });

  it("TP-10.3: put, list, delete, delete of a missing key, deletePrefix", async () => {
    const other = "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0d";
    await store.put("exports", exportKey(), Buffer.from("zip-bytes"), "application/zip");
    await store.put("exports", exportKey(other, "csv"), Buffer.from("csv"), "text/csv");

    expect((await keysOf(store, "exports", `users/${USER}/`)).sort()).toEqual(
      [exportKey(), exportKey(other, "csv")].sort(),
    );

    await store.delete("exports", exportKey(other, "csv"));
    await expect(store.delete("exports", exportKey(other, "csv"))).resolves.toBeUndefined();
    expect(await keysOf(store, "exports", "users/")).toEqual([exportKey()]);
    expect(await store.deletePrefix("exports", `users/${USER}/`)).toBe(1);
    expect(await keysOf(store, "exports", "users/")).toEqual([]);
  });

  it(`TP-10.3: presign without and with downloadName ${NAME}: response-content-disposition is attachment / attachment; filename="…", and the server answers with that header`, async () => {
    await store.put("exports", exportKey(), Buffer.from("zip-bytes"), "application/zip");

    const plain = await store.presignGet("exports", exportKey(), 600);
    const named = await store.presignGet("exports", exportKey(), 600, { downloadName: NAME });
    const plainRes = await fetch(plain);
    const namedRes = await fetch(named);

    expect(plain.searchParams.get("response-content-disposition")).toBe("attachment");
    expect(named.searchParams.get("response-content-disposition")).toBe(
      `attachment; filename="${NAME}"`,
    );
    expect(plainRes.status).toBe(200);
    expect(await plainRes.text()).toBe("zip-bytes");
    expect(plainRes.headers.get("content-disposition")).toBe("attachment");
    expect(namedRes.status).toBe(200);
    expect(namedRes.headers.get("content-disposition")).toBe(`attachment; filename="${NAME}"`);
  });

  it("TP-10.3: put to a bucket that doesn't exist is ObjectStoreError", async () => {
    const { ObjectStoreError } = await s10.objectStore();
    const { createS3ObjectStore } = await s10.s3ObjectStore();
    const missing = createS3ObjectStore(
      cfg({ exports: "budmon-no-such-bucket", erasureLog: BUCKETS.erasureLog }),
    );

    expect(
      await failure(() => missing.put("exports", exportKey(), Buffer.from("x"), "application/zip")),
    ).toBeInstanceOf(ObjectStoreError);
  });

  it("TP-10.3: a presigned URL is refused (403) after ttlSeconds", async () => {
    await store.put("exports", exportKey(), Buffer.from("zip-bytes"), "application/zip");
    const url = await store.presignGet("exports", exportKey(), 60);

    await new Promise((resolve) => setTimeout(resolve, 62_000));
    const res = await fetch(url);

    expect(res.status).toBe(403);
  }, 90_000);
});
