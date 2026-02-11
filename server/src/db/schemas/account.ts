import { pgTable, integer, varchar, primaryKey } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm/relations";
import { currenciesTable } from "./currencies.js";
import { usersTable } from "./users.js";

export const accountsTable = pgTable("accounts", {
  id: integer().primaryKey().generatedAlwaysAsIdentity().primaryKey(),
  name: varchar({ length: 256 }).notNull(),
  initialBalance: integer().notNull(),
  currentBalance: integer().notNull(),
  currencyId: integer()
    .notNull()
    .references(() => currenciesTable.id),
});

export const accountOwnersTable = pgTable(
  "accountOwners",
  {
    accountId: integer()
      .notNull()
      .references(() => accountsTable.id),
    ownerId: integer()
      .notNull()
      .references(() => usersTable.id),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.ownerId] })],
);

export const accountOwnersRelations = relations(
  accountOwnersTable,
  ({ one }) => ({
    account: one(accountsTable, {
      fields: [accountOwnersTable.accountId],
      references: [accountsTable.id],
    }),
    owner: one(usersTable, {
      fields: [accountOwnersTable.ownerId],
      references: [usersTable.id],
    }),
  }),
);

export const accountsRelations = relations(accountsTable, ({ many }) => ({
  accountOwners: many(accountOwnersTable),
}));
