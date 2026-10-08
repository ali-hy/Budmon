// F-348 checkContractRules. TP-4.5: one fixture document violating each of R1 to R6, and a clean
// one; plus extra cases TP-4.24x (the real contract's emitted document is clean). IDs ending in "x"
// are test-architect additions, not LLD test-plan IDs.
//
// The clean document is generated (F-347's configuration) from a small contract built with F-343's
// createRoute and F-344's list schemas, so it has exactly the shapes the rules expect; each
// violating document is a copy with one change. A location is a JSON pointer; the tests check that
// it points into the operation concerned (and, for schema rules, at the offending property).
import { z } from "zod";
import type { OpenAPIV3_1 } from "openapi-types";
import { describe, expect, it } from "vitest";
import { MoneyAmount, UuidSchema, base, createRoute, listInput, listOutput } from "../src/index.js";
import { checkContractRules } from "../src/rules/contractRules.js";
import { emitOpenapi } from "../scripts/emitOpenapi.js";
import { generate } from "./fixtures/generate.js";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- fixture documents are read and mutated freely

const thingsContract = {
  things: {
    list: base
      .route({ method: "GET", path: "/things" })
      .input(listInput({ kind: z.enum(["a", "b"]) }))
      .output(listOutput(z.object({ id: UuidSchema, amount: MoneyAmount }))),
    create: createRoute("/things").input(z.object({ name: z.string().max(100) })),
  },
};

async function clean(): Promise<Json> {
  const doc = await generate(thingsContract);
  doc["paths"]["/things"]["get"]["operationId"] = "things.list";
  doc["paths"]["/things"]["post"]["operationId"] = "things.create";
  return doc;
}

function check(doc: Json) {
  return checkContractRules(doc as unknown as OpenAPIV3_1.Document);
}

function pointer(location: string): string {
  return location.replace(/^#/, "");
}

const GET = "/paths/~1things/get";
const POST = "/paths/~1things/post";

function listItemSchema(doc: Json): Json {
  const schema =
    doc["paths"]["/things"]["get"]["responses"]["200"]["content"]["application/json"]["schema"];
  return schema["properties"]["items"]["items"];
}

describe("TP-4.5: checkContractRules", () => {
  it("TP-4.5: the clean document has no violations", async () => {
    expect(check(await clean())).toEqual([]);
  });

  it("TP-4.5: R1, an untyped request body schema", async () => {
    const doc = await clean();
    doc["paths"]["/things"]["post"]["requestBody"]["content"]["application/json"]["schema"][
      "properties"
    ]["name"] = {};

    const violations = check(doc);

    expect(violations.map((v) => v.rule)).toEqual(["R1"]);
    expect(pointer(violations[0]?.location ?? "")).toMatch(
      new RegExp(`^${POST}/requestBody/.*name`),
    );
  });

  it("TP-4.5: R2, an int64 without maximum", async () => {
    const doc = await clean();
    delete listItemSchema(doc)["properties"]["amount"]["maximum"];

    const violations = check(doc);

    expect(violations.map((v) => v.rule)).toEqual(["R2"]);
    expect(pointer(violations[0]?.location ?? "")).toMatch(
      new RegExp(`^${GET}/responses/.*amount`),
    );
  });

  it("TP-4.5: R3, a number without x-budmon-allow-number", async () => {
    const doc = await clean();
    listItemSchema(doc)["properties"]["ratio"] = { type: "number" };

    const violations = check(doc);

    expect(violations.map((v) => v.rule)).toEqual(["R3"]);
    expect(pointer(violations[0]?.location ?? "")).toMatch(new RegExp(`^${GET}/responses/.*ratio`));
  });

  it("TP-4.5: R4, a free-text string query parameter on a GET", async () => {
    const doc = await clean();
    doc["paths"]["/things"]["get"]["parameters"].push({
      name: "q",
      in: "query",
      required: false,
      schema: { type: "string" },
    });

    const violations = check(doc);

    expect(violations.map((v) => v.rule)).toEqual(["R4"]);
    expect(pointer(violations[0]?.location ?? "")).toMatch(new RegExp(`^${GET}`));
  });

  it("TP-4.5: R5, a create without its Idempotency-Key header", async () => {
    const doc = await clean();
    const post = doc["paths"]["/things"]["post"];
    post["parameters"] = (post["parameters"] as Json[]).filter(
      (p) => p["name"] !== "Idempotency-Key",
    );

    const violations = check(doc);

    expect(violations.map((v) => v.rule)).toEqual(["R5"]);
    expect(pointer(violations[0]?.location ?? "")).toMatch(new RegExp(`^${POST}`));
  });

  it("TP-4.5: R6, a duplicate operation id", async () => {
    const doc = await clean();
    doc["paths"]["/things"]["get"]["operationId"] = "things.create";

    const violations = check(doc);

    expect(violations.map((v) => v.rule)).toEqual(["R6"]);
    expect(pointer(violations[0]?.location ?? "")).toMatch(/^\/paths\/~1things\/(get|post)/);
  });
});

describe("TP-4.24x: checkContractRules, further cases (F-348)", () => {
  it("TP-4.24x: the real contract's emitted document is clean", async () => {
    const doc = JSON.parse(await emitOpenapi()) as Json;

    expect(check(doc)).toEqual([]);
  });

  it("TP-4.24x: R4, a GET with a request body", async () => {
    const doc = await clean();
    doc["paths"]["/things"]["get"]["requestBody"] = {
      content: { "application/json": { schema: { type: "object" } } },
    };

    expect(check(doc).map((v) => v.rule)).toContain("R4");
  });

  it("TP-4.24x: R3, a number marked x-budmon-allow-number is allowed", async () => {
    const doc = await clean();
    listItemSchema(doc)["properties"]["ratio"] = { type: "number", "x-budmon-allow-number": true };

    expect(check(doc)).toEqual([]);
  });

  it("TP-4.24x: R5, a create whose 201 response isn't CreatedResult", async () => {
    const doc = await clean();
    doc["paths"]["/things"]["post"]["responses"]["201"]["content"]["application/json"]["schema"] = {
      type: "object",
      properties: { ok: { type: "boolean" } },
    };

    expect(check(doc).map((v) => v.rule)).toEqual(["R5"]);
  });

  it("TP-4.24x: the contract builders never leave a .transform() (R1 on the emitted spike)", async () => {
    const { spike } = await import("./fixtures/spikeContract.js");

    expect(check(await generate(spike))).toEqual([]);
  });
});
