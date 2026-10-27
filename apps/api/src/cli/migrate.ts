import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { migrate, readMigrations } from "../db/migrate";

/**
 * Purpose: command-line entry for `deploy/bin/migrate` (runs before the API starts).
 * Inputs: MOBSIMLAB_DB_HOST, optional MOBSIMLAB_DB_NAME, MOBSIMLAB_MIGRATIONS_DIR, MOBSIMLAB_SECRETS_DIR.
 * Side effects: connects as mobsimlab_migrator and applies pending migrations; exits non-zero on failure.
 */
async function main(): Promise<void> {
  const secrets = process.env.MOBSIMLAB_SECRETS_DIR ?? "/run/secrets";
  const db = new Client({
    host: process.env.MOBSIMLAB_DB_HOST,
    port: Number(process.env.MOBSIMLAB_DB_PORT ?? 5432),
    database: process.env.MOBSIMLAB_DB_NAME ?? "mobsimlab",
    user: "mobsimlab_migrator",
    password: readFileSync(join(secrets, "db_migrator_password"), "utf8").trim(),
  });
  await db.connect();
  try {
    const dir = process.env.MOBSIMLAB_MIGRATIONS_DIR ?? "/app/db/migrations";
    const applied = await migrate(db, readMigrations(dir));
    process.stdout.write(`${JSON.stringify({ level: "info", msg: "migrations applied", applied })}\n`);
  } finally {
    await db.end();
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`${JSON.stringify({ level: "error", msg: (e as Error).message })}\n`);
  process.exit(1);
});
