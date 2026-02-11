import ENV from "../env.js";
import { drizzle } from "drizzle-orm/node-postgres";
import { usersTable } from "./schemas/users.js";
import { accountsTable } from "./schemas/account.js";
import { currenciesTable } from "./schemas/currencies.js";
import { refreshTokensTable } from "./schemas/refreshTokens.js";

// Connect to db
export const db = drizzle(ENV.DATABASE_URL, {
  schema: {
    users: usersTable,
    accounts: accountsTable,
    refresTokens: refreshTokensTable,
    currencies: currenciesTable,
  },
});
