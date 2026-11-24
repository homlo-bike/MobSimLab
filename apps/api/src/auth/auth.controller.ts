import { createHash, timingSafeEqual } from "node:crypto";
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  NotFoundException,
  Post,
  Put,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import { APP_CONFIG } from "../config/config.module";
import type { AppConfig } from "../config/env";
import { sql } from "kysely";
import { DATABASE, type Database } from "../db/database";
import { AuditService } from "../audit/audit.service";
import { AuthRateLimit } from "../iam/rate-limit.service";
import { Public, Requires } from "../iam/requires";
import { AuthService } from "./auth.service";
import { describeOidcError, OidcNotConfiguredError, OidcService } from "./oidc.service";
import { ABSOLUTE_MS, type MslRequest, SessionService } from "./session.service";

/** The project layers a person can keep shown on every map tab (web `PINNED_LAYERS`). */
export const PINNED_LAYERS = [
  "serviceLines",
  "tracks",
  "stations",
  "stops",
  "streetSetups",
  "regions",
] as const;

/**
 * Per-user preferences that follow the person to other devices. `language` is "system" (follow the browser)
 * or a BCP 47 tag; numbers, dates and units follow the language unless `units` is set.
 */
export const preferencesBody = z.strictObject({
  language: z
    .string()
    .regex(/^(system|[a-z]{2,3}(-[A-Za-z0-9]{2,8})*)$/, "not a language tag")
    .optional(),
  units: z.enum(["auto", "metric", "imperial"]).optional(),
  theme: z.enum(["auto", "light", "dark"]).optional(),
  mapStyle: z.string().max(60).optional(),
  largerTargets: z.boolean().optional(),
  reduceMotion: z.boolean().optional(),
  existingRailways: z.boolean().optional(),
  /** Per project (by id), the project layers the person keeps shown on every map tab. Sent whole when changed. */
  mapLayers: z
    .record(z.uuid(), z.array(z.enum(PINNED_LAYERS)).max(PINNED_LAYERS.length))
    .refine((r) => Object.keys(r).length <= 2000, "too many projects")
    .optional(),
});
export type Preferences = z.infer<typeof preferencesBody>;

/**
 * Each sign-in flow has its own cookie, named after its state, so a sign-in started in a second tab (while the
 * first waits at the provider for a password or consent) does not overwrite the first tab's flow.
 */
const FLOW_COOKIE = "msl_auth_flow";
export function flowCookieName(state: string): string {
  return `${FLOW_COOKIE}_${sha256(state).toString("base64url").slice(0, 16)}`;
}
const FLOW_MS = 10 * 60 * 1000;

