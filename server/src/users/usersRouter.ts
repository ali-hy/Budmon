import express from "express";
import { db } from "../db/index.js";
import { usersTable } from "../db/schemas/users.js";

const usersRouter: express.Router = express.Router();

usersRouter.get("/", async (req, res) => {
  const allUsers = await db.select().from(usersTable);
  res.json(allUsers);
});

usersRouter.post("/", async (req, res) => {

})

export { usersRouter };
