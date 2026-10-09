// The API can't unseal capture secrets (F-96, F-10). TP-8.15.
//
// configSchemaFor exposes no key list, so "has no KMS_PROVIDER, GCP_CREDENTIALS_FILE or
// CAPTURE_PRIVATE_KEY_FILE keys" is checked by behaviour: an api configuration given those
// variables never reads their files and holds nothing from them.
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../../src/platform/config/loadConfig.js";
import { createApiContainer } from "../../../src/platform/container.js";
import { observed } from "../../support/api.js";
import { devApi, readFileFrom, rsaKeyPair, withFile } from "../../support/configEnv.js";

describe("TP-8.15: no capture unsealer on the API side (F-96, F-10)", () => {
  function apiFixtureWithCaptureSecrets() {
    const f = devApi();
    f.env["KMS_PROVIDER"] = "gcp";
    withFile(f, "CAPTURE_PRIVATE_KEY_FILE", rsaKeyPair().privatePem);
    withFile(
      f,
      "GCP_CREDENTIALS_FILE",
      JSON.stringify({ type: "service_account", project_id: "p" }),
    );
    return f;
  }

  it("TP-8.15: the api configuration never reads CAPTURE_PRIVATE_KEY_FILE or GCP_CREDENTIALS_FILE and holds no private key or KMS settings", () => {
    const f = apiFixtureWithCaptureSecrets();
    const read: string[] = [];
    const inner = readFileFrom(f.files);

    const config = loadConfig("api", f.env, (path: string) => {
      read.push(path);
      return inner(path);
    });

    expect(read).not.toContain(f.env["CAPTURE_PRIVATE_KEY_FILE"]);
    expect(read).not.toContain(f.env["GCP_CREDENTIALS_FILE"]);
    const text = JSON.stringify(config);
    expect(text).not.toContain("PRIVATE KEY");
    expect(text).not.toContain("service_account");
    expect(config.capture?.kms).toBeUndefined();
  });

  it("TP-8.15: an ApiContainer has no captureUnsealer member", async () => {
    const f = devApi();
    const config = loadConfig("api", f.env, readFileFrom(f.files));
    const c = createApiContainer(config, observed().overrides);
    try {
      expect("captureUnsealer" in c).toBe(false);
    } finally {
      await c.close();
    }
  });
});
