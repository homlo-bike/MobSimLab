import { createHash } from "node:crypto";
import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Response } from "express";
import { APP_CONFIG } from "../config/config.module";
import type { AppConfig } from "../config/env";
import { DATABASE, type Database } from "../db/database";
import { AuditService } from "../audit/audit.service";
import { AuthRateLimit } from "../iam/rate-limit.service";
import { Public, Requires } from "../iam/requires";
import { AuthService } from "./auth.service";
import { OidcNotConfiguredError, OidcService } from "./oidc.service";
import { ABSOLUTE_MS, type MslRequest, SessionService } from "./session.service";

const FLOW_COOKIE = "msl_auth_flow";
const FLOW_MS = 10 * 60 * 1000;

/** Sign-in, sign-out and "who am I" (05 §3.1). */
@Controller("api/auth")
export class AuthController {
  private readonly log = new Logger(AuthController.name);

  constructor(
    private readonly oidc: OidcService,
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Purpose: current user, CSRF token and instance state for the web app.
   * Output: `{ instance, signInAvailable, user?, csrfToken? }`.
   */
  @Get("me")
  @Public()
  async me(@Req() req: MslRequest) {
    const inst = await this.db.selectFrom("iam.instance").select(["mode", "name"]).executeTakeFirstOrThrow();
    const s = req.session;
    return {
      instance: { mode: inst.mode, name: inst.name },
      signInAvailable: Boolean(this.config.oidc),
      user: s
        ? { id: s.actor.userId, role: s.actor.role, email: s.email, displayName: s.displayName }
        : undefined,
      csrfToken: s ? this.sessions.csrfToken(s.tokenHash) : undefined,
    };
  }

  /**
   * Purpose: start sign-in: store state, nonce and PKCE verifier, bind the state to this browser with a
   * short-lived cookie (prevents login CSRF), and redirect to the provider.
   */
  @Get("login")
  @Public()
  @AuthRateLimit()
  async login(@Res() res: Response): Promise<void> {
    let r;
    try {
      r = await this.oidc.begin();
    } catch (e) {
      if (e instanceof OidcNotConfiguredError)
        throw new ServiceUnavailableException("sign-in is not configured");
      this.log.error(`OIDC discovery failed: ${(e as Error).message}`);
      throw new ServiceUnavailableException("sign-in provider unavailable");
    }
    await this.db.deleteFrom("iam.auth_flow").where("expires_at", "<", new Date()).execute();
    await this.db
      .insertInto("iam.auth_flow")
      .values({
        state_hash: sha256(r.state),
        code_verifier: r.codeVerifier,
        nonce: r.nonce,
        return_to: "/",
        expires_at: new Date(Date.now() + FLOW_MS),
      })
      .execute();
    res.cookie(FLOW_COOKIE, r.state, { ...this.sessions.cookieOptions(FLOW_MS), path: "/api/auth" });
    res.redirect(302, r.url.href);
  }

  /**
   * Purpose: provider callback. Validates state (single use, bound to the browser), exchanges the code,
   * applies the sign-in rules and starts a session.
   * Output: redirect to `/`, or to `/?signin=<reason>` when refused.
   */
  @Get("callback")
  @Public()
  @AuthRateLimit()
  async callback(@Req() req: MslRequest, @Res() res: Response): Promise<void> {
    const fail = (reason: string) => res.redirect(302, `/?signin=${encodeURIComponent(reason)}`);
    res.clearCookie(FLOW_COOKIE, { ...this.sessions.cookieOptions(), path: "/api/auth" });
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const cookieState = (req.cookies as Record<string, string> | undefined)?.[FLOW_COOKIE];
    if (!state || state !== cookieState) return fail("invalid_request");
    const flow = await this.db
      .deleteFrom("iam.auth_flow")
      .where("state_hash", "=", sha256(state))
      .returningAll()
      .executeTakeFirst();
    if (!flow || flow.expires_at < new Date()) return fail("expired");

    const query = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
    let identity;
    try {
      identity = await this.oidc.complete(new URL(`/api/auth/callback${query}`, this.config.publicUrl), {
        state,
        nonce: flow.nonce,
        codeVerifier: flow.code_verifier,
      });
    } catch (e) {
      this.log.warn(`sign-in failed: ${(e as Error).message}`);
      return fail("provider_error");
    }
    const meta = { ipHash: this.sessions.ipHash(req.ip), requestId: req.requestId ?? null };
    const outcome = await this.auth.signIn(identity, meta);
    if (!outcome.ok) return fail(outcome.reason);
    if (req.session) await this.sessions.revoke(req.session.tokenHash);
    const token = await this.sessions.create(outcome.userId);
    res.cookie(this.sessions.cookieName, token, this.sessions.cookieOptions(ABSOLUTE_MS));
    res.redirect(302, flow.return_to);
  }

  /**
   * Purpose: sign out. Revokes the session server-side and returns the provider's end-session URL, if any,
   * for the browser to visit.
   */
  @Post("logout")
  @HttpCode(200)
  @Requires("session.own")
  async logout(@Req() req: MslRequest, @Res({ passthrough: true }) res: Response) {
    const s = req.session;
    if (s) {
      await this.sessions.revoke(s.tokenHash);
      await this.audit.append({
        action: "auth.logout",
        objectType: "user",
        objectId: s.actor.userId,
        actorId: s.actor.userId,
        actorIpHash: this.sessions.ipHash(req.ip),
        requestId: req.requestId,
      });
    }
    res.clearCookie(this.sessions.cookieName, this.sessions.cookieOptions());
    const endSessionUrl = await this.oidc.endSessionUrl().catch(() => null);
    return { endSessionUrl };
  }
}

function sha256(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}
