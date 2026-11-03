/**
 * An `ilike` pattern matching `query` anywhere, with `%`, `_` and `\` taken
 * literally (Postgres' default LIKE escape is the backslash).
 */
export function containsPattern(query: string) {
  return `%${query.trim().replace(/[%_]/g, "$&")}%`;
}
