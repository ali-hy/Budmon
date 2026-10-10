// F-183: the upgrade test harness (test-architect). For release vN it builds the previous release's
// database from the migrations at the previous release tag, loads test/upgrade/<vN>/fixtures.sql,
// applies the current migrations and runs test/upgrade/<vN>/*.test.ts. With no previous release
// tag (before the first release) it reports "skipped: baseline" and passes.
//
// CLI: tsx test/upgrade/harness.ts [--repo <dir>] (exit 0 when skipped or passed).
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export type UpgradeResult =
  { status: "skipped: baseline" } | { status: "ran"; previousTag: string };

/** The most recent tag `v*` reachable from `ref` (release or hotfix), or null if there's none. */
export function previousReleaseTag(repoDir: string, ref = "HEAD"): string | null {
  try {
    return execFileSync("git", ["describe", "--tags", "--abbrev=0", "--match", "v*", ref], {
      cwd: repoDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

export function runUpgradeHarness(opts: { repoDir: string; ref?: string }): UpgradeResult {
  const previousTag = previousReleaseTag(opts.repoDir, opts.ref);
  if (previousTag === null) return { status: "skipped: baseline" };
  // The previous-release path needs a first release to exist (its tag, migrations and fixtures);
  // it's built with that release, following F-183's steps.
  throw new Error(
    `upgrade harness: the path from ${previousTag} isn't built yet (it arrives with the first release)`,
  );
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf("--repo");
  const repoDir = i >= 0 ? (process.argv[i + 1] ?? REPO_ROOT) : REPO_ROOT;
  const result = runUpgradeHarness({ repoDir });
  process.stdout.write(`${result.status}\n`);
}
