import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupDatabase } from "../src/db/setup";
import { startDatabase, type TestDatabase } from "./support/database";

/** Integration: the database set-up the container runs before its migrations can run again safely. */
describe("setupDatabase", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.container.stop();
  });

  const superuserOf = async (database: string) => {
    const c = new Client({
      host: db.host,
      port: db.port,
      database,
      user: db.container.getUsername(),
      password: db.container.getPassword(),
    });
    await c.connect();
    return c;
  };

  it("runs again on a set-up database, keeps it, and sets the role passwords to the new secret", async () => {
    const pw = "Qw8eR5tY2uI9oP4aS7dF1gH6jK3lZ0xC";
    const admin = await superuserOf("postgres");
    const changed = await setupDatabase(admin, () => superuserOf("mobsimlab"), {
      mobsimlab_migrator: pw,
      mobsimlab_app: pw,
      mobsimlab_worker: pw,
    });
    await admin.end();
    expect(changed).toEqual([
      "password of mobsimlab_migrator",
      "password of mobsimlab_app",
      "password of mobsimlab_worker",
    ]);
    const as = async (user: string) => {
      const c = new Client({ host: db.host, port: db.port, database: "mobsimlab", user, password: pw });
      await c.connect();
      return c;
    };
    // The migrations applied before are still there.
    const migrator = await as("mobsimlab_migrator");
    const { rows } = await migrator.query("SELECT count(*)::int AS n FROM meta.migration");
    expect(rows[0].n).toBeGreaterThan(0);
    await migrator.end();
    // The app role still may not create tables in public.
    const app = await as("mobsimlab_app");
    await expect(app.query("CREATE TABLE public.nope (x int)")).rejects.toThrow(/permission denied/);
    await app.end();
  });
});
