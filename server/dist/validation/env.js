import z from "zod";
export const env_schema = z.object({
    DATABASE_URL: z.string(),
    PORT: z.coerce.number(),
});
//# sourceMappingURL=env.js.map