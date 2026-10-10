// The web build (F-221, S-11a acceptance criteria, A-313): TP-11.27, AC-11.1 and AC-11.3. Builds go
// to temporary directories, so apps/web/dist isn't touched.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function run(
  command: string,
  args: readonly string[],
  env: Record<string, string> = {},
): { status: number | null; output: string } {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, CI: "true", FORCE_COLOR: "0", NO_COLOR: "1", ...env },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function withOutDir<T>(fn: (outDir: string) => T): T {
  const outDir = mkdtempSync(path.join(tmpdir(), "budmon-web-build-"));
  try {
    return fn(outDir);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

describe("TP-11.27: version.json (F-221)", () => {
  it('TP-11.27: BUDMON_BUILD_NUMBER=12 vite build writes version.json {"buildNumber":12}', () => {
    withOutDir((outDir) => {
      const { status, output } = run(
        "pnpm",
        ["--filter", "@budmon/web", "exec", "vite", "build", "--outDir", outDir, "--emptyOutDir"],
        { BUDMON_BUILD_NUMBER: "12" },
      );

      expect(status, output).toBe(0);
      expect(readFileSync(path.join(outDir, "version.json"), "utf8")).toBe('{"buildNumber":12}');
    });
  }, 300_000);
});

describe("S-11a acceptance criteria", () => {
  it("AC-11.1: pnpm --filter @budmon/web build produces the app (index.html) and version.json (buildNumber 0 outside release builds)", () => {
    withOutDir((outDir) => {
      const env = { ...process.env };
      delete env["BUDMON_BUILD_NUMBER"];
      const result = spawnSync(
        "pnpm",
        ["--filter", "@budmon/web", "build", "--outDir", outDir, "--emptyOutDir"],
        { cwd: ROOT, encoding: "utf8", env: { ...env, CI: "true", NO_COLOR: "1" } },
      );

      expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
      expect(existsSync(path.join(outDir, "index.html"))).toBe(true);
      expect(JSON.parse(readFileSync(path.join(outDir, "version.json"), "utf8"))).toEqual({
        buildNumber: 0,
      });
    });
  }, 300_000);

  it("AC-11.3: the web sources have no physical Tailwind utilities or CSS properties (ESLint's budmon/no-physical-tailwind and lint:css pass)", () => {
    const eslint = run(path.join(ROOT, "node_modules/.bin/eslint"), ["apps/web/src"]);
    const css = run("pnpm", ["lint:css"]);

    expect(eslint.status, eslint.output).toBe(0);
    expect(eslint.output).not.toContain("budmon/no-physical-tailwind");
    expect(css.status, css.output).toBe(0);
  }, 300_000);
});
