// F-6's CLI (A-7): `parseCheckMigrationFilesArgs`, `parseChangedFiles`,
// `runCheckMigrationFilesCli` and the entry guard. TP-0.17, plus the extra case TP-0.20x
// (test-architect addition, not an LLD ID).
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseChangedFiles,
  parseCheckMigrationFilesArgs,
  runCheckMigrationFilesCli,
} from "../checkMigrationFiles.js";

const USAGE =
  "Usage: checkMigrationFiles.ts --branch <head ref> --changed-files <file> [--hotfix-merge-back]";
const MIGRATION_MESSAGE =
  "Migration files may only change on release/* and hotfix/* branches (D-12): apps/server/drizzle/0001.sql";

const FILES: Readonly<Record<string, string>> = {
  "/c.txt": "apps/server/drizzle/0001.sql\nREADME.md\n",
  "/empty.txt": "",
};

interface CliRun {
  code: number;
  stdout: string[];
  stderr: string[];
  readFileCalls: string[];
}

function runCli(argv: readonly string[]): CliRun {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const readFileCalls: string[] = [];
  const code = runCheckMigrationFilesCli(argv, {
    readFile: (p) => {
      readFileCalls.push(p);
      const text = FILES[p];
      if (text === undefined) throw new Error("ENOENT");
      return text;
    },
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
  });
  return { code, stdout, stderr, readFileCalls };
}

describe("TP-0.17: F-6 CLI", () => {
  it("TP-0.17 (a): a migration file on a feature branch exits 1 with F-6's message on stderr", () => {
    const run = runCli(["--branch", "feat/x", "--changed-files", "/c.txt"]);

    expect(run.code).toBe(1);
    expect(run.stderr).toEqual([MIGRATION_MESSAGE]);
    expect(run.stdout).toEqual([]);
    expect(run.readFileCalls).toEqual(["/c.txt"]);
  });

  it.each([
    [["--hotfix-merge-back", "--branch", "feat/x", "--changed-files", "/c.txt"]],
    [["--branch", "feat/x", "--hotfix-merge-back", "--changed-files", "/c.txt"]],
    [["--branch", "feat/x", "--changed-files", "/c.txt", "--hotfix-merge-back"]],
  ])("TP-0.17 (b): --hotfix-merge-back in any position exits 0 (%j)", (argv) => {
    const run = runCli(argv);

    expect(run.code).toBe(0);
    expect(run.stdout).toEqual(["checkMigrationFiles: ok (2 changed files)"]);
    expect(run.stderr).toEqual([]);
  });

  it("TP-0.17 (c): a release branch exits 0", () => {
    const run = runCli(["--branch", "release/v1.0.0", "--changed-files", "/c.txt"]);

    expect(run.code).toBe(0);
    expect(run.stdout).toEqual(["checkMigrationFiles: ok (2 changed files)"]);
    expect(run.stderr).toEqual([]);
  });

  it("TP-0.17 (d): an empty changed-files file exits 0 with 0 changed files", () => {
    const run = runCli(["--branch", "feat/x", "--changed-files", "/empty.txt"]);

    expect(run.code).toBe(0);
    expect(run.stdout).toEqual(["checkMigrationFiles: ok (0 changed files)"]);
    expect(run.stderr).toEqual([]);
  });

  it.each([
    ["(e) no arguments", [], "Missing required argument: --branch"],
    ["(f) no --branch", ["--changed-files", "/c.txt"], "Missing required argument: --branch"],
    ["(g) --branch alone", ["--branch"], "Missing value for --branch"],
    [
      "(h) empty --branch",
      ["--branch", "", "--changed-files", "/c.txt"],
      "Missing value for --branch",
    ],
    [
      "(i) --branch followed by a flag",
      ["--branch", "--changed-files", "/c.txt"],
      "Missing value for --branch",
    ],
    [
      "(j) --branch twice",
      ["--branch", "a", "--branch", "b", "--changed-files", "/c.txt"],
      "Duplicate argument: --branch",
    ],
    [
      "(k) --branch=value form",
      ["--branch=feat/x", "--changed-files", "/c.txt"],
      "Unknown argument: --branch=feat/x",
    ],
    [
      "(l) a positional word",
      ["--branch", "feat/x", "extra", "--changed-files", "/c.txt"],
      "Unknown argument: extra",
    ],
  ])("TP-0.17 %s exits 64 with the message and the usage line", (_label, argv, message) => {
    const run = runCli(argv);

    expect(run.code).toBe(64);
    expect(run.stderr).toEqual([`checkMigrationFiles: ${message}`, USAGE]);
    expect(run.stdout).toEqual([]);
    expect(run.readFileCalls).toEqual([]);
  });

  it("TP-0.17 (m): an unreadable changed-files file exits 64 with the read error", () => {
    const run = runCli(["--branch", "feat/x", "--changed-files", "/missing.txt"]);

    expect(run.code).toBe(64);
    expect(run.stderr).toEqual(["checkMigrationFiles: cannot read /missing.txt: ENOENT"]);
    expect(run.stdout).toEqual([]);
  });

  it("TP-0.17 (n): parseChangedFiles splits on LF and CRLF and drops empty lines", () => {
    expect(parseChangedFiles("a\r\nb\n\nc")).toEqual(["a", "b", "c"]);
  });

  it("TP-0.17: parseChangedFiles of an empty string is []", () => {
    expect(parseChangedFiles("")).toEqual([]);
  });

  it("TP-0.17: parseChangedFiles keeps order, duplicates and surrounding spaces", () => {
    expect(parseChangedFiles("b\na\nb\n a \n")).toEqual(["b", "a", "b", " a "]);
  });

  it("TP-0.17: parseCheckMigrationFilesArgs returns the parsed values", () => {
    expect(
      parseCheckMigrationFilesArgs(["--changed-files", "/c.txt", "--branch", "feat/x"]),
    ).toEqual({ ok: true, branch: "feat/x", changedFilesPath: "/c.txt", isHotfixMergeBack: false });
    expect(
      parseCheckMigrationFilesArgs([
        "--branch",
        "feat/x",
        "--changed-files",
        "/c.txt",
        "--hotfix-merge-back",
      ]),
    ).toEqual({ ok: true, branch: "feat/x", changedFilesPath: "/c.txt", isHotfixMergeBack: true });
  });

  it.each([
    [["--branch", "feat/x"], "Missing required argument: --changed-files"],
    [["--branch", "feat/x", "--changed-files"], "Missing value for --changed-files"],
    [
      [
        "--branch",
        "feat/x",
        "--changed-files",
        "/c.txt",
        "--hotfix-merge-back",
        "--hotfix-merge-back",
      ],
      "Duplicate argument: --hotfix-merge-back",
    ],
    [["extra", "--branch"], "Unknown argument: extra"],
  ])("TP-0.17: parseCheckMigrationFilesArgs(%j) reports the first problem", (argv, message) => {
    expect(parseCheckMigrationFilesArgs(argv)).toEqual({ ok: false, message });
  });

  describe("TP-0.17: entry guard", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("TP-0.17: importing the module runs no CLI (no output, process.exitCode unchanged)", async () => {
      const exitCodeBefore = process.exitCode;
      const stdoutWrite = vi.spyOn(process.stdout, "write");
      const stderrWrite = vi.spyOn(process.stderr, "write");
      vi.resetModules();

      await import("../checkMigrationFiles.js");

      expect(stdoutWrite).not.toHaveBeenCalled();
      expect(stderrWrite).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(exitCodeBefore);
    });
  });
});

