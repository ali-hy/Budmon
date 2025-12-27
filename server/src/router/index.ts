import e from "express";
import { usersRouter } from "./users.js";

const router: e.Router = e.Router();

router.use("/users", usersRouter);

router.get("/", (req, res) => {
  res.send("Hello World!");
});

export { router };
