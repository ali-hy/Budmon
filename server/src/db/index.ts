import ENV from "../env.js";
import { drizzle } from "drizzle-orm/node-postgres";

// Connect to db
export const db = drizzle(ENV.DATABASE_URL);
