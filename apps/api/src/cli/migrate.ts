import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { migrate, readMigrations } from "../db/migrate";
import { connectWithRetry } from "./connect";
import { errorText } from "./error-text";

/**
 * Purpose: command-line entry for `deploy/bin/migrate` (runs before the API starts).
 * Inputs: MOBSIMLAB_DB_HOST, optional MOBSIMLAB_DB_NAME, MOBSIMLAB_MIGRATIONS_DIR, MOBSIMLAB_SECRETS_DIR.
 * Side effects: connects as mobsimlab_migrator (password: db_migrator_password, else db_password) and applies pending migrations; exits non-zero on failure.
 */
async function main(): Promise<void> {
  const secrets = process.env.MOBSIMLAB_SECRETS_DIR ?? "/run/secrets";
  // Without a host, pg falls back to localhost, which is never the database in the container.
  const host = process.env.MOBSIMLAB_DB_HOST;
  if (!host)
    throw new Error("MOBSIMLAB_DB_HOST is not set (compose.yaml sets it under mobsimlab: environment)");
  const options = {
    host,
    port: Number(process.env.MOBSIMLAB_DB_PORT ?? 5432),
    database: process.env.MOBSIMLAB_DB_NAME ?? "mobsimlab",
    user: "mobsimlab_migrator",
    password: migratorPassword(secrets),
  };
  const db = await connectWithRetry(
    () => new Client(options),
    `${options.database} at ${options.host}:${options.port}`,
  );
  try {
    const dir = process.env.MOBSIMLAB_MIGRATIONS_DIR ?? "/app/db/migrations";
    const applied = await migrate(db, readMigrations(dir));
    process.stdout.write(`${JSON.stringify({ level: "info", msg: "migrations applied", applied })}\n`);
  } finally {
    await db.end();
  }
}

/** The migrator role's own password if it has one (separate role passwords), else the one db_password. */
function migratorPassword(dir: string): string {
  for (const name of ["db_migrator_password", "db_password"]) {
    try {
      const v = readFileSync(join(dir, name), "utf8").trim();
      if (v) return v;
    } catch {
      // try the next one
    }
  }
  throw new Error("secret db_password is missing");
}

main().catch((e: unknown) => {
  process.stderr.write(`${JSON.stringify({ level: "error", msg: errorText(e) })}\n`);
  process.exit(1);
});
