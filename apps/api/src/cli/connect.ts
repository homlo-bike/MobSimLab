import type { Client } from "pg";
import { errorText } from "./error-text";

/** How long a network error is retried: the container's network can still be coming up when migrate starts. */
const CONNECT_RETRY_MS = 60_000;

/**
 * Purpose: connect, retrying network errors (no SQLSTATE: refused, unreachable, DNS) for up to a minute, because
 * migrate runs first thing in the container. A database error (wrong password, missing role) fails at once.
 * Inputs: a factory for a new client (a pg client cannot connect twice) and a label for messages.
 * Output: the connected client. Throws with the last error, never with an empty message.
 */
export async function connectWithRetry(
  make: () => Client,
  label: string,
  retryMs = CONNECT_RETRY_MS,
): Promise<Client> {
  const until = Date.now() + retryMs;
  for (let attempt = 1; ; attempt++) {
    const db = make();
    try {
      await db.connect();
      return db;
    } catch (e) {
      await db.end().catch(() => undefined);
      const code = (e as { code?: unknown }).code;
      const sqlState = typeof code === "string" && /^[0-9A-Z]{5}$/.test(code);
      if (sqlState || Date.now() >= until) {
        throw new Error(`cannot connect to the database ${label} (attempt ${attempt}): ${errorText(e)}`, {
          cause: e,
        });
      }
      process.stderr.write(
        `${JSON.stringify({ level: "warn", msg: `database not reachable yet, retrying: ${errorText(e)}` })}\n`,
      );
      await new Promise((r) => setTimeout(r, Math.min(1000 * attempt, 5000)));
    }
  }
}
