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
  if (plaintext instanceof Uint8Array) return Buffer.from(plaintext);
  throw new KmsUnavailableError();
}

export function createKmsCaptureUnsealer(deps: {
  client: KmsDecryptClient;
  timeoutMs?: number;
  metrics: PlatformMetrics;
}): CaptureUnsealer {
  return {
    async unseal(envelope, ctx) {
      const parts = decodeEnvelope(envelope);
      if (parts.provider !== "kms-capture") throw new EnvelopeFormatError();
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
