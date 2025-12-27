import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users } from "../db/schemas/users.js";
import type { Paginated, PaginationOptions } from "../utils/pagination.js";

export async function getUserById(id: number) {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user;
}

export async function getUsersPaginated({
  page,
  pageSize,
}: PaginationOptions): Promise<Paginated<typeof users.$inferSelect>> {
  const count = await db.$count(users);

  return {
    items: await db
      .select()
      .from(users)
      .offset((page - 1) * pageSize)
      .limit(pageSize),
    pageCount: Math.floor(count / pageSize),
    totalCount: count,
  };
}

export async function getUsersCount() {
  return db.$count(users);
}
