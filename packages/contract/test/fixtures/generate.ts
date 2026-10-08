// Generates an OpenAPI document from a contract with F-347's generator configuration, for the
// contract tests' fixtures. Test-architect's helper.
import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";

export async function generate(contract: object): Promise<Record<string, unknown>> {
  const generator = new OpenAPIGenerator({ schemaConverters: [new ZodToJsonSchemaConverter()] });
  const doc = await generator.generate(contract as never, {
    info: { title: "Budmon API", version: "1.0" },
    servers: [{ url: "/api/v1" }],
  });
  return JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
}

/** Follows `$ref`s into `components`, so tests can read a schema whether or not it was inlined. */
export function resolve(doc: Record<string, unknown>, schema: unknown): Record<string, unknown> {
  let current = schema as Record<string, unknown>;
  for (let i = 0; i < 10 && typeof current["$ref"] === "string"; i++) {
    const pointer = current["$ref"].replace(/^#\//, "").split("/");
    let target: unknown = doc;
    for (const part of pointer)
      target = (target as Record<string, unknown>)[
        part.replaceAll("~1", "/").replaceAll("~0", "~")
      ];
    current = target as Record<string, unknown>;
  }
  return current;
}
