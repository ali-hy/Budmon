import { integer, pgTable, varchar } from "drizzle-orm/pg-core";

export const currenciesTable = pgTable("currencies", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  code: varchar({ length: 3 }),
  name: varchar({ length: 255 }),
});
