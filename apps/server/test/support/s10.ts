// S-10 test support (object storage, erasure log, restore verification), owned by the
// test-architect.
//
// The S-10 modules arrive with S-10's code. Until then this file declares their shapes from the
// LLD (F-140 to F-146, F-150, F-151) and loads them through variable specifiers, so typecheck
// passes before the code exists; once it lands the loaders become static imports.
import type { Clock, Temporal } from "@budmon/shared";
import type { ApiContainer, WorkerContainer } from "../../src/platform/container.js";
import type { Config } from "../../src/platform/config/schema.js";
import type { Database } from "../../src/platform/db/types.js";
import type { Logger } from "../../src/platform/observability/logger.js";

// ---- F-140 ----
export type BucketName = "exports" | "erasure-log";
export type ObjectStoreErrorReason = "not_found" | "denied" | "unavailable";
export interface PresignGetOptions {
  downloadName?: string;
}
export interface ObjectStore {
  put: (bucket: BucketName, key: string, body: Buffer, contentType: string) => Promise<void>;
  delete: (bucket: BucketName, key: string) => Promise<void>;
  deletePrefix: (bucket: BucketName, prefix: string) => Promise<number>;
  list: (
    bucket: BucketName,
    prefix: string,
  ) => AsyncIterable<{ key: string; lastModified: Temporal.Instant }>;
  presignGet: (
    bucket: BucketName,
    key: string,
    ttlSeconds?: number,
    opts?: PresignGetOptions,
  ) => Promise<URL>;
}
export interface ObjectStoreModule {
  ObjectStoreError: new (...args: never[]) => Error & { readonly reason: ObjectStoreErrorReason };
  assertObjectKey: (bucket: BucketName, key: string) => void;
}

// ---- F-141 to F-143 ----
export interface S3ObjectStoreModule {
  createS3ObjectStore: (
    cfg: Extract<NonNullable<Config["objectStore"]>, { kind: "s3" }>,
  ) => ObjectStore;
}
export interface FsObjectStoreModule {
  createFsObjectStore: (cfg: {
    root: string;
    publicOrigin: URL;
    signingKey: Buffer;
    clock: Clock;
  }) => ObjectStore;
}
export type MemoryObjectStore = ObjectStore & {
  snapshot: () => ReadonlyMap<string, { body: Buffer; lastModified: Temporal.Instant }>;
};
export interface MemoryObjectStoreModule {
  createMemoryObjectStore: (clock: Clock) => MemoryObjectStore;
}

// ---- F-144 ----
export interface ExportsPurgeModule {
  purgeExpiredExports: (deps: {
    store: ObjectStore;
    clock: Clock;
    logger: Logger;
  }) => Promise<number>;
}

// ---- F-146 ----
export interface ErasureRecord {
  userId: string;
  erasedAt: Temporal.Instant;
}
export interface ErasureLog {
  append: (r: ErasureRecord) => Promise<void>;
  listSince: (since: Temporal.Instant) => Promise<ErasureRecord[]>;
}
export type ErasureHandler = (userId: string) => Promise<void>;
export interface ErasureLogModule {
  createErasureLog: (store: ObjectStore) => ErasureLog;
}

// ---- F-150, F-151 ----
export interface RestoreReport {
  ok: boolean;
  schema: "ok" | "behind" | "ahead" | "not_migrated";
  amcheck: { indexesChecked: number; failures: { index: string; code: string }[] };
  tables: { schema: string; table: string; rows: number }[];
}
export interface RestoreVerifyModule {
  verifyRestore: (deps: {
    database: Database;
    journal: readonly { hash: string; when: number }[];
  }) => Promise<RestoreReport>;
}
export interface ErasureReplayModule {
  NoErasureHandlerError: new (...args: never[]) => Error;
  replayErasures: (
    deps: { log: ErasureLog; handler: ErasureHandler | null; logger: Logger },
    since: Temporal.Instant,
  ) => Promise<{ replayed: number }>;
}

const SPECIFIERS = {
  objectStore: "../../src/platform/storage/objectStore.js",
  s3ObjectStore: "../../src/platform/storage/s3ObjectStore.js",
  fsObjectStore: "../../src/platform/storage/fsObjectStore.js",
  memoryObjectStore: "../../src/platform/storage/memoryObjectStore.js",
  exportsPurge: "../../src/platform/storage/exportsPurge.js",
  erasureLog: "../../src/platform/storage/erasureLog.js",
  restoreVerify: "../../src/platform/ops/restoreVerify.js",
  erasureReplay: "../../src/platform/ops/erasureReplay.js",
} as const;

async function load<T>(specifier: string): Promise<T> {
  return (await import(/* @vite-ignore */ specifier)) as T;
}

export const s10 = {
  objectStore: () => load<ObjectStoreModule>(SPECIFIERS.objectStore),
  s3ObjectStore: () => load<S3ObjectStoreModule>(SPECIFIERS.s3ObjectStore),
  fsObjectStore: () => load<FsObjectStoreModule>(SPECIFIERS.fsObjectStore),
  memoryObjectStore: () => load<MemoryObjectStoreModule>(SPECIFIERS.memoryObjectStore),
  exportsPurge: () => load<ExportsPurgeModule>(SPECIFIERS.exportsPurge),
  erasureLog: () => load<ErasureLogModule>(SPECIFIERS.erasureLog),
  restoreVerify: () => load<RestoreVerifyModule>(SPECIFIERS.restoreVerify),
  erasureReplay: () => load<ErasureReplayModule>(SPECIFIERS.erasureReplay),
};

/** F-96's `objectStore` member (ApiContainer: always; WorkerContainer: general role). */
export function objectStoreOf(c: ApiContainer | WorkerContainer): ObjectStore | null {
  return (c as unknown as { objectStore: ObjectStore | null }).objectStore;
}

/** Every key `store.list(bucket, prefix)` yields, in order. */
export async function keysOf(
  store: ObjectStore,
  bucket: BucketName,
  prefix: string,
): Promise<string[]> {
  const keys: string[] = [];
  for await (const entry of store.list(bucket, prefix)) keys.push(entry.key);
  return keys;
}

/** What `fn` throws or rejects with (undefined if it doesn't). */
export async function failure(fn: () => unknown): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

// A valid user id and export ids (lower-case UUIDs, as the key rules want).
export const USER = "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0b";
export const EXPORT_ID = "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0c";
export const exportKey = (id: string = EXPORT_ID, ext = "zip", user: string = USER) =>
  `users/${user}/exports/${id}.${ext}`;
