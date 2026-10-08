// TP-2.26: ci.yml's check job runs the integration tests after the unit tests (A-31), plus the extra
// case TP-2.60x: the main-only dev-smoke job runs TP-2.18's script (§10.1 CI jobs, A-55).
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
