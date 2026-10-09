// The healthcheck entry (F-175 "Health checks", S-6). TP-6.10's process part.
//
// It runs `src/main/healthcheck.ts` through tsx (the bundle is built once, by apiBundle.test.ts;
// a second build in parallel would race). `--heartbeat` reads the fixed `/tmp/heartbeat` and
// judges its content (F-79's epoch seconds, A-208); `--ready` requests
// `http://127.0.0.1:${PORT}/health/ready`, so the stub API listens on a free port.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SERVER_DIR } from "../../support/platform.js";

const HEARTBEAT = "/tmp/heartbeat";
const TSX = path.join(SERVER_DIR, "node_modules/.bin/tsx");

function healthcheck(
  arg: string,
  env: Record<string, string> = {},
): { status: number | null; output: string } {
  const result = spawnSync(TSX, ["src/main/healthcheck.ts", arg], {
    cwd: SERVER_DIR,
    env: { PATH: process.env["PATH"] ?? "", ...env },
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

  /** A heartbeat whose content is `ageSeconds` old, with the file's mtime `mtimeAgeSeconds` old. */
  function beat(ageSeconds: number, mtimeAgeSeconds = ageSeconds): void {
    const now = Math.floor(Date.now() / 1000);
    writeFileSync(HEARTBEAT, String(now - ageSeconds));
    utimesSync(HEARTBEAT, now - mtimeAgeSeconds, now - mtimeAgeSeconds);
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

  it("TP-6.10: (A-208) content 'abc' exits 1", () => {
    writeFileSync(HEARTBEAT, "abc");

    const { status, output } = healthcheck("--heartbeat");

    expect(status, output).toBe(1);
  });

  it("TP-6.10: (A-208) a fresh timestamp in a file whose mtime is 2 minutes old exits 0 (the content decides)", () => {
    beat(0, 120);

    const { status, output } = healthcheck("--heartbeat");

    expect(status, output).toBe(0);
  });

  it("TP-6.10: (A-208) a 61 s old timestamp in a file whose mtime is now exits 1", () => {
    beat(61, 0);

    const { status, output } = healthcheck("--heartbeat");

    expect(status, output).toBe(1);
  });

  it("TP-6.10: no heartbeat file exits 1", () => {
    rmSync(HEARTBEAT, { force: true });

    const { status, output } = healthcheck("--heartbeat");

    expect(status, output).toBe(1);
  });
});

describe("TP-6.10: healthcheck --ready (PORT, A-208)", () => {
  let server: Server;
  let port = 0;
  let status = 200;

  beforeAll(async () => {
    server = createServer((req, res) => {
      res.writeHead(req.url === "/health/ready" ? status : 404);
      res.end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    port = typeof address === "object" && address !== null ? address.port : 0;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  });

  it("TP-6.10: the API on PORT answering 200 exits 0", () => {
    status = 200;

    const { status: code, output } = healthcheck("--ready", { PORT: String(port) });

    expect(code, output).toBe(0);
  });

  it("TP-6.10: the API on PORT answering 503 exits 1", () => {
    status = 503;

    const { status: code, output } = healthcheck("--ready", { PORT: String(port) });

    expect(code, output).toBe(1);
  });

  it("TP-6.10: (A-208) --ready uses PORT: with the stub answering 200 but PORT pointing elsewhere, it exits 1", async () => {
    status = 200;
    const closed = await new Promise<number>((resolve) => {
      const probe = createServer();
      probe.listen(0, "127.0.0.1", () => {
        const a = probe.address();
        const p = typeof a === "object" && a !== null ? a.port : 0;
        probe.close(() => {
          resolve(p);
        });
      });
    });

    const { status: code, output } = healthcheck("--ready", { PORT: String(closed) });

    expect(code, output).toBe(1);
  });
});
