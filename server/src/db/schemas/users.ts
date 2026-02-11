import { date, integer, pgTable, varchar } from "drizzle-orm/pg-core";
import { refreshTokensTable } from "./refreshTokens.js";
import { relations } from "drizzle-orm/relations";
import { accountOwnersTable } from "./account.js";

export const usersTable = pgTable("users", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 255 }).notNull(),
  dob: date(),
  email: varchar({ length: 255 }).unique().notNull(),
  passwordHash: varchar({ length: 255 }).notNull(),
});

export const userRefreshRelationship = relations(usersTable, ({ many }) => ({
  refreshTokens: many(refreshTokensTable),
  userAccounts: many(accountOwnersTable),
}));
