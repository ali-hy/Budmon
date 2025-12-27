import express from "express";
import { db } from "../db/index.js";
import { users } from "../db/schemas/users.js";

const usersRouter: express.Router = express.Router();

usersRouter.get("/", async (req, res) => {
  const allUsers = await db.select().from(users);
  res.json(allUsers);
});

export { usersRouter };
