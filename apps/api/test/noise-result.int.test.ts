import { gzipSync } from "node:zlib";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config/env";
import { createApp, testConfig } from "./support/app";
import { startDatabase, type TestDatabase } from "./support/database";
import { cookieValue, signIn, startIdp, type TestIdp } from "./support/idp";

/** Integration: the project's noise map, saved with the project and read back by its members. */
describe("saved noise map", () => {
  let db: TestDatabase;
  let idp: TestIdp;
  let app: NestExpressApplication;
  let config: AppConfig;
  const browsers: Record<string, { cookie: string; csrf: string }> = {};

  async function login(sub: string): Promise<void> {
    const res = await signIn(app, idp, sub);
    const token = cookieValue(res, "msl_session");
    if (!token) throw new Error(`${sub} could not sign in: ${String(res.headers.location)}`);
    const cookie = `msl_session=${token}`;
    const me = (await request(app.getHttpServer()).get("/api/auth/me").set("Cookie", cookie)).body;
    browsers[sub] = { cookie, csrf: me.csrfToken };
  }

  const as = (sub: string) => {
    const b = browsers[sub]!;
    const server = app.getHttpServer();
    const write = (r: request.Test) =>
      r.set("Cookie", b.cookie).set("Origin", config.publicUrl.origin).set("X-CSRF-Token", b.csrf);
    return {
      get: (path: string) => request(server).get(path).set("Cookie", b.cookie),
      post: (path: string, body: object = {}) => write(request(server).post(path)).send(body),
      put: (path: string, body: object) => write(request(server).put(path)).send(body),
      putRaw: (path: string, body: Buffer) =>
        write(request(server).put(path)).set("Content-Type", "application/octet-stream").send(body),
    };
  };

  let project = "";
  const url = () => `/api/projects/${project}/noise-result`;

  beforeAll(async () => {
    db = await startDatabase();
    idp = await startIdp();
    config = testConfig({
      db: { host: db.host, port: db.port, name: "mobsimlab" },
      secrets: { ...testConfig().secrets, db_app_password: db.appPassword },
      oidc: { issuer: idp.issuer, clientId: "mobsimlab", allowInsecureHttp: true },
    });
    app = await createApp(config);
    await login("alice");
    await as("alice").post("/api/setup/finish");
    await as("alice").put("/api/admin/registration", {
      autoRegistration: true,
      defaultRole: "user",
      allowedEmailDomains: [],
      allowedGroups: [],
    });
    await login("dave");
    project = (await as("alice").post("/api/projects", { name: "Riverside" })).body.project.id;
    expect(
      (
        await as("alice").post(`/api/projects/${project}/members`, {
          email: "dave@example.org",
          role: "viewer",
        })
      ).status,
    ).toBe(201);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await idp?.server.stop();
    await db?.container.stop();
  });

  it("has none until one is worked out", async () => {
    expect((await as("alice").get(url())).status).toBe(404);
  });

  it("keeps the latest noise map and gives it to every member as it was sent", async () => {
    const first = gzipSync(JSON.stringify({ version: 1, n: 1 }));
    expect((await as("alice").putRaw(url(), first)).status).toBe(200);
    const second = gzipSync(JSON.stringify({ version: 1, n: 2 }));
    const saved = await as("alice").putRaw(url(), second);
    expect(saved.status).toBe(200);
    expect(typeof saved.body.computedAt).toBe("string");
    const res = await as("dave")
      .get(url())
      .buffer(true)
      .parse((r, done) => {
        const parts: Buffer[] = [];
        r.on("data", (c: Buffer) => parts.push(c));
        r.on("end", () => done(null, Buffer.concat(parts)));
      });
    expect(res.status).toBe(200);
    expect(Buffer.compare(res.body as Buffer, second)).toBe(0);
    expect(res.headers["x-computed-at"]).toBeTruthy();
  });

  it("lets only Owners and Editors replace it, and only with gzip", async () => {
    expect((await as("dave").putRaw(url(), gzipSync("{}"))).status).toBe(403);
    expect((await as("alice").putRaw(url(), Buffer.from("{}"))).status).toBe(400);
  });
});
