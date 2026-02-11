import { asc, eq } from "drizzle-orm";
import { db as appDb } from "../db/index.js";
import { usersTable } from "../db/schemas/users.js";
import { paginationInfo, type PaginationOptions } from "../utils/pagination.js";

export class UserRepo {
  db: typeof appDb;

  constructor(db: typeof appDb) {
    this.db = db;
  }

  private static instance?: UserRepo;
  static getInstance() {
    if (!UserRepo.instance)
      UserRepo.instance = new UserRepo(appDb);
    return UserRepo.instance;
  }

  async createUser(user: typeof usersTable.$inferInsert) {
    return this.db.insert(usersTable).values(user);
  }

  async getUserById(id: typeof usersTable.$inferSelect.id) {
    return this.db.select().from(usersTable).where(eq(usersTable.id, id))
  }

  async getUserByEmail(email: typeof usersTable.$inferSelect.email) {
    return this.db.select().from(usersTable).where(eq(usersTable.email, email))
  }

  async getUsersPaginated(paginationOpts: PaginationOptions) {
    const [queryOpts, pageInfo] = paginationInfo({
      ...paginationOpts,
      totalItems: await this.db.$count(usersTable)
    })

    const items = await this.db.select().from(usersTable)
      .orderBy(asc(usersTable.id))
      .offset(queryOpts.offset)
      .limit(queryOpts.limit)

    return {
      items,
      ...pageInfo,
    }
  }
}
