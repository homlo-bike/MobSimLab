/** Hints for the PostgreSQL errors an operator meets on a first start. */
const PG_HINTS: Record<string, string> = {
  "28P01": "the role does not exist or its password does not match the secret",
  "3D000": "the database does not exist",
};

/**
 * Purpose: a one-line description of an error that is never empty. Node reports a failed connection to a host
 * with several addresses (IPv4 and IPv6) as an AggregateError whose own message is empty; this adds each attempt.
 * Inputs: anything thrown. Output: text such as "connect ECONNREFUSED 172.18.0.2:5432; connect ... (ECONNREFUSED)".
 */
export function errorText(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const err = e as Error & { code?: string; errors?: unknown[] };
  const parts: string[] = [];
  if (err.message) parts.push(err.message);
  if (Array.isArray(err.errors)) for (const inner of err.errors) parts.push(errorText(inner));
  if (parts.length === 0) parts.push(err.name || "Error");
  let text = parts.join("; ");
  if (err.code && !text.includes(err.code)) text += ` (${err.code})`;
  const hint = err.code ? PG_HINTS[err.code] : undefined;
  return hint ? `${text}: ${hint}` : text;
}
