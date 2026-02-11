import { usersTable } from "../db/schemas/users.js";
import { createInsertSchema } from "drizzle-zod";
import z from "zod";

export const passwordSchema = z
  .string()
  .regex(/^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]{8,}$/, {
    error: "Passwords should be at least 8 characters long, with at least one uppercase letter, one lowercase letter, one number, and one special character"
  })

export const registrationSchema = createInsertSchema(usersTable)
  .omit({
    passwordHash: true
  })
  .extend({
    password: passwordSchema
  });

export const loginSchema = z.object({
  email: z.email(),
  password: z.string()
})

export const authRefreshSchema = z.object({
  refreshToken: z.string()
})

export const jwtPayloadSchema = z.object({
  email: z.string()
})
