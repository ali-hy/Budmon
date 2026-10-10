// ci.yml's branch-type wiring (D-12, §10.1 CI jobs, S-14). TP-14.8: for each kind of pull request,
// which migration steps run, decided by evaluating each step's `if:` (support/ghExpression.ts).
//   - every PR: F-6;
//   - feature PRs: the non-blocking pending-schema report (F-181);
//   - release/* and hotfix/* PRs: check (i) (F-182), (iii) the upgrade harness (F-183), (iv) the
//     risky-statement check (F-184), and the check job's integration tests on a template built from
//     migrations (BUDMON_SCHEMA_MODE=migrate, check (ii));
//   - PRs labelled hotfix-merge-back: F-6b.
// actionlint (the row's other half) isn't installed here; it arrives with S-15's infra-lint job.
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
}
interface Job {
  if?: unknown;
  env?: Record<string, unknown>;
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
  "check (iii)": /test\/upgrade\/harness\.ts/,
  "check (iv)": /db:check-risky/,
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
