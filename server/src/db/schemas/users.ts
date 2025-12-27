import { date, integer, pgTable, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { createSelectSchema } from "drizzle-zod";

export const users = pgTable("users", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 255 }).notNull(),
  dob: date(),
  email: varchar({ length: 255 }).unique().notNull(),
});

export const userInsertSchema = createInsertSchema(users);
