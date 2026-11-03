export const PAGE_SIZE = 50;

export type SearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

/** `?q=` and `?page=` (1-based) of an admin list, as API input. */
export async function listParams(searchParams: SearchParams) {
  const params = await searchParams;
  const query = first(params.q)?.trim() || undefined;
  const page = Math.max(1, Number.parseInt(first(params.page) ?? "", 10) || 1);
  return {
    params,
    page,
    input: { query, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE },
    first,
  };
}

/** The current list URL with some params replaced (undefined drops one). */
export function listHref(
  pathname: string,
  params: Record<string, string | string[] | undefined>,
  changes: Record<string, string | undefined>,
) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...changes })) {
    const single = first(value);
    if (single) search.set(key, single);
  }
  const query = search.toString();
  return query ? `${pathname}?${query}` : pathname;
}
