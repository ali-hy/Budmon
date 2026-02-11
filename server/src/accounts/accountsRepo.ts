import { accountOwnersTable, accountsTable } from "../db/schemas/account.js";
import { usersTable } from "../db/schemas/users.js";
import { db as appDb } from "../db/index.js";
import { eq, getTableColumns } from "drizzle-orm";
import type { TableRecord } from "../types/TableRecord.js";
import assert from "assert";

export class AccountsRepo {
  db: typeof appDb;

  private static _instance: AccountsRepo;
  static getInstance() {
    if (AccountsRepo._instance) return AccountsRepo._instance;

    return new AccountsRepo(appDb);
  }
  static get instance() {
    return AccountsRepo.getInstance();
  }

  constructor(db: typeof appDb) {
    this.db = db;
  }

  getAccountsByUserId(
    userId: typeof usersTable.$inferSelect.id,
  ): Promise<TableRecord<typeof accountsTable>[]> {
    return this.db
      .select({
        ...getTableColumns(accountsTable),
      })
      .from(accountOwnersTable)
      .where(eq(accountOwnersTable.ownerId, userId))
      .groupBy(usersTable.id)
      .leftJoin(
        accountsTable,
        eq(accountsTable.id, accountOwnersTable.accountId),
      );
  }

  getAccountById(accountId: typeof accountsTable.$inferSelect.id) {
    return this.db
      .select()
      .from(accountsTable)
      .where(eq(accountsTable.id, accountId))
      .groupBy(accountsTable.id)
      .leftJoin(
        accountOwnersTable,
        eq(accountOwnersTable.accountId, accountsTable.id),
      )
      .leftJoin(usersTable, eq(accountOwnersTable.accountId, usersTable.id));
  }

  async createAccount(
    account: typeof accountsTable.$inferInsert,
    ownerIds: (typeof usersTable.$inferSelect.id)[],
  ) {
    const [insertedAccount] = await this.db
      .insert(accountsTable)
      .values(account)
      .returning({ id: accountsTable.id });

    if (insertedAccount === undefined)
      throw new Error("Failed to insert new account");

    this.db
      .insert(accountOwnersTable)
      .values(
        ownerIds.map((ownerId) => ({ ownerId, accountId: insertedAccount.id })),
      );
  }

  async updateAccount(account: typeof accountsTable.$inferSelect) {}
}
