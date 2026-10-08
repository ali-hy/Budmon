// F-349 listProcedures. Extra cases TP-4.25x (F-349 has no LLD test case of its own; TP-4.8 uses
// it). IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { base, contract, createRoute } from "../src/index.js";
import { listProcedures } from "../src/rules/listProcedures.js";

describe("TP-4.25x: listProcedures", () => {
  it("TP-4.25x: the platform contract has meta.clientConfig, GET /meta/client-config", () => {
    expect(listProcedures(contract)).toEqual([
      { path: "meta.clientConfig", method: "GET", route: "/meta/client-config" },
    ]);
  });

  it("TP-4.25x: nested routers give dotted paths", () => {
    const c = {
      a: {
        b: {
          get: base.route({ method: "GET", path: "/a/b" }).output(z.object({ ok: z.boolean() })),
        },
        make: createRoute("/a"),
      },
    };

    expect(listProcedures(c).sort((l, r) => l.path.localeCompare(r.path))).toEqual([
      { path: "a.b.get", method: "GET", route: "/a/b" },
      { path: "a.make", method: "POST", route: "/a" },
    ]);
  });
});
