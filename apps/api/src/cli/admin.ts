import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { AuditService } from "../audit/audit.service";
import { ConfigError, loadConfig } from "../config/env";
import type { DB } from "../db/database";

/**
 * Purpose: break-glass "reset owner" (05 §3.1). Demotes every Owner to Admin, revokes their sessions and
 * puts the instance back into setup mode, so the next permitted sign-in becomes Owner. Run inside the
 * container by an operator: `docker compose exec mobsimlab mobsimlab admin reset-owner`.
 * Inputs: database handle. Output: number of demoted owners.
 * Side effects: one transaction; audited on the instance chain.
 */
export async function resetOwner(db: Kysely<DB>): Promise<number> {
  return db.transaction().execute(async (tx) => {
    await tx.selectFrom("iam.instance").select("mode").forUpdate().executeTakeFirstOrThrow();
    const owners = await tx
      .updateTable("iam.user")
      .set({ instance_role: "admin" })
      .where("instance_role", "=", "owner")
      .returning("id")
      .execute();
    const ids = owners.map((o) => o.id);
    if (ids.length > 0) {
      await tx
        .updateTable("iam.session")
        .set({ revoked_at: new Date() })
        .where("user_id", "in", ids)
        .execute();
    }
    await tx.updateTable("iam.instance").set({ mode: "setup", updated_at: new Date() }).execute();
    await new AuditService(tx).append(
      {
        action: "instance.owner_reset",
        objectType: "instance",
        before: { owners: ids },
        after: { mode: "setup", demoted_to: "admin" },
        reason: "operator command: mobsimlab admin reset-owner",
      },
      tx,
    );
    return ids.length;
  });
}

async function main(argv: string[]): Promise<number> {
  const [cmd] = argv;
  if (cmd !== "reset-owner") {
    process.stderr.write("usage: mobsimlab admin reset-owner\n");
    return 64;
  }
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    if (e instanceof ConfigError) {
      process.stderr.write(`${e.message}\n`);
      return 78;
    }
    throw e;
  }
  const db = new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new Pool({
        host: config.db.host,
        port: config.db.port,
        database: config.db.name,
        user: "mobsimlab_app",
        password: config.secrets.db_app_password,
        max: 1,
      }),
    }),
  });
  try {
    const n = await resetOwner(db);
    process.stdout.write(
      `Instance is in setup mode again; ${n} owner(s) demoted to admin. The next permitted sign-in becomes Owner.\n`,
    );
    return 0;
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      process.stderr.write(`${(e as Error).message}\n`);
      process.exit(1);
    },
  );
}
