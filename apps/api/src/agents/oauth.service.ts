import { randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { sql } from "kysely";
import { AuditService } from "../audit/audit.service";
import { APP_CONFIG } from "../config/config.module";
import type { AppConfig } from "../config/env";
import { DATABASE, type Database, type InstanceRole } from "../db/database";
import {
  ACCESS_TTL_S,
  CODE_TTL_S,
  CONSENT_TTL_S,
  mayUseAgents,
  newToken,
  parseScopes,
  pkceOk,
  REFRESH_IDLE_S,
  redirectMatches,
  type Scope,
  SCOPE_IDS,
  tokenHash,
  validRedirectUri,
} from "./oauth";

/** An OAuth error (RFC 6749 §5.2 / RFC 7591 §3.2.2) with its HTTP status. */
export class OAuthError extends Error {
  constructor(
    readonly error: string,
    readonly description: string,
    readonly status = 400,
  ) {
    super(description);
  }
}

/** Who is calling through an agent token. */
export interface AgentPrincipal {
  userId: string;
  role: InstanceRole;
  connectionId: string;
  /** Client name (OAuth) or token name (personal access token). */
  clientName: string;
  /** OAuth client id, or null for a personal access token. */
  clientId: string | null;
  scopes: Scope[];
}

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

/** Throttle for last-used updates. */
const TOUCH_MS = 60_000;

/**
 * The authorization server for agent connections (ADR-0035 §2): Dynamic Client Registration, consent,
 * authorization codes with PKCE and resource indicators, rotating refresh tokens, revocation, personal access
 * tokens, and bearer token resolution for `/mcp`. The effective rights are always the token's scopes capped by
 * the user's current role: a user demoted to Viewer or suspended loses every agent on the next call.
 */
@Injectable()
export class OAuthService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly audit: AuditService,
  ) {}

  /** Purpose: base URL ending in "/" for endpoint URLs. */
  private base(): URL {
    const u = new URL(this.config.publicUrl.href);
    if (!u.pathname.endsWith("/")) u.pathname += "/";
    return u;
  }

  /** Purpose: the MCP endpoint URL, which is also the protected resource identifier (RFC 8707, RFC 9728). */
  resource(): string {
    return new URL("mcp", this.base()).href;
  }

  /** Purpose: issuer identifier of the authorization server (RFC 8414). */
  issuer(): string {
    return this.base().href.replace(/\/$/, "");
  }

  /** Purpose: Protected Resource Metadata (RFC 9728) for `/mcp`. */
  async resourceMetadata() {
    const inst = await this.db.selectFrom("iam.instance").select("name").executeTakeFirstOrThrow();
    return {
      resource: this.resource(),
      authorization_servers: [this.issuer()],
      scopes_supported: SCOPE_IDS,
      bearer_methods_supported: ["header"],
      resource_name: `${inst.name} (MobSimLab)`,
      resource_documentation: "https://github.com/homlo-bike/MobSimLab/blob/main/docs/user/ai-agents.md",
    };
  }

  /** Purpose: Authorization Server Metadata (RFC 8414). */
  async serverMetadata() {
    const reg = await this.registrationOpen();
    const u = (p: string) => new URL(p, this.base()).href;
    return {
      issuer: this.issuer(),
      authorization_endpoint: u("oauth/authorize"),
      token_endpoint: u("oauth/token"),
      revocation_endpoint: u("oauth/revoke"),
      ...(reg ? { registration_endpoint: u("oauth/register") } : {}),
      scopes_supported: SCOPE_IDS,
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none"],
      revocation_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
      authorization_response_iss_parameter_supported: true,
    };
  }

  private async registrationOpen(): Promise<boolean> {
    const i = await this.db.selectFrom("iam.instance").select("agent_registration").executeTakeFirstOrThrow();
    return i.agent_registration;
  }

  /**
   * Purpose: Dynamic Client Registration (RFC 7591) of a public client.
   * Output: the client information response. Throws OAuthError when switched off or the metadata is invalid.
   */
  async register(body: Record<string, unknown>) {
    if (!(await this.registrationOpen()))
      throw new OAuthError(
        "access_denied",
        "Client registration is switched off on this instance; ask an administrator",
        403,
      );
    const uris = body.redirect_uris;
    if (
      !Array.isArray(uris) ||
      uris.length === 0 ||
      uris.length > 10 ||
      !uris.every((u) => typeof u === "string")
    )
      throw new OAuthError("invalid_redirect_uri", "redirect_uris must list 1 to 10 URIs");
    for (const u of uris as string[])
      if (!validRedirectUri(u) || u.length > 2000)
        throw new OAuthError("invalid_redirect_uri", `redirect URI not allowed: ${u.slice(0, 200)}`);
    const method = body.token_endpoint_auth_method ?? "none";
    if (method !== "none")
      throw new OAuthError(
        "invalid_client_metadata",
        "only public clients (token_endpoint_auth_method none)",
      );
    const grants = (body.grant_types as unknown[] | undefined) ?? ["authorization_code", "refresh_token"];
    if (!Array.isArray(grants) || grants.some((g) => g !== "authorization_code" && g !== "refresh_token"))
      throw new OAuthError(
        "invalid_client_metadata",
        "grant_types may only be authorization_code and refresh_token",
      );
    const rawName = typeof body.client_name === "string" ? body.client_name.trim() : "";
    const name = (rawName || "Unnamed agent").slice(0, 200);
    const clientUri =
      typeof body.client_uri === "string" && /^https:\/\//.test(body.client_uri) ? body.client_uri : null;
    const id = `msl_client_${randomBytes(18).toString("base64url")}`;
    const now = new Date();
    await this.db
      .insertInto("agent.client")
      .values({ id, name, redirect_uris: uris as string[], client_uri: clientUri, registered_by: "dynamic" })
      .execute();
    return {
      client_id: id,
      client_id_issued_at: Math.floor(now.getTime() / 1000),
      client_name: name,
      client_uri: clientUri ?? undefined,
      redirect_uris: uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  /**
   * Purpose: validate an authorization request (OAuth 2.1 §4.1.1) and park it for the user's consent.
   * Output: `{ consent }` with the consent request id, or `{ redirect }` for an error the client should see.
   * Throws OAuthError (shown to the user, never redirected) when the client or redirect URI is unknown.
   */
  async authorize(q: Record<string, unknown>): Promise<{ consent: string } | { redirect: string }> {
    const str = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : undefined);
    const clientId = str("client_id");
    const redirectUri = str("redirect_uri");
    const client = clientId
      ? await this.db.selectFrom("agent.client").selectAll().where("id", "=", clientId).executeTakeFirst()
      : undefined;
    if (!client) throw new OAuthError("invalid_client", "Unknown client. Ask the app to register again.");
    const registered = client.redirect_uris.find((r) => redirectUri && redirectMatches(r, redirectUri));
    if (!redirectUri || !registered)
      throw new OAuthError("invalid_request", "The redirect URI is not registered for this client.");
    const state = str("state");
    const fail = (error: string, description: string) => {
      const u = new URL(redirectUri);
      u.searchParams.set("error", error);
      u.searchParams.set("error_description", description);
      if (state) u.searchParams.set("state", state);
      u.searchParams.set("iss", this.issuer());
      return { redirect: u.href };
    };
    if (str("response_type") !== "code")
      return fail("unsupported_response_type", "response_type must be code");
    const challenge = str("code_challenge");
    if (!challenge || str("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(challenge))
      return fail("invalid_request", "PKCE with code_challenge_method S256 is required");
    const resource = str("resource") ?? this.resource();
    if (!this.isOurResource(resource)) return fail("invalid_target", `resource must be ${this.resource()}`);
    const scopes = parseScopes(str("scope"));
    if (!scopes) return fail("invalid_scope", `known scopes: ${SCOPE_IDS.join(" ")}`);
    const id = newToken("request");
    await this.db.deleteFrom("agent.consent_request").where("expires_at", "<", new Date()).execute();
    await this.db
      .insertInto("agent.consent_request")
      .values({
        id_hash: tokenHash(id),
        client_id: client.id,
        redirect_uri: redirectUri,
        scopes,
        code_challenge: challenge,
        state: state ?? null,
        resource: this.resource(),
        expires_at: new Date(Date.now() + CONSENT_TTL_S * 1000),
      })
      .execute();
    return { consent: id };
  }

  /** Purpose: whether a resource indicator names this instance's MCP endpoint (with or without a slash). */
  private isOurResource(r: string): boolean {
    const want = this.resource();
    return r === want || r === `${want}/` || r === this.issuer() || r === `${this.issuer()}/`;
  }

  /** Purpose: what the consent screen shows. Null when the request is unknown or expired. */
  async consentDetails(id: string) {
    const r = await this.db
      .selectFrom("agent.consent_request as r")
      .innerJoin("agent.client as c", "c.id", "r.client_id")
      .select(["c.name", "c.client_uri", "c.registered_by", "r.redirect_uri", "r.scopes", "r.expires_at"])
      .where("r.id_hash", "=", tokenHash(id))
      .executeTakeFirst();
    if (!r || r.expires_at < new Date()) return null;
    return {
      client: {
        name: r.name,
        uri: r.client_uri,
        redirectHost: new URL(r.redirect_uri).host,
        verified: r.registered_by === "admin",
      },
      scopes: r.scopes as Scope[],
      expiresAt: r.expires_at.toISOString(),
    };
  }

  /**
   * Purpose: the user's answer on the consent screen. Approval creates (or updates) the connection and an
   * authorization code; both answers end the request.
   * Inputs: request id, the user, approve or not, the scopes the user kept (a subset of those asked).
   * Output: the URL to send the browser back to the client. Side effects: audit record on approval.
   */
  async decide(
    id: string,
    user: {
      userId: string;
      role: InstanceRole;
      status: string;
      ipHash: string | null;
      requestId: string | null;
    },
    approve: boolean,
    keep?: string[],
  ): Promise<string> {
    const r = await this.db
      .deleteFrom("agent.consent_request")
      .where("id_hash", "=", tokenHash(id))
      .returningAll()
      .executeTakeFirst();
    if (!r || r.expires_at < new Date())
      throw new OAuthError(
        "invalid_request",
        "This connection request has expired. Start again in your app.",
        404,
      );
    const back = new URL(r.redirect_uri);
    if (r.state) back.searchParams.set("state", r.state);
    back.searchParams.set("iss", this.issuer());
    if (!approve) {
      back.searchParams.set("error", "access_denied");
      back.searchParams.set("error_description", "The user declined");
      return back.href;
    }
    if (!mayUseAgents(user.role, user.status))
      throw new OAuthError("access_denied", "Only Editors and above can connect AI agents.", 403);
    const scopes = (keep ?? r.scopes).filter((s): s is Scope => r.scopes.includes(s));
    if (scopes.length === 0) throw new OAuthError("invalid_scope", "Keep at least one permission.");
    const client = await this.db
      .selectFrom("agent.client")
      .select(["id", "name"])
      .where("id", "=", r.client_id)
      .executeTakeFirstOrThrow();
    const code = newToken("code");
    await this.db.transaction().execute(async (tx) => {
      const existing = await tx
        .selectFrom("agent.connection")
        .select("id")
        .where("user_id", "=", user.userId)
        .where("client_id", "=", client.id)
        .where("revoked_at", "is", null)
        .executeTakeFirst();
      const connectionId = existing
        ? (
            await tx
              .updateTable("agent.connection")
              .set({ scopes })
              .where("id", "=", existing.id)
              .returning("id")
              .executeTakeFirstOrThrow()
          ).id
        : (
            await tx
              .insertInto("agent.connection")
              .values({
                user_id: user.userId,
                client_id: client.id,
                kind: "oauth",
                name: client.name,
                scopes,
              })
              .returning("id")
              .executeTakeFirstOrThrow()
          ).id;
      await tx
        .insertInto("agent.token")
        .values({
          token_hash: tokenHash(code),
          connection_id: connectionId,
          kind: "code",
          redirect_uri: r.redirect_uri,
          code_challenge: r.code_challenge,
          resource: r.resource,
          expires_at: new Date(Date.now() + CODE_TTL_S * 1000),
          used_at: null,
        })
        .execute();
      await this.audit.append(
        {
          action: "agent.connected",
          objectType: "agent_connection",
          objectId: connectionId,
          actorId: user.userId,
          actorIpHash: user.ipHash,
          requestId: user.requestId,
          after: { client: client.name, client_id: client.id, scopes },
        },
        tx,
      );
    });
    back.searchParams.set("code", code);
    return back.href;
  }

  /**
   * Purpose: the token endpoint (OAuth 2.1 §3.2): authorization code with PKCE, or refresh token rotation.
   * A reused code or refresh token revokes the whole connection (token theft detection, OAuth 2.1 §4.3.1).
   */
  async token(body: Record<string, unknown>): Promise<TokenResponse> {
    const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : undefined);
    const grant = str("grant_type");
    const clientId = str("client_id");
    if (!clientId) throw new OAuthError("invalid_client", "client_id is required", 401);
    if (grant === "authorization_code") {
      const code = str("code");
      const verifier = str("code_verifier");
      if (!code || !verifier) throw new OAuthError("invalid_request", "code and code_verifier are required");
      const row = await this.tokenRow(code, "code");
      if (!row || row.client_id !== clientId) throw new OAuthError("invalid_grant", "unknown code");
      if (row.used_at) {
        await this.revokeConnection(row.connection_id);
        throw new OAuthError("invalid_grant", "code already used; the connection was revoked");
      }
      if (row.expires_at < new Date()) throw new OAuthError("invalid_grant", "code expired");
      const redirect = str("redirect_uri");
      if (!redirect || !row.redirect_uri || !redirectMatches(row.redirect_uri, redirect))
        throw new OAuthError("invalid_grant", "redirect_uri does not match");
      if (!pkceOk(verifier, row.code_challenge ?? ""))
        throw new OAuthError("invalid_grant", "PKCE verification failed");
      const resource = str("resource");
      if (resource && !this.isOurResource(resource))
        throw new OAuthError("invalid_target", "unknown resource");
      await this.markUsed(code);
      return this.issue(row.connection_id);
    }
    if (grant === "refresh_token") {
      const rt = str("refresh_token");
      if (!rt) throw new OAuthError("invalid_request", "refresh_token is required");
      const row = await this.tokenRow(rt, "refresh");
      if (!row || row.client_id !== clientId) throw new OAuthError("invalid_grant", "unknown refresh token");
      if (row.used_at) {
        await this.revokeConnection(row.connection_id);
        throw new OAuthError("invalid_grant", "refresh token already used; the connection was revoked");
      }
      if (row.expires_at < new Date()) throw new OAuthError("invalid_grant", "refresh token expired");
      const narrow = parseScopes(str("scope") ?? null);
      await this.markUsed(rt);
      return this.issue(row.connection_id, str("scope") ? (narrow ?? undefined) : undefined);
    }
    throw new OAuthError("unsupported_grant_type", "grant_type must be authorization_code or refresh_token");
  }

  private async tokenRow(t: string, kind: "code" | "refresh") {
    return this.db
      .selectFrom("agent.token as t")
      .innerJoin("agent.connection as c", "c.id", "t.connection_id")
      .select([
        "t.connection_id",
        "t.used_at",
        "t.expires_at",
        "t.redirect_uri",
        "t.code_challenge",
        "c.client_id",
      ])
      .where("t.token_hash", "=", tokenHash(t))
      .where("t.kind", "=", kind)
      .where("c.revoked_at", "is", null)
      .executeTakeFirst();
  }

  private async markUsed(t: string): Promise<void> {
    await this.db
      .updateTable("agent.token")
      .set({ used_at: new Date() })
      .where("token_hash", "=", tokenHash(t))
      .execute();
  }

  /** Purpose: a new access and refresh token for a connection whose user may still use agents. */
  private async issue(connectionId: string, narrow?: Scope[]): Promise<TokenResponse> {
    const c = await this.db
      .selectFrom("agent.connection as c")
      .innerJoin("iam.user as u", "u.id", "c.user_id")
      .select(["c.scopes", "u.instance_role", "u.status"])
      .where("c.id", "=", connectionId)
      .where("c.revoked_at", "is", null)
      .executeTakeFirst();
    if (!c || !mayUseAgents(c.instance_role, c.status))
      throw new OAuthError("invalid_grant", "the user can no longer connect agents");
    if (narrow) {
      const scopes = c.scopes.filter((s) => narrow.includes(s as Scope));
      await this.db.updateTable("agent.connection").set({ scopes }).where("id", "=", connectionId).execute();
      c.scopes = scopes;
    }
    const access = newToken("access");
    const refresh = newToken("refresh");
    const now = Date.now();
    await this.db
      .insertInto("agent.token")
      .values([
        {
          token_hash: tokenHash(access),
          connection_id: connectionId,
          kind: "access",
          redirect_uri: null,
          code_challenge: null,
          resource: this.resource(),
          expires_at: new Date(now + ACCESS_TTL_S * 1000),
          used_at: null,
        },
        {
          token_hash: tokenHash(refresh),
          connection_id: connectionId,
          kind: "refresh",
          redirect_uri: null,
          code_challenge: null,
          resource: this.resource(),
          expires_at: new Date(now + REFRESH_IDLE_S * 1000),
          used_at: null,
        },
      ])
      .execute();
    // Housekeeping: drop expired tokens. Used codes and refresh tokens stay until they expire, so a replay
    // is recognised and revokes the connection.
    await this.db
      .deleteFrom("agent.token")
      .where("connection_id", "=", connectionId)
      .where("expires_at", "<", new Date(now))
      .execute();
    return {
      access_token: access,
      token_type: "Bearer",
      expires_in: ACCESS_TTL_S,
      refresh_token: refresh,
      scope: c.scopes.join(" "),
    };
  }

  /** Purpose: token revocation (RFC 7009). Unknown tokens are not an error. Refresh tokens end the connection. */
  async revokeToken(token: string): Promise<void> {
    const row = await this.db
      .selectFrom("agent.token")
      .select(["connection_id", "kind"])
      .where("token_hash", "=", tokenHash(token))
      .executeTakeFirst();
    if (!row) return;
    if (row.kind === "refresh" || row.kind === "pat") await this.revokeConnection(row.connection_id);
    else await this.db.deleteFrom("agent.token").where("token_hash", "=", tokenHash(token)).execute();
  }

  /** Purpose: end a connection and delete its tokens. */
  async revokeConnection(connectionId: string): Promise<void> {
    await this.db.transaction().execute(async (tx) => {
      await tx
        .updateTable("agent.connection")
        .set({ revoked_at: new Date() })
        .where("id", "=", connectionId)
        .where("revoked_at", "is", null)
        .execute();
      await tx.deleteFrom("agent.token").where("connection_id", "=", connectionId).execute();
    });
  }

  /**
   * Purpose: create a personal access token for headless use (CI, scripts).
   * Output: the token, shown once. Side effects: connection, token and audit record.
   */
  async createPat(
    user: { userId: string; ipHash: string | null; requestId: string | null },
    name: string,
    scopes: Scope[],
    expiresInDays: number,
  ): Promise<{ id: string; token: string; expiresAt: string }> {
    const token = newToken("pat");
    const expires = new Date(Date.now() + expiresInDays * 86_400_000);
    const id = await this.db.transaction().execute(async (tx) => {
      const c = await tx
        .insertInto("agent.connection")
        .values({ user_id: user.userId, client_id: null, kind: "pat", name, scopes, expires_at: expires })
        .returning("id")
        .executeTakeFirstOrThrow();
      await tx
        .insertInto("agent.token")
        .values({
          token_hash: tokenHash(token),
          connection_id: c.id,
          kind: "pat",
          redirect_uri: null,
          code_challenge: null,
          resource: this.resource(),
          expires_at: expires,
          used_at: null,
        })
        .execute();
      await this.audit.append(
        {
          action: "agent.token_created",
          objectType: "agent_connection",
          objectId: c.id,
          actorId: user.userId,
          actorIpHash: user.ipHash,
          requestId: user.requestId,
          after: { name, scopes, expires_at: expires.toISOString() },
        },
        tx,
      );
      return c.id;
    });
    return { id, token, expiresAt: expires.toISOString() };
  }

  /**
   * Purpose: resolve the bearer token of an `/mcp` call.
   * Output: the principal, or null when the token is unknown, expired, revoked, or its user may no longer use
   * agents. Side effects: records last use (at most once a minute).
   */
  async resolve(token: string): Promise<AgentPrincipal | null> {
    const now = new Date();
    const row = await this.db
      .selectFrom("agent.token as t")
      .innerJoin("agent.connection as c", "c.id", "t.connection_id")
      .innerJoin("iam.user as u", "u.id", "c.user_id")
      .leftJoin("agent.client as k", "k.id", "c.client_id")
      .select([
        "c.id",
        "c.user_id",
        "c.name",
        "c.client_id",
        "c.scopes",
        "c.last_used_at",
        "c.expires_at as c_exp",
      ])
      .select(["t.expires_at", "u.instance_role", "u.status", "k.name as client_name"])
      .where("t.token_hash", "=", tokenHash(token))
      .where("t.kind", "in", ["access", "pat"])
      .where("c.revoked_at", "is", null)
      .executeTakeFirst();
    if (!row || row.expires_at <= now || (row.c_exp && row.c_exp <= now)) return null;
    if (!mayUseAgents(row.instance_role, row.status)) return null;
    if (!row.last_used_at || now.getTime() - row.last_used_at.getTime() > TOUCH_MS) {
      await this.db
        .updateTable("agent.connection")
        .set({ last_used_at: now })
        .where("id", "=", row.id)
        .execute();
      if (row.client_id)
        await this.db
          .updateTable("agent.client")
          .set({ last_used_at: now })
          .where("id", "=", row.client_id)
          .execute();
    }
    return {
      userId: row.user_id,
      role: row.instance_role,
      connectionId: row.id,
      clientName: row.client_name ?? row.name,
      clientId: row.client_id,
      scopes: row.scopes.filter((s): s is Scope => SCOPE_IDS.includes(s as Scope)),
    };
  }

  /** Purpose: the user's connections with recent agent actions, for the Connected agents page. */
  async connections(userId: string) {
    const rows = await this.db
      .selectFrom("agent.connection as c")
      .leftJoin("agent.client as k", "k.id", "c.client_id")
      .select([
        "c.id",
        "c.kind",
        "c.name",
        "c.scopes",
        "c.created_at",
        "c.last_used_at",
        "c.expires_at",
        "k.client_uri",
      ])
      .where("c.user_id", "=", userId)
      .where("c.revoked_at", "is", null)
      .where((eb) => eb.or([eb("c.expires_at", "is", null), eb("c.expires_at", ">", new Date())]))
      .orderBy("c.created_at", "desc")
      .execute();
    const { rows: actions } = await sql<{
      at: Date;
      action: string;
      object_id: string | null;
      after: unknown;
    }>`
      SELECT at, action, object_id, after FROM audit.record
      WHERE actor_id = ${userId}::uuid AND action LIKE 'agent.%' ORDER BY id DESC LIMIT 50`.execute(this.db);
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      name: r.name,
      clientUri: r.client_uri,
      scopes: r.scopes,
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
      expiresAt: r.expires_at,
      recentActions: actions
        .filter(
          (a) => (a.after as { connection?: string } | null)?.connection === r.id || a.object_id === r.id,
        )
        .slice(0, 5)
        .map((a) => ({
          at: a.at,
          action: a.action,
          tool: (a.after as { tool?: string } | null)?.tool ?? null,
        })),
    }));
  }

  /** Purpose: revoke one of the user's own connections. Output: false when not found. */
  async revokeOwn(
    userId: string,
    connectionId: string,
    meta: { ipHash: string | null; requestId: string | null },
  ) {
    const c = await this.db
      .selectFrom("agent.connection")
      .select(["id", "name"])
      .where("id", "=", connectionId)
      .where("user_id", "=", userId)
      .where("revoked_at", "is", null)
      .executeTakeFirst();
    if (!c) return false;
    await this.revokeConnection(c.id);
    await this.audit.append({
      action: "agent.disconnected",
      objectType: "agent_connection",
      objectId: c.id,
      actorId: userId,
      actorIpHash: meta.ipHash,
      requestId: meta.requestId,
      before: { name: c.name },
    });
    return true;
  }

  /** Purpose: instance agent settings (Admins). */
  async settings() {
    return { dynamicRegistration: await this.registrationOpen() };
  }

  /** Purpose: switch Dynamic Client Registration on or off. Side effects: audit record. */
  async setRegistration(
    open: boolean,
    actor: { userId: string; ipHash: string | null; requestId: string | null },
  ) {
    await this.db.transaction().execute(async (tx) => {
      const before = await tx
        .selectFrom("iam.instance")
        .select("agent_registration")
        .forUpdate()
        .executeTakeFirstOrThrow();
      await tx
        .updateTable("iam.instance")
        .set({ agent_registration: open, updated_at: new Date() })
        .execute();
      await this.audit.append(
        {
          action: "instance.agent_registration_updated",
          objectType: "instance",
          actorId: actor.userId,
          actorIpHash: actor.ipHash,
          requestId: actor.requestId,
          before,
          after: { agent_registration: open },
        },
        tx,
      );
    });
  }
}
