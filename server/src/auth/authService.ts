import { db as appDb } from "../db/index.js";
import { usersTable } from "../db/schemas/users.js";
import bcrypt from "bcrypt";
import z from "zod";
import {
  jwtPayloadSchema,
  type loginSchema,
  type registrationSchema,
} from "./authValidators.js";
import { eq } from "drizzle-orm";
import assert from "assert";
import jwt from "jsonwebtoken";
import ENV from "../env.js";
import { refreshTokensTable } from "../db/schemas/refreshTokens.js";
import {
  InvalidCredentialsError,
  UnauthorizedError,
  UserAlreadyExists,
} from "./authErrors.js";
import { UserRepo } from "../users/userRepo.js";

export class AuthService {
  db: typeof appDb;
  userRepo: UserRepo;

  constructor(db: typeof appDb) {
    this.db = db;
    this.userRepo = UserRepo.getInstance();
    AuthService.instance = this;
  }

  private static instance?: AuthService;
  static getInstance() {
    if (!AuthService.instance) AuthService.instance = new AuthService(appDb);
    return AuthService.instance;
  }

  async registerUser({
    password,
    ...userInfo
  }: z.infer<typeof registrationSchema>) {
    const exists = await this.userRepo.getUserByEmail(userInfo.email);
    if (exists.length) {
      throw new UserAlreadyExists("A user with this email exists");
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const newUser = await this.db.insert(usersTable).values({
      ...userInfo,
      passwordHash,
    });

    return newUser;
  }

  async login({ email, password }: z.infer<typeof loginSchema>) {
    const [user] = await this.db
      .select({
        id: usersTable.id,
        passwordHash: usersTable.passwordHash,
      })
      .from(usersTable)
      .where(eq(usersTable.email, email));

    assert(user !== undefined, new InvalidCredentialsError());

    if (!(await bcrypt.compare(password, user.passwordHash))) {
      throw new InvalidCredentialsError();
    }

    return {
      accessToken: this.createAccessToken(email),
      refreshToken: await this.createRefreshToken(email, user.id),
    };
  }

  async refreshToken(token: string) {
    try {
      const decoded = jwtPayloadSchema.parse(jwt.verify(token, ENV.JWT_SECRET));

      const [queryRes] = await this.db
        .select()
        .from(refreshTokensTable)
        .where(eq(refreshTokensTable.token, token))
        .leftJoin(usersTable, eq(refreshTokensTable.userId, usersTable.id));

      if (!queryRes) {
        const user = this.db
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(eq(usersTable.email, decoded.email))
          .as("userId");

        await this.db
          .delete(refreshTokensTable)
          .where(eq(refreshTokensTable.userId, user.id))
          .execute();

        throw new UnauthorizedError();
      }

      await this.db
        .delete(refreshTokensTable)
        .where(eq(refreshTokensTable.token, token))
        .execute();

      assert(
        queryRes.users,
        `Unexpected: refreshToken must have a user (${token})`,
      );

      return {
        accessToken: this.createAccessToken(queryRes.users.email),
        refreshToken: await this.createRefreshToken(
          queryRes.users.email,
          queryRes.users.id,
        ),
      };
    } catch (err) {
      await this.db
        .delete(refreshTokensTable)
        .where(eq(refreshTokensTable.token, token))
        .execute();

      throw new UnauthorizedError();
    }
  }

  createAccessToken(email: string) {
    return jwt.sign(
      {
        email: email,
      },
      ENV.JWT_SECRET,
      {
        expiresIn: "30m",
      },
    );
  }

  async createRefreshToken(email: string, userId: number) {
    const refreshToken = jwt.sign(
      {
        email: email,
      },
      ENV.JWT_SECRET,
      {
        expiresIn: "7d",
      },
    );

    this.db
      .insert(refreshTokensTable)
      .values({
        userId,
        token: refreshToken,
      })
      .execute();

    return refreshToken;
  }
}
