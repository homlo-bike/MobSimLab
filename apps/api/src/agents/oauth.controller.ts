import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpException,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { type MslRequest, SessionService } from "../auth/session.service";
import { AuthRateLimit } from "../iam/rate-limit.service";
import { CrossOrigin, Public, Requires } from "../iam/requires";
import { OAuthError, OAuthService } from "./oauth.service";
import { SCOPE_IDS, SCOPES } from "./oauth";

/**
 * OAuth 2.1 authorization server and protected-resource metadata for agent connections (ADR-0035 §2), as the
 * MCP authorization specification requires: RFC 9728, RFC 8414, RFC 7591, PKCE (RFC 7636), resource
 * indicators (RFC 8707) and revocation (RFC 7009). People sign in through the instance's OIDC provider and
 * consent in the web app at `/agents/consent`.
 */
@Controller()
export class OAuthController {
  constructor(
    private readonly oauth: OAuthService,
    private readonly sessions: SessionService,
  ) {}

  /** Purpose: Protected Resource Metadata for `/mcp` (RFC 9728), at both well-known locations. */
  @Get([".well-known/oauth-protected-resource", ".well-known/oauth-protected-resource/mcp"])
  @Public()
  @CrossOrigin()
  @Header("Cache-Control", "public, max-age=300")
  resourceMetadata() {
    return this.oauth.resourceMetadata();
  }

  /** Purpose: Authorization Server Metadata (RFC 8414). */
  @Get([".well-known/oauth-authorization-server", ".well-known/oauth-authorization-server/mcp"])
  @Public()
  @CrossOrigin()
  @Header("Cache-Control", "public, max-age=300")
  serverMetadata() {
    return this.oauth.serverMetadata();
  }

  /** Purpose: Dynamic Client Registration (RFC 7591). Rate limited per client address. */
  @Post("oauth/register")
  @Public()
  @CrossOrigin()
  @AuthRateLimit()
  @HttpCode(201)
  @Header("Cache-Control", "no-store")
  async register(@Body() body: unknown) {
    return this.oauthCall(() => this.oauth.register(asRecord(body)));
  }

  /**
   * Purpose: authorization endpoint. Validates the request and sends the browser to the consent page (which
   * asks the person to sign in first when needed). Unknown clients and redirect URIs are shown, never redirected.
   */
  @Get("oauth/authorize")
  @Public()
  @AuthRateLimit()
  async authorize(@Query() q: Record<string, unknown>, @Res() res: Response): Promise<void> {
    try {
      const r = await this.oauth.authorize(q);
      if ("redirect" in r) return res.redirect(302, r.redirect);
      res.redirect(302, `/agents/consent?request=${encodeURIComponent(r.consent)}`);
    } catch (e) {
      if (!(e instanceof OAuthError)) throw e;
      res.status(400).type("text/plain").send(`MobSimLab could not start the connection: ${e.description}`);
    }
  }

  /** Purpose: token endpoint (form or JSON body). */
  @Post("oauth/token")
  @Public()
  @CrossOrigin()
  @AuthRateLimit()
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @Header("Pragma", "no-cache")
  async token(@Body() body: unknown) {
    return this.oauthCall(() => this.oauth.token(asRecord(body)));
  }

  /** Purpose: token revocation (RFC 7009). Always 200. */
  @Post("oauth/revoke")
  @Public()
  @CrossOrigin()
  @AuthRateLimit()
  @HttpCode(200)
  async revoke(@Body() body: unknown) {
    const t = asRecord(body).token;
    if (typeof t === "string") await this.oauth.revokeToken(t);
    return {};
  }

  /** Purpose: what the consent page shows: client, requested permissions, and whether this user may consent. */
  @Get("api/agents/consent/:id")
  @Requires("session.own")
  async consent(@Param("id") id: string, @Req() req: MslRequest) {
    const d = await this.oauth.consentDetails(id);
    if (!d) throw new HttpException("This connection request has expired. Start again in your app.", 404);
    const role = req.session!.actor.role;
    return {
      ...d,
      scopes: d.scopes.map((s) => ({ id: s, label: SCOPES[s] })),
      allowed: ["owner", "admin", "user"].includes(role),
      reason: ["owner", "admin", "user"].includes(role)
        ? null
        : "Only Editors and above can connect AI agents. Ask an administrator for the Editor role.",
    };
  }

  /** Purpose: the person's answer. Body `{ approve, scopes? }`. Output: `{ redirect }` back to the client. */
  @Post("api/agents/consent/:id")
  @Requires("session.own")
  @HttpCode(200)
  async decide(@Param("id") id: string, @Body() body: unknown, @Req() req: MslRequest) {
    const b = z
      .object({
        approve: z.boolean(),
        scopes: z.array(z.enum(SCOPE_IDS as [string, ...string[]])).optional(),
      })
      .safeParse(body);
    if (!b.success) throw new HttpException("approve (boolean) is required", 400);
    const s = req.session!;
    return this.oauthCall(async () => ({
      redirect: await this.oauth.decide(
        id,
        {
          userId: s.actor.userId,
          role: s.actor.role,
          status: s.actor.status,
          ipHash: this.sessions.ipHash(req.ip),
          requestId: req.requestId ?? null,
        },
        b.data.approve,
        b.data.scopes,
      ),
    }));
  }

  private async oauthCall<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof OAuthError)
        throw new HttpException(
          { error: e.error, error_description: e.description, message: e.description },
          e.status,
        );
      throw e;
    }
  }
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
