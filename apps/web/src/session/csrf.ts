/**
 * The signed-in session's CSRF token, for the few requests made outside a component that has it (the terrain
 * heights). The app sets it when the session loads; without it (signed out) the header is left out.
 */
let token: string | null = null;

/** Purpose: remember the session's CSRF token (null when signed out). */
export function setCsrfToken(value: string | null): void {
  token = value;
}

/** Purpose: the `X-CSRF-Token` header for a request that changes nothing but is a POST, or none. */
export function csrfHeader(): Record<string, string> {
  return token ? { "X-CSRF-Token": token } : {};
}
