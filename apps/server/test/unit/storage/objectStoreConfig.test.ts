// F-10's object-store settings: OBJECT_STORE_KIND required (A-307, TP-10.11) and the dev objects
// key never read outside development and test (A-303, review B-6, extra cases TP-10.11x). IDs
// ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../../src/platform/config/loadConfig.js";
import { parseConfig, type ProcessKind } from "../../../src/platform/config/schema.js";
import {
  devApi,
  devWorker,
  prodApi,
  readFileFrom,
  withFile,
  type Fixture,
} from "../../support/configEnv.js";

function problemsOf(kind: ProcessKind, f: Fixture) {
  const files = Object.fromEntries(
    [...f.files].map(([p, content]) => [
      p,
      content.endsWith("\n") ? content.slice(0, -1) : content,
    ]),
  );
  const result = parseConfig(kind, { env: f.env, files });
  return result.ok ? [] : result.problems;
}

function withoutObjectStore(f: Fixture): Fixture {
  delete f.env["OBJECT_STORE_KIND"];
  delete f.env["OBJECT_STORE_FS_ROOT"];
  return f;
}

describe("TP-10.11: OBJECT_STORE_KIND is required for the api and a general worker (F-10, A-307)", () => {
  it("TP-10.11: an api without OBJECT_STORE_KIND has one problem, OBJECT_STORE_KIND required", () => {
    expect(problemsOf("api", withoutObjectStore(devApi()))).toEqual([
      { variable: "OBJECT_STORE_KIND", rule: "required" },
    ]);
  });

  it("TP-10.11: a worker with WORKER_ROLES=general without OBJECT_STORE_KIND has one problem, OBJECT_STORE_KIND required", () => {
    const f = withoutObjectStore(devWorker());
    f.env["WORKER_ROLES"] = "general";

    expect(problemsOf("worker", f)).toEqual([{ variable: "OBJECT_STORE_KIND", rule: "required" }]);
  });

  it("TP-10.11: a capture-only worker without OBJECT_STORE_KIND has no problem", () => {
    const f = withoutObjectStore(devWorker());
    f.env["WORKER_ROLES"] = "capture";
    // A-299: a capture-only worker connects as budmon_capture.
    f.env["DB_USER"] = "budmon_capture";

    expect(problemsOf("worker", f)).toEqual([]);
  });
});

describe("TP-10.11x (B-6): DEV_OBJECTS_SIGNING_KEY_FILE outside development and test (A-303)", () => {
  it.each([["rehearsal"], ["production"]] as const)(
    "TP-10.11x (B-6): an api in %s never reads DEV_OBJECTS_SIGNING_KEY_FILE and has no devObjectsKey",
    (appEnv) => {
      const f = prodApi(appEnv);
      withFile(f, "DEV_OBJECTS_SIGNING_KEY_FILE", Buffer.alloc(32, 7).toString("base64"));
      const read: string[] = [];
      const inner = readFileFrom(f.files);

      const config = loadConfig("api", f.env, (file: string) => {
        read.push(file);
        return inner(file);
      });

      expect(read).not.toContain(f.env["DEV_OBJECTS_SIGNING_KEY_FILE"]);
      expect(config.api?.devObjectsKey).toBeUndefined();
    },
  );
});
