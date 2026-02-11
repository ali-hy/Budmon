import * as p from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { usersTable } from "./users.js";

export const refreshTokensTable = p.pgTable("refreshTokens", {
  id: p.integer().primaryKey().generatedAlwaysAsIdentity(),
  userId: p.integer().notNull().references(() => usersTable.id),
  token: p.varchar().notNull()
});

export const refreshTokensRelationship = relations(refreshTokensTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [refreshTokensTable.userId],
    references: [usersTable.id]
  })
}))
