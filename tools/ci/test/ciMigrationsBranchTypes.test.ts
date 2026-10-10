// ci.yml's branch-type wiring (D-12, §10.1 CI jobs, S-14). TP-14.8: for each kind of pull request,
// which migration steps run, decided by evaluating each step's `if:` (support/ghExpression.ts).
//   - every PR: F-6;
//   - feature PRs: the non-blocking pending-schema report (F-181);
//   - release/* and hotfix/* PRs: check (i) (F-182), (iii) the risky-statement check (F-184), (iv)
//     the upgrade harness (F-183, `test:upgrade`), and the check job's integration tests on a
//     template built from migrations (BUDMON_SCHEMA_MODE=migrate, check (ii));
//   - PRs labelled hotfix-merge-back or infra-merge-back: F-6b with --kind (A-364, A-366).
// Plus A-366/A-367's exact conditions, permissions, the job-summary report and actionlint 1.7.12
// through tools/ci/setup-actionlint.sh.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { evaluate, evaluateValue, pullRequestContext } from "./support/ghExpression.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

interface Step {
  name?: string;
  if?: unknown;
  run?: unknown;
  env?: Record<string, unknown>;
  "continue-on-error"?: unknown;
}
interface Job {
  if?: unknown;
  env?: Record<string, unknown>;
  permissions?: unknown;
  steps?: Step[];
}

function jobs(): Record<string, Job> {
  const wf = parse(readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8")) as {
    jobs?: Record<string, Job>;
  };
  return wf.jobs ?? {};
}

const KINDS = {
  "F-6": /checkMigrationFiles\.ts/,
  "pending report": /db:pending-report/,
  "check (i)": /db:check-migrations/,
  "check (iii)": /db:check-risky/,
  "check (iv)": /test:upgrade/,
  "merge-back": /checkMergeBack\.ts/,
} as const;
type Kind = keyof typeof KINDS;

const runs = (cond: unknown, ctx: ReturnType<typeof pullRequestContext>) =>
  typeof cond !== "string" || evaluate(cond, ctx);

/** The migration steps the migrations job runs for this pull request. */
function stepsRun(ctx: ReturnType<typeof pullRequestContext>): Kind[] {
  const job = jobs()["migrations"];
  if (job === undefined) throw new Error("ci.yml has no migrations job");
  if (!runs(job.if, ctx)) return [];
  const out = new Set<Kind>();
  for (const step of job.steps ?? []) {
    const text = typeof step.run === "string" ? step.run : "";
    for (const [kind, pattern] of Object.entries(KINDS) as [Kind, RegExp][]) {
      if (pattern.test(text) && runs(step.if, ctx)) out.add(kind);
    }
  }
  return [...out].sort();
}

const sorted = (k: Kind[]) => [...k].sort();

describe("TP-14.8: migrations job steps per branch type (D-12, §10.1)", () => {
  it.each([["feat/budgets"], ["fix/typo"], ["module/accounts"]])(
    "TP-14.8: a feature PR (%s) runs F-6 and the pending report only",
    (headRef) => {
      expect(stepsRun(pullRequestContext({ headRef }))).toEqual(sorted(["F-6", "pending report"]));
    },
  );

  it.each([["release/v1.3.0"], ["hotfix/v1.2.0-hotfix.1"]])(
    "TP-14.8: %s runs F-6 and checks (i), (iii) and (iv), without the pending report",
    (headRef) => {
      expect(stepsRun(pullRequestContext({ headRef }))).toEqual(
        sorted(["F-6", "check (i)", "check (iii)", "check (iv)"]),
      );
    },
  );

  it("TP-14.8: a hotfix PR labelled hotfix-merge-back also runs the merge-back check (F-6b)", () => {
    const ran = stepsRun(
      pullRequestContext({ headRef: "hotfix/v1.2.0-hotfix.1", labels: ["hotfix-merge-back"] }),
    );

    expect(ran).toContain("merge-back");
    expect(ran).toContain("F-6");
  });

  it("TP-14.8: no other PR runs the merge-back check", () => {
    for (const headRef of ["feat/x", "release/v1.3.0", "hotfix/v1.2.0-hotfix.1"]) {
      expect(stepsRun(pullRequestContext({ headRef }))).not.toContain("merge-back");
    }
  });

  it("TP-14.8: check (ii): the check job builds its integration template from migrations on release/* and hotfix/* only", () => {
    const check = jobs()["check"];
    const raw = check?.env?.["BUDMON_SCHEMA_MODE"];
    expect(typeof raw).toBe("string");
    const mode = (headRef: string) => {
      const expr = String(raw);
      return expr.includes("${{") ? evaluateValue(expr, pullRequestContext({ headRef })) : expr;
    };

    expect(mode("release/v1.3.0")).toBe("migrate");
    expect(mode("hotfix/v1.2.0-hotfix.1")).toBe("migrate");
    expect(mode("feat/x")).not.toBe("migrate");
  });
});

