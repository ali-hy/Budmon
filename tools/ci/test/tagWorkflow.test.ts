// Stage-0 tagging (§4.17 "Stage-0 tagging", D-12): .github/workflows/tag.yml's structure. TP-14.10
// (workflow part), with actionlint 1.7.12 through tools/ci/setup-actionlint.sh (A-367).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const FILE = path.join(ROOT, ".github/workflows/tag.yml");

interface Step {
  uses?: unknown;
  run?: unknown;
  with?: Record<string, unknown>;
}
interface Workflow {
  on?: {
    pull_request?: { types?: unknown; branches?: unknown };
    workflow_dispatch?: { inputs?: Record<string, unknown> };
  } & Record<string, unknown>;
  permissions?: unknown;
  jobs?: Record<string, { permissions?: unknown; steps?: Step[]; environment?: unknown }>;
}

function workflow(): Workflow {
  return parse(readFileSync(FILE, "utf8")) as Workflow;
}

describe("TP-14.10: tag.yml (stage 0)", () => {
  it("TP-14.10: the file exists", () => {
    expect(existsSync(FILE)).toBe(true);
  });

  it("TP-14.10: triggers are pull_request closed on main and workflow_dispatch with input pr, nothing else", () => {
    const on = workflow().on ?? {};

    expect(Object.keys(on).sort()).toEqual(["pull_request", "workflow_dispatch"]);
    expect(on.pull_request?.types).toEqual(["closed"]);
    expect(on.pull_request?.branches).toEqual(["main"]);
    expect(Object.keys(on.workflow_dispatch?.inputs ?? {})).toEqual(["pr"]);
  });

  it("TP-14.10: permissions are exactly contents: write, pull-requests: read, checks: read", () => {
    const wf = workflow();
    const expected = { contents: "write", "pull-requests": "read", checks: "read" };
    const jobPerms = Object.values(wf.jobs ?? {}).map((j) => j.permissions);

    // At the workflow level, or on its one job with the workflow granting nothing more.
    if (wf.permissions !== undefined) {
      expect(wf.permissions).toEqual(expected);
      for (const p of jobPerms) if (p !== undefined) expect(p).toEqual(expected);
    } else {
      expect(jobPerms).toEqual([expected]);
    }
  });

  it("TP-14.10: checkout uses fetch-depth 0, and the job runs tools/ci/tagRelease.sh", () => {
    const steps = Object.values(workflow().jobs ?? {}).flatMap((j) => j.steps ?? []);
    const checkout = steps.find(
      (s) => typeof s.uses === "string" && s.uses.startsWith("actions/checkout@"),
    );

    expect(checkout?.with?.["fetch-depth"]).toBe(0);
    expect(
      steps.some((s) => typeof s.run === "string" && s.run.includes("tools/ci/tagRelease.sh")),
    ).toBe(true);
  });

  it("TP-14.10: no signing or deploy job (one job, no environment, no signing tools)", () => {
    const wf = workflow();
    const text = readFileSync(FILE, "utf8");

    expect(Object.keys(wf.jobs ?? {})).toHaveLength(1);
    for (const job of Object.values(wf.jobs ?? {})) expect(job.environment).toBeUndefined();
    expect(text).not.toMatch(/cosign|sigstore|gpg|deploy|id-token/i);
  });

  it("TP-14.10: every uses: is pinned to a 40-hex SHA", () => {
    const steps = Object.values(workflow().jobs ?? {}).flatMap((j) => j.steps ?? []);

    for (const s of steps) {
      if (typeof s.uses === "string" && !s.uses.startsWith("./")) {
        expect(s.uses).toMatch(/@[0-9a-f]{40}$/);
      }
    }
  });
});

describe("TP-14.10 (A-367): actionlint on tag.yml", () => {
  it("TP-14.10: actionlint 1.7.12 (tools/ci/setup-actionlint.sh) passes on tag.yml", () => {
    const setup = spawnSync("bash", [path.join(ROOT, "tools/ci/setup-actionlint.sh")], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(setup.status, `${setup.stdout}${setup.stderr}`).toBe(0);

    const lint = spawnSync(
      path.join(ROOT, ".tools/actionlint/actionlint"),
      ["-shellcheck=", "-pyflakes=", ".github/workflows/tag.yml"],
      { cwd: ROOT, encoding: "utf8" },
    );
    expect(lint.status, `${lint.stdout}${lint.stderr}`).toBe(0);
  }, 120_000);
});
