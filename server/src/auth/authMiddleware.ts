import express, { type RequestHandler } from "express";
import jwt from "jsonwebtoken";
import ENV from "../env.js";
import z from "zod";
import { UnauthorizedError } from "./authErrors.js";
import { usersTable } from "../db/schemas/users.js";
import { jwtPayloadSchema } from "./authValidators.js";
import { db } from "../db/index.js";
import { eq } from "drizzle-orm";
import { UserRepo } from "../users/userRepo.js";

declare global {
  namespace Express {
    interface Request {
      user?: typeof usersTable.$inferSelect;
    }
  }
}

const authTypeValidator = z.enum(["Bearer"] as const);

export const identifyUser: express.RequestHandler = async (req, res, next) => {
  if (req.headers.authorization === undefined) {
    next();
    return;
  }

  const [authType, token] = req.headers.authorization.split(" ");

  try {
    authTypeValidator.parse(authType);
  } catch {
    next(new UnauthorizedError());
    return;
  }

  if (token === undefined) {
    next(new UnauthorizedError());
    return;
  }

  switch (authType) {
    case "Bearer":
      try {
        const payload = jwtPayloadSchema.parse(
          jwt.verify(token, ENV.JWT_SECRET),
        );
        const [user] = await db
          .select()
          .from(usersTable)
          .where(eq(usersTable.email, payload.email));

        if (!user) throw new UnauthorizedError();

        req.user = user;
      } catch (e) {
        next(new UnauthorizedError());
        return;
      }
  }

  next();
};

export const authGuard = (...args: never[]): RequestHandler => {
  return async (req, res, next) => {
    if (req.user) {
      next();
      return;
    }

    if (!req.headers.authorization) {
      throw new UnauthorizedError();
    }

    const [authType, token] = req.headers.authorization.split(" ");

    try {
      authTypeValidator.parse(authType);
    } catch {
      throw new UnauthorizedError();
    }

    if (token === undefined) {
      throw new UnauthorizedError();
    }

    switch (authType) {
      case "Bearer":
        let payload: z.infer<typeof jwtPayloadSchema>;

        try {
          payload = jwtPayloadSchema.parse(jwt.verify(token, ENV.JWT_SECRET));
        } catch (e) {
          throw new UnauthorizedError();
        }

        const [user] = await UserRepo.getInstance().getUserByEmail(
          payload.email,
        );

        if (!user) {
          throw new UnauthorizedError();
        }
    }

    next();
  };
};
