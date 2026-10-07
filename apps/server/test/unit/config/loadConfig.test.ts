// F-10 / F-11 loadConfig. TP-2.1 to TP-2.5, TP-2.21 to TP-2.23, TP-2.30 (config part), plus extra
// cases TP-2.33x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../../../src/platform/config/loadConfig.js";
import type { Config } from "../../../src/platform/config/schema.js";
import { Secret } from "../../../src/platform/observability/redaction.js";
import {
  devApi,
  devMigrate,
  devWorker,
  keyRing,
  prodApi,
  prodMigrate,
  prodWorkerCapture,
  prodWorkerGeneral,
  readFileFrom,
  roleSecretsJson,
  rsaKeyPair,
  withFile,
  type Fixture,
} from "../../support/configEnv.js";

type Problem = { variable: string; rule: string };

function load(f: Fixture): Config {
  return loadConfig(f.kind, f.env, readFileFrom(f.files));
}

/** The problems loadConfig reports, or [] when it accepts the fixture. */
function problemsOf(f: Fixture): readonly Problem[] {
  try {
    load(f);
    return [];
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
}

function caughtConfigError(f: Fixture): ConfigError {
  try {
    load(f);
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error("loadConfig accepted the fixture");
}

function isDeepFrozen(value: unknown, seen = new Set<unknown>()): boolean {
  if (typeof value !== "object" || value === null || seen.has(value)) return true;
  seen.add(value);
  if (value instanceof Secret || value instanceof URL || Buffer.isBuffer(value)) return true;
  if (value instanceof Map || value instanceof Set) return true;
  if (!Object.isFrozen(value)) return false;
  return Object.values(value).every((v) => isDeepFrozen(v, seen));
}

describe("TP-2.1: a valid development configuration per process kind", () => {
  it("TP-2.1: api: deep-frozen, secrets are Secret instances, defaults applied", () => {
    const config = load(devApi());

    expect(isDeepFrozen(config)).toBe(true);
    expect(config.kind).toBe("api");
    expect(config.appEnv).toBe("development");
    expect(config.logLevel).toBe("info");
    expect(config.release).toBe("dev");
    expect(config.db).toMatchObject({ port: 5432, sslmode: "disable", poolMax: 10 });
    expect(config.db.password).toBeInstanceOf(Secret);
    expect(config.db.password.reveal()).toBe("db-password");
    expect(config.api).toMatchObject({ port: 3000, host: "0.0.0.0" });
    expect(config.api?.clientVersions).toMatchObject({
      minAndroid: 0,
      latestAndroid: 0,
      minWeb: 0,
    });
    expect(config.api?.cursorKey).toBeInstanceOf(Secret);
    expect(config.api?.rateLimitKey).toBeInstanceOf(Secret);
    expect(config.api?.apiSecretsKeys).toBeInstanceOf(Secret);
    expect(config.api?.recoveryCodeKeys).toBeInstanceOf(Secret);
    expect(config.api?.googleSignIn).toBeUndefined();
  });

  it("TP-2.1: worker: deep-frozen, secrets are Secret instances, defaults applied", () => {
    const config = load(devWorker());

    expect(isDeepFrozen(config)).toBe(true);
    expect(config.kind).toBe("worker");
    expect(config.db.poolMax).toBe(5);
    expect([...(config.worker?.roles ?? [])].sort()).toEqual(["capture", "general"]);
    expect(config.worker?.queue).toMatchObject({ user: "budmon_queue", poolMax: 3 });
    expect(config.worker?.queue?.password).toBeInstanceOf(Secret);
    expect(config.capture?.mailboxHmacKey).toBeInstanceOf(Secret);
    expect(config.capture?.kms.provider).toBe("local");
    expect(config.fx).toEqual({ provider: "fixed" });
    expect(config.email?.from).toBe("Budmon <no-reply@budmon.local>");
  });

  it("TP-2.1: migrate: deep-frozen, role secrets read, pool default 2", () => {
    const config = load(devMigrate());

    expect(isDeepFrozen(config)).toBe(true);
    expect(config.kind).toBe("migrate");
    expect(config.db.poolMax).toBe(2);
    expect(Object.keys(config.migrate?.roleSecrets ?? {}).sort()).toEqual([
      "budmon_app",
      "budmon_capture",
      "budmon_migrator",
      "budmon_monitor",
      "budmon_queue",
    ]);
  });

  it("TP-2.1 (A-71): migrate with DB_PASSWORD_PREVIOUS_FILE has migrate.previousPassword as a Secret", () => {
    const f = devMigrate();
    withFile(f, "DB_PASSWORD_PREVIOUS_FILE", "previous-password\n");

    const previous = load(f).migrate?.previousPassword;

    expect(previous).toBeInstanceOf(Secret);
    expect(previous?.reveal()).toBe("previous-password");
  });

  it("TP-2.1 (A-71): migrate without DB_PASSWORD_PREVIOUS_FILE has no previousPassword", () => {
    expect(load(devMigrate()).migrate?.previousPassword).toBeUndefined();
  });

  it("TP-2.33x: a *_FILE value has one trailing newline trimmed, no more", () => {
    const f = devApi();
    withFile(f, "DB_PASSWORD_FILE", "pw\n\n");

    expect(load(f).db.password.reveal()).toBe("pw\n");
  });

  it("TP-2.33x: a Config doesn't reveal secrets when serialised", () => {
    const text = JSON.stringify(load(devApi()));

    expect(text).not.toContain("db-password");
  });
});

describe("TP-2.2: missing and invalid variables", () => {
  it("TP-2.2: reports DB_HOST required and DB_PORT invalid, and never prints a file's content", () => {
    const f = devApi();
    delete f.env["DB_HOST"];
    f.env["DB_PORT"] = "abc";
    withFile(f, "CURSOR_KEY_FILE", "S3NT1NEL");

    const error = caughtConfigError(f);

    expect(error.problems).toContainEqual({ variable: "DB_HOST", rule: "required" });
    expect(error.problems.some((p) => p.variable === "DB_PORT")).toBe(true);
    expect(error.problems.some((p) => p.variable === "CURSOR_KEY_FILE")).toBe(true);
    expect(error.message).not.toContain("S3NT1NEL");
    expect(JSON.stringify(error.problems)).not.toContain("S3NT1NEL");
  });

  it("TP-2.33x: one problem per failing variable", () => {
    const f = devApi();
    delete f.env["DB_HOST"];
    delete f.env["DB_NAME"];

    const variables = problemsOf(f).map((p) => p.variable);

    expect(variables.filter((v) => v === "DB_HOST")).toHaveLength(1);
    expect(variables.filter((v) => v === "DB_NAME")).toHaveLength(1);
  });

  it.each([["__FILL_ME__\n"], ["__FILL_ME__"]])(
    'TP-2.33x: a file holding the placeholder %j is "placeholder not filled"',
    (content) => {
      const f = devApi();
      withFile(f, "CURSOR_KEY_FILE", content);

      expect(problemsOf(f)).toContainEqual({
        variable: "CURSOR_KEY_FILE",
        rule: "placeholder not filled",
      });
    },
  );

  it('TP-2.33x: a plain variable set to __FILL_ME__ is "placeholder not filled"', () => {
    const f = devApi();
    f.env["DB_HOST"] = "__FILL_ME__";

    expect(problemsOf(f)).toContainEqual({ variable: "DB_HOST", rule: "placeholder not filled" });
  });
});

describe("TP-2.3: production-only rules, each separately", () => {
  const RULES = ["not allowed in production", "required"];

  it("TP-2.33x: the production fixtures are valid as they are", () => {
    for (const f of [prodApi(), prodWorkerGeneral(), prodWorkerCapture(), prodMigrate()]) {
      expect(problemsOf(f)).toEqual([]);
    }
  });

  it.each([
    [
      "OBJECT_STORE_KIND=fs (api)",
      () => {
        const f = prodApi();
        f.env["OBJECT_STORE_KIND"] = "fs";
        f.env["OBJECT_STORE_FS_ROOT"] = "/data/objects";
        return f;
      },
      "OBJECT_STORE_KIND",
    ],
    [
      "KMS_PROVIDER=local (worker capture)",
      () => {
        const f = prodWorkerCapture();
        f.env["KMS_PROVIDER"] = "local";
        withFile(f, "CAPTURE_PRIVATE_KEY_FILE", rsaKeyPair().privatePem);
        return f;
      },
      "KMS_PROVIDER",
    ],
    [
      "FX_PROVIDER=fixed (worker general)",
      () => {
        const f = prodWorkerGeneral();
        f.env["FX_PROVIDER"] = "fixed";
        return f;
      },
      "FX_PROVIDER",
    ],
    [
      "DB_SSLMODE=disable with WORKER_ROLES=capture",
      () => {
        const f = prodWorkerCapture();
        f.env["DB_SSLMODE"] = "disable";
        return f;
      },
      "DB_SSLMODE",
    ],
    [
      "password-form role secrets (migrate)",
      () => {
        const f = prodMigrate();
        withFile(f, "ROLE_SECRETS_FILE", roleSecretsJson("password"));
        return f;
      },
      "ROLE_SECRETS_FILE",
    ],
    [
      "no TRUSTED_PROXY (api)",
      () => {
        const f = prodApi();
        delete f.env["TRUSTED_PROXY"];
        return f;
      },
      "TRUSTED_PROXY",
    ],
  ])("TP-2.3: %s is exactly one problem", (_label, build, variable) => {
    const problems = problemsOf(build());

    expect(problems).toHaveLength(1);
    expect(problems[0]?.variable).toBe(variable);
    expect(RULES).toContain(problems[0]?.rule);
  });
});

describe("TP-2.4: APP_ENV=rehearsal", () => {
  it("TP-2.4: KMS_PROVIDER=local is accepted", () => {
    const f = prodWorkerCapture("rehearsal");
    f.env["KMS_PROVIDER"] = "local";
    f.env["CAPTURE_KEY_VERSION"] = "local:1";
    delete f.env["GCP_CREDENTIALS_FILE"];
    withFile(f, "CAPTURE_PRIVATE_KEY_FILE", rsaKeyPair().privatePem);

    expect(problemsOf(f)).toEqual([]);
  });

  it("TP-2.4: OBJECT_STORE_KIND=fs is a problem", () => {
    const f = prodApi("rehearsal");
    f.env["OBJECT_STORE_KIND"] = "fs";
    f.env["OBJECT_STORE_FS_ROOT"] = "/data/objects";

    expect(problemsOf(f).map((p) => p.variable)).toEqual(["OBJECT_STORE_KIND"]);
  });
});

describe("TP-2.5: unreadable *_FILE", () => {
  it("TP-2.5: readFile throwing for CURSOR_KEY_FILE is 'file not readable'", () => {
    const f = devApi();
    f.env["CURSOR_KEY_FILE"] = "/secrets/missing";

    expect(problemsOf(f)).toContainEqual({
      variable: "CURSOR_KEY_FILE",
      rule: "file not readable",
    });
  });
});

describe("TP-2.21: GOOGLE_OAUTH_REDIRECT_ORIGIN (production)", () => {
  it("TP-2.21: unset on the api, it defaults to PUBLIC_ORIGIN's origin", () => {
    const f = prodApi();
    delete f.env["GOOGLE_OAUTH_REDIRECT_ORIGIN"];
    f.env["PUBLIC_ORIGIN"] = "https://a.ts.net";

    expect(load(f).api?.googleOAuthRedirectOrigin.origin).toBe("https://a.ts.net");
  });

  it("TP-2.33x: a capture worker's origin is in capture.oauth.redirectOrigin", () => {
    expect(load(prodWorkerCapture()).capture?.oauth?.redirectOrigin.origin).toBe(
      "http://localhost:8080",
    );
  });

  it.each([["http://localhost:8080"]])("TP-2.21: %s is accepted for the api", (origin) => {
    const f = prodApi();
    f.env["GOOGLE_OAUTH_REDIRECT_ORIGIN"] = origin;

    expect(problemsOf(f)).toEqual([]);
    expect(load(f).api?.googleOAuthRedirectOrigin.origin).toBe(origin);
  });

  it.each([
    ["http://localhost:8080/", "trailing slash"],
    ["http://example.com", "http only for localhost"],
    ["https://a.ts.net/cb", "path"],
  ])("TP-2.21: %s is a problem (%s)", (origin) => {
    const f = prodApi();
    f.env["GOOGLE_OAUTH_REDIRECT_ORIGIN"] = origin;

    expect(problemsOf(f).map((p) => p.variable)).toEqual(["GOOGLE_OAUTH_REDIRECT_ORIGIN"]);
  });

  it('TP-2.21: a capture worker with the client id set and the origin unset is "required"', () => {
    const f = prodWorkerCapture();
    delete f.env["GOOGLE_OAUTH_REDIRECT_ORIGIN"];

    expect(problemsOf(f)).toEqual([{ variable: "GOOGLE_OAUTH_REDIRECT_ORIGIN", rule: "required" }]);
  });
});

describe("TP-2.22: SMTP_URL, SMTP_PASSWORD_FILE, EMAIL_FROM and the worker's PUBLIC_ORIGIN (production)", () => {
  it.each([
    ["smtp://mailpit:1025", { security: "none", host: "mailpit", port: 1025 }],
    [
      "smtps://u@smtp.example.com",
      { security: "implicit_tls", host: "smtp.example.com", port: 465, user: "u" },
    ],
  ])("TP-2.22: SMTP_URL %s is accepted with smtpTransport %o", (url, transport) => {
    const f = prodWorkerGeneral();
    f.env["SMTP_URL"] = url;

    const email = load(f).email;

    expect(email?.smtpTransport).toEqual(transport);
    expect(email?.smtpUrl.href).toBe(new URL(url).href);
  });

  it("TP-2.22: SMTP_URL smtp://u@smtp.example.com:587 is accepted with STARTTLS required", () => {
    const f = prodWorkerGeneral();
    f.env["SMTP_URL"] = "smtp://u@smtp.example.com:587";

    expect(load(f).email?.smtpTransport).toMatchObject({
      security: "starttls",
      port: 587,
      user: "u",
    });
  });

  it.each([
    ["smtp://smtp.example.com", { security: "starttls", host: "smtp.example.com", port: 587 }],
    [
      "smtps://smtp.example.com:2465",
      { security: "implicit_tls", host: "smtp.example.com", port: 2465 },
    ],
  ])("TP-2.33x: SMTP_URL %s gives smtpTransport %o", (url, transport) => {
    const f = prodWorkerGeneral();
    f.env["SMTP_URL"] = url;

    expect(load(f).email?.smtpTransport).toEqual(transport);
  });

  it.each([
    ["smtp://localhost:1025", "plain SMTP to localhost only in development and test"],
    ["http://x", "scheme"],
  ])("TP-2.22: SMTP_URL %s is a problem (%s)", (url) => {
    const f = prodWorkerGeneral();
    f.env["SMTP_URL"] = url;

    expect(problemsOf(f).map((p) => p.variable)).toEqual(["SMTP_URL"]);
  });

  it("TP-2.22: a password in SMTP_URL is a problem that doesn't echo the value", () => {
    const f = prodWorkerGeneral();
    f.env["SMTP_URL"] = "smtp://u:Pw7f3aSECRET@smtp.example.com:587";

    const error = caughtConfigError(f);

    expect(error.problems.map((p) => p.variable)).toEqual(["SMTP_URL"]);
    expect(error.message).not.toContain("Pw7f3aSECRET");
    expect(JSON.stringify(error.problems)).not.toContain("Pw7f3aSECRET");
  });

  // TP-2.54x (code review B-5): decoding the user name must not escape as a URIError.
  it("TP-2.54x: a malformed percent-escape in SMTP_URL's user is a ConfigError naming SMTP_URL, without the value", () => {
    const f = prodWorkerGeneral();
    f.env["SMTP_URL"] = "smtp://%E0%A4%A@smtp.example.com";

    const error = caughtConfigError(f);

    expect(error.problems.map((p) => p.variable)).toEqual(["SMTP_URL"]);
    expect(error.message).not.toContain("%E0%A4%A");
    expect(JSON.stringify(error.problems)).not.toContain("%E0%A4%A");
  });

  it("TP-2.22: an empty SMTP_PASSWORD_FILE means no authentication", () => {
    const f = prodWorkerGeneral();
    withFile(f, "SMTP_PASSWORD_FILE", "");

    expect(load(f).email?.smtpPassword).toBeUndefined();
  });

  it.each([["EMAIL_FROM"], ["PUBLIC_ORIGIN"]])('TP-2.22: %s unset is "required"', (variable) => {
    const f = prodWorkerGeneral();
    f.env[variable] = undefined;

    expect(problemsOf(f)).toEqual([{ variable, rule: "required" }]);
  });

  it("TP-2.33x: plain SMTP to localhost is accepted in development, without TLS", () => {
    const f = devWorker();
    f.env["SMTP_URL"] = "smtp://localhost:1025";

    expect(load(f).email?.smtpTransport).toEqual({
      security: "none",
      host: "localhost",
      port: 1025,
    });
  });
});

describe("TP-2.23: GOOGLE_SIGNIN_* and RECOVERY_CODE_HMAC_KEYS_FILE (api, production)", () => {
  it('TP-2.23: client id unset is "required"', () => {
    const f = prodApi();
    delete f.env["GOOGLE_SIGNIN_CLIENT_ID"];

    expect(problemsOf(f)).toContainEqual({ variable: "GOOGLE_SIGNIN_CLIENT_ID", rule: "required" });
  });

  it('TP-2.23: client id set without the secret file is "required" for GOOGLE_SIGNIN_CLIENT_SECRET_FILE', () => {
    const f = prodApi();
    delete f.env["GOOGLE_SIGNIN_CLIENT_SECRET_FILE"];

    expect(problemsOf(f)).toEqual([
      { variable: "GOOGLE_SIGNIN_CLIENT_SECRET_FILE", rule: "required" },
    ]);
  });

  it("TP-2.23: callback http://localhost:8080 and two app origins are accepted", () => {
    const f = prodApi();
    f.env["GOOGLE_SIGNIN_CALLBACK_ORIGIN"] = "http://localhost:8080";
    f.env["GOOGLE_SIGNIN_APP_ORIGINS"] = "https://a.ts.net,http://localhost:8080";

    const signIn = load(f).api?.googleSignIn;

    expect(signIn?.appOrigins.map((u) => u.origin)).toEqual([
      "https://a.ts.net",
      "http://localhost:8080",
    ]);
    expect(signIn?.callbackOrigin.origin).toBe("http://localhost:8080");
  });

  it("TP-2.23: an app origin with a path is a problem", () => {
    const f = prodApi();
    f.env["GOOGLE_SIGNIN_APP_ORIGINS"] = "https://a.ts.net/path";

    expect(problemsOf(f).map((p) => p.variable)).toEqual(["GOOGLE_SIGNIN_APP_ORIGINS"]);
  });

  it("TP-2.23: a bad Android client id is a problem naming GOOGLE_SIGNIN_ANDROID_CLIENT_IDS", () => {
    const f = prodApi();
    f.env["GOOGLE_SIGNIN_ANDROID_CLIENT_IDS"] = "x.apps.googleusercontent.com,bad";

    expect(problemsOf(f).map((p) => p.variable)).toEqual(["GOOGLE_SIGNIN_ANDROID_CLIENT_IDS"]);
  });

  it("TP-2.23: a recovery key ring whose current key isn't in keys is a problem", () => {
    const f = prodApi();
    withFile(f, "RECOVERY_CODE_HMAC_KEYS_FILE", keyRing("k2", ["k1"]));

    expect(problemsOf(f).map((p) => p.variable)).toEqual(["RECOVERY_CODE_HMAC_KEYS_FILE"]);
  });

  it('TP-2.23: a missing recovery key file is "file not readable"', () => {
    const f = prodApi();
    f.env["RECOVERY_CODE_HMAC_KEYS_FILE"] = "/secrets/missing";

    expect(problemsOf(f)).toEqual([
      { variable: "RECOVERY_CODE_HMAC_KEYS_FILE", rule: "file not readable" },
    ]);
  });

  it("TP-2.23: in development the client id may be unset, and googleSignIn is undefined", () => {
    const config = load(devApi());

    expect(config.api?.googleSignIn).toBeUndefined();
  });
});

describe("TP-2.30: DEV_SUPERUSER_URL is a development-tools variable, not configuration (A-59)", () => {
  it("TP-2.30: with DEV_SUPERUSER_URL set, the api config is accepted and holds no field for it", () => {
    const f = devApi();
    f.env["DEV_SUPERUSER_URL"] = "postgres://postgres:s3cr3tSuperUser@localhost:5432/postgres";

    const config = load(f);

    expect(JSON.stringify(config)).not.toContain("s3cr3tSuperUser");
    expect(JSON.stringify(config)).not.toContain("localhost:5432/postgres");
  });
});
