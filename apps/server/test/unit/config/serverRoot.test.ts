// F-25 serverRoot (A-43). TP-2.28.
// serverRoot caches its first result, so each case imports a fresh copy of the module.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ServerRoot = (fromUrl?: string) => string;

async function freshServerRoot(): Promise<ServerRoot> {
  vi.resetModules();
  const module = await import("../../../src/platform/config/serverRoot.js");
  return module.serverRoot;
}

let dir = "";

beforeEach(() => {
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), "budmon-server-root-")));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function touch(file: string, content = ""): string {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  return file;
}

describe("TP-2.28: serverRoot", () => {
  function serverTree(): string {
    const root = path.join(dir, "r");
    touch(path.join(root, "package.json"), JSON.stringify({ name: "@budmon/server" }));
    touch(path.join(root, "src/x/y.ts"));
    touch(path.join(root, "dist/main/chunks/z.js"));
    return root;
  }

  it("TP-2.28: from a source file under src/ it returns the @budmon/server directory", async () => {
    const root = serverTree();
    const serverRoot = await freshServerRoot();

    expect(serverRoot(pathToFileURL(path.join(root, "src/x/y.ts")).href)).toBe(root);
  });

  it("TP-2.28: from a bundle chunk under dist/main/chunks/ it returns the same directory", async () => {
    const root = serverTree();
    const serverRoot = await freshServerRoot();

    expect(serverRoot(pathToFileURL(path.join(root, "dist/main/chunks/z.js")).href)).toBe(root);
  });

  it('TP-2.28: a tree without @budmon/server\'s package.json throws Error("server root not found")', async () => {
    const other = path.join(dir, "other");
    touch(path.join(other, "package.json"), JSON.stringify({ name: "@budmon/web" }));
    const file = touch(path.join(other, "src/x/y.ts"));
    const serverRoot = await freshServerRoot();

    expect(() => serverRoot(pathToFileURL(file).href)).toThrow(new Error("server root not found"));
  });

  it("TP-2.30x: with no argument it finds apps/server from its own location", async () => {
    const serverRoot = await freshServerRoot();

    expect(serverRoot()).toBe(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."),
    );
  });
});
