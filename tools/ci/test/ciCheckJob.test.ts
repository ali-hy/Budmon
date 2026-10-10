// TP-2.26: ci.yml's check job runs the integration tests after the unit tests (A-31), plus the extra
// case TP-2.60x: the main-only dev-smoke job runs TP-2.18's script (§10.1 CI jobs, A-55). TP-0.26:
// Testcontainers pulls Docker Hub images through mirror.gcr.io in CI (A-284). TP-0.29: the catalog
// check runs in CI through pnpm lint (A-316). TP-0.31: the e2e job (A-334), which also covers
// AC-11.2 (the axe report uploaded as an artifact).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("TP-2.26: ci.yml check job", () => {
  it("TP-2.26: one run executes pnpm test and then pnpm test:int", () => {
    const workflow = parse(readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8")) as {
      jobs?: { check?: { steps?: { run?: unknown }[] } };
    };
    const runs = (workflow.jobs?.check?.steps ?? [])
      .map((step) => step.run)
      .filter((run): run is string => typeof run === "string")
      .map((run) => run.split("\n").map((line) => line.trim()));

    const matching = runs.filter((lines) => {
      const test = lines.indexOf("pnpm test");
      const testInt = lines.indexOf("pnpm test:int");
      return test >= 0 && testInt > test;
    });

    expect(matching).toHaveLength(1);
  });
});

describe("TP-2.60x: ci.yml dev-smoke job", () => {
  it("TP-2.60x: a dev-smoke job runs tools/ci/test/dev-smoke.sh, only on main", () => {
    const workflow = parse(readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8")) as {
      jobs?: Record<string, { if?: unknown; steps?: { run?: unknown }[] }>;
    };
    const job = workflow.jobs?.["dev-smoke"];
    const runs = (job?.steps ?? [])
      .map((step) => step.run)
      .filter((run) => typeof run === "string");

    expect(runs.some((run) => run.includes("tools/ci/test/dev-smoke.sh"))).toBe(true);
    expect(String(job?.if)).toContain("main");
  });
});

