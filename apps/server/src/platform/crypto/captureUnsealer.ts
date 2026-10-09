// F-112 and F-113: unsealing capture secrets (worker-capture only).
import { constants, privateDecrypt } from "node:crypto";
import type { PlatformMetrics } from "../observability/metrics.js";
import { gcmOpen } from "./aead.js";
import {
  aadFor,
  decodeEnvelope,
  EnvelopeAuthError,
  EnvelopeFormatError,
  KmsUnavailableError,
  UnknownKeyVersionError,
  type SealContext,
} from "./envelope.js";

export interface CaptureUnsealer {
  unseal(envelope: Buffer, ctx: SealContext): Promise<Buffer>;
}

/** The part of the KMS client used (`@google-cloud/kms` returns a tuple). */
export interface KmsDecryptClient {
  asymmetricDecrypt(
    request: { name: string; ciphertext: Buffer },
    options?: { timeout?: number },
  ): Promise<unknown>;
}

/** A-247: `[0].plaintext` as a Buffer copy (zero-filled by the caller); anything else fails. */
function plaintextOf(response: unknown): Buffer {
  const first: unknown = Array.isArray(response) ? response[0] : undefined;
  const plaintext = (first as { plaintext?: unknown } | undefined)?.plaintext;
  if (plaintext instanceof Uint8Array) {
    const copy = Buffer.from(plaintext);
    // The client's own copy of the DEK doesn't wait for garbage collection.
    plaintext.fill(0);
    return copy;
  }
  throw new KmsUnavailableError();
}

export function createKmsCaptureUnsealer(deps: {
  client: KmsDecryptClient;
  timeoutMs?: number;
  metrics: PlatformMetrics;
  /**
   * A-258: config.capture.keyVersion. An envelope must name a version of the same key; the
   * signature in F-112 has no such field, so it's optional (the container always passes it).
   */
  configuredKeyVersion?: string;
}): CaptureUnsealer {
  const configured = deps.configuredKeyVersion;
  const marker = "/cryptoKeyVersions/";
  const keyName =
    configured === undefined || !configured.includes(marker)
      ? undefined
      : configured.slice(0, configured.indexOf(marker));
  /** `^<key name>/cryptoKeyVersions/\d+$`: any version of the configured key. */
  const sameKey = (keyVersion: string): boolean =>
    keyName !== undefined &&
    keyVersion.startsWith(`${keyName}${marker}`) &&
    /^\d+$/.test(keyVersion.slice(keyName.length + marker.length));
  return {
    async unseal(envelope, ctx) {
      const parts = decodeEnvelope(envelope);
      if (parts.provider !== "kms-capture") throw new EnvelopeFormatError();
      // A-258: never ask KMS to decrypt with a key the row merely names.
      if (configured !== undefined && !sameKey(parts.keyVersion)) {
        throw new UnknownKeyVersionError();
      }
      const aad = aadFor(ctx);
      let dek: Buffer;
      try {
        dek = plaintextOf(
          await deps.client.asymmetricDecrypt(
            { name: parts.keyVersion, ciphertext: parts.wrappedDek },
            { timeout: deps.timeoutMs ?? 5000 },
          ),
        );
      } catch {
        deps.metrics.kmsErrors.add(1, {});
        throw new KmsUnavailableError();
      }
      try {
        return gcmOpen(dek, parts.nonce, parts.ciphertext, parts.tag, aad);
      } finally {
        dek.fill(0);
      }
    },
  };
}

export function createLocalCaptureUnsealer(cfg: { privateKeyPem: string }): CaptureUnsealer {
  return {
    unseal(envelope, ctx) {
      const parts = decodeEnvelope(envelope);
      if (parts.provider !== "local-capture") throw new EnvelopeFormatError();
      const aad = aadFor(ctx);
      let dek: Buffer;
      try {
        dek = privateDecrypt(
          { key: cfg.privateKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
          parts.wrappedDek,
        );
      } catch {
        // Another key pair's envelope, or a damaged wrapped key.
        return Promise.reject(new EnvelopeAuthError());
      }
      try {
        return Promise.resolve(gcmOpen(dek, parts.nonce, parts.ciphertext, parts.tag, aad));
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new EnvelopeAuthError());
      } finally {
        dek.fill(0);
      }
    },
  };
}
