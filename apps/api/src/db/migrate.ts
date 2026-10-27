import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Client } from "pg";

/** One migration file on disk. */
export interface Migration {
  name: string;
  sql: string;
  checksum: string;
}

/** Arbitrary constant for pg_advisory_lock, so two containers never migrate at once. */
const LOCK_KEY = 7_316_525_101;

/**
 * Purpose: read migration files (`NNNN_name.sql`) in name order.
 * Inputs: directory. Output: migrations with SHA-256 checksums.
 */
export function readMigrations(dir: string): Migration[] {
  return readdirSync(dir)
    .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
    .sort()
    .map((name) => {
      const sql = readFileSync(join(dir, name), "utf8");
      return { name, sql, checksum: createHash("sha256").update(sql).digest("hex") };
    });
}

/**
 * Purpose: apply pending migrations, forward only (04 §3.7).
 * Inputs: a connected client with the migrator role, and the migrations.
 * Output: names of the migrations applied in this call.
 * Side effects: creates `meta.migration` if missing; each migration runs in its own transaction with a
 * lock timeout. Throws if an applied migration was edited afterwards (checksum mismatch).
 */
export async function migrate(db: Client, migrations: Migration[]): Promise<string[]> {
  await db.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
  try {
    await db.query(`CREATE SCHEMA IF NOT EXISTS meta;
      CREATE TABLE IF NOT EXISTS meta.migration (
        name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const { rows } = await db.query<{ name: string; checksum: string }>("SELECT name, checksum FROM meta.migration");
    const applied = new Map(rows.map((r) => [r.name, r.checksum]));
    const done: string[] = [];
    for (const m of migrations) {
      const sum = applied.get(m.name);
      if (sum !== undefined) {
        if (sum !== m.checksum) throw new Error(`migration ${m.name} was changed after it was applied`);
        continue;
      }
      await db.query("BEGIN");
      try {
        await db.query("SET LOCAL lock_timeout = '10s'");
        await db.query(m.sql);
        await db.query("INSERT INTO meta.migration (name, checksum) VALUES ($1, $2)", [m.name, m.checksum]);
        await db.query("COMMIT");
      } catch (e) {
        await db.query("ROLLBACK");
        throw new Error(`migration ${m.name} failed: ${(e as Error).message}`, { cause: e });
      }
      done.push(m.name);
    }
    return done;
  } finally {
    await db.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]);
  }
}
