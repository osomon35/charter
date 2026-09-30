/**
 * Normalises a PostgREST embedded relation to a single row.
 *
 * `select("..., contracts(title)")` across a to-one foreign key returns an
 * object at runtime, but supabase-js's generated types describe it as an array.
 * Elsewhere in this codebase that mismatch was hidden behind
 * `as unknown as { ... }` casts, which compile but assert something the types
 * disagree with — and would be silently wrong if a given embed ever did come
 * back as an array.
 *
 * This accepts either shape and returns the row, so the call site is correct
 * whichever one arrives.
 */
export function embedOne<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return (value[0] as T | undefined) ?? null;
  return value as T;
}

/** The array form of the same problem, for to-many embeds. */
export function embedMany<T>(value: unknown): T[] {
  if (value === null || value === undefined) return [];
  return (Array.isArray(value) ? value : [value]) as T[];
}
