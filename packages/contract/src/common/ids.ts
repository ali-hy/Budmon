// F-340: identifiers on the wire (lower-case UUIDs), emitted as `format: uuid` with the pattern.
import { JSON_SCHEMA_REGISTRY } from "@orpc/zod/zod4";
import { z } from "zod";

/** A-153: A-41's `isUuid` rule (version 1 to 8, variant 8, 9, a or b); nil and max are refused. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const UuidSchema = z.string().regex(UUID_PATTERN);
JSON_SCHEMA_REGISTRY.add(UuidSchema, {
  type: "string",
  format: "uuid",
  pattern: UUID_PATTERN.source,
});
