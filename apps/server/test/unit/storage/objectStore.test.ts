// F-140 key, prefix, TTL and download-name rules, F-143 the memory store and F-144 the exports
// purge. TP-10.1, TP-10.4 and TP-10.5, plus extra cases TP-10.11x. IDs ending in "x" are
// test-architect additions, not LLD test-plan IDs.
import { Temporal, fixedClock } from "@budmon/shared";
import { describe, expect, it } from "vitest";
import { recordingLogger } from "../../support/platform.js";
import {
  EXPORT_ID,
  USER,
  exportKey,
  failure,
  keysOf,
  s10,
  type BucketName,
} from "../../support/s10.js";

const NOW = "2026-10-07T12:00:00Z";
const RECORD = `records/20261005T120000Z_${USER}.json`;

async function memoryStore(now = NOW) {
  const { createMemoryObjectStore } = await s10.memoryObjectStore();
  const clock = fixedClock(now);
  return { store: createMemoryObjectStore(clock), clock };
}

describe("TP-10.1: key, prefix, TTL and download-name rules (F-140, A-22)", () => {
  it.each<[string, BucketName, string]>([
    ["an exports zip", "exports", exportKey()],
    ["an exports csv", "exports", exportKey(EXPORT_ID, "csv")],
    ["an exports json", "exports", exportKey(EXPORT_ID, "json")],
    ["an erasure-log record", "erasure-log", RECORD],
  ])("TP-10.1: %s passes assertObjectKey and put", async (_label, bucket, key) => {
    const { assertObjectKey } = await s10.objectStore();
    const { store } = await memoryStore();

    expect(() => {
      assertObjectKey(bucket, key);
    }).not.toThrow();
    await expect(
      store.put(bucket, key, Buffer.from("x"), "application/octet-stream"),
    ).resolves.toBeUndefined();
  });

  it.each<[string, BucketName, string]>([
    ["a .txt export", "exports", exportKey(EXPORT_ID, "txt")],
    ["an upper-case user id", "exports", exportKey(EXPORT_ID, "zip", USER.toUpperCase())],
    ["a short id", "exports", "users/abc/exports/def.zip"],
    ["a leading slash", "exports", `/${exportKey()}`],
    ["a path traversal", "exports", `users/${USER}/exports/../${EXPORT_ID}.zip`],
    ["a record key in exports", "exports", RECORD],
    ["an export key in erasure-log", "erasure-log", exportKey()],
    ["a record with a dashed date", "erasure-log", `records/2026-10-05T120000Z_${USER}.json`],
    ["a record without Z", "erasure-log", `records/20261005T120000_${USER}.json`],
    ["a record that isn't .json", "erasure-log", `records/20261005T120000Z_${USER}.txt`],
    ["an empty key", "exports", ""],
  ])(
    "TP-10.1: %s is RangeError from assertObjectKey, put, delete and presignGet",
    async (_label, bucket, key) => {
      const { assertObjectKey } = await s10.objectStore();
      const { store } = await memoryStore();

      expect(() => {
        assertObjectKey(bucket, key);
      }).toThrow(RangeError);
      expect(
        await failure(() => store.put(bucket, key, Buffer.from("x"), "text/plain")),
      ).toBeInstanceOf(RangeError);
      expect(await failure(() => store.delete(bucket, key))).toBeInstanceOf(RangeError);
      expect(await failure(() => store.presignGet(bucket, key))).toBeInstanceOf(RangeError);
    },
  );

  it.each<[BucketName, string]>([
    ["exports", "users/"],
    ["exports", `users/${USER}/`],
    ["erasure-log", "records/"],
  ])("TP-10.1: prefix %s %j is accepted by list and deletePrefix", async (bucket, prefix) => {
    const { store } = await memoryStore();

    expect(await keysOf(store, bucket, prefix)).toEqual([]);
    expect(await store.deletePrefix(bucket, prefix)).toBe(0);
  });

  it.each([[""], ["users"], ["users/abc/"], ["other/"], [`users/${USER}`], ["/users/"]])(
    "TP-10.1: prefix %j is RangeError from list and deletePrefix",
    async (prefix) => {
      const { store } = await memoryStore();

      expect(await failure(() => keysOf(store, "exports", prefix))).toBeInstanceOf(RangeError);
      expect(await failure(() => store.deletePrefix("exports", prefix))).toBeInstanceOf(RangeError);
    },
  );

  it.each([[30], [901], [59], [0]])("TP-10.1: ttlSeconds %i is RangeError", async (ttl) => {
    const { store } = await memoryStore();

    expect(await failure(() => store.presignGet("exports", exportKey(), ttl))).toBeInstanceOf(
      RangeError,
    );
  });

  it.each([[60], [900]])("TP-10.11x: ttlSeconds %i is accepted", async (ttl) => {
    const { store } = await memoryStore();

    await expect(store.presignGet("exports", exportKey(), ttl)).resolves.toBeInstanceOf(URL);
  });

  it.each([["budmon-export-2026-10-07.zip"], ["a".repeat(100)]])(
    "TP-10.1: downloadName %j passes",
    async (downloadName) => {
      const { store } = await memoryStore();

      await expect(
        store.presignGet("exports", exportKey(), 900, { downloadName }),
      ).resolves.toBeInstanceOf(URL);
    },
  );

  it.each([[""], ["a".repeat(101)], ["a b.zip"], ['a"b.zip'], ["x/y.zip"], ["é.zip"]])(
    "TP-10.1: downloadName %j is RangeError",
    async (downloadName) => {
      const { store } = await memoryStore();

      expect(
        await failure(() => store.presignGet("exports", exportKey(), 900, { downloadName })),
      ).toBeInstanceOf(RangeError);
    },
  );
});

