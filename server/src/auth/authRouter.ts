import express from "express";
import {
  authRefreshSchema,
  loginSchema,
  registrationSchema,
} from "./authValidators.js";
import { AuthService } from "./authService.js";
import { authGuard, identifyUser } from "./authMiddleware.js";

const authRouter: express.Router = express.Router();

authRouter.get(
  "/test-auth",
  identifyUser,
  authGuard(),
  async (req, res, next) => {
    res.status(200).json({
      name: req.user?.name,
    });
  },
);

authRouter.post("/login", async (req, res, next) => {
  const body = loginSchema.parse(req.body);

  try {
    res.json(await AuthService.getInstance().login(body));
  } catch (e: unknown) {
    next(e);
  }
});

authRouter.post("/register", async (req, res, next) => {
  const body = registrationSchema.parse(req.body);
  try {
    await AuthService.getInstance().registerUser(body);
    res.sendStatus(201);
  } catch (e: unknown) {
    next(e);
  }
});

authRouter.post("/refresh", async (req, res, next) => {
  const body = authRefreshSchema.parse(req.body);
  try {
    const result = await AuthService.getInstance().refreshToken(
      body.refreshToken,
    );
    res.json(result);
  } catch (e) {
    next(e);
  }
});

export { authRouter };
