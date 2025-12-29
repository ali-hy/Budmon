import { asc, eq } from "drizzle-orm";
import { db as appDb } from "../db/index.js";
import { users } from "../db/schemas/users.js";
import { paginationInfo, type PaginationOptions } from "../utils/pagination.js";

export class UserService {
  db: typeof appDb;

  constructor(db: typeof appDb) {
    this.db = db;
  }

  async getUserById(id: typeof users.$inferSelect.id) {
    return this.db.select().from(users).where(eq(users.id, id))
  }

  async getUsersPaginated(paginationOpts: PaginationOptions) {
    const [queryOpts, pageInfo] = paginationInfo({
      ...paginationOpts,
      totalItems: await this.db.$count(users)
    })

    const items = await this.db.select().from(users)
      .orderBy(asc(users.id))
      .limit(queryOpts?.limit)
      .offset(queryOpts.offset)

    return {
      items,
      ...pageInfo,
    }
  }
}

export const userService = new UserService(appDb);
