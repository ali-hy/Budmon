import ENV from "./env.js";
import express from "express";
import morgan from "morgan";

import { users } from "./db/schemas/users.js";
import { router } from "./router/index.js";
import { sql } from "drizzle-orm";
import { db } from "./db/index.js";

const app = express();

// Setup express app
app.use(morgan("short"));

// Add endpoints
app.use("/", router);

async function main() {
  // Seed db
  const user: typeof users.$inferInsert = {
    name: "Admin User",
    email: "adminstrator@localhost.com",
  };
  try {
    const [result] = await db
      .select({
        count: sql<number>`count(${users.id})`,
      })
      .from(users);

    if (result && result.count <= 0) await db.insert(users).values(user);
  } catch {
    console.error("Tried to seed users and failed");
  }

  app.listen(ENV.PORT, (e) => {
    console.log(`Node app listening on http://localhost:${ENV.PORT}`);
  });
}

main();
