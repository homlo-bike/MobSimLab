import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { migrate, readMigrations } from "../../src/db/migrate";

const REPO = join(__dirname, "..", "..", "..", "..");

/** A throwaway PostGIS database set up exactly like production: init script, roles, migrations. */
export interface TestDatabase {
  container: StartedPostgreSqlContainer;
  host: string;
  port: number;
  appPassword: string;
  /** Superuser connection to the mobsimlab database (for assertions and tampering tests). */
  superuser(): Promise<Client>;
}

/**
 * Purpose: start PostGIS with the real `db/init/10-roles.sh` and secrets, then apply `db/migrations` as the
 * migrator role. Output: connection details. Side effects: starts a Docker container.
 */
export async function startDatabase(): Promise<TestDatabase> {
  const pw = () => randomBytes(24).toString("hex");
  const secrets = { db_migrator_password: pw(), db_app_password: pw(), db_worker_password: pw() };
  const container = await new PostgreSqlContainer("postgis/postgis:17-3.5")
    .withCopyFilesToContainer([
      { source: join(REPO, "db", "init", "10-roles.sh"), target: "/docker-entrypoint-initdb.d/10-roles.sh" },
    ])
    .withCopyContentToContainer(
      Object.entries(secrets).map(([name, content]) => ({ content, target: `/run/secrets/${name}` })),
    )
    .start();
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
    superuser: async () => {
      const c = new Client({
        host,
        port,
        database: "mobsimlab",
        user: container.getUsername(),
        password: container.getPassword(),
      });
      await c.connect();
      return c;
    },
  };
}
