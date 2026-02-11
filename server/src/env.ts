import assert from "assert";
import "dotenv/config";
import z from "zod";

const env_schema = z.object({
  DATABASE_URL: z.string(),
  PORT: z.coerce.number().min(1).max(65535),
  JWT_SECRET: z.string().min(8)
});

type EnvType = z.infer<typeof env_schema>;
let env: EnvType = process.env as unknown as EnvType;

try {
  env = env_schema.parse(process.env);
} catch (e) {
  console.warn(`ENV is not valid. Please check the validation error:\n${e}`);
}

const ENV = Object.freeze(env);

export default ENV;
export type { EnvType };
