// F-340: identifiers on the wire (lower-case UUIDs), emitted as `format: uuid`.
import { JSON_SCHEMA_REGISTRY } from "@orpc/zod/zod4";
import { z } from "zod";

export const UuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
JSON_SCHEMA_REGISTRY.add(UuidSchema, { type: "string", format: "uuid" });