describe("TP-0.26: ci.yml pulls Docker Hub images through mirror.gcr.io (A-284)", () => {
  const VARIABLE = "TESTCONTAINERS_HUB_IMAGE_NAME_PREFIX";

  interface Step {
    name?: unknown;
    uses?: unknown;
    run?: unknown;
    env?: Record<string, unknown>;
  }
  interface Job {
    env?: Record<string, unknown>;
    steps?: Step[];
  }

  function workflow(): { env?: Record<string, unknown>; jobs?: Record<string, Job> } {
    return parse(readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8")) as {
      env?: Record<string, unknown>;
      jobs?: Record<string, Job>;
    };
  }

  it("TP-0.26: the top-level env sets TESTCONTAINERS_HUB_IMAGE_NAME_PREFIX to exactly mirror.gcr.io/", () => {
    expect(workflow().env?.[VARIABLE]).toBe("mirror.gcr.io/");
  });

  it("TP-0.26: no job or step env overrides it, and no step's run unsets or rewrites it", () => {
    const offenders: string[] = [];
    for (const [jobName, job] of Object.entries(workflow().jobs ?? {})) {
      if (job.env !== undefined && VARIABLE in job.env) offenders.push(`${jobName}.env`);
      for (const [i, step] of (job.steps ?? []).entries()) {
        const where = `${jobName}.steps[${String(i)}]`;
        if (step.env !== undefined && VARIABLE in step.env) offenders.push(`${where}.env`);
        if (typeof step.run === "string" && step.run.includes(VARIABLE)) {
          offenders.push(`${where}.run`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("TP-0.26: the check job has no docker login step and no secrets. reference", () => {
    const check = workflow().jobs?.["check"];
    expect(check).toBeDefined();
    const steps = check?.steps ?? [];

    const logins = steps.filter(
      (step) =>
        (typeof step.run === "string" && /docker\s+login/.test(step.run)) ||
        (typeof step.uses === "string" && step.uses.includes("login-action")),
    );

    expect(logins).toEqual([]);
    expect(JSON.stringify(check)).not.toContain("secrets.");
  });
});

describe("TP-0.29: the catalog check runs in CI through pnpm lint (A-316)", () => {
  function scripts(relative: string): Record<string, unknown> {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, relative), "utf8")) as {
      scripts?: Record<string, unknown>;
    };
    return pkg.scripts ?? {};
  }

  it("TP-0.29: root lint is exactly eslint . && pnpm lint:css && pnpm lint:catalogs", () => {
    expect(scripts("package.json")["lint"]).toBe("eslint . && pnpm lint:css && pnpm lint:catalogs");
  });

  it("TP-0.29: root lint:catalogs delegates to @budmon/tools-ci, whose lint:catalogs is tsx checkCatalogs.ts", () => {
    expect(scripts("package.json")["lint:catalogs"]).toBe(
      "pnpm --filter @budmon/tools-ci lint:catalogs",
    );
    expect(scripts("tools/ci/package.json")["lint:catalogs"]).toBe("tsx checkCatalogs.ts");
  });

  it("TP-0.29: the check job runs pnpm lint", () => {
    const workflow = parse(readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8")) as {
      jobs?: { check?: { steps?: { run?: unknown }[] } };
    };
    const lines = (workflow.jobs?.check?.steps ?? [])
      .map((step) => step.run)
      .filter((run): run is string => typeof run === "string")
      .flatMap((run) => run.split("\n").map((line) => line.trim()));

    expect(lines).toContain("pnpm lint");
  });
});

describe("TP-0.31: ci.yml e2e job (A-334)", () => {
  interface Step {
    uses?: unknown;
    run?: unknown;
    if?: unknown;
    with?: Record<string, unknown>;
  }
  const workflow = () =>
    parse(readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8")) as {
      on?: Record<string, unknown>;
      jobs?: Record<string, { if?: unknown; steps?: Step[] }>;
    };
  const runLines = (steps: readonly Step[]) =>
    steps
      .map((s) => s.run)
      .filter((r): r is string => typeof r === "string")
      .flatMap((r) => r.split("\n").map((line) => line.trim()));

  it("TP-0.31: the e2e job runs on pull_request", () => {
    const wf = workflow();
    const job = wf.jobs?.["e2e"];

    expect(job).toBeDefined();
    expect(Object.keys(wf.on ?? {})).toContain("pull_request");
    expect(typeof job?.if === "string" ? job.if : "").not.toMatch(/push|refs\/heads\/main/);
  });

  it("TP-0.31: a step runs playwright install --with-deps chromium", () => {
    const lines = runLines(workflow().jobs?.["e2e"]?.steps ?? []);

    expect(lines.some((l) => /playwright install --with-deps chromium$/.test(l))).toBe(true);
  });

  it("TP-0.31: a step runs pnpm test:e2e with --project=chromium and --project=pseudo-rtl and no other --project", () => {
    const lines = runLines(workflow().jobs?.["e2e"]?.steps ?? []).filter((l) =>
      l.startsWith("pnpm test:e2e"),
    );

    expect(lines).toHaveLength(1);
    const projects = [...(lines[0] ?? "").matchAll(/--project[= ](\S+)/g)].map((m) => m[1]);
    expect(projects.sort()).toEqual(["chromium", "pseudo-rtl"]);
  });

  it("TP-0.31, AC-11.2: the last step uploads apps/web/playwright-report/ as playwright-report with a SHA-pinned actions/upload-artifact and if: always()", () => {
    const steps = workflow().jobs?.["e2e"]?.steps ?? [];
    const last = steps.at(-1);

    expect(typeof last?.uses === "string" ? last.uses : "").toMatch(
      /^actions\/upload-artifact@[0-9a-f]{40}$/,
    );
    expect(last?.if).toBe("always()");
    expect(last?.with?.["name"]).toBe("playwright-report");
    expect(last?.with?.["path"]).toBe("apps/web/playwright-report/");
  });
});

// TP-13.18x (test-architect addition): CI step 6 (D-27, §10.1 Android): the android job runs the
// JVM tests, lint and ktlint. Its path filter and release-candidate trigger wait for the planner.
describe("TP-13.18x: ci.yml android job (§10.1, S-13)", () => {
  it("TP-13.18x: an android job runs ./gradlew testDebugUnitTest lint ktlintCheck in apps/android", () => {
    const workflow = parse(readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8")) as {
      jobs?: Record<
        string,
        {
          defaults?: { run?: { "working-directory"?: unknown } };
          steps?: { run?: unknown; "working-directory"?: unknown }[];
        }
      >;
    };
    const job = workflow.jobs?.["android"];
    const steps = (job?.steps ?? []).filter(
      (s) => typeof s.run === "string" && s.run.includes("testDebugUnitTest"),
    );

    expect(job).toBeDefined();
    expect(steps).toHaveLength(1);
    const step = steps[0];
    expect(String(step?.run)).toMatch(/\.\/gradlew testDebugUnitTest lint ktlintCheck/);
    const dir = step?.["working-directory"] ?? job?.defaults?.run?.["working-directory"];
    expect(dir).toBe("apps/android");
  });
});
