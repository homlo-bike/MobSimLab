import { randomUUID } from "node:crypto";
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { type MslRequest, SessionService } from "../auth/session.service";
import { APP_CONFIG } from "../config/config.module";
import type { AppConfig } from "../config/env";
import { type Action, can } from "./policy";
import { PUBLIC_KEY, REQUIRES_KEY } from "./requires";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Global guard on every route (05 §3.2, §3.4):
 * 1. resolves the session cookie;
 * 2. for state-changing methods, requires a same-origin `Origin` (or `Referer`) and, with a session, a valid
 *    `X-CSRF-Token`;
 * 3. enforces `@Requires(action)` through the policy table. Routes with neither `@Requires` nor `@Public`
 *    are refused (and a test fails the build).
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<MslRequest>();
    req.requestId = randomUUID();
    const token = (req.cookies as Record<string, string> | undefined)?.[this.sessions.cookieName];
    req.session = token ? ((await this.sessions.resolve(token)) ?? undefined) : undefined;

    const unsafe = !SAFE_METHODS.has(req.method);
    if (unsafe && !this.sameOrigin(req)) throw new ForbiddenException("cross-origin request refused");

    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;
    const action = this.reflector.getAllAndOverride<Action>(REQUIRES_KEY, targets);
    if (!action) throw new ForbiddenException("route has no permission declaration");
    if (!req.session) throw new UnauthorizedException();
    if (unsafe && !this.sessions.checkCsrf(req.session.tokenHash, req.header("x-csrf-token"))) {
      throw new ForbiddenException("missing or invalid CSRF token");
    }
    if (!can(req.session.actor, action)) throw new ForbiddenException();
    return true;
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
