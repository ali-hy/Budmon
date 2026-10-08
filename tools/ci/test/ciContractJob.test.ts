// TP-4.1's CI part (S-4, CI step 2): the `contract` job runs on every pull request and fails on a
// stale openapi.json with `pnpm contract:openapi && git diff --exit-code`. The drift itself is
// tested in packages/contract/test/emitOpenapi.test.ts.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

interface Workflow {
  on?: Record<string, unknown> | string[] | string;
  jobs?: Record<string, { steps?: { run?: unknown }[] }>;
}

function ci(): Workflow {
  return parse(readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8")) as Workflow;
}

describe("TP-4.1: the CI contract job", () => {
  it("TP-4.1: ci.yml runs on pull requests and has a contract job", () => {
    const workflow = ci();
    const triggers =
      typeof workflow.on === "string" ? [workflow.on] : Object.keys(workflow.on ?? {});

    expect(triggers).toContain("pull_request");
    expect(Object.keys(workflow.jobs ?? {})).toContain("contract");
  });

  it("TP-4.1: the contract job regenerates openapi.json and then runs git diff --exit-code", () => {
    const runs = (ci().jobs?.["contract"]?.steps ?? [])
      .map((s) => (typeof s.run === "string" ? s.run : ""))
      .join("\n");

    const generate = runs.indexOf("pnpm contract:openapi");
    const diff = runs.indexOf("git diff --exit-code");
    expect(generate).toBeGreaterThanOrEqual(0);
    expect(diff).toBeGreaterThan(generate);
  });
});
