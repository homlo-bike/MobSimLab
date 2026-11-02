import { createHash, randomBytes } from "node:crypto";
import type { InstanceRole } from "../db/database";

/**
 * OAuth 2.1 pieces for agent connections (ADR-0035 §2): scopes, which users may connect agents, redirect URI
 * rules, PKCE and token formats. The authorization server lives in this module; sign-in itself is still
 * delegated to the instance's OIDC provider.
 */

/** Scopes an agent can be granted. `simulation:run` arrives with simulation runs (ADR-0035 phase C). */
export const SCOPES = {
  "project:read": "Read your agent scenarios: stops, lines, service levels and validation results",
  "analysis:run": "Run analyses: stop spacing, walk coverage, catchments, journeys and benchmarks",
  "scenario:write": "Create agent scenarios and change them (never the base network, sharing or users)",
} as const;
export type Scope = keyof typeof SCOPES;
export const SCOPE_IDS = Object.keys(SCOPES) as Scope[];

/** Product owner (2026-11-01): only Editors and above connect agents; Viewers and Restricted users cannot. */
export const AGENT_ROLES: readonly InstanceRole[] = ["owner", "admin", "user"];

/** Purpose: whether a user with this instance role may connect agents or use a token. */
export function mayUseAgents(role: InstanceRole, status: string): boolean {
  return status === "active" && AGENT_ROLES.includes(role);
}

/** Purpose: parse a space-separated scope string. Unknown scopes are an error; empty means all. */
export function parseScopes(s: string | undefined | null): Scope[] | null {
  if (!s || !s.trim()) return [...SCOPE_IDS];
  const out: Scope[] = [];
  for (const p of s.trim().split(/\s+/)) {
    if (!(p in SCOPES)) return null;
    if (!out.includes(p as Scope)) out.push(p as Scope);
  }
  return out;
}

/**
 * Purpose: whether a redirect URI may be registered (OAuth 2.1 §2.3.1, RFC 8252 §7.3): https, or http on a
 * loopback address for native apps; no fragment, no credentials.
 */
export function validRedirectUri(u: string): boolean {
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:") return ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  // Private-use schemes of native apps (RFC 8252 §7.1), e.g. com.example.app:/callback.
  return /^[a-z][a-z0-9+.-]*\.[a-z0-9+.-]+:$/.test(url.protocol);
}

/**
 * Purpose: compare a redirect URI from a request with a registered one. Exact match, except that the port of
 * a loopback http URI may differ (RFC 8252 §7.3).
 */
export function redirectMatches(registered: string, asked: string): boolean {
  if (registered === asked) return true;
  try {
    const r = new URL(registered);
    const a = new URL(asked);
    const loop = ["127.0.0.1", "localhost", "[::1]"];
    return (
      r.protocol === "http:" &&
      a.protocol === "http:" &&
      loop.includes(r.hostname) &&
      r.hostname === a.hostname &&
      r.pathname === a.pathname &&
      r.search === a.search
    );
  } catch {
    return false;
  }
}

/** Purpose: PKCE S256 check (RFC 7636 §4.6). */
export function pkceOk(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  return createHash("sha256").update(verifier).digest("base64url") === challenge;
}

/** Purpose: SHA-256 of a token; only hashes are stored. */
export function tokenHash(t: string): Buffer {
  return createHash("sha256").update(t).digest();
}

/** Token prefixes, so leaked tokens are recognisable by secret scanners. */
export const PREFIX = {
  code: "msl_ac_",
  access: "msl_at_",
  refresh: "msl_rt_",
  pat: "msl_pat_",
  request: "msl_cr_",
};

/** Purpose: a new random token with a prefix. */
export function newToken(kind: keyof typeof PREFIX): string {
  return PREFIX[kind] + randomBytes(32).toString("base64url");
}

export const ACCESS_TTL_S = 3600;
export const REFRESH_IDLE_S = 30 * 24 * 3600;
export const CODE_TTL_S = 60;
export const CONSENT_TTL_S = 10 * 60;
