// TP-2.26: ci.yml's check job runs the integration tests after the unit tests (A-31), plus the extra
// case TP-2.60x: the main-only dev-smoke job runs TP-2.18's script (§10.1 CI jobs, A-55). TP-0.26:
// Testcontainers pulls Docker Hub images through mirror.gcr.io in CI (A-284). TP-0.29: the catalog
// check runs in CI through pnpm lint (A-316).
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
