// TP-2.6: the built api entry (F-24) under plain Node with DB_HOST unset (F-90, F-11).
import { spawnSync } from "node:child_process";
import { createConnection, createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const REPO_ROOT = path.resolve(SERVER_DIR, "../..");

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

function portAcceptsConnections(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      resolve(false);
    });
  });
}

describe("TP-2.6: node dist/main/api.js with DB_HOST unset", () => {
  beforeAll(() => {
    const build = spawnSync("pnpm", ["--filter", "@budmon/server", "build"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    if (build.status !== 0) {
      throw new Error(`pnpm --filter @budmon/server build failed:\n${build.stdout}${build.stderr}`);
    }
  }, 180_000);

  it("TP-2.6: prints the configuration problems, exits 78 and opens no port", async () => {
    const port = await freePort();
    const env: Record<string, string> = {
      PATH: process.env["PATH"] ?? "",
      APP_ENV: "development",
      PORT: String(port),
      HOST: "127.0.0.1",
    };

    const result = spawnSync(process.execPath, ["dist/main/api.js"], {
      cwd: SERVER_DIR,
      env,
      encoding: "utf8",
      timeout: 30_000,
    });

    expect(result.status, result.stderr).toBe(78);
    expect(result.stderr).toContain("Configuration invalid:");
    expect(result.stderr.split("\n")).toContain("  - DB_HOST: required");
    expect(`${result.stdout}${result.stderr}`).not.toContain("api_started");
    expect(await portAcceptsConnections(port)).toBe(false);
  });
});