/** Sign-in, sign-out and "who am I" (05 §3.1). */
@Controller("api/auth")
export class AuthController {
  private readonly log = new Logger(AuthController.name);
  /** Refused sign-ins (WARN, so they are also kept in the database for 30 days). */
  private readonly security = new Logger("security");

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
    const prefs = s
      ? await this.db
          .selectFrom("iam.user")
          .select("preferences")
          .where("id", "=", s.actor.userId)
          .executeTakeFirst()
      : undefined;
    return {
      instance: {
        mode: inst.mode,
        name: inst.name,
        // Desktop app on this computer: one local Owner, no sign-in or administration of other people.
        local: Boolean(this.config.localLaunchKey),
        agents: !this.config.agentsDisabled,
      },
      signInAvailable: Boolean(this.config.oidc),
      user: s
        ? {
            id: s.actor.userId,
            role: s.actor.role,
            email: s.email,
            displayName: s.displayName,
            preferences: preferencesBody.catch({}).parse(prefs?.preferences ?? {}),
          }
        : undefined,
      csrfToken: s ? this.sessions.csrfToken(s.tokenHash) : undefined,
    };
  }

  /**
   * Purpose: change one's own preferences (language, units, theme). Body: the fields to change; the rest stay.
   * Output: `{ preferences }`, the stored set.
   */
  @Put("preferences")
  @Requires("session.own")
  async setPreferences(@Body() body: unknown, @Req() req: MslRequest) {
    const s = req.session;
    const r = preferencesBody.safeParse(body ?? {});
    if (!r.success) throw new BadRequestException(r.error.issues.map((i) => i.message));
    if (!s) throw new BadRequestException();
    const row = await this.db
      .updateTable("iam.user")
      .set({ preferences: sql`preferences || ${JSON.stringify(r.data)}::jsonb` })
      .where("id", "=", s.actor.userId)
      .returning("preferences")
      .executeTakeFirstOrThrow();
    return { preferences: preferencesBody.catch({}).parse(row.preferences) };
  }

  /**
   * Purpose: start sign-in: store state, nonce and PKCE verifier, bind the state to this browser with a
   * short-lived cookie (prevents login CSRF), and redirect to the provider. `return_to` (a path on this
   * instance, for example the agent consent page) is where the browser lands afterwards.
   */
  @Get("login")
  @Public()
  @AuthRateLimit()
  async login(@Query("return_to") returnTo: unknown, @Res() res: Response): Promise<void> {
    let r;
    try {
      r = await this.oidc.begin();
    } catch (e) {
      if (e instanceof OidcNotConfiguredError)
        throw new ServiceUnavailableException("sign-in is not configured");
      this.log.error(`OIDC discovery failed: ${describeOidcError(e)}`);
      throw new ServiceUnavailableException("sign-in provider unavailable");
    }
    await this.db.deleteFrom("iam.auth_flow").where("expires_at", "<", new Date()).execute();
    await this.db
      .insertInto("iam.auth_flow")
      .values({
        state_hash: sha256(r.state),
        code_verifier: r.codeVerifier,
        nonce: r.nonce,
        return_to: safeReturnTo(returnTo),
        expires_at: new Date(Date.now() + FLOW_MS),
      })
      .execute();
    res.cookie(flowCookieName(r.state), r.state, {
      ...this.sessions.cookieOptions(FLOW_MS),
      path: "/api/auth",
    });
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
    const fail = (reason: string) => {
      this.security.warn(`sign-in refused: ${reason} (client ${this.sessions.ipHash(req.ip) ?? "unknown"})`);
      res.redirect(302, `/?signin=${encodeURIComponent(reason)}`);
    };
    const state = typeof req.query.state === "string" ? req.query.state : "";
    if (!state) return fail("invalid_request");
    const cookieName = flowCookieName(state);
    res.clearCookie(cookieName, { ...this.sessions.cookieOptions(), path: "/api/auth" });
    const cookieState = (req.cookies as Record<string, string> | undefined)?.[cookieName];
    if (state !== cookieState) return fail("invalid_request");
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
      this.log.warn(`sign-in failed: ${describeOidcError(e)}`);
      return fail("provider_error");
    }
    const meta = { ipHash: this.sessions.ipHash(req.ip), requestId: req.requestId ?? null };
    const outcome = await this.auth.signIn(identity, meta);
    if (!outcome.ok) return fail(outcome.reason);
    if (req.session) await this.sessions.revoke(req.session.tokenHash);
    const token = await this.sessions.create(outcome.userId, new Date(), identity.idToken);
    res.cookie(this.sessions.cookieName, token, this.sessions.cookieOptions(ABSOLUTE_MS));
    res.redirect(302, flow.return_to);
  }

  /**
   * Purpose: sign in the desktop app's local Owner (local mode only; 404 on a server). The desktop app adds the
   * launch key header to its own requests to this local address; a browser on the same computer cannot, so it
   * cannot take over the local session. The page itself calls this when it finds no session.
   * Output: `{ ok: true }` and a new session cookie.
   */
  @Post("local")
  @HttpCode(200)
  @Public()
  @AuthRateLimit()
  async local(@Req() req: MslRequest, @Res({ passthrough: true }) res: Response) {
    const key = this.config.localLaunchKey;
    if (!key) throw new NotFoundException();
    if (!sameSecret(key, (req as Request).header(LOCAL_KEY_HEADER))) {
      this.security.warn(`local sign-in refused: wrong or missing launch key`);
      throw new NotFoundException();
    }
    const meta = { ipHash: this.sessions.ipHash(req.ip), requestId: req.requestId ?? null };
    const userId = await this.auth.signInLocalOwner(meta);
    if (req.session) await this.sessions.revoke(req.session.tokenHash);
    const token = await this.sessions.create(userId);
    res.cookie(this.sessions.cookieName, token, this.sessions.cookieOptions(ABSOLUTE_MS));
    return { ok: true };
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
    let idToken: string | null = null;
    if (s) {
      idToken = await this.sessions.revoke(s.tokenHash);
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
    const endSessionUrl = await this.oidc.endSessionUrl(idToken).catch(() => null);
    return { endSessionUrl };
  }
}

/** Header the desktop app adds to its requests to the local API (never visible to the page's scripts). */
export const LOCAL_KEY_HEADER = "x-mobsimlab-local-key";

/** Purpose: constant-time comparison of the launch key. */
function sameSecret(expected: string, given: string | undefined): boolean {
  if (!given) return false;
  const a = Buffer.from(sha256(expected));
  const b = Buffer.from(sha256(given));
  return timingSafeEqual(a, b);
}

function sha256(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}

/** Purpose: a same-origin path to return to after sign-in; anything else becomes "/" (no open redirect). */
export function safeReturnTo(v: unknown): string {
  if (typeof v !== "string" || v.length > 1000) return "/";
  if (
    !v.startsWith("/") ||
    v.startsWith("//") ||
    v.includes("\\") ||
    [...v].some((c) => c.charCodeAt(0) < 32)
  )
    return "/";
  return v;
}
