/**
 * The shared log redaction deny-list (ADR-0022, 03 §6). Same words as `contracts/log-redaction.json`, the web
 * app's `src/logging/redact.ts` and the worker's `logsink.py`; `test/logging.test.ts` checks that they match.
 */
export const REDACT_KEYS = [
  "password",
  "passwd",
  "passphrase",
  "secret",
  "token",
  "authorization",
  "cookie",
  "apikey",
  "credential",
  "privatekey",
  "session",
  "codeverifier",
  "nonce",
] as const;

/** What a redacted value is replaced by. */
export const REDACTED = "[REDACTED]";

/** Deepest level of nested objects kept; anything deeper is cut (also stops reference cycles). */
const MAX_DEPTH = 8;

/** Most array items kept. */
const MAX_ITEMS = 100;

/** Credentials written inline, as in an `Authorization` header value. */
const INLINE_CREDENTIAL = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;

/**
 * Purpose: whether a field name holds a secret.
 * Inputs: field name. Output: true when the name, lower-cased and without `-` and `_`, contains a deny-list word.
 */
export function isSecretKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[-_]/g, "");
  return REDACT_KEYS.some((w) => k.includes(w));
}

/**
 * Purpose: a copy of a value that is safe to log.
 * Inputs: any value. Output: the same shape, with secret fields replaced by REDACTED, inline credentials in
 * strings masked, errors turned into plain objects, and very deep or long structures cut.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redactText(value);
  if (value === null || typeof value !== "object") {
    return typeof value === "bigint" ? value.toString() : value;
  }
  if (depth >= MAX_DEPTH) return "[TRUNCATED]";
  if (value instanceof Error) {
    return { name: value.name, message: redactText(value.message), stack: redactText(value.stack ?? "") };
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = isSecretKey(k) ? REDACTED : redact(v, depth + 1);
  return out;
}

/** Purpose: mask inline credentials (`Bearer …`, `Basic …`) in a text. */
export function redactText(text: string): string {
  return text.replace(INLINE_CREDENTIAL, `$1 ${REDACTED}`);
}
