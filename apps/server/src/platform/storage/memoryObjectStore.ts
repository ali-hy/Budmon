// F-143: an in-memory object store for tests, with F-140's validation and errors.
import type { Clock, Temporal } from "@budmon/shared";
import {
  assertObjectKey,
  assertObjectPrefix,
  checkPresign,
  type BucketName,
  type ObjectStore,
} from "./objectStore.js";

export type MemoryObjectStore = ObjectStore & {
  /** Keyed `<bucket>/<key>`. */
  snapshot(): ReadonlyMap<string, { body: Buffer; lastModified: Temporal.Instant }>;
};

export function createMemoryObjectStore(clock: Clock): MemoryObjectStore {
  const objects = new Map<string, { body: Buffer; lastModified: Temporal.Instant }>();
  const id = (bucket: BucketName, key: string) => `${bucket}/${key}`;
  const under = (bucket: BucketName, prefix: string) =>
    [...objects.keys()]
      .filter((k) => k.startsWith(id(bucket, prefix)))
      .sort()
      .map((k) => k.slice(bucket.length + 1));

  return {
    put(bucket, key, body) {
      assertObjectKey(bucket, key);
      objects.set(id(bucket, key), { body: Buffer.from(body), lastModified: clock.now() });
      return Promise.resolve();
    },
    delete(bucket, key) {
      assertObjectKey(bucket, key);
      objects.delete(id(bucket, key));
      return Promise.resolve();
    },
    deletePrefix(bucket, prefix) {
      assertObjectPrefix(bucket, prefix);
      const keys = under(bucket, prefix);
      for (const key of keys) objects.delete(id(bucket, key));
      return Promise.resolve(keys.length);
    },
    // eslint-disable-next-line @typescript-eslint/require-await -- the interface is async; memory needs no await
    async *list(bucket, prefix) {
      assertObjectPrefix(bucket, prefix);
      for (const key of under(bucket, prefix)) {
        const entry = objects.get(id(bucket, key));
        if (entry !== undefined) yield { key, lastModified: entry.lastModified };
      }
    },
    presignGet(bucket, key, ttlSeconds, opts = {}) {
      const ttl = checkPresign(bucket, key, ttlSeconds, opts);
      // A-290: integer epoch seconds.
      const exp = Math.floor(clock.now().epochMilliseconds / 1000) + ttl;
      const url = new URL(`memory://${bucket}/${key}`);
      url.searchParams.set("exp", String(exp));
      if (opts.downloadName !== undefined) url.searchParams.set("n", opts.downloadName);
      return Promise.resolve(url);
    },
    snapshot: () => new Map(objects),
  };
}