// The evaluator itself (test tooling), on the expression forms the cases above rely on.
describe("TP-14.11x: the if: evaluator (support/ghExpression.ts)", () => {
  const ctx = pullRequestContext({ headRef: "release/v1.3.0", labels: ["hotfix-merge-back"] });

  it.each([
    ["startsWith(github.head_ref, 'release/')", true],
    ["${{ startsWith(github.head_ref, 'hotfix/') }}", false],
    ["!startsWith(github.head_ref, 'release/') && !startsWith(github.head_ref, 'hotfix/')", false],
    ["contains(github.event.pull_request.labels.*.name, 'hotfix-merge-back')", true],
    ["contains(github.event.pull_request.labels.*.name, 'infra-merge-back')", false],
    ["github.event_name == 'pull_request'", true],
    ["(startsWith(github.head_ref, 'x') || github.base_ref == 'MAIN')", true],
    ["always()", true],
  ])("TP-14.11x: %s is %s", (expr, expected) => {
    expect(evaluate(expr, ctx)).toBe(expected);
  });

  it("TP-14.11x: an a && 'x' || 'y' value", () => {
    const expr =
      "${{ (startsWith(github.head_ref, 'release/') || startsWith(github.head_ref, 'hotfix/')) && 'migrate' || 'push' }}";

    expect(evaluateValue(expr, ctx)).toBe("migrate");
    expect(evaluateValue(expr, pullRequestContext({ headRef: "feat/x" }))).toBe("push");
  });

  it("TP-14.11x: an unsupported function throws", () => {
    expect(() => evaluate("hashFiles('x')", ctx)).toThrow(/unsupported function/);
  });
});

// A-366, A-367: the exact wiring of the migrations job.
describe("TP-14.8 (A-366, A-367): the migrations job's exact wiring", () => {
  const RC = "startsWith(github.head_ref, 'release/') || startsWith(github.head_ref, 'hotfix/')";
  const steps = () => jobs()["migrations"]?.steps ?? [];
  const stepRunning = (pattern: RegExp) =>
    steps().filter((s) => typeof s.run === "string" && pattern.test(s.run));
  const ifOf = (s: Step | undefined) =>
    typeof s?.if === "string"
      ? s.if.trim().replace(/^\$\{\{\s*([\s\S]*?)\s*\}\}$/, "$1")
      : undefined;

  it("TP-14.8: actionlint 1.7.12 (tools/ci/setup-actionlint.sh) passes on ci.yml", () => {
    const setup = spawnSync("bash", [path.join(ROOT, "tools/ci/setup-actionlint.sh")], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(setup.status, `${setup.stdout}${setup.stderr}`).toBe(0);

    const lint = spawnSync(
      path.join(ROOT, ".tools/actionlint/actionlint"),
      ["-shellcheck=", "-pyflakes=", ".github/workflows/ci.yml"],
      { cwd: ROOT, encoding: "utf8" },
    );
    expect(lint.status, `${lint.stdout}${lint.stderr}`).toBe(0);
  }, 120_000);

  it("TP-14.8: the job keeps permissions contents: read only", () => {
    expect(jobs()["migrations"]?.permissions).toEqual({ contents: "read" });
  });

  it("TP-14.8: the F-6 step has no if", () => {
    const f6 = stepRunning(KINDS["F-6"]);
    expect(f6).toHaveLength(1);
    expect(f6[0]?.if).toBeUndefined();
  });

  it.each([["check (i)"], ["check (iii)"], ["check (iv)"]] as const)(
    "TP-14.8: the %s step's if is exactly the release-candidate condition",
    (kind) => {
      const found = stepRunning(KINDS[kind]);
      expect(found).toHaveLength(1);
      expect(ifOf(found[0])).toBe(RC);
    },
  );

  it("TP-14.8: the pending-report step negates the condition, continues on error and writes to $GITHUB_STEP_SUMMARY", () => {
    const found = stepRunning(KINDS["pending report"]);
    expect(found).toHaveLength(1);
    const step = found[0];
    expect(ifOf(step)).toMatch(
      /^!\s*\(\s*startsWith\(github\.head_ref, 'release\/'\) \|\| startsWith\(github\.head_ref, 'hotfix\/'\)\s*\)$/,
    );
    expect(step?.["continue-on-error"]).toBe(true);
    expect(String(step?.run)).toContain("$GITHUB_STEP_SUMMARY");
  });

  it("TP-14.8: the F-6b step checks both labels and passes --kind", () => {
    const found = stepRunning(KINDS["merge-back"]);
    expect(found).toHaveLength(1);
    const cond = ifOf(found[0]) ?? "";
    expect(cond).toContain(
      "contains(github.event.pull_request.labels.*.name, 'hotfix-merge-back')",
    );
    expect(cond).toContain("contains(github.event.pull_request.labels.*.name, 'infra-merge-back')");
    expect(String(found[0]?.run)).toMatch(/--kind/);
  });

  it("TP-14.8 (A-17): no step's run contains ${{", () => {
    for (const s of steps()) {
      if (typeof s.run === "string") expect(s.run, s.name ?? s.run).not.toContain("${{");
    }
  });

  it("TP-14.8 (A-366): a hotfix PR labelled hotfix-merge-back runs the release-candidate checks and F-6b", () => {
    const ran = stepsRun(
      pullRequestContext({ headRef: "hotfix/v1.2.0-hotfix.1", labels: ["hotfix-merge-back"] }),
    );

    expect(ran).toEqual(
      expect.arrayContaining(["check (i)", "check (iii)", "check (iv)", "merge-back"]),
    );
  });

  it("TP-14.8: a feature PR labelled infra-merge-back runs F-6b too", () => {
    expect(
      stepsRun(pullRequestContext({ headRef: "infra/x", labels: ["infra-merge-back"] })),
    ).toContain("merge-back");
  });
});