// TP-0.20x (test-architect addition, not an LLD ID): the documented invocation,
// `tsx checkMigrationFiles.ts …` from `tools/ci/`, runs the CLI through the entry guard and
// reports through the real exit code and streams.
describe("TP-0.20x: the CLI run as a process", () => {
  const TOOLS_CI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  let dir = "";

  afterEach(async () => {
    if (dir !== "") await rm(dir, { recursive: true, force: true });
    dir = "";
  });

  function runTsx(args: readonly string[]): {
    status: number | null;
    stdout: string;
    stderr: string;
  } {
    const tsxCli = createRequire(path.join(TOOLS_CI, "package.json")).resolve("tsx/cli");
    const result = spawnSync(process.execPath, [tsxCli, "checkMigrationFiles.ts", ...args], {
      cwd: TOOLS_CI,
      encoding: "utf8",
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  it("TP-0.20x: a migration file on a feature branch exits 1 and prints F-6's message", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "budmon-cmf-"));
    const changed = path.join(dir, "changed-files.txt");
    await writeFile(changed, "apps/server/drizzle/0001.sql\nREADME.md\n");

    const result = runTsx(["--branch", "feat/x", "--changed-files", changed]);

    expect(result.status).toBe(1);
    expect(result.stderr).toBe(`${MIGRATION_MESSAGE}\n`);
    expect(result.stdout).toBe("");
  });

  it("TP-0.20x: a release branch exits 0 and prints the ok line", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "budmon-cmf-"));
    const changed = path.join(dir, "changed-files.txt");
    await writeFile(changed, "apps/server/drizzle/0001.sql\nREADME.md\n");

    const result = runTsx(["--branch", "release/v1.0.0", "--changed-files", changed]);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("checkMigrationFiles: ok (2 changed files)\n");
  });

  it("TP-0.20x: no arguments exits 64 with the usage line", () => {
    const result = runTsx([]);

    expect(result.status).toBe(64);
    expect(result.stderr).toBe(
      `checkMigrationFiles: Missing required argument: --branch\n${USAGE}\n`,
    );
  });
});
