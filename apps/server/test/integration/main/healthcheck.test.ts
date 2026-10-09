// The healthcheck entry (F-175 "Health checks", S-6). TP-6.10's process part.
//
// It runs `src/main/healthcheck.ts` through tsx (the bundle is built once, by apiBundle.test.ts;
// a second build in parallel would race). The paths are the LLD's fixed ones: `/tmp/heartbeat`
// and `http://127.0.0.1:3000/health/ready`, so port 3000 must be free while this file runs.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SERVER_DIR } from "../../support/platform.js";

const HEARTBEAT = "/tmp/heartbeat";
const TSX = path.join(SERVER_DIR, "node_modules/.bin/tsx");

function healthcheck(arg: string): { status: number | null; output: string } {
  const result = spawnSync(TSX, ["src/main/healthcheck.ts", arg], {
    cwd: SERVER_DIR,
    env: { PATH: process.env["PATH"] ?? "" },
    encoding: "utf8",
    timeout: 30_000,
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe("TP-6.10: healthcheck --heartbeat", () => {
  let saved: string | undefined;

  beforeAll(() => {
    saved = existsSync(HEARTBEAT) ? readFileSync(HEARTBEAT, "utf8") : undefined;
  });

  afterAll(() => {
    if (saved === undefined) rmSync(HEARTBEAT, { force: true });
    else writeFileSync(HEARTBEAT, saved);
  });

  /** A heartbeat written `ageSeconds` ago: the content (F-79's epoch seconds) and the mtime agree. */
  function beat(ageSeconds: number): void {
    const at = Math.floor(Date.now() / 1000) - ageSeconds;
    writeFileSync(HEARTBEAT, String(at));
    utimesSync(HEARTBEAT, at, at);
  }

  it("TP-6.10: a fresh heartbeat exits 0", () => {
    beat(0);

    const { status, output } = healthcheck("--heartbeat");

    expect(status, output).toBe(0);
  });

  it("TP-6.10: a 61 s old heartbeat exits 1", () => {
    beat(61);

    const { status, output } = healthcheck("--heartbeat");

    expect(status, output).toBe(1);
  });

  it("TP-6.10: no heartbeat file exits 1", () => {
    rmSync(HEARTBEAT, { force: true });

    const { status, output } = healthcheck("--heartbeat");

    expect(status, output).toBe(1);
  });
});

describe("TP-6.10: healthcheck --ready", () => {
  let server: Server;
  let status = 200;

  beforeAll(async () => {
    server = createServer((req, res) => {
      res.writeHead(req.url === "/health/ready" ? status : 404);
      res.end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(3000, "127.0.0.1", resolve);
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  });

  it("TP-6.10: the API answering 200 exits 0", () => {
    status = 200;

    const { status: code, output } = healthcheck("--ready");

    expect(code, output).toBe(0);
  });

  it("TP-6.10: the API answering 503 exits 1", () => {
    status = 503;

    const { status: code, output } = healthcheck("--ready");

    expect(code, output).toBe(1);
  });
});
