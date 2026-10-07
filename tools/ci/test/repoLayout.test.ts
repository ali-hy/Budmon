// S-0 repository checks: TP-0.1 (§2.1 removals), plus the extra cases TP-0.13x to TP-0.16x for
// the S-0 deliverables and acceptance criteria (§2.2, §9 S-0 AC-2 to AC-4).
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
}

/** Tracked files plus untracked files that aren't ignored: what a commit of this tree contains. */
function repositoryFiles(): string[] {
  return git("ls-files", "--cached", "--others", "--exclude-standard")
    .split("\n")
    .filter((line) => line !== "");
}

function readRootFile(relative: string): string {
  return readFileSync(path.join(ROOT, relative), "utf8");
}

function isIgnored(relative: string): boolean {
  const result = spawnSync("git", ["check-ignore", "--no-index", "-q", relative], { cwd: ROOT });
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`git check-ignore failed for ${relative}: ${String(result.stderr)}`);
  }
  return result.status === 0;
}

describe("TP-0.1: the §2.1 removals", () => {
  it("TP-0.1: nothing under server/ is in the repository", () => {
    expect(repositoryFiles().filter((file) => file.startsWith("server/"))).toEqual([]);
  });

  it.each([["compose.yaml"], ["code-bites.md"], [".prettierrc"]])(
    "TP-0.1: the root %s doesn't exist",
    (file) => {
      expect(existsSync(path.join(ROOT, file))).toBe(false);
    },
  );

  it("TP-0.1: git ls-files has no dist/ path", () => {
    expect(
      git("ls-files")
        .split("\n")
        .filter((file) => /(^|\/)dist\//.test(file)),
    ).toEqual([]);
  });

  it("TP-0.1: .zed/settings.json is kept", () => {
    expect(git("ls-files", ".zed/settings.json").trim()).toBe(".zed/settings.json");
  });
});

describe("TP-0.13x: root workspace files (§2.2)", () => {
  it("TP-0.13x: no vitest.workspace.* file exists (A-8)", () => {
    expect(repositoryFiles().filter((file) => /^vitest\.workspace\./.test(file))).toEqual([]);
  });

  interface RootPackageJson {
    private?: unknown;
    packageManager?: unknown;
    engines?: { node?: unknown };
    scripts?: Record<string, string>;
  }

  function rootPackageJson(): RootPackageJson {
    return JSON.parse(readRootFile("package.json")) as RootPackageJson;
  }

  function script(name: string): string {
    const value = rootPackageJson().scripts?.[name];
    if (value === undefined) throw new Error(`Root package.json has no "${name}" script`);
    return value;
  }

  it("TP-0.13x: package.json is a private workspace root with pnpm 10 pinned and Node 24", () => {
    const pkg = rootPackageJson();

    expect(pkg.private).toBe(true);
    expect(pkg.packageManager).toMatch(/^pnpm@10\.\d+\.\d+(\+sha\d+\.[0-9a-f]+)?$/);
    expect(pkg.engines?.node).toBe(">=24 <25");
  });

  it.each([["check"], ["test"], ["test:int"], ["lint"], ["format"], ["typecheck"]])(
    "TP-0.13x: package.json has a %s script",
    (name) => {
      expect(script(name).trim()).not.toBe("");
    },
  );

  it("TP-0.13x: `test` runs every Vitest project except server-int, and `test:int` only server-int", () => {
    const test = script("test");
    const testInt = script("test:int");

    expect(test).toMatch(/\bvitest run\b/);
    expect(test).toMatch(/--project[= ]['"]?!server-int\b/);
    expect(testInt).toMatch(/\bvitest run\b/);
    expect(testInt).toMatch(/--project[= ]['"]?server-int\b/);
  });

  it("TP-0.13x: `check` runs format, lint, typecheck, test and test:int", () => {
    const check = script("check");

    expect(check).toMatch(/format|prettier/);
    expect(check).toMatch(/\blint\b/);
    expect(check).toMatch(/\btypecheck\b/);
    expect(check).toMatch(/\btest(?!:)\b/);
    expect(check).toMatch(/\btest:int\b/);
  });

  it("TP-0.13x: pnpm-workspace.yaml lists exactly the §2.2 workspaces", () => {
    const lines = readRootFile("pnpm-workspace.yaml").split(/\r?\n/);
    const start = lines.findIndex((line) => /^packages:\s*$/.test(line));
    expect(start).toBeGreaterThanOrEqual(0);
    const packages: string[] = [];
    for (const line of lines.slice(start + 1)) {
      const item = /^\s+-\s+['"]?([^'"#]+?)['"]?\s*(#.*)?$/.exec(line);
      if (item?.[1] === undefined) break;
      packages.push(item[1]);
    }

    expect(packages.sort()).toEqual(
      ["apps/server", "apps/web", "infra/budmonctl", "packages/*", "tools/*"].sort(),
    );
  });

  it("TP-0.13x: .nvmrc is 24", () => {
    expect(readRootFile(".nvmrc").trim()).toBe("24");
  });

  it.each([
    ["apps/server/node_modules/x/index.js"],
    ["packages/shared/node_modules/x/index.js"],
    ["dist/index.js"],
    ["apps/server/dist/main/api.js"],
    ["build/x"],
    ["apps/android/app/build/outputs/x.apk"],
    [".data/objects/x"],
    [".env"],
    [".env.local"],
    ["apps/server/.env"],
    ["coverage/index.html"],
    ["playwright-report/index.html"],
    ["test-results/x.json"],
    ["apps/android/.gradle/x"],
    ["apps/android/local.properties"],
  ])("TP-0.13x: .gitignore ignores %s", (file) => {
    expect(isIgnored(file)).toBe(true);
  });

  it.each([[".env.example"], ["apps/server/.env.example"], ["README.md"]])(
    "TP-0.13x: .gitignore doesn't ignore %s",
    (file) => {
      expect(isIgnored(file)).toBe(false);
    },
  );
});

describe("TP-0.14x: README (S-0 AC-3)", () => {
  function headings(): string[] {
    return [...readRootFile("README.md").matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)].map(
      (match) => match[1] ?? "",
    );
  }

  it.each([["Layout"], ["Prerequisites"], ["Commands"], ["Environments"]])(
    "TP-0.14x: README has a %s section",
    (section) => {
      expect(
        headings().some((heading) => heading.toLowerCase().startsWith(section.toLowerCase())),
      ).toBe(true);
    },
  );

  it("TP-0.14x: README links to the platform HLD for the stage model", () => {
    expect(readRootFile("README.md")).toMatch(
      /\]\((\.\/)?docs\/design\/platform\/hld\.md(#[^)]*)?\)/,
    );
  });
});

describe("TP-0.15x: proposed CLAUDE.md conventions (S-0 AC-4, HLD D-34)", () => {
  const PROPOSAL = "docs/proposals/claude-md-conventions.md";

  it("TP-0.15x: the proposal file exists", () => {
    expect(existsSync(path.join(ROOT, PROPOSAL))).toBe(true);
  });

  it.each([
    ["the db:reset-only rule", /pnpm db:reset/],
    ["the release/* branch rule", /release\/\*/],
    ["the hotfix/* branch rule", /hotfix\/\*/],
    ["SolidJS", /SolidJS/],
    ["i18n", /i18n|internationali[sz]ation/i],
    ["RTL", /\bRTL\b|right-to-left/i],
    ["accessibility", /accessib/i],
  ])("TP-0.15x: the proposal covers %s", (_label, pattern) => {
    expect(readRootFile(PROPOSAL)).toMatch(pattern);
  });
});

describe("TP-0.16x: CI runs steps 1 to 3 on pull requests (S-0 AC-2, HLD D-27)", () => {
  const CI = ".github/workflows/ci.yml";

  function ci(): string {
    return readRootFile(CI);
  }

  it("TP-0.16x: ci.yml is triggered by pull requests", () => {
    const text = ci();

    expect(text).toMatch(/^(on|"on"|'on'):/m);
    expect(text).toMatch(/\bpull_request\b/);
  });

  it("TP-0.16x: ci.yml installs with pnpm", () => {
    expect(ci()).toMatch(/\bpnpm( run)? install\b|\bpnpm i\b/);
  });

  it("TP-0.16x: ci.yml runs format check, lint, type-check and unit tests (steps 1 and 3)", () => {
    const text = ci();
    const runsCheck = /\bpnpm( run)? check\b(?!:)/.test(text);
    const runsEach =
      /prettier\b[^\n]*--check|\bpnpm( run)? format:check\b/.test(text) &&
      /\bpnpm( run)? lint\b/.test(text) &&
      /\bpnpm( run)? typecheck\b/.test(text) &&
      /\bpnpm( run)? test\b(?!:)/.test(text);

    expect(runsCheck || runsEach).toBe(true);
  });

  it("TP-0.16x: ci.yml runs F-6's migration-file check (step 2)", () => {
    expect(ci()).toMatch(/checkMigrationFiles/);
  });
});
