import e from "express";
import { usersRouter } from "../users/usersRouter.js";
import { authRouter } from "../auth/authRouter.js";
import { router } from "../trpc.js";

const expressRouter: e.Router = e.Router();

expressRouter.use("/auth", authRouter);
expressRouter.use("/users", usersRouter);

expressRouter.get("/", (req, res) => {
  res.send("Hello World!");
});

/* tRPC router */
const appRouter = router({});

export { expressRouter as expressRouter };
