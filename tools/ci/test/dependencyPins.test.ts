// TP-0.20: ESLint 10 dependency pins and the single declared peer exception (A-13, A-19).
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

function configPackage(): PackageJson {
  return JSON.parse(
    readFileSync(path.join(ROOT, "packages/config/package.json"), "utf8"),
  ) as PackageJson;
}

/** Every version range declared for `name` in packages/config/package.json. */
function declaredVersions(name: string): string[] {
  const pkg = configPackage();
  return [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies]
    .map((deps) => deps?.[name])
    .filter((version): version is string => version !== undefined);
}

/** Clones HEAD (the committed tree, no node_modules) into a temporary directory, runs `pnpm install <args>` there and
 * returns the exit status and combined output. */
function installInCleanClone(args: readonly string[]): { status: number | null; output: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "budmon-install-"));
  try {
    const checkout = path.join(dir, "budmon");
    const clone = spawnSync("git", ["clone", "--quiet", "--no-hardlinks", ROOT, checkout], {
      encoding: "utf8",
    });
    if (clone.status !== 0) throw new Error(`git clone failed: ${clone.stderr}`);
    const install = spawnSync("pnpm", ["install", ...args], {
      cwd: checkout,
      encoding: "utf8",
      env: { ...process.env, CI: "true" },
    });
    return { status: install.status, output: `${install.stdout}${install.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("TP-0.20: ESLint 10 dependency pins (A-13)", () => {
  it("TP-0.20 (a): peerDependencyRules has exactly allowedVersions { eslint-plugin-jsx-a11y>eslint: 10 }", () => {
    const workspace = parse(readFileSync(path.join(ROOT, "pnpm-workspace.yaml"), "utf8")) as {
      peerDependencyRules?: unknown;
    };

    expect(workspace.peerDependencyRules).toEqual({
      allowedVersions: { "eslint-plugin-jsx-a11y>eslint": "10" },
    });
  });

  it.each([
    ["eslint-plugin-formatjs", "8.1.1"],
    ["eslint-plugin-jsx-a11y", "6.10.2"],
    ["eslint", "10.12.0"],
  ])("TP-0.20 (a): packages/config pins %s to exactly %s", (name, version) => {
    const versions = declaredVersions(name);

    expect(versions.length).toBeGreaterThan(0);
    expect(versions.every((v) => v === version)).toBe(true);
  });

  it("TP-0.20 (b): a resolving install (pnpm install --fix-lockfile) in a fresh clone exits 0 and reports no peer issue", () => {
    const { status, output } = installInCleanClone(["--fix-lockfile"]);

    expect(status, output).toBe(0);
    expect(output).not.toContain("Issues with peer dependencies found");
    expect(output).not.toContain("unmet peer");
  }, 300_000);

  it("TP-0.20 (c): pnpm install --frozen-lockfile in a fresh clone exits 0", () => {
    const { status, output } = installInCleanClone(["--frozen-lockfile"]);

    expect(status, output).toBe(0);
  }, 300_000);
});
