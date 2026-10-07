// TP-0.19: `ci.yml`'s `migrations` job feeds F-6 (A-7).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

interface Step {
  uses?: string;
  with?: Record<string, unknown>;
  env?: Record<string, unknown>;
  run?: string;
}

interface Job {
  if?: string;
  steps?: Step[];
}

interface Workflow {
  on?: { pull_request?: { types?: string[] } | null };
  jobs?: Record<string, Job>;
}

function workflow(): Workflow {
  return parse(readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8")) as Workflow;
}

function migrationsJob(): Job {
  const job = workflow().jobs?.["migrations"];
  if (job === undefined) throw new Error("ci.yml has no `migrations` job");
  return job;
}

function steps(): Step[] {
  return migrationsJob().steps ?? [];
}

function f6Step(): Step {
  const step = steps().find((s) => s.run?.includes("checkMigrationFiles.ts") === true);
  if (step === undefined) throw new Error("No step runs checkMigrationFiles.ts");
  return step;
}

describe("TP-0.19: ci.yml migrations job wiring", () => {
  it("TP-0.19: pull_request triggers include opened, synchronize, reopened, labeled and unlabeled", () => {
    expect(workflow().on?.pull_request?.types).toEqual(
      expect.arrayContaining(["opened", "synchronize", "reopened", "labeled", "unlabeled"]),
    );
  });

  it("TP-0.19: the job's if restricts it to pull_request events", () => {
    expect(migrationsJob().if?.replace(/\s+/g, " ")).toMatch(
      /github\.event_name == ['"]pull_request['"]/,
    );
  });

  it("TP-0.19: checkout uses fetch-depth 0", () => {
    const checkout = steps().find((s) => s.uses?.startsWith("actions/checkout@") === true);

    expect(checkout?.with?.["fetch-depth"]).toBe(0);
  });

  it("TP-0.19: a step lists changed files with a three-dot diff against origin/${BASE_REF}", () => {
    const diffStep = steps().find(
      (s) => s.run?.includes("git diff --no-renames --name-only") === true,
    );

    expect(diffStep?.run).toMatch(/origin\/\$\{BASE_REF\}\.\.\.HEAD/);
    expect(String(diffStep?.env?.["BASE_REF"]).replace(/\s+/g, "")).toBe("${{github.base_ref}}");
  });

  it("TP-0.19: the F-6 step gets HEAD_REF from github.head_ref through env", () => {
    expect(String(f6Step().env?.["HEAD_REF"]).replace(/\s+/g, "")).toBe("${{github.head_ref}}");
  });

  it("TP-0.19: the F-6 step's MERGE_BACK tests both merge-back labels", () => {
    const mergeBack = String(f6Step().env?.["MERGE_BACK"]);

    expect(mergeBack).toContain("hotfix-merge-back");
    expect(mergeBack).toContain("infra-merge-back");
  });

  it('TP-0.19: the F-6 step passes --branch "$HEAD_REF" and --changed-files', () => {
    const run = f6Step().run ?? "";

    expect(run).toContain('--branch "$HEAD_REF"');
    expect(run).toContain("--changed-files");
  });

  it("TP-0.19: no run in the job interpolates the head ref or pull request fields", () => {
    const runs = steps().map((s) => (s.run ?? "").replace(/\{\{\s+/g, "{{"));

    for (const run of runs) {
      expect(run).not.toContain("${{github.head_ref");
      expect(run).not.toContain("${{github.event.pull_request");
    }
  });
});
