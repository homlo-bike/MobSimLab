import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config/env";
import { createApp, testConfig } from "./support/app";
import { startDatabase, type TestDatabase } from "./support/database";

const KEY = "Lk9!local-launch-key-for-tests-0123456789abcdefXYZ";

/** Integration: the desktop app's local mode signs in its single local Owner with the launch key only. */
describe("desktop local mode", () => {
  let db: TestDatabase;
  let app: NestExpressApplication;
  let config: AppConfig;

  beforeAll(async () => {
    db = await startDatabase();
    config = testConfig({
      db: { host: db.host, port: db.port, name: "mobsimlab" },
      secrets: { ...testConfig().secrets, db_app_password: db.appPassword },
      bootstrapOwnerSubject: undefined,
      localLaunchKey: KEY,
      listenHost: "127.0.0.1",
    });
    app = await createApp(config);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await db?.container.stop();
  });

  const server = () => app.getHttpServer();
  const origin = () => config.publicUrl.origin;
  const session = (res: request.Response) =>
    ((res.headers["set-cookie"] as unknown as string[]) ?? [])
      .find((c) => c.startsWith("msl_session="))
      ?.split(";")[0];

  it("refuses the local sign-in without the launch key, or with a wrong one", async () => {
    expect((await request(server()).post("/api/auth/local").set("Origin", origin())).status).toBe(404);
    const wrong = await request(server())
      .post("/api/auth/local")
      .set("Origin", origin())
      .set("X-MobSimLab-Local-Key", `${KEY}x`);
    expect(wrong.status).toBe(404);
    expect(session(wrong)).toBeUndefined();
  });

  it("refuses a cross-site request even with the key", async () => {
    const res = await request(server())
      .post("/api/auth/local")
      .set("Origin", "https://evil.example")
      .set("X-MobSimLab-Local-Key", KEY);
    expect(res.status).toBe(403);
  });

  it("signs in the local Owner, finishes setup, and keeps the same account next time", async () => {
    const first = await request(server())
      .post("/api/auth/local")
      .set("Origin", origin())
      .set("X-MobSimLab-Local-Key", KEY);
    expect(first.status).toBe(200);
    const cookie = session(first);
    expect(cookie).toBeTruthy();
    const me = (await request(server()).get("/api/auth/me").set("Cookie", cookie!)).body;
    expect(me.instance).toMatchObject({ mode: "open", local: true, agents: true });
    expect(me.user).toMatchObject({ role: "owner", displayName: "Local user" });

    const second = await request(server())
      .post("/api/auth/local")
      .set("Origin", origin())
      .set("X-MobSimLab-Local-Key", KEY);
    const me2 = (await request(server()).get("/api/auth/me").set("Cookie", session(second)!)).body;
    expect(me2.user.id).toBe(me.user.id);
  });

  it("does not offer the local sign-in on a server", async () => {
    const serverApp = await createApp({ ...config, localLaunchKey: undefined });
    try {
      const res = await request(serverApp.getHttpServer())
        .post("/api/auth/local")
        .set("Origin", origin())
        .set("X-MobSimLab-Local-Key", KEY);
      expect(res.status).toBe(404);
      expect((await request(serverApp.getHttpServer()).get("/api/auth/me")).body.instance.local).toBe(false);
    } finally {
      await serverApp.close();
    }
  });
});
