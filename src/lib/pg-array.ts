/**
 * Postgres array-literal binding for raw SQL.
 *
 * Drizzle's `sql` template expands a JavaScript array into a comma-separated
 * list of placeholders — `($1, $2, $3)` — which Postgres reads as a ROW, not an
 * array. `= ANY($1::uuid[])` then fails two different ways depending on length:
 *
 *   3 elements → "cannot cast type record to uuid[]"
 *   1 element  → "malformed array literal" (a bare value, not `{...}`)
 *
 * Both are silent-at-compile-time and only appear against a live database.
 * Passing one text parameter holding a literal `{"a","b"}` binds as a single
 * placeholder and casts cleanly, for uuid[], text[] and enum[] alike.
 *
 * Every element is double-quoted and escaped, so a value containing a comma,
 * a brace, a quote or a backslash cannot break out of the literal.
 */
export function pgArray(values: readonly string[]): string {
  if (values.length === 0) return "{}";
  const escaped = values.map(
    (value) => `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`,
  );
  return `{${escaped.join(",")}}`;
}
