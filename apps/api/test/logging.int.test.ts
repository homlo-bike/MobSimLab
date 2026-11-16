import type { NestExpressApplication } from "@nestjs/platform-express";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config/env";
import { type AppLogger, LOGGER } from "../src/logging/logger";
import { LogMaintenance } from "../src/logging/logging.module";
import { createApp, testConfig } from "./support/app";
import { startDatabase, type TestDatabase } from "./support/database";
import { cookieValue, signIn, startIdp, type TestIdp } from "./support/idp";

/** Integration: the PostgreSQL log sink, browser log ingestion and daily partitions (ADR-0022). */
describe("logging", () => {
  let db: TestDatabase;
  let idp: TestIdp;
  let app: NestExpressApplication;
  let config: AppConfig;
  let su: Client;
  let alice: { cookie: string; csrf: string; id: string };

  const rows = async (where: string) =>
    (
      await su.query<{
        level: string;
        origin: string;
        module: string | null;
        message: string;
        request_id: string | null;
        user_id: string | null;
        context: Record<string, unknown> | null;
      }>(
        `SELECT level, origin, module, message, request_id, user_id::text, context FROM logs.entry WHERE ${where} ORDER BY id`,
      )
    ).rows;

  const postLogs = (body: object, as = alice) =>
    request(app.getHttpServer())
      .post("/api/logs")
      .set("Cookie", as.cookie)
      .set("Origin", config.publicUrl.origin)
      .set("X-CSRF-Token", as.csrf)
      .send(body);

  beforeAll(async () => {
    db = await startDatabase();
    idp = await startIdp();
    config = testConfig({
      db: { host: db.host, port: db.port, name: "mobsimlab" },
      secrets: { ...testConfig().secrets, db_app_password: db.appPassword },
      oidc: { issuer: idp.issuer, clientId: "mobsimlab", allowInsecureHttp: true },
    });
    app = await createApp(config);
    su = await db.superuser();
    const res = await signIn(app, idp, "alice");
    const cookie = `msl_session=${cookieValue(res, "msl_session")}`;
    const me = (await request(app.getHttpServer()).get("/api/auth/me").set("Cookie", cookie)).body;
    alice = { cookie, csrf: me.csrfToken, id: me.user.id };
  }, 180_000);

  afterAll(async () => {
    await su?.end();
    await app?.close();
    await idp?.server.stop();
    await db?.container.stop();
  });

  it("has a partition for today and the coming days", async () => {
    const { rows: parts } = await su.query<{ n: string }>(
      `SELECT count(*) AS n FROM pg_inherits WHERE inhparent = 'logs.entry'::regclass`,
    );
    expect(Number(parts[0]?.n)).toBeGreaterThanOrEqual(8);
  });

  it("stores WARN and above from the API, redacted, and nothing below WARN", async () => {
    const logger = app.get<AppLogger>(LOGGER);
    logger.info("api-info", { module: "test" });
    logger.warn("api-warn Bearer abc", { module: "test", password: "hunter2", host: "example.org" });
    logger.critical("api-critical", { module: "test" });
    await app.get(LogMaintenance).flush();
    const got = await rows(`message LIKE 'api-%'`);
    expect(got.map((r) => [r.level, r.origin, r.module])).toEqual([
      ["WARN", "backend", "test"],
      ["CRITICAL", "backend", "test"],
    ]);
    expect(got[0]?.message).toBe("api-warn Bearer [REDACTED]");
    expect(got[0]?.context).toEqual({ password: "[REDACTED]", host: "example.org" });
  });

  it("stores browser entries with origin frontend, the user and the request", async () => {
    const res = await postLogs({
      entries: [
        { level: "info", message: "web-info" },
        { level: "error", message: "web-error", module: "map", context: { token: "t", zoom: 12 } },
        { level: "critical", message: "web-critical", time: Date.now() },
      ],
    });
    expect(res.status).toBe(204);
    await app.get(LogMaintenance).flush();
    const got = await rows(`message LIKE 'web-%'`);
    expect(got.map((r) => [r.level, r.origin, r.module, r.user_id])).toEqual([
      ["ERROR", "frontend", "map", alice.id],
      ["CRITICAL", "frontend", "web", alice.id],
    ]);
    expect(got[0]?.request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(got[0]?.request_id).toBe(got[1]?.request_id);
    expect(got[0]?.context).toEqual({ details: { token: "[REDACTED]", zoom: 12 } });
  });

  it("refuses browser logs without a session, without the CSRF token, or out of shape", async () => {
    const server = app.getHttpServer();
    const entries = [{ level: "error", message: "x" }];
    expect(
      (await request(server).post("/api/logs").set("Origin", config.publicUrl.origin).send({ entries }))
        .status,
    ).toBe(401);
    expect((await postLogs({ entries }, { ...alice, csrf: "wrong" })).status).toBe(403);
    expect((await postLogs({ entries: [] })).status).toBe(400);
    expect((await postLogs({ entries: [{ level: "audit", message: "x" }] })).status).toBe(400);
    const many = Array.from({ length: 51 }, () => ({ level: "info", message: "x" }));
    expect((await postLogs({ entries: many })).status).toBe(400);
  });

  it("drops partitions older than 30 days", async () => {
    await su.query(
      `CREATE TABLE logs.entry_20200101 PARTITION OF logs.entry FOR VALUES FROM ('2020-01-01 00:00+00') TO ('2020-01-02 00:00+00')`,
    );
    await app.get(LogMaintenance).maintain();
    const { rows: left } = await su.query(`SELECT to_regclass('logs.entry_20200101') AS t`);
    expect(left[0]?.t).toBeNull();
  });

  it("lets the worker store entries only as origin worker", async () => {
    const worker = new Client({
      host: db.host,
      port: db.port,
      database: "mobsimlab",
      user: "mobsimlab_worker",
      password: db.workerPassword,
    });
    await worker.connect();
    try {
      await worker.query(
        `SELECT logs.append_worker('ERROR', 'worker', 'worker-error', NULL, '{"job":"j1"}')`,
      );
      await expect(
        worker.query(`INSERT INTO logs.entry (level, origin, message) VALUES ('WARN', 'backend', 'fake')`),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await worker.end();
    }
    const got = await rows(`message = 'worker-error'`);
    expect(got.map((r) => [r.level, r.origin, r.context])).toEqual([["ERROR", "worker", { job: "j1" }]]);
  });
});
