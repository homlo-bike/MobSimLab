/** What `GET /api/auth/me` returns. */
export interface Me {
  instance: { mode: "setup" | "open"; name: string };
  signInAvailable: boolean;
  user?: { id: string; role: string; email: string | null; displayName: string | null };
  csrfToken?: string;
}

/** Messages for `/?signin=<reason>` after a refused sign-in. */
export const SIGNIN_MESSAGES: Record<string, string> = {
  setup_in_progress: "This instance is being set up. Please try again later.",
  not_bootstrap_owner: "Only the person named by the operator can set up this instance.",
  pending_approval: "Your account is waiting for an administrator to approve it.",
  account_deleted: "This account has been removed.",
  expired: "The sign-in took too long. Please try again.",
  invalid_request: "The sign-in could not be completed. Please try again.",
  provider_error: "The sign-in provider returned an error. Please try again.",
};

/** Purpose: load the current session and instance state. */
export async function fetchMe(): Promise<Me> {
  const res = await fetch("/api/auth/me", { credentials: "same-origin" });
  if (!res.ok) throw new Error(`GET /api/auth/me failed: ${res.status}`);
  return (await res.json()) as Me;
}

/**
 * Purpose: send a state-changing request with the session's CSRF token.
 * Inputs: method, path, CSRF token, optional JSON body. Output: parsed JSON response.
 */
export async function send<T>(
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  csrfToken: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorMessage(res, `${method} ${path}`));
  return (await res.json()) as T;
}

/** Purpose: GET a JSON resource with the session cookie. */
export async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin" });
  if (!res.ok) throw new Error(await errorMessage(res, `GET ${path}`));
  return (await res.json()) as T;
}

/** Purpose: a readable message from an API error response (NestJS puts it in `message`). */
async function errorMessage(res: Response, what: string): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string | string[] };
    if (Array.isArray(body.message)) return body.message.join("; ");
    if (body.message) return body.message;
  } catch {
    // not JSON
  }
  return `${what} failed: ${res.status}`;
}
