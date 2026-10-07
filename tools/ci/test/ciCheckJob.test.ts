// TP-2.26: ci.yml's check job runs the integration tests after the unit tests (A-31).
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
