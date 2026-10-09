// S-8 test support (credential encryption and capture plumbing), owned by the test-architect.
//
// The S-8 modules arrive with S-8's code. Until then this file declares their shapes from the LLD
// (F-110 to F-122) and loads them through variable specifiers, so typecheck passes before the code
// exists; once it lands the loaders become static imports. Error classes are checked by name
// (`errorName`), since the LLD doesn't say which module exports EnvelopeAuthError,
// KmsUnavailableError or UnknownKeyVersionError.
import type { Clock, Temporal } from "@budmon/shared";
import type { Database } from "../../src/platform/db/types.js";
import type { Logger } from "../../src/platform/observability/logger.js";
import type { PlatformMetrics } from "../../src/platform/observability/metrics.js";
import type { Secret } from "../../src/platform/observability/redaction.js";
import type { SealedColumn } from "../../src/platform/crypto/sealedColumns.js";

export type EnvelopeProvider = "kms-capture" | "local-capture" | "api-local";
export interface SealContext {
  table: string;
  rowId: string;
  purpose: string;
}
export interface EnvelopeParts {
  provider: EnvelopeProvider;
  keyVersion: string;
  wrappedDek: Buffer;
  nonce: Buffer;
  ciphertext: Buffer;
  tag: Buffer;
}

export interface EnvelopeModule {
  EnvelopeFormatError: new (...args: never[]) => Error;
  encodeEnvelope: (p: EnvelopeParts) => Buffer;
  decodeEnvelope: (b: Buffer) => EnvelopeParts;
  aadFor: (ctx: SealContext) => Buffer;
  keyVersionOf: (b: Buffer) => string;
}

export interface CaptureSealer {
  seal: (plaintext: Buffer, ctx: SealContext) => Buffer;
}
export interface CaptureUnsealer {
  unseal: (envelope: Buffer, ctx: SealContext) => Promise<Buffer>;
}
export interface CaptureSealerModule {
  createCaptureSealer: (
    cfg: { publicKeyPem: string; keyVersion: string },
    deps?: { randomBytes?: (n: number) => Buffer },
  ) => CaptureSealer;
}
export interface KmsClient {
  asymmetricDecrypt: (
    request: { name: string; ciphertext: Buffer | Uint8Array },
    options?: { timeout?: number },
  ) => Promise<unknown>;
}
export interface CaptureUnsealerModule {
  createKmsCaptureUnsealer: (deps: {
    client: KmsClient;
    timeoutMs?: number;
    metrics: PlatformMetrics;
  }) => CaptureUnsealer;
  createLocalCaptureUnsealer: (cfg: { privateKeyPem: string }) => CaptureUnsealer;
}

export interface ApiSecretsCipher {
  seal: (plaintext: Buffer, ctx: SealContext) => Buffer;
  unseal: (envelope: Buffer, ctx: SealContext) => Buffer;
  currentKeyId: () => string;
}
export interface ApiSecretsModule {
  createApiSecretsCipher: (
    keys: { current: string; keys: ReadonlyMap<string, Buffer> },
    deps?: { randomBytes?: (n: number) => Buffer },
  ) => ApiSecretsCipher;
}

export interface RewrapModule {
  rewrapApiSecrets: (deps: {
    database: Database;
    cipher: ApiSecretsCipher;
    columns: readonly SealedColumn[];
    batchSize?: number;
    logger: Logger;
  }) => Promise<{ rewrapped: number; skipped: number }>;
  rewrapApiSecretsCommand: (c: {
    database: Database;
    apiSecrets: ApiSecretsCipher;
    sealedColumns: { all: () => readonly SealedColumn[] };
    logger: Logger;
  }) => Promise<{ rewrapped: number; skipped: number }>;
}

export interface OAuthTokens {
  refreshToken: Secret<string>;
  accessToken: Secret<string>;
  expiresAt: Temporal.Instant;
  scopes: readonly string[];
}
export interface OAuthModule {
  createPkcePair: (randomBytes?: (n: number) => Buffer) => {
    verifier: Secret<string>;
    challenge: string;
    method: "S256";
  };
  createOAuthState: () => string;
  buildGoogleAuthorizationUrl: (p: {
    clientId: string;
    redirectUri: string;
    scopes: readonly string[];
    state: string;
    challenge: string;
  }) => URL;
  OAuthExchangeError: new (...args: never[]) => Error & {
    readonly reason: string;
    readonly retryable: boolean;
  };
  exchangeAuthorizationCode: (
    deps: { fetch: typeof fetch; clientId: string; clientSecret: Secret<string>; clock: Clock },
    input: { code: Secret<string>; verifier: Secret<string>; redirectUri: string },
  ) => Promise<OAuthTokens>;
}

export interface EgressModule {
  CAPTURE_EGRESS_HOSTS: ReadonlySet<string>;
  EgressDeniedError: new (...args: never[]) => Error & { readonly host: string };
  createGuardedFetch: (allowed: ReadonlySet<string>, inner: typeof fetch) => typeof fetch;
}

export interface ProxyModule {
  installProxySupport: (env: Readonly<Record<string, string | undefined>>) => {
    httpsProxy?: string;
  };
}

const SPECIFIERS = {
  envelope: "../../src/platform/crypto/envelope.js",
  captureSealer: "../../src/platform/crypto/captureSealer.js",
  captureUnsealer: "../../src/platform/crypto/captureUnsealer.js",
  apiSecrets: "../../src/platform/crypto/apiSecrets.js",
  rewrap: "../../src/platform/crypto/rewrap.js",
  oauth: "../../src/platform/crypto/oauth.js",
  egress: "../../src/platform/crypto/egress.js",
  proxy: "../../src/platform/crypto/proxy.js",
} as const;

async function load<T>(specifier: string): Promise<T> {
  return (await import(/* @vite-ignore */ specifier)) as T;
}

export const s8 = {
  envelope: () => load<EnvelopeModule>(SPECIFIERS.envelope),
  captureSealer: () => load<CaptureSealerModule>(SPECIFIERS.captureSealer),
  captureUnsealer: () => load<CaptureUnsealerModule>(SPECIFIERS.captureUnsealer),
  apiSecrets: () => load<ApiSecretsModule>(SPECIFIERS.apiSecrets),
  rewrap: () => load<RewrapModule>(SPECIFIERS.rewrap),
  oauth: () => load<OAuthModule>(SPECIFIERS.oauth),
  egress: () => load<EgressModule>(SPECIFIERS.egress),
  proxy: () => load<ProxyModule>(SPECIFIERS.proxy),
};

/** The constructor name of what `fn` throws or rejects with ("none" if it doesn't). */
export async function errorName(fn: () => unknown): Promise<string> {
  try {
    await fn();
  } catch (error) {
    return error instanceof Error ? error.constructor.name : typeof error;
  }
  return "none";
}
