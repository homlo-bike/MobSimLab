import { randomUUID } from "node:crypto";
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { type MslRequest, SessionService } from "../auth/session.service";
import { APP_CONFIG } from "../config/config.module";
import type { AppConfig } from "../config/env";
import { type Action, can } from "./policy";
import { RATE_LIMIT_KEY, RateLimitService } from "./rate-limit.service";
import { PUBLIC_KEY, REQUIRES_KEY } from "./requires";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Global guard on every route (05 §3.2, §3.4, §3.5):
 * 1. applies the per-IP sign-in rate limit on routes marked `@AuthRateLimit`;
 * 2. resolves the session cookie;
 * 3. for state-changing methods, requires a same-origin `Origin` (or `Referer`) and, with a session, a valid
 *    `X-CSRF-Token`;
 * 4. enforces `@Requires(action)` through the policy table. Routes with neither `@Requires` nor `@Public`
 *    are refused (and a test fails the build);
 * 5. applies the per-user write rate limit to state-changing requests.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly limits: RateLimitService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<MslRequest>();
    req.requestId = randomUUID();
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<string>(RATE_LIMIT_KEY, targets) === "auth") {
      const key = `auth:${ctx.getHandler().name}:${req.ip ?? "unknown"}`;
      await this.limit(ctx, key, this.config.rateLimits.authPerMinute);
    }
    const token = (req.cookies as Record<string, string> | undefined)?.[this.sessions.cookieName];
    req.session = token ? ((await this.sessions.resolve(token)) ?? undefined) : undefined;

    const unsafe = !SAFE_METHODS.has(req.method);
    if (unsafe && !this.sameOrigin(req)) throw new ForbiddenException("cross-origin request refused");

    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;
    const action = this.reflector.getAllAndOverride<Action>(REQUIRES_KEY, targets);
    if (!action) throw new ForbiddenException("route has no permission declaration");
    if (!req.session) throw new UnauthorizedException();
    if (unsafe && !this.sessions.checkCsrf(req.session.tokenHash, req.header("x-csrf-token"))) {
      throw new ForbiddenException("missing or invalid CSRF token");
    }
    if (!can(req.session.actor, action)) throw new ForbiddenException();
    if (unsafe) {
      await this.limit(ctx, `write:${req.session.actor.userId}`, this.config.rateLimits.writesPerMinute);
    }
    return true;
  }

  /** Purpose: refuse with 429 and a Retry-After header when the bucket is empty. */
  private async limit(ctx: ExecutionContext, key: string, perMinute: number): Promise<void> {
    if (await this.limits.take(key, perMinute)) return;
    ctx
      .switchToHttp()
      .getResponse<{ setHeader(n: string, v: string): void }>()
      .setHeader("Retry-After", String(Math.ceil(60 / perMinute)));
    throw new HttpException("too many requests, please wait a moment", HttpStatus.TOO_MANY_REQUESTS);
  }

  /** Purpose: Origin check for state-changing requests; falls back to Referer, refuses when both are absent. */
  private sameOrigin(req: MslRequest): boolean {
    const expected = this.config.publicUrl.origin;
    const origin = req.header("origin");
    if (origin) return origin === expected;
    const referer = req.header("referer");
    if (!referer) return false;
    try {
      return new URL(referer).origin === expected;
    } catch {
      return false;
    }
  }
}
