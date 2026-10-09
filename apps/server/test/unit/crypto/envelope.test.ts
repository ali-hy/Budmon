// F-110 envelope format, F-111 createCaptureSealer, F-112/F-113 capture unsealers, F-114
// createApiSecretsCipher. TP-8.1 to TP-8.6, plus extra cases TP-8.17x. IDs ending in "x" are
// test-architect additions, not LLD test-plan IDs.
import { generateKeyPairSync, privateDecrypt, constants, randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { observed } from "../../support/api.js";
import { rsaKeyPair } from "../../support/configEnv.js";
import { expectCryptoError, s8, type EnvelopeParts, type SealContext } from "../../support/s8.js";

const CTX: SealContext = { table: "sealed_test", rowId: "r1", purpose: "gmail.refresh" };
const KMS_VERSION =
  "projects/p/locations/europe-west1/keyRings/r/cryptoKeys/capture/cryptoKeyVersions/1";

function parts(): EnvelopeParts {
  return {
    provider: "local-capture",
    keyVersion: "local:1",
    wrappedDek: Buffer.alloc(384, 0xaa),
    nonce: Buffer.alloc(12, 0xbb),
    ciphertext: Buffer.alloc(10, 0xcc),
    tag: Buffer.alloc(16, 0xdd),
  };
}

describe("TP-8.1: the envelope byte layout (F-110)", () => {
  it("TP-8.1: encode writes the exact v1 layout, and decode round-trips it", async () => {
    const { encodeEnvelope, decodeEnvelope, keyVersionOf } = await s8.envelope();

    const b = encodeEnvelope(parts());

    const expected = Buffer.concat([
      Buffer.from([0x01, 0x02, 7]),
      Buffer.from("local:1", "utf8"),
      Buffer.from([0x01, 0x80]),
      Buffer.alloc(384, 0xaa),
      Buffer.alloc(12, 0xbb),
      Buffer.alloc(10, 0xcc),
      Buffer.alloc(16, 0xdd),
    ]);
    expect(b).toEqual(expected);
    expect(decodeEnvelope(b)).toEqual(parts());
    expect(keyVersionOf(b)).toBe("local:1");
  });

  it.each([[0], [1], [2], [5], [10], [12], [200], [395], [423]])(
    "TP-8.1: a buffer truncated to %i bytes is EnvelopeFormatError",
    async (length) => {
      const { encodeEnvelope, decodeEnvelope } = await s8.envelope();
      const { EnvelopeFormatError } = await s8.cryptoErrors();
      const b = encodeEnvelope(parts()).subarray(0, length);

      expect(() => decodeEnvelope(b)).toThrow(EnvelopeFormatError);
    },
  );

  it.each([
    ["version byte 2", 0, 2],
    ["provider 9", 1, 9],
    ["L = 0", 2, 0],
  ])("TP-8.1: %s is EnvelopeFormatError", async (_label, offset, value) => {
    const { encodeEnvelope, decodeEnvelope } = await s8.envelope();
    const { EnvelopeFormatError } = await s8.cryptoErrors();
    const b = Buffer.from(encodeEnvelope(parts()));
    b[offset] = value;

    expect(() => decodeEnvelope(b)).toThrow(EnvelopeFormatError);
  });

  it("TP-8.17x: the error message carries no envelope content", async () => {
    const { decodeEnvelope } = await s8.envelope();
    const b = Buffer.from("01ff07secret-key-version", "utf8");

    let message = "";
    try {
      decodeEnvelope(b);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain("secret-key-version");
  });

  it.each([
    ["kms-capture", 0x01],
    ["api-local", 0x03],
  ] as const)("TP-8.17x: provider %s is byte 0x%s", async (provider, byte) => {
    const { encodeEnvelope } = await s8.envelope();

    expect(encodeEnvelope({ ...parts(), provider })[1]).toBe(byte);
  });

  it("TP-8.17x: a wrapped DEK of 1025 bytes is refused (W is 1..1024)", async () => {
    const { encodeEnvelope, decodeEnvelope } = await s8.envelope();
    const { EnvelopeFormatError } = await s8.cryptoErrors();
    const b = Buffer.from(encodeEnvelope(parts()));
    // Rewrite W to 1025 (its bytes follow the 7-byte key version).
    b.writeUInt16BE(1025, 3 + 7);

    expect(() => decodeEnvelope(b)).toThrow(EnvelopeFormatError);
  });
});

describe("TP-8.2: aadFor (F-110)", () => {
  it("TP-8.2: a rowId with a space throws RangeError", async () => {
    const { aadFor } = await s8.envelope();

    expect(() => aadFor({ table: "t", rowId: "r 1", purpose: "p" })).toThrow(RangeError);
  });

  it('TP-8.17x: aadFor is utf8 "budmon/v1|<table>|<rowId>|<purpose>"', async () => {
    const { aadFor } = await s8.envelope();

    expect(aadFor(CTX).toString("utf8")).toBe("budmon/v1|sealed_test|r1|gmail.refresh");
  });
});

describe("TP-8.3: seal and unseal with a local key (F-111, F-113)", () => {
  async function sealer() {
    const { createCaptureSealer } = await s8.captureSealer();
    const { createLocalCaptureUnsealer } = await s8.captureUnsealer();
    const keys = rsaKeyPair();
    return {
      sealer: createCaptureSealer({ publicKeyPem: keys.publicPem, keyVersion: "local:1" }),
      unsealer: createLocalCaptureUnsealer({ privateKeyPem: keys.privatePem }),
    };
  }

  it("TP-8.3: seal then unseal gives the plaintext back; the provider byte is 0x02", async () => {
    const { sealer: s, unsealer: u } = await sealer();
    const plaintext = Buffer.from("refresh-token-value");

    const envelope = s.seal(plaintext, CTX);

    expect(envelope[1]).toBe(0x02);
    expect(await u.unseal(envelope, CTX)).toEqual(plaintext);
  });

  it("TP-8.3: unsealing with another rowId is EnvelopeAuthError", async () => {
    const { sealer: s, unsealer: u } = await sealer();
    const envelope = s.seal(Buffer.from("x"), CTX);

    await expectCryptoError(() => u.unseal(envelope, { ...CTX, rowId: "r2" }), "EnvelopeAuthError");
  });

  it("TP-8.3: one flipped ciphertext byte is EnvelopeAuthError", async () => {
    const { sealer: s, unsealer: u } = await sealer();
    const envelope = Buffer.from(s.seal(Buffer.from("some plaintext"), CTX));
    // The ciphertext sits just before the 16-byte tag.
    const at = envelope.length - 17;
    envelope[at] = (envelope[at] ?? 0) ^ 0x01;

    await expectCryptoError(() => u.unseal(envelope, CTX), "EnvelopeAuthError");
  });

  it("TP-8.17x: two seals of the same plaintext differ (fresh DEK and nonce)", async () => {
    const { sealer: s } = await sealer();

    expect(s.seal(Buffer.from("x"), CTX)).not.toEqual(s.seal(Buffer.from("x"), CTX));
  });

  it("TP-8.17x: the local unsealer refuses a kms-capture envelope with EnvelopeFormatError", async () => {
    const { createCaptureSealer } = await s8.captureSealer();
    const { createLocalCaptureUnsealer } = await s8.captureUnsealer();
    const keys = rsaKeyPair();
    const kmsEnvelope = createCaptureSealer({
      publicKeyPem: keys.publicPem,
      keyVersion: KMS_VERSION,
    }).seal(Buffer.from("x"), CTX);

    await expectCryptoError(
      () => createLocalCaptureUnsealer({ privateKeyPem: keys.privatePem }).unseal(kmsEnvelope, CTX),
      "EnvelopeFormatError",
    );
  });
});

describe("TP-8.4: a weak sealing key (F-111)", () => {
  it("TP-8.4: an RSA-2048 public key throws TypeError at construction", async () => {
    const { createCaptureSealer } = await s8.captureSealer();
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

    expect(() =>
      createCaptureSealer({
        publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
        keyVersion: "local:1",
      }),
    ).toThrow(TypeError);
  });

  it("TP-8.17x: an EC public key throws TypeError at construction", async () => {
    const { createCaptureSealer } = await s8.captureSealer();
    const { publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });

    expect(() =>
      createCaptureSealer({
        publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
        keyVersion: "local:1",
      }),
    ).toThrow(TypeError);
  });
});

describe("TP-8.5: the KMS unsealer (F-112)", () => {
  const keys = rsaKeyPair();

  /** A fake KMS client that decrypts with the local private key, like asymmetricDecrypt. */
  function fakeKms(shape: "buffer" | "uint8array" | "string" | "missing" = "buffer") {
    return {
      asymmetricDecrypt: vi.fn((request: { name: string; ciphertext: Buffer | Uint8Array }) => {
        const dek = privateDecrypt(
          {
            key: keys.privatePem,
            padding: constants.RSA_PKCS1_OAEP_PADDING,
            oaepHash: "sha256",
          },
          Buffer.from(request.ciphertext),
        );
        // A-247: @google-cloud/kms resolves to a tuple whose first element has `plaintext`.
        const plaintext =
          shape === "buffer"
            ? dek
            : shape === "uint8array"
              ? new Uint8Array(dek)
              : shape === "string"
                ? "str"
                : undefined;
        return Promise.resolve([{ plaintext }]);
      }),
    };
  }

  async function kmsEnvelope(plaintext: Buffer): Promise<Buffer> {
    const { createCaptureSealer } = await s8.captureSealer();
    return createCaptureSealer({ publicKeyPem: keys.publicPem, keyVersion: KMS_VERSION }).seal(
      plaintext,
      CTX,
    );
  }

  it("TP-8.5: unseal returns the plaintext; asymmetricDecrypt gets {name, ciphertext} and timeout 5000", async () => {
    const { createKmsCaptureUnsealer } = await s8.captureUnsealer();
    const { decodeEnvelope } = await s8.envelope();
    const client = fakeKms();
    const envelope = await kmsEnvelope(Buffer.from("kms plaintext"));

    const plaintext = await createKmsCaptureUnsealer({
      client,
      metrics: observed().metrics,
    }).unseal(envelope, CTX);

    expect(plaintext).toEqual(Buffer.from("kms plaintext"));
    expect(client.asymmetricDecrypt).toHaveBeenCalledTimes(1);
    const [request, options] = client.asymmetricDecrypt.mock.calls[0] as unknown as [
      { name: string; ciphertext: Buffer },
      { timeout: number },
    ];
    expect(request.name).toBe(KMS_VERSION);
    expect(Buffer.from(request.ciphertext)).toEqual(decodeEnvelope(envelope).wrappedDek);
    expect(options).toMatchObject({ timeout: 5000 });
  });

  it("TP-8.5: a rejecting client is KmsUnavailableError and kms_errors_total 1", async () => {
    const { createKmsCaptureUnsealer } = await s8.captureUnsealer();
    const obs = observed();
    const client = { asymmetricDecrypt: vi.fn(() => Promise.reject(new Error("UNAVAILABLE"))) };
    const unsealer = createKmsCaptureUnsealer({ client, metrics: obs.metrics });

    const envelope = await kmsEnvelope(Buffer.from("x"));

    await expectCryptoError(() => unsealer.unseal(envelope, CTX), "KmsUnavailableError");
    const metric = (await obs.collect()).get("kms_errors_total");
    expect(metric?.dataPoints.reduce((sum, p) => sum + Number(p.value), 0)).toBe(1);
  });

  it("TP-8.5 (A-247): a [{ plaintext: Uint8Array }] response unseals to the plaintext", async () => {
    const { createKmsCaptureUnsealer } = await s8.captureUnsealer();
    const envelope = await kmsEnvelope(Buffer.from("uint8 plaintext"));

    const plaintext = await createKmsCaptureUnsealer({
      client: fakeKms("uint8array"),
      metrics: observed().metrics,
    }).unseal(envelope, CTX);

    expect(Buffer.from(plaintext)).toEqual(Buffer.from("uint8 plaintext"));
  });

  it('TP-8.5 (A-247): a [{ plaintext: "str" }] response is KmsUnavailableError', async () => {
    const { createKmsCaptureUnsealer } = await s8.captureUnsealer();
    const envelope = await kmsEnvelope(Buffer.from("x"));
    const unsealer = createKmsCaptureUnsealer({
      client: fakeKms("string"),
      metrics: observed().metrics,
    });

    await expectCryptoError(() => unsealer.unseal(envelope, CTX), "KmsUnavailableError");
  });

  it("TP-8.17x (A-247): a response with no plaintext is KmsUnavailableError", async () => {
    const { createKmsCaptureUnsealer } = await s8.captureUnsealer();
    const envelope = await kmsEnvelope(Buffer.from("x"));
    const unsealer = createKmsCaptureUnsealer({
      client: fakeKms("missing"),
      metrics: observed().metrics,
    });

    await expectCryptoError(() => unsealer.unseal(envelope, CTX), "KmsUnavailableError");
  });

  it("TP-8.5: an envelope with provider local-capture is EnvelopeFormatError", async () => {
    const { createKmsCaptureUnsealer } = await s8.captureUnsealer();
    const { createCaptureSealer } = await s8.captureSealer();
    const local = createCaptureSealer({ publicKeyPem: keys.publicPem, keyVersion: "local:1" }).seal(
      Buffer.from("x"),
      CTX,
    );
    const client = fakeKms();

    await expectCryptoError(
      () => createKmsCaptureUnsealer({ client, metrics: observed().metrics }).unseal(local, CTX),
      "EnvelopeFormatError",
    );
    expect(client.asymmetricDecrypt).not.toHaveBeenCalled();
  });

  it("TP-8.17x: a tampered KMS envelope is EnvelopeAuthError, not KmsUnavailableError", async () => {
    const { createKmsCaptureUnsealer } = await s8.captureUnsealer();
    const envelope = Buffer.from(await kmsEnvelope(Buffer.from("tamper me")));
    const at = envelope.length - 17;
    envelope[at] = (envelope[at] ?? 0) ^ 0x01;

    await expectCryptoError(
      () =>
        createKmsCaptureUnsealer({ client: fakeKms(), metrics: observed().metrics }).unseal(
          envelope,
          CTX,
        ),
      "EnvelopeAuthError",
    );
  });
});

describe("TP-8.6: the api-secrets cipher and key rotation (F-114)", () => {
  const k1 = randomBytes(32);
  const k2 = randomBytes(32);

  it("TP-8.6: seal with k1, unseal with the k1 cipher; the {k1,k2} cipher (current k2) unseals it; a k2-only cipher throws UnknownKeyVersionError", async () => {
    const { createApiSecretsCipher } = await s8.apiSecrets();
    const one = createApiSecretsCipher({ current: "k1", keys: new Map([["k1", k1]]) });
    const both = createApiSecretsCipher({
      current: "k2",
      keys: new Map([
        ["k1", k1],
        ["k2", k2],
      ]),
    });
    const onlyK2 = createApiSecretsCipher({ current: "k2", keys: new Map([["k2", k2]]) });
    const plaintext = Buffer.from("api secret");

    const envelope = one.seal(plaintext, CTX);

    expect(one.unseal(envelope, CTX)).toEqual(plaintext);
    expect(both.unseal(envelope, CTX)).toEqual(plaintext);
    await expectCryptoError(() => onlyK2.unseal(envelope, CTX), "UnknownKeyVersionError");
  });

  it("TP-8.17x: the envelope is api-local (0x03) with the key id as key version; currentKeyId is the current id; another context is EnvelopeAuthError", async () => {
    const { createApiSecretsCipher } = await s8.apiSecrets();
    const { keyVersionOf } = await s8.envelope();
    const cipher = createApiSecretsCipher({
      current: "k2",
      keys: new Map([
        ["k1", k1],
        ["k2", k2],
      ]),
    });

    const envelope = cipher.seal(Buffer.from("x"), CTX);

    expect(envelope[1]).toBe(0x03);
    expect(keyVersionOf(envelope)).toBe("k2");
    expect(cipher.currentKeyId()).toBe("k2");
    await expectCryptoError(
      () => cipher.unseal(envelope, { ...CTX, purpose: "other" }),
      "EnvelopeAuthError",
    );
  });

  it("TP-8.17x: a capture envelope given to the api cipher is EnvelopeFormatError", async () => {
    const { createApiSecretsCipher } = await s8.apiSecrets();
    const { createCaptureSealer } = await s8.captureSealer();
    const keys = rsaKeyPair();
    const capture = createCaptureSealer({
      publicKeyPem: keys.publicPem,
      keyVersion: "local:1",
    }).seal(Buffer.from("x"), CTX);

    await expectCryptoError(
      () =>
        createApiSecretsCipher({ current: "k1", keys: new Map([["k1", k1]]) }).unseal(capture, CTX),
      "EnvelopeFormatError",
    );
  });
});
