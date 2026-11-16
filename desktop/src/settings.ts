import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** What the person chose in onboarding and settings, kept in `<user data>/settings.json`. */
export interface Settings {
  /** Not chosen yet: onboarding shows. */
  mode: "local" | "server" | null;
  /** The MobSimLab server's address (server mode). */
  serverUrl?: string;
  /** AI agents (MCP) on in local mode. Off until the person turns them on. */
  agents: boolean;
}

const DEFAULTS: Settings = { mode: null, agents: false };

/** Purpose: read the settings; missing or damaged files give the defaults. */
export function readSettings(file: string): Settings {
  if (!existsSync(file)) return { ...DEFAULTS };
  try {
    const v = JSON.parse(readFileSync(file, "utf8")) as Partial<Settings>;
    return {
      mode: v.mode === "local" || v.mode === "server" ? v.mode : null,
      serverUrl: typeof v.serverUrl === "string" ? v.serverUrl : undefined,
      agents: v.agents === true,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/** Purpose: save the settings (written to a temporary file first, so a crash never leaves half a file). */
export function writeSettings(file: string, s: Settings): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(s, null, 2), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}

/**
 * Purpose: check and normalise a server address typed in onboarding.
 * Output: the origin (`https://mobsimlab.example.org`), or an error message for the person.
 * Plain http is accepted only for this computer (a test server); everything else needs https.
 */
export function normaliseServerUrl(input: string): { url: string } | { error: string } {
  let text = input.trim();
  if (!text) return { error: "Enter the address of your MobSimLab server." };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return { error: "That is not a web address." };
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && loopback))
    return { error: "The server must use https://." };
  if (u.username || u.password) return { error: "Leave the user name and password out of the address." };
  return { url: u.origin };
}

/**
 * Purpose: whether a server answers like MobSimLab: `GET /api/auth/me` returns the instance's name and mode.
 * Output: the instance name, or an error message for the person.
 */
export async function probeServer(
  url: string,
  get: (url: string) => Promise<Response> = (u) => fetch(u),
): Promise<{ name: string } | { error: string }> {
  let res: Response;
  try {
    res = await get(`${url}/api/auth/me`);
  } catch {
    return { error: "The server could not be reached. Check the address and your connection." };
  }
  if (!res.ok)
    return { error: `The server answered with an error (${res.status}). Is this a MobSimLab address?` };
  try {
    const body = (await res.json()) as {
      instance?: { name?: unknown; mode?: unknown };
      signInAvailable?: unknown;
    };
    if (typeof body.instance?.name === "string" && typeof body.signInAvailable === "boolean")
      return { name: body.instance.name };
  } catch {
    // not JSON
  }
  return { error: "This address does not look like a MobSimLab server." };
}
