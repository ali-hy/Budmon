import z from "zod";

/**
 * Schema for validating pagination params
 * @prop page - positive int
 * @prop pageSize - positive int
 */
const paginationParamsSchema = z.object({
  page: z.coerce.number().int(),
  pageSize: z.coerce.number().int().min(1),
});

type PaginationOptions = z.infer<typeof paginationParamsSchema>;

type Paginated<T> = {
  items: T[];
  totalCount: number;
  pageCount: number;
};

function getPaginatedResponse<T>(items: T[]) {}

export { paginationParamsSchema };
export type { PaginationOptions, Paginated };
