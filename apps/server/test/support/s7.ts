// S-7 test support (idempotency and cursors), owned by the test-architect.
//
// The S-7 modules arrive with S-7's code. Until then this file declares their shapes from the LLD
// (F-100 to F-105) and loads them through variable specifiers, so typecheck passes before the
// code exists; once it lands the loaders become static imports.
import type { Clock, Temporal } from "@budmon/shared";
import type { DbHandle } from "../../src/platform/db/types.js";
import type { Principal, RequestContext } from "../../src/platform/http/context.js";
import type { PlatformMetrics } from "../../src/platform/observability/metrics.js";

export interface CreatedResult {
  id: string;
  createdAt: Temporal.Instant;
}

export interface Idempotency {
  run: (
    h: DbHandle,
    req: { userId: string; key: string; procedure: string; input: unknown },
    work: () => Promise<CreatedResult>,
  ) => Promise<{ result: CreatedResult; replayed: boolean; status: 201 }>;
}

export interface IdempotencyModule {
  createIdempotency: (deps: { clock: Clock; metrics: PlatformMetrics }) => Idempotency;
  runIdempotentCreate: (
    ctx: RequestContext & { principal: Principal },
    procedure: string,
    input: unknown,
    work: (tx: DbHandle) => Promise<CreatedResult>,
  ) => Promise<{ id: string; createdAt: string }>;
}

export interface IdempotencyRecord {
  procedure: string;
  requestHash: Buffer;
  responseStatus: number | null;
  result: { id: string; createdAt: string } | null;
}

export interface IdempotencyRepoModule {
  insertIfAbsent: (
    h: DbHandle,
    r: { userId: string; key: string; procedure: string; requestHash: Buffer; expiresAt: Date },
  ) => Promise<boolean>;
  find: (h: DbHandle, userId: string, key: string) => Promise<IdempotencyRecord | null>;
  complete: (
    h: DbHandle,
    userId: string,
    key: string,
    status: number,
    result: { id: string; createdAt: string },
  ) => Promise<void>;
}

export type SortKey = readonly (string | number | boolean | null)[];

export interface CursorCodec {
  encode: (p: { sortKey: SortKey; id: string; filterHash: string }) => string;
  decode: (token: string, expectedFilterHash: string) => { sortKey: SortKey; id: string };
}

export interface CursorModule {
  createCursorCodec: (deps: {
    key: Buffer;
    clock: Clock;
    randomBytes?: (n: number) => Buffer;
  }) => CursorCodec;
  filterHash: (filters: unknown) => string;
  paginate: <T>(
    rows: readonly T[],
    limit: number,
    keyOf: (row: T) => { sortKey: SortKey; id: string },
    filterHashValue: string,
    codec: CursorCodec,
  ) => { items: T[]; nextCursor: string | null };
}

const SPECIFIERS = {
  idempotency: "../../src/platform/idempotency/idempotency.js",
  idempotencyRepo: "../../src/platform/idempotency/idempotencyRepo.js",
  cursor: "../../src/platform/pagination/cursor.js",
} as const;

async function load<T>(specifier: string): Promise<T> {
  return (await import(/* @vite-ignore */ specifier)) as T;
}

export const s7 = {
  idempotency: () => load<IdempotencyModule>(SPECIFIERS.idempotency),
  idempotencyRepo: () => load<IdempotencyRepoModule>(SPECIFIERS.idempotencyRepo),
  cursor: () => load<CursorModule>(SPECIFIERS.cursor),
};
