import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config/env";
import { createApp, testConfig } from "./support/app";
import { startDatabase, type TestDatabase } from "./support/database";
import { cookieValue, signIn, startIdp, type TestIdp } from "./support/idp";

/** Integration: user administration, group mappings, auto-registration and rate limits (05 §3.2, §3.5, §4). */
describe("administration", () => {
  let db: TestDatabase;
  let idp: TestIdp;
  let app: NestExpressApplication;
  let config: AppConfig;

  /** A signed-in browser: session cookie plus CSRF token. */
  interface Browser {
    cookie: string;
    csrf: string;
    id: string;
  }
  const browsers: Record<string, Browser> = {};

  async function login(sub: string, extra: Record<string, unknown> = {}): Promise<request.Response> {
    const res = await signIn(app, idp, sub, extra);
    const token = cookieValue(res, "msl_session");
    if (token) {
      const cookie = `msl_session=${token}`;
      const me = (await request(app.getHttpServer()).get("/api/auth/me").set("Cookie", cookie)).body;
      browsers[sub] = { cookie, csrf: me.csrfToken, id: me.user.id };
    }
    return res;
  }

  const as = (sub: string) => {
    const b = browsers[sub];
    if (!b) throw new Error(`${sub} is not signed in`);
    const server = app.getHttpServer();
    const write = (r: request.Test) =>
      r.set("Cookie", b.cookie).set("Origin", config.publicUrl.origin).set("X-CSRF-Token", b.csrf);
    return {
      get: (path: string) => request(server).get(path).set("Cookie", b.cookie),
      post: (path: string, body: object = {}) => write(request(server).post(path)).send(body),
      put: (path: string, body: object) => write(request(server).put(path)).send(body),
      patch: (path: string, body: object) => write(request(server).patch(path)).send(body),
      del: (path: string, body: object = {}) => write(request(server).delete(path)).send(body),
    };
  };

  async function userId(email: string): Promise<string> {
    const sql = await db.superuser();
    const { rows } = await sql.query<{ id: string }>("SELECT id FROM iam.user WHERE email = $1", [email]);
    await sql.end();
    return rows[0]?.id ?? "";
  }

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
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await idp?.server.stop();
    await db?.container.stop();
  });

  it("lists pending users with their IdP groups and lets an admin approve them", async () => {
    expect((await login("dave", { groups: ["planning"] })).headers.location).toBe("/?signin=pending_approval");
    const list = await as("alice").get("/api/admin/users?status=pending");
    expect(list.status).toBe(200);
    expect(list.body.users).toHaveLength(1);
    expect(list.body.users[0]).toMatchObject({
      email: "dave@example.org",
      status: "pending",
      role: "viewer",
      identities: [{ issuer: idp.issuer.href.replace(/\/$/, ""), groups: ["planning"] }],
    });
    const dave = list.body.users[0].id as string;
    expect((await as("alice").post(`/api/admin/users/${dave}/approve`, { role: "user" })).status).toBe(200);
    expect((await login("dave")).headers.location).toBe("/");
    const me = (await as("dave").get("/api/auth/me")).body;
    expect(me.user.role).toBe("user");
    expect((await as("dave").get("/api/admin/users")).status).toBe(403);
  });

  it("lets only the Owner create and manage Admins", async () => {
    await login("erin");
    const erin = await userId("erin@example.org");
    const dave = await userId("dave@example.org");
    const alice = await userId("alice@example.org");
    expect((await as("alice").post(`/api/admin/users/${erin}/approve`, { role: "admin" })).status).toBe(200);
    await login("erin");
    // An admin cannot create admins, touch the owner, or change themselves.
    expect((await as("erin").patch(`/api/admin/users/${dave}`, { role: "admin" })).status).toBe(403);
    expect((await as("erin").patch(`/api/admin/users/${alice}`, { role: "user" })).status).toBe(403);
    expect((await as("erin").del(`/api/admin/users/${alice}`)).status).toBe(403);
    expect((await as("erin").patch(`/api/admin/users/${erin}`, { role: "user" })).status).toBe(409);
    // ...but can restrict and restore ordinary users.
    expect((await as("erin").patch(`/api/admin/users/${dave}`, { role: "restricted" })).status).toBe(200);
    expect((await as("dave").get("/api/auth/me")).body.user.role).toBe("restricted");
    expect((await as("dave").get("/api/setup")).status).toBe(403);
    expect((await as("erin").patch(`/api/admin/users/${dave}`, { role: "user" })).status).toBe(200);
  });

  it("never removes the last Owner", async () => {
    const alice = await userId("alice@example.org");
    const erin = await userId("erin@example.org");
    expect((await as("alice").patch(`/api/admin/users/${alice}`, { role: "admin" })).status).toBe(409);
    // Transfer: make erin an owner, then erin may demote alice, but not the last remaining owner.
    expect((await as("alice").patch(`/api/admin/users/${erin}`, { role: "owner" })).status).toBe(200);
    expect((await as("erin").patch(`/api/admin/users/${alice}`, { role: "admin" })).status).toBe(200);
    expect((await as("erin").del(`/api/admin/users/${erin}`)).status).toBe(409);
    expect((await as("erin").patch(`/api/admin/users/${alice}`, { role: "owner" })).status).toBe(200);
  });

  it("validates input and requires the CSRF token", async () => {
    const dave = await userId("dave@example.org");
    expect((await as("alice").patch(`/api/admin/users/${dave}`, { role: "emperor" })).status).toBe(400);
    expect((await as("alice").patch(`/api/admin/users/${dave}`, {})).status).toBe(400);
    expect((await as("alice").patch("/api/admin/users/not-a-uuid", { role: "user" })).status).toBe(400);
    const b = browsers.alice as Browser;
    const noCsrf = await request(app.getHttpServer())
      .patch(`/api/admin/users/${dave}`)
      .set("Cookie", b.cookie)
      .set("Origin", config.publicUrl.origin)
      .send({ role: "viewer" });
    expect(noCsrf.status).toBe(403);
  });

  it("applies auto-registration rules and group mappings at sign-in", async () => {
    const put = await as("alice").put("/api/admin/registration", {
      autoRegistration: true,
      defaultRole: "viewer",
      allowedEmailDomains: [],
      allowedGroups: ["staff"],
    });
    expect(put.status).toBe(200);
    expect(put.body.allowedGroups).toEqual(["staff"]);
    expect((await as("alice").post("/api/admin/group-mappings", { group: "planners", role: "user" })).status).toBe(
      201,
    );
    expect(
      (await as("alice").post("/api/admin/group-mappings", { group: "suspended", role: "restricted" })).status,
    ).toBe(201);
    expect((await as("alice").post("/api/admin/group-mappings", { group: "planners", role: "viewer" })).status).toBe(
      409,
    );
    // Only an Owner may map a group to Admin.
    await login("erin");
    expect((await as("erin").post("/api/admin/group-mappings", { group: "it", role: "admin" })).status).toBe(201);

    expect((await login("gina", { groups: ["staff", "planners"] })).headers.location).toBe("/");
    expect((await as("gina").get("/api/auth/me")).body.user.role).toBe("user");
    expect((await login("hank", { groups: ["guests"] })).headers.location).toBe("/?signin=pending_approval");

    // Roles are recomputed at every sign-in; "restricted" wins over other matches.
    await login("gina", { groups: ["staff", "planners", "suspended"] });
    expect((await as("gina").get("/api/auth/me")).body.user.role).toBe("restricted");
    // A pinned role is left alone.
    const gina = await userId("gina@example.org");
    expect((await as("alice").patch(`/api/admin/users/${gina}`, { role: "viewer" })).status).toBe(200);
    await login("gina", { groups: ["planners"] });
    expect((await as("gina").get("/api/auth/me")).body.user.role).toBe("viewer");

    const mappings = (await as("alice").get("/api/admin/group-mappings")).body.mappings as {
      id: string;
      group: string;
    }[];
    expect(mappings.map((m) => m.group)).toEqual(["it", "planners", "suspended"]);
  });

  it("lets admins manage only non-admin group mappings", async () => {
    const mappings = (await as("alice").get("/api/admin/group-mappings")).body.mappings as {
      id: string;
      group: string;
    }[];
    const it = mappings.find((m) => m.group === "it");
    await as("alice").patch(`/api/admin/users/${await userId("erin@example.org")}`, { role: "admin" });
    await login("erin");
    expect((await as("erin").post("/api/admin/group-mappings", { group: "x", role: "admin" })).status).toBe(403);
    expect((await as("erin").del(`/api/admin/group-mappings/${it?.id}`)).status).toBe(403);
    expect((await as("alice").del(`/api/admin/group-mappings/${it?.id}`)).status).toBe(200);
  });

  it("deletes a user: personal data removed, sessions ended, sign-in refused", async () => {
    const dave = await userId("dave@example.org");
    const res = await as("alice").del(`/api/admin/users/${dave}`, { reason: "left the team" });
    expect(res.status).toBe(200);
    expect((await as("dave").get("/api/auth/me")).body.user).toBeUndefined();
    const sql = await db.superuser();
    const u = await sql.query("SELECT email, display_name, status FROM iam.user WHERE id = $1", [dave]);
    const i = await sql.query("SELECT email, groups FROM iam.identity WHERE user_id = $1", [dave]);
    await sql.end();
    expect(u.rows).toEqual([{ email: null, display_name: null, status: "deleted" }]);
    expect(i.rows).toEqual([{ email: null, groups: [] }]);
    expect((await signIn(app, idp, "dave")).headers.location).toBe("/?signin=account_deleted");
    const deleted = (await as("alice").get("/api/admin/users?status=deleted")).body.users;
    expect(deleted.map((x: { id: string }) => x.id)).toEqual([dave]);
  });

  it("shows the audit log to admins with an intact chain", async () => {
    const res = await as("alice").get("/api/admin/audit?limit=200");
    expect(res.status).toBe(200);
    expect(res.body.brokenAt).toBeNull();
    const actions = (res.body.records as { action: string }[]).map((r) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "user.approved",
        "user.role_changed",
        "user.role_mapped",
        "user.deleted",
        "group_mapping.created",
        "group_mapping.deleted",
        "instance.registration_updated",
      ]),
    );
    const del = (res.body.records as { action: string; reason: string | null }[]).find(
      (r) => r.action === "user.deleted",
    );
    expect(del?.reason).toBe("left the team");
    expect((await as("gina").get("/api/admin/audit")).status).toBe(403);
  });

  it("rate-limits sign-in per client address and writes per user", async () => {
    const strict = await createApp({ ...config, rateLimits: { authPerMinute: 2, writesPerMinute: 2 } });
    try {
      const server = strict.getHttpServer();
      expect((await request(server).get("/api/auth/login")).status).toBe(302);
      expect((await request(server).get("/api/auth/login")).status).toBe(302);
      const third = await request(server).get("/api/auth/login");
      expect(third.status).toBe(429);
      expect(third.headers["retry-after"]).toBe("30");

      const b = browsers.alice as Browser;
      const write = () =>
        request(server)
          .put("/api/admin/registration")
          .set("Cookie", b.cookie)
          .set("Origin", config.publicUrl.origin)
          .set("X-CSRF-Token", b.csrf)
          .send({ autoRegistration: false, defaultRole: "viewer", allowedEmailDomains: [], allowedGroups: [] });
      expect((await write()).status).toBe(200);
      expect((await write()).status).toBe(200);
      expect((await write()).status).toBe(429);
      // Reads are not limited by the write bucket.
      expect((await request(server).get("/api/admin/users").set("Cookie", b.cookie)).status).toBe(200);
    } finally {
      await strict.close();
    }
  });
});
