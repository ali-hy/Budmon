// The laptop's Caddy (F-175 Caddyfile) in the web image: maintenance answers, the API proxy, SPA
// and asset caching, headers on every response, an access log without query strings, canaries or
// headers (A-4), and no TLS (auto_https off). TP-15.13.
//
// The web image runs as Compose's caddy service; a stub API (the same image running
// `caddy respond` on :3000) joins the project's edge network as `api`.
import { rmSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildImage, compose, laptopHome, sh, TEST_TAG } from "./support.js";

const PROJECT = `budmon-tp15-caddy-${String(process.pid)}`;
const STUB = `${PROJECT}-api`;
const BASE = "http://127.0.0.1:8080";
const CANARY = "CANARY-caddy-tp-15-13-7f3a";
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://*.ingest.de.sentry.io https://*.ingest.sentry.io; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const MAINT_BODY =
  '{"defined":true,"code":"SERVICE_UNAVAILABLE","status":503,"message":"Service unavailable","data":{"outcome":"not_applied"}}';

let home = "";
let createdNetwork = false;

beforeAll(async () => {
  buildImage("web");
  home = laptopHome({});
  if (sh("docker", ["network", "inspect", "budmon_capture_db"]).status !== 0) {
    sh("docker", [
      "network",
      "create",
      "--internal",
      "--subnet",
      "172.30.42.0/29",
      "budmon_capture_db",
    ]);
    createdNetwork = true;
  }
  const up = compose(PROJECT, home, ["up", "-d", "--no-deps", "caddy"]);
  if (up.status !== 0) throw new Error(`compose up caddy: ${up.stderr}`);
  const stub = sh("docker", [
    "run",
    "-d",
    "--name",
    STUB,
    "--network",
    `${PROJECT}_edge`,
    "--network-alias",
    "api",
    `budmon/web:${TEST_TAG}`,
    "caddy",
    "respond",
    "--listen",
    ":3000",
    "--body",
    '{"stub":true}',
  ]);
  if (stub.status !== 0) throw new Error(`stub api: ${stub.stderr}`);
  for (let i = 0; i < 30; i += 1) {
    try {
      await fetch(`${BASE}/version.json`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }
  throw new Error("caddy never answered");
}, 1_800_000);

afterAll(() => {
  sh("docker", ["rm", "-f", STUB]);
  if (home === "") return;
  compose(PROJECT, home, ["down", "-v", "--remove-orphans"]);
  if (createdNetwork) sh("docker", ["network", "rm", "budmon_capture_db"]);
  rmSync(home, { recursive: true, force: true });
});

const flag = () => path.join(home, "maintenance/on");

function expectHeaders(res: Response): void {
  expect(res.headers.get("content-security-policy")).toBe(CSP);
  expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000");
  expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
}

describe("TP-15.13: Caddy on the laptop (F-175)", () => {
  it('TP-15.13: with the maintenance flag, /api/* is the exact 503 envelope with Retry-After 120, and /health/ready is {"status":"maintenance"} 503', async () => {
    writeFileSync(flag(), "");
    try {
      const api = await fetch(`${BASE}/api/v1/x`);
      expect(api.status).toBe(503);
      expect(await api.text()).toBe(MAINT_BODY);
      expect(api.headers.get("retry-after")).toBe("120");
      expect(api.headers.get("content-type")).toMatch(/^application\/json/);
      expectHeaders(api);

      const ready = await fetch(`${BASE}/health/ready`);
      expect(ready.status).toBe(503);
      expect(await ready.text()).toBe('{"status":"maintenance"}');
      expectHeaders(ready);
    } finally {
      unlinkSync(flag());
    }
  });

  it("TP-15.13: without the flag, /api/* and the Google callback reach the API; the access log has bare paths, no canary and no headers", async () => {
    const since = new Date().toISOString();

    const a = await fetch(`${BASE}/api/v1/x?token=${CANARY}`, {
      headers: { Authorization: `Bearer ${CANARY}` },
    });
    const b = await fetch(`${BASE}/api/v1/auth/google/callback?code=${CANARY}&state=${CANARY}`);

    expect(a.status).toBe(200);
    expect(await a.text()).toBe('{"stub":true}');
    expect(b.status).toBe(200);
    expectHeaders(a);
    const logs = compose(PROJECT, home, ["logs", "--no-log-prefix", "--since", since, "caddy"]);
    const text = `${logs.stdout}${logs.stderr}`;
    expect(text).toContain("/api/v1/auth/google/callback");
    expect(text).not.toContain(CANARY);
    expect(text).not.toMatch(/\/api\/v1\/x\?/);
    expect(text).not.toMatch(/callback\?/);
    expect(text).not.toMatch(/"headers"\s*:\s*\{\s*"/);
    expect(text).not.toMatch(/Authorization/i);
  });

  it("TP-15.13: /some/route serves index.html; /version.json has Cache-Control no-store; /assets/* are immutable", async () => {
    const route = await fetch(`${BASE}/some/route`);
    const html = await route.text();
    expect(route.status).toBe(200);
    expect(html).toMatch(/<div id="root"/);
    expectHeaders(route);

    const version = await fetch(`${BASE}/version.json`);
    expect(version.status).toBe(200);
    expect(version.headers.get("cache-control")).toBe("no-store");

    const asset = /\/assets\/[^"']+\.js/.exec(html)?.[0];
    expect(asset).toBeDefined();
    const res = await fetch(`${BASE}${asset ?? "/assets/a.js"}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expectHeaders(res);
  });

  it("TP-15.13: a TLS request to https://127.0.0.1:8080/ fails (plain HTTP only)", () => {
    const r = sh("curl", ["-k", "-sS", "--max-time", "10", "https://127.0.0.1:8080/"]);

    expect(r.status).not.toBe(0);
  });
});
