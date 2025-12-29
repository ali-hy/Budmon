import { db as appDb } from "../db/index.js"
import { users } from "../db/schemas/users.js"

export class AuthService {
  db: typeof appDb;

  constructor(db: typeof appDb) {
    this.db = db;
  }

  async registerUser(userInfo: typeof ) {
    const newUser = await this.db.insert(users).values(userInfo)

    return newUser;
  }
}
