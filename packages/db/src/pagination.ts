/**
 * Pagination helpers shared by API services.
 *
 * Keeps list endpoints consistent: 1-based pages, clamped page size,
 * Prisma-ready `skip`/`take`, and the `Paginated<T>` envelope from
 * `@ai-study-companion/shared`.
 */

export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export interface PaginationArgs {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

/** Normalize raw page/pageSize input into safe Prisma arguments. */
export function parsePagination(
  input: { page?: unknown; pageSize?: unknown } = {}
): PaginationArgs {
  const rawPage = Number(input.page);
  const rawSize = Number(input.pageSize);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : DEFAULT_PAGE;
  const pageSize =
    Number.isFinite(rawSize) && rawSize >= 1
      ? Math.min(Math.floor(rawSize), MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

/** Build the `Paginated<T>` envelope for a list query result. */
export function buildPaginatedResult<T>(
  items: T[],
  total: number,
  args: Pick<PaginationArgs, "page" | "pageSize">
): { items: T[]; page: number; pageSize: number; total: number } {
  return { items, total, page: args.page, pageSize: args.pageSize };
}
