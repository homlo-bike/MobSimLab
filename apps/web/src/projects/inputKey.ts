/**
 * Fingerprints of what a calculated result was worked out from. A result saved with the project keeps the
 * fingerprint of its inputs; when the inputs give another fingerprint, the result is out of date.
 */

/** Purpose: JSON text with object keys sorted, so the same values always give the same text. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return v;
    const o = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(o)
        .sort()
        .map((k) => [k, o[k]]),
    );
  });
}

/** Purpose: a short hash of a text (two 32-bit FNV-1a style lanes, 16 hex digits). Not for security. */
export function hashText(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
    h2 ^= h2 >>> 15;
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  return hex(h1) + hex(h2);
}

/** Purpose: the fingerprint of some input values (any JSON-like value; key order does not matter). */
export function inputKey(value: unknown): string {
  return hashText(stableJson(value));
}
