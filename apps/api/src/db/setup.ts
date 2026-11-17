import type { Client } from "pg";

/** The three database roles: DDL (migrations only), the API, and the restricted simulation worker. */
export interface RolePasswords {
  mobsimlab_migrator: string;
  mobsimlab_app: string;
  mobsimlab_worker: string;
}

/**
 * Purpose: create or update the MobSimLab roles and database, as the PostgreSQL superuser. Safe to run again: an
 * existing role gets its password set to the current secret; an existing database is kept.
 * Inputs: `admin`, a superuser connection to another database (`postgres`); `connectDb`, which opens a superuser
 * connection to `dbName` (called once it exists); the role passwords; the database name.
 * Output: what was created or changed, for the log. Passwords go in as query parameters and are quoted by
 * PostgreSQL's format(%L), never put into SQL text by this code.
 * Side effects: CREATE/ALTER ROLE, CREATE DATABASE, grants, the PostGIS extension.
 */
export async function setupDatabase(
  admin: Client,
  connectDb: () => Promise<Client>,
  passwords: RolePasswords,
  dbName = "mobsimlab",
): Promise<string[]> {
  const changed: string[] = [];
  for (const [role, password] of Object.entries(passwords)) {
    const exists = (await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role])).rowCount === 1;
    await execFormatted(
      admin,
      exists ? "ALTER ROLE %I LOGIN PASSWORD %L" : "CREATE ROLE %I LOGIN PASSWORD %L",
      role,
      password,
    );
    changed.push(exists ? `password of ${role}` : `role ${role}`);
  }
  const dbExists = (await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName])).rowCount === 1;
  if (!dbExists) {
    await execFormatted(admin, "CREATE DATABASE %I OWNER mobsimlab_migrator", dbName);
    changed.push(`database ${dbName}`);
  }
  await execFormatted(admin, "REVOKE ALL ON DATABASE %I FROM PUBLIC", dbName);
  await execFormatted(admin, "GRANT CONNECT ON DATABASE %I TO mobsimlab_app, mobsimlab_worker", dbName);
  const db = await connectDb();
  try {
    await db.query(`CREATE EXTENSION IF NOT EXISTS postgis;
      REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      ALTER SCHEMA public OWNER TO mobsimlab_migrator;
      GRANT USAGE ON SCHEMA public TO mobsimlab_app, mobsimlab_worker`);
  } finally {
    await db.end();
  }
  return changed;
}

/** Purpose: run `format(template, args...)` in PostgreSQL and execute the result (identifiers %I, literals %L). */
async function execFormatted(db: Client, template: string, ...args: string[]): Promise<void> {
  const params = args.map((_, i) => `$${i + 2}::text`).join(", ");
  const { rows } = await db.query<{ sql: string }>(`SELECT format($1, ${params}) AS sql`, [template, ...args]);
  const sql = rows[0]?.sql;
  if (!sql) throw new Error(`format() returned nothing for: ${template}`);
  await db.query(sql);
}
