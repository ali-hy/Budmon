import { date, integer, pgTable, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import z from "zod";

export const users = pgTable("users", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 255 }).notNull(),
  dob: date(),
  email: varchar({ length: 255 }).unique().notNull(),
  passwordHash: varchar({ length: 255 }).notNull()
});

export const registrationSchema = createInsertSchema(users)
  .omit({
    passwordHash: true
  })
  .extend(z.object({
    password: z.string
  }));

