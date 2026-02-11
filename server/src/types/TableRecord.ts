import { PgTable } from "drizzle-orm/pg-core";

export type TableRecord<Table extends PgTable> = {
  [k in keyof Table["$inferSelect"]]: Table["$inferSelect"][k] | null;
};