describe("TP-10.4: the memory store (F-143, A-22)", () => {
  it("TP-10.4: put, list (with lastModified), delete, delete of a missing key, deletePrefix", async () => {
    const { store, clock } = await memoryStore();
    const other = "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0d";
    await store.put("exports", exportKey(), Buffer.from("zip"), "application/zip");
    clock.advance({ minutes: 1 });
    await store.put("exports", exportKey(other, "csv"), Buffer.from("csv"), "text/csv");

    const listed: { key: string; lastModified: Temporal.Instant }[] = [];
    for await (const entry of store.list("exports", `users/${USER}/`)) listed.push(entry);

    expect(listed.map((e) => e.key).sort()).toEqual([exportKey(), exportKey(other, "csv")].sort());
    expect(listed.find((e) => e.key === exportKey())?.lastModified.toString()).toBe(
      Temporal.Instant.from(NOW).toString(),
    );

    await store.delete("exports", exportKey());
    await expect(store.delete("exports", exportKey())).resolves.toBeUndefined();
    expect(await keysOf(store, "exports", "users/")).toEqual([exportKey(other, "csv")]);

    expect(await store.deletePrefix("exports", `users/${USER}/`)).toBe(1);
    expect(await keysOf(store, "exports", "users/")).toEqual([]);
  });

  it("TP-10.4: presignGet without a name is memory://exports/<key>?exp=<epoch>, with no n parameter", async () => {
    const { store } = await memoryStore();

    const url = await store.presignGet("exports", exportKey(), 600);

    expect(url.href.startsWith(`memory://exports/${exportKey()}?exp=`)).toBe(true);
    expect(url.searchParams.get("exp")).toMatch(/^\d+$/);
    expect(url.searchParams.has("n")).toBe(false);
  });

  it("TP-10.4: presignGet with downloadName adds &n=budmon-export-2026-10-07.zip", async () => {
    const { store } = await memoryStore();

    const url = await store.presignGet("exports", exportKey(), 600, {
      downloadName: "budmon-export-2026-10-07.zip",
    });

    expect(url.href.startsWith(`memory://exports/${exportKey()}?exp=`)).toBe(true);
    expect(url.searchParams.get("n")).toBe("budmon-export-2026-10-07.zip");
  });

  it("TP-10.11x: the snapshot holds the body of what was put", async () => {
    const { store } = await memoryStore();
    await store.put("exports", exportKey(), Buffer.from("zip-bytes"), "application/zip");

    const bodies = [...store.snapshot().values()].map((v) => v.body.toString());

    expect(bodies).toEqual(["zip-bytes"]);
  });
});

describe("TP-10.5: exports older than 7 days are purged (F-144)", () => {
  it("TP-10.5: objects at now − 8 d and now − 6 d: purge deletes 1 and logs exports_purged {count: 1}", async () => {
    const { purgeExpiredExports } = await s10.exportsPurge();
    const { store, clock } = await memoryStore("2026-09-29T12:00:00Z");
    const old = exportKey("0190a0b0-1c2d-7e3f-8a4b-000000000008");
    const recent = exportKey("0190a0b0-1c2d-7e3f-8a4b-000000000006");
    await store.put("exports", old, Buffer.from("old"), "application/zip");
    clock.advance({ days: 2 });
    await store.put("exports", recent, Buffer.from("recent"), "application/zip");
    clock.advance({ days: 6 });
    const logger = recordingLogger();

    const count = await purgeExpiredExports({ store, clock, logger });

    expect(count).toBe(1);
    expect(await keysOf(store, "exports", "users/")).toEqual([recent]);
    expect(logger.lines.filter((l) => l.event === "exports_purged").map((l) => l.fields)).toEqual([
      expect.objectContaining({ fields: { count: 1 } }),
    ]);
  });

  it("TP-10.11x: an object exactly 7 days old is kept (lastModified < now − 7 days purges)", async () => {
    const { purgeExpiredExports } = await s10.exportsPurge();
    const { store, clock } = await memoryStore("2026-09-30T12:00:00Z");
    await store.put("exports", exportKey(), Buffer.from("x"), "application/zip");
    clock.advance({ days: 7 });

    expect(await purgeExpiredExports({ store, clock, logger: recordingLogger() })).toBe(0);
    expect(await keysOf(store, "exports", "users/")).toEqual([exportKey()]);
  });
});
