/** What `GET /api/auth/me` returns. */
export interface Me {
  instance: {
    mode: "setup" | "open";
    name: string;
    /** Desktop app on this computer: one local Owner, signed in by the app, no administration of other people. */
    local?: boolean;
    /** AI agents (MCP) switched on; the desktop app's local mode starts with them off. */
    agents?: boolean;
  };
  signInAvailable: boolean;
  user?: {
    id: string;
    role: string;
    email: string | null;
    displayName: string | null;
    preferences?: Preferences;
  };
  csrfToken?: string;
}

/** Per-user settings stored on the account (`PUT /api/auth/preferences`). */
export interface Preferences {
  /** "system" follows the device or browser; otherwise a language tag. */
  language?: string;
  units?: "auto" | "metric" | "imperial";
  /** "auto" follows the device or browser; otherwise always light or dark. */
  theme?: "auto" | "light" | "dark";
  largerTargets?: boolean;
  reduceMotion?: boolean;
  /** Load and draw existing railways from OpenStreetMap in the railway tool (off when absent). */
  existingRailways?: boolean;
}

/** Purpose: change some preferences; the others stay. Output: the stored set. */
export async function savePreferences(csrfToken: string, patch: Preferences): Promise<Preferences> {
  return (await send<{ preferences: Preferences }>("PUT", "/api/auth/preferences", csrfToken, patch))
    .preferences;
}

/**
 * Purpose: load the current session and instance state. In the desktop app's local mode a missing or expired
 * session is renewed at once: the app adds its launch key to this request, so nobody has to sign in.
 */
export async function fetchMe(): Promise<Me> {
  const get = async () => {
    const res = await fetch("/api/auth/me", { credentials: "same-origin" });
    if (!res.ok) throw new Error(`GET /api/auth/me failed: ${res.status}`);
    return (await res.json()) as Me;
  };
  const me = await get();
  if (!me.instance.local || me.user) return me;
  const res = await fetch("/api/auth/local", { method: "POST", credentials: "same-origin" });
  return res.ok ? get() : me;
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
