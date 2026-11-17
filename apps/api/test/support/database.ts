import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { migrate, readMigrations } from "../../src/db/migrate";
import { setupDatabase } from "../../src/db/setup";

const REPO = join(__dirname, "..", "..", "..", "..");

/** A throwaway PostGIS database set up exactly like production: roles and database (setupDatabase), migrations. */
export interface TestDatabase {
  container: StartedPostgreSqlContainer;
  host: string;
  port: number;
  appPassword: string;
  /** Password of the restricted worker role, for tests that run the Python worker. */
  workerPassword: string;
  /** Superuser connection to the mobsimlab database (for assertions and tampering tests). */
  superuser(): Promise<Client>;
}

/**
 * Purpose: start PostGIS, set up the roles and database with the real `setupDatabase` (as the container does on its
 * first start), then apply `db/migrations` as the migrator role. Output: connection details. Side effects: starts a
 * Docker container.
 */
export async function startDatabase(): Promise<TestDatabase> {
  const pw = () => randomBytes(24).toString("hex");
  const secrets = { db_migrator_password: pw(), db_app_password: pw(), db_worker_password: pw() };
  const container = await new PostgreSqlContainer("postgis/postgis:17-3.5").start();
  const superuserOf = async (database: string) => {
    const c = new Client({
      host: container.getHost(),
      port: container.getPort(),
      database,
      user: container.getUsername(),
      password: container.getPassword(),
    });
    await c.connect();
    return c;
  };
  const admin = await superuserOf("postgres");
  await setupDatabase(admin, () => superuserOf("mobsimlab"), {
    mobsimlab_migrator: secrets.db_migrator_password,
    mobsimlab_app: secrets.db_app_password,
    mobsimlab_worker: secrets.db_worker_password,
  });
  await admin.end();
  const host = container.getHost();
  const port = container.getPort();
  const migrator = new Client({
    host,
    port,
    database: "mobsimlab",
    user: "mobsimlab_migrator",
    password: secrets.db_migrator_password,
  });
  await migrator.connect();
  await migrate(migrator, readMigrations(join(REPO, "db", "migrations")));
  await migrator.end();
  return {
    container,
    host,
    port,
    appPassword: secrets.db_app_password,
    workerPassword: secrets.db_worker_password,
    superuser: () => superuserOf("mobsimlab"),
  };
}
