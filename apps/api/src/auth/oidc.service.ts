import { Inject, Injectable } from "@nestjs/common";
import * as oidc from "openid-client";
import { APP_CONFIG } from "../config/config.module";
import type { AppConfig, OidcConfig } from "../config/env";

/** Verified identity claims from an ID token. */
export interface OidcIdentity {
  issuer: string;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  groups: string[];
  /** The raw ID token, kept with the session only to send as `id_token_hint` at sign-out. */
  idToken?: string;
}

/** Values to keep between the redirect to the provider and the callback. */
export interface AuthRequest {
  url: URL;
  state: string;
  nonce: string;
  codeVerifier: string;
}

/**
 * Purpose: a log line for a failed sign-in step that names the provider's own answer. `openid-client` reports an
 * OAuth error body only as "server responded with an error in the response body"; the useful part
 * (`error` / `error_description`, for example `invalid_client`) is on the error object. Never includes tokens.
 */
export function describeOidcError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const x = e as Error & { error?: unknown; error_description?: unknown; status?: unknown; code?: unknown };
  const parts: string[] = [];
  if (typeof x.error === "string") parts.push(`error=${x.error}`);
  if (typeof x.error_description === "string")
    parts.push(`error_description=${x.error_description.slice(0, 300)}`);
  if (typeof x.status === "number") parts.push(`status=${x.status}`);
  if (parts.length === 0 && typeof x.code === "string") parts.push(`code=${x.code}`);
  return parts.length > 0 ? `${e.message} (${parts.join(", ")})` : e.message;
}

/** Thrown when sign-in is not configured. */
export class OidcNotConfiguredError extends Error {}

/**
 * OIDC Authorization Code flow with PKCE, state and nonce (05 §3.1), using `openid-client`, which validates
 * the ID token signature, `iss`, `aud`, `exp`, `iat` and `nonce`.
 */
@Injectable()
export class OidcService {
  private configuration?: Promise<oidc.Configuration>;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** Redirect URI registered with the provider. */
  get redirectUri(): string {
    return new URL("/api/auth/callback", this.config.publicUrl).href;
  }

  private provider(): OidcConfig {
    if (!this.config.oidc) throw new OidcNotConfiguredError("no sign-in provider is configured");
    return this.config.oidc;
  }

  /** Purpose: discover provider metadata once (retried on the next call if it failed). */
  private discover(): Promise<oidc.Configuration> {
    const p = this.provider();
    if (!this.configuration) {
      this.configuration = oidc
        .discovery(
          p.issuer,
          p.clientId,
          undefined,
          p.clientSecret ? oidc.ClientSecretBasic(p.clientSecret) : oidc.None(),
          p.allowInsecureHttp ? { execute: [oidc.allowInsecureRequests] } : undefined,
        )
        .catch((e: unknown) => {
          this.configuration = undefined;
          throw e;
        });
    }
    return this.configuration;
  }

  /** Purpose: build the authorisation URL with fresh state, nonce and PKCE verifier. */
  async begin(): Promise<AuthRequest> {
    const cfg = await this.discover();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const url = oidc.buildAuthorizationUrl(cfg, {
      redirect_uri: this.redirectUri,
      scope: "openid email profile",
      code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: "S256",
      state,
      nonce,
    });
    return { url, state, nonce, codeVerifier };
  }

  /**
   * Purpose: exchange the code and validate the ID token.
   * Inputs: the callback URL as received (rebuilt on the public URL) and the stored checks.
   * Output: verified identity. Throws on any validation failure.
   */
  async complete(
    callbackUrl: URL,
    checks: { state: string; nonce: string; codeVerifier: string },
  ): Promise<OidcIdentity> {
    const cfg = await this.discover();
    const tokens = await oidc.authorizationCodeGrant(cfg, callbackUrl, {
      pkceCodeVerifier: checks.codeVerifier,
      expectedState: checks.state,
      expectedNonce: checks.nonce,
      idTokenExpected: true,
    });
    const c = tokens.claims();
    if (!c) throw new Error("no ID token");
    const groups = Array.isArray(c.groups) ? c.groups.filter((g): g is string => typeof g === "string") : [];
    return {
      issuer: c.iss,
      subject: c.sub,
      email: typeof c.email === "string" ? c.email.toLowerCase() : null,
      emailVerified: c.email_verified === true,
      name: typeof c.name === "string" ? c.name : null,
      groups,
      idToken: tokens.id_token,
    };
  }

  /**
   * Purpose: the provider's end-session URL, if it has one (05 §3.1 logout).
   * Inputs: the session's ID token, if kept. Providers such as Authentik only send the browser back to
   * `post_logout_redirect_uri` when `id_token_hint` names the session; `client_id` is added for the others.
   */
  async endSessionUrl(idTokenHint?: string | null): Promise<string | null> {
    if (!this.config.oidc) return null;
    const cfg = await this.discover();
    if (!cfg.serverMetadata().end_session_endpoint) return null;
    const params: Record<string, string> = {
      post_logout_redirect_uri: new URL("/", this.config.publicUrl).href,
      client_id: this.config.oidc.clientId,
    };
    if (idTokenHint) params.id_token_hint = idTokenHint;
    return oidc.buildEndSessionUrl(cfg, params).href;
  }
}
