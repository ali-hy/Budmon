// F-141 the S3 object store against versitygw (A-287), an S3-compatible Testcontainer. TP-10.3,
// plus extra cases TP-10.11x. IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
// Not skipped: it runs in every pnpm test:int, in CI through A-284's mirror prefix.
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Secret } from "../../../src/platform/observability/redaction.js";
import { S3_TEST_IMAGE } from "../../setup/s3Image.js";
import { USER, exportKey, failure, keysOf, s10, type ObjectStore } from "../../support/s10.js";

const ACCESS = "budmontest";
const SECRET = "budmontest-secret-key";
const BUCKETS = { exports: "budmon-exports", erasureLog: "budmon-erasure-log" };
const NAME = "budmon-export-2026-10-07.zip";

describe("TP-10.3: the S3 store (F-141, A-22, A-287)", () => {
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
    container = await new GenericContainer(S3_TEST_IMAGE)
      .withEnvironment({ ROOT_ACCESS_KEY: ACCESS, ROOT_SECRET_KEY: SECRET })
      .withCommand(["posix", "/tmp"])
      .withExposedPorts(7070)
      .withWaitStrategy(Wait.forListeningPorts())
      .start();
    endpoint = new URL(`http://${container.getHost()}:${String(container.getMappedPort(7070))}`);
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

  it("TP-10.3: S3_TEST_IMAGE is pinned by digest", () => {
    expect(S3_TEST_IMAGE).toMatch(/^[^@]+@sha256:[0-9a-f]{64}$/);
  });

  it("TP-10.3: put to a bucket that doesn't exist is ObjectStoreError with reason not_found (A-293)", async () => {
    const { ObjectStoreError } = await s10.objectStore();
    const { createS3ObjectStore } = await s10.s3ObjectStore();
    const missing = createS3ObjectStore(
      cfg({ exports: "budmon-no-such-bucket", erasureLog: BUCKETS.erasureLog }),
    );

    const error = await failure(() =>
      missing.put("exports", exportKey(), Buffer.from("x"), "application/zip"),
    );

    expect(error).toBeInstanceOf(ObjectStoreError);
    expect((error as { reason?: unknown }).reason).toBe("not_found");
  });

  it("TP-10.3: a presigned URL is refused (403) after ttlSeconds", async () => {
    await store.put("exports", exportKey(), Buffer.from("zip-bytes"), "application/zip");
    const url = await store.presignGet("exports", exportKey(), 60);

    await new Promise((resolve) => setTimeout(resolve, 62_000));
    const res = await fetch(url);

    expect(res.status).toBe(403);
  }, 90_000);
});
