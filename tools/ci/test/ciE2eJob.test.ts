// ci.yml's e2e job (§10.1 CI jobs, D-27 step 5, S-11b): Playwright on every PR (extra case TP-11.33x),
// with the axe report uploaded as an artifact (AC-11.2, D-39). IDs ending in "x" are test-architect
// additions, not LLD test-plan IDs.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

interface Step {
  uses?: unknown;
  run?: unknown;
  if?: unknown;
  with?: Record<string, unknown>;
}
interface Job {
  if?: unknown;
  steps?: Step[];
}

const text = (v: unknown): string => (typeof v === "string" ? v : "");

function e2eJob(): Job | undefined {
  const workflow = parse(readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8")) as {
    jobs?: Record<string, Job>;
  };
  return workflow.jobs?.["e2e"];
}

describe("TP-11.33x: ci.yml e2e job (D-27 step 5)", () => {
  it("TP-11.33x: an e2e job runs pnpm test:e2e, with no condition that skips pull requests", () => {
    const job = e2eJob();
    const runs = (job?.steps ?? [])
      .map((s) => s.run)
      .filter((r): r is string => typeof r === "string")
      .flatMap((r) => r.split("\n").map((line) => line.trim()));

    expect(job).toBeDefined();
    expect(runs.some((line) => line.startsWith("pnpm test:e2e"))).toBe(true);
    expect(text(job?.if)).not.toMatch(/push|main/);
  });

  it("AC-11.2: the axe report is uploaded as a CI artifact (actions/upload-artifact, even when tests fail)", () => {
    const uploads = (e2eJob()?.steps ?? []).filter(
      (s) => typeof s.uses === "string" && s.uses.startsWith("actions/upload-artifact@"),
    );

    expect(uploads.length).toBeGreaterThan(0);
    const upload = uploads[0];
    expect(text(upload?.if)).toMatch(/always\(\)|!cancelled\(\)/);
    expect(text(upload?.with?.["path"])).toMatch(/playwright-report|test-results/);
  });
});
