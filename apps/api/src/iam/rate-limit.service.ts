import { Inject, Injectable, SetMetadata } from "@nestjs/common";
import { sql } from "kysely";
import { DATABASE, type Database } from "../db/database";

export const RATE_LIMIT_KEY = "mobsimlab:rate-limit";

/**
 * Purpose: put a route in the per-IP sign-in bucket (05 §3.5: auth endpoints 10/min by default).
 * The global guard enforces it before the route runs, also on `@Public` routes.
 */
export const AuthRateLimit = (): MethodDecorator => SetMetadata(RATE_LIMIT_KEY, "auth");

/** Rows untouched for this long are full buckets again and can be dropped. */
const STALE = "10 minutes";

/** Token buckets stored in PostgreSQL, so limits hold across API processes and restarts. */
@Injectable()
export class RateLimitService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Purpose: take one token from the bucket `key`, which holds `perMinute` tokens and refills continuously.
   * Output: true if the request may proceed.
   * Side effects: updates the bucket row; now and then deletes stale rows.
   */
  async take(key: string, perMinute: number): Promise<boolean> {
    const { rows } = await sql<{ ok: boolean }>`
      SELECT iam.take_token(${key}, ${perMinute}::float8, ${perMinute / 60}::float8) AS ok`.execute(this.db);
    if (Math.random() < 0.01) {
      await sql`DELETE FROM iam.rate_limit WHERE updated_at < now() - ${STALE}::interval`.execute(this.db);
    }
    return rows[0]?.ok === true;
  }
}
