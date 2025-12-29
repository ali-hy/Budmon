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

type Paginated<T> = PaginationOptions & {
  items: T[];
  totalItems: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
};

type QueryPaginationParams = {
  limit: number;
  offset: number;
}

function paginationInfo(options: PaginationOptions & Pick<Paginated<unknown>, "totalItems">) {
  const totalPages = Math.floor(options.totalItems / options.pageSize);
  return [
    {
      limit: options.pageSize,
      offset: (options.page - 1) * options.pageSize
    }, {
      ...options,
      totalPages,
      hasNext: options.page < totalPages,
      hasPrev: options.page <= totalPages && options.page > 1,
    } satisfies Omit<Paginated<unknown>, "items">
  ] as const
}

export { paginationParamsSchema, paginationInfo };
export type { PaginationOptions, Paginated, QueryPaginationParams };
