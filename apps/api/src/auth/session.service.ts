import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { APP_CONFIG } from "../config/config.module";
import type { AppConfig } from "../config/env";
import { DATABASE, type Database } from "../db/database";
import type { Actor } from "../iam/policy";

/** 05 §3.1: 12 h idle and 7 d absolute timeout. */
export const IDLE_MS = 12 * 3600 * 1000;
export const ABSOLUTE_MS = 7 * 24 * 3600 * 1000;
/** Idle expiry is pushed forward at most this often, to avoid a write on every request. */
const TOUCH_MS = 60 * 1000;

/** A resolved session attached to the request. */
export interface SessionContext {
  tokenHash: Buffer;
  actor: Actor;
  email: string | null;
  displayName: string | null;
}

/** Request fields set by the access guard. */
export interface MslRequest extends Request {
  session?: SessionContext;
  requestId?: string;
}

/** Purpose: SHA-256 of a token. Only hashes are stored, so a database leak does not leak sessions. */
export function hashToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

/** Server-side sessions with an opaque random cookie (05 §3.1). */
@Injectable()
export class SessionService {
  /** Cookie name. `__Host-` needs HTTPS; plain-HTTP installs (local only) fall back to a plain name. */
  readonly cookieName: string;
  readonly secure: boolean;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.secure = config.publicUrl.protocol === "https:";
    this.cookieName = this.secure ? "__Host-msl_session" : "msl_session";
  }

  /**
   * Purpose: start a new session (always a new token, so login rotates the session).
   * Output: the cookie value. Side effects: inserts a session row.
   */
  async create(userId: string, now = new Date()): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    await this.db
      .insertInto("iam.session")
      .values({
        token_hash: hashToken(token),
        user_id: userId,
        last_seen_at: now,
        idle_expires_at: new Date(now.getTime() + IDLE_MS),
        absolute_expires_at: new Date(now.getTime() + ABSOLUTE_MS),
        revoked_at: null,
      })
      .execute();
    return token;
  }

  /**
   * Purpose: look up a session from its cookie value.
   * Output: the session context, or null when unknown, revoked, expired, or the user is deleted.
   * Side effects: slides the idle expiry forward.
   */
  async resolve(token: string, now = new Date()): Promise<SessionContext | null> {
    const tokenHash = hashToken(token);
    const row = await this.db
      .selectFrom("iam.session as s")
      .innerJoin("iam.user as u", "u.id", "s.user_id")
      .select(["s.user_id", "s.last_seen_at", "s.idle_expires_at", "s.absolute_expires_at", "s.revoked_at"])
      .select(["u.instance_role", "u.status", "u.email", "u.display_name"])
      .where("s.token_hash", "=", tokenHash)
      .executeTakeFirst();
    if (!row || row.revoked_at || row.status === "deleted") return null;
    if (row.idle_expires_at <= now || row.absolute_expires_at <= now) return null;
    if (now.getTime() - row.last_seen_at.getTime() > TOUCH_MS) {
      await this.db
        .updateTable("iam.session")
        .set({ last_seen_at: now, idle_expires_at: new Date(now.getTime() + IDLE_MS) })
        .where("token_hash", "=", tokenHash)
        .execute();
    }
    return {
      tokenHash,
      actor: { userId: row.user_id, role: row.instance_role, status: row.status },
      email: row.email,
      displayName: row.display_name,
    };
  }

  /** Purpose: end a session server-side. */
  async revoke(tokenHash: Buffer, now = new Date()): Promise<void> {
    await this.db
      .updateTable("iam.session")
      .set({ revoked_at: now })
      .where("token_hash", "=", tokenHash)
      .execute();
  }

  /** Purpose: CSRF token bound to the session (synchroniser token, sent back in `X-CSRF-Token`). */
  csrfToken(tokenHash: Buffer): string {
    return createHmac("sha256", this.config.secrets.session_secret)
      .update("csrf\0")
      .update(tokenHash)
      .digest("base64url");
  }

  /** Purpose: constant-time check of a submitted CSRF token. */
  checkCsrf(tokenHash: Buffer, submitted: string | undefined): boolean {
    if (!submitted) return false;
    const a = Buffer.from(this.csrfToken(tokenHash));
    const b = Buffer.from(submitted);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** Purpose: keyed hash of a client IP for the audit log (no raw IPs are stored). */
  ipHash(ip: string | undefined): string | null {
    if (!ip) return null;
    return createHmac("sha256", this.config.secrets.session_secret)
      .update("ip\0")
      .update(ip)
      .digest("hex")
      .slice(0, 32);
  }

  /** Purpose: cookie options shared by set and clear. */
  cookieOptions(maxAgeMs?: number) {
    return { httpOnly: true, secure: this.secure, sameSite: "lax" as const, path: "/", maxAge: maxAgeMs };
  }
}
