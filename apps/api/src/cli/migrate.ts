import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client, type ClientConfig } from "pg";
import { migrate, readMigrations } from "../db/migrate";
import { type RolePasswords, setupDatabase } from "../db/setup";
import { connectWithRetry } from "./connect";
import { errorText } from "./error-text";

/** PostgreSQL errors that mean the roles or the database are not set up (yet), or a role's password changed. */
const NOT_SET_UP = new Set(["28P01", "28000", "3D000"]);

/**
 * Purpose: command-line entry for `deploy/bin/migrate` (runs before the API starts): set up the database if needed,
 * then apply the migrations.
 * Inputs: MOBSIMLAB_DB_HOST, optional MOBSIMLAB_DB_PORT, MOBSIMLAB_DB_NAME, MOBSIMLAB_DB_ADMIN_USER (default
 * postgres), MOBSIMLAB_MIGRATIONS_DIR, MOBSIMLAB_SECRETS_DIR; secrets db_password (or db_<role>_password) and
 * db_admin_password.
 * Side effects: when mobsimlab_migrator cannot sign in to the database (first start, or db_password changed),
 * connects as the superuser with db_admin_password and creates or updates the roles and the database. Then applies
 * pending migrations as mobsimlab_migrator. Exits non-zero on failure.
 */
async function main(): Promise<void> {
  const secrets = process.env.MOBSIMLAB_SECRETS_DIR ?? "/run/secrets";
  // Without a host, pg falls back to localhost, which is never the database in the container.
  const host = process.env.MOBSIMLAB_DB_HOST;
  if (!host)
    throw new Error("MOBSIMLAB_DB_HOST is not set (compose.yaml sets it under mobsimlab: environment)");
  const server = { host, port: Number(process.env.MOBSIMLAB_DB_PORT ?? 5432) };
  const dbName = process.env.MOBSIMLAB_DB_NAME ?? "mobsimlab";
  const passwords: RolePasswords = {
    mobsimlab_migrator: rolePassword(secrets, "db_migrator_password"),
    mobsimlab_app: rolePassword(secrets, "db_app_password"),
    mobsimlab_worker: rolePassword(secrets, "db_worker_password"),
  };
  const migratorConfig: ClientConfig = {
    ...server,
    database: dbName,
    user: "mobsimlab_migrator",
    password: passwords.mobsimlab_migrator,
  };
  const where = `${dbName} at ${host}:${server.port}`;

  let db: Client;
  try {
    db = await connectWithRetry(() => new Client(migratorConfig), `${where} as mobsimlab_migrator`);
  } catch (e) {
    const code = ((e as Error).cause as { code?: string } | undefined)?.code;
    if (!code || !NOT_SET_UP.has(code)) throw e;
    await setUp(server, dbName, passwords, readSecret(secrets, "db_admin_password"));
    db = await connectWithRetry(() => new Client(migratorConfig), `${where} as mobsimlab_migrator`);
  }
  try {
    const dir = process.env.MOBSIMLAB_MIGRATIONS_DIR ?? "/app/db/migrations";
    const applied = await migrate(db, readMigrations(dir));
    process.stdout.write(`${JSON.stringify({ level: "info", msg: "migrations applied", applied })}\n`);
  } finally {
    await db.end();
  }
}

/** Purpose: create or update the roles and database as the superuser (first start, or db_password changed). */
async function setUp(
  server: { host: string; port: number },
  dbName: string,
  passwords: RolePasswords,
  adminPassword: string | undefined,
): Promise<void> {
  if (!adminPassword)
    throw new Error(
      "the database is not set up for MobSimLab (or db_password changed), and secret db_admin_password is missing: " +
        "add it to the mobsimlab service so that the roles and the database can be created",
    );
  const user = process.env.MOBSIMLAB_DB_ADMIN_USER || "postgres";
  const admin = (database: string) => () =>
    new Client({ ...server, database, user, password: adminPassword });
  const label = (database: string) => `${database} at ${server.host}:${server.port} as ${user}`;
  const db = await connectWithRetry(admin("postgres"), label("postgres"));
  try {
    const changed = await setupDatabase(
      db,
      () => connectWithRetry(admin(dbName), label(dbName)),
      passwords,
      dbName,
    );
    process.stdout.write(`${JSON.stringify({ level: "info", msg: "database set up", changed })}\n`);
  } finally {
    await db.end();
  }
}

/** A role's own password if it has one (separate role passwords), else the one db_password. */
function rolePassword(dir: string, ownFile: string): string {
  const v = readSecret(dir, ownFile) ?? readSecret(dir, "db_password");
  if (!v) throw new Error("secret db_password is missing");
  return v;
}

/** The trimmed content of a secret file, or undefined when it is missing or empty. */
function readSecret(dir: string, name: string): string | undefined {
  try {
    return readFileSync(join(dir, name), "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`${JSON.stringify({ level: "error", msg: errorText(e) })}\n`);
  process.exit(1);
});
