import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config/env";
import { createApp, testConfig } from "./support/app";
import { startDatabase, type TestDatabase } from "./support/database";
import { cookieValue, signIn, startIdp, type TestIdp } from "./support/idp";

/** Integration: projects home actions, project roles and per-user preferences. */
describe("projects", () => {
  let db: TestDatabase;
  let idp: TestIdp;
  let app: NestExpressApplication;
  let config: AppConfig;
  const browsers: Record<string, { cookie: string; csrf: string; id: string }> = {};

  async function login(sub: string): Promise<void> {
    const res = await signIn(app, idp, sub);
    const token = cookieValue(res, "msl_session");
    if (!token) throw new Error(`${sub} could not sign in: ${String(res.headers.location)}`);
    const cookie = `msl_session=${token}`;
    const me = (await request(app.getHttpServer()).get("/api/auth/me").set("Cookie", cookie)).body;
    browsers[sub] = { cookie, csrf: me.csrfToken, id: me.user.id };
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
    await login("bob");
    await login("carol");
    // Carol is a Viewer on the instance: read-only on every project, whatever her project role.
    await as("alice").patch(`/api/admin/users/${browsers.carol?.id}`, { role: "viewer" });
    await login("carol");
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await idp?.server.stop();
    await db?.container.stop();
  });

  let lakeside = "";

  it("creates a project owned by the creator and lists it on their home only", async () => {
    const res = await as("alice").post("/api/projects", {
      name: "Lakeside network",
      areaName: "Lakeside",
      modes: ["bus", "tram", "tram"],
    });
    expect(res.status).toBe(201);
    expect(res.body.project).toMatchObject({
      name: "Lakeside network",
      myRole: "owner",
      modes: ["bus", "tram"],
      memberCount: 1,
      owner: { id: browsers.alice?.id },
    });
    lakeside = res.body.project.id;
    expect((await as("alice").get("/api/projects")).body.projects.map((p: { id: string }) => p.id)).toEqual([
      lakeside,
    ]);
    expect((await as("bob").get("/api/projects")).body.projects).toEqual([]);
    // Someone without access cannot tell the project exists.
    expect((await as("bob").get(`/api/projects/${lakeside}`)).status).toBe(404);
    expect((await as("carol").post("/api/projects", { name: "Nope" })).status).toBe(403);
    expect((await as("alice").post("/api/projects", { name: "  " })).status).toBe(400);
  });

  it("shares with people by e-mail and caps the role by the instance role", async () => {
    const add = await as("alice").post(`/api/projects/${lakeside}/members`, {
      email: "BOB@example.org",
      role: "editor",
    });
    expect(add.status).toBe(201);
    expect(add.body.members.map((m: { role: string }) => m.role)).toEqual(["owner", "editor"]);
    await as("alice").post(`/api/projects/${lakeside}/members`, {
      email: "carol@example.org",
      role: "editor",
    });
    expect(
      (
        await as("alice").post(`/api/projects/${lakeside}/members`, {
          email: "bob@example.org",
          role: "viewer",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await as("alice").post(`/api/projects/${lakeside}/members`, {
          email: "zed@example.org",
          role: "viewer",
        })
      ).status,
    ).toBe(404);

    expect((await as("bob").get("/api/projects")).body.projects[0].myRole).toBe("editor");
    expect((await as("carol").get("/api/projects")).body.projects[0].myRole).toBe("viewer");
    // Editors rename; Viewers cannot; only the owner manages access.
    expect(
      (await as("bob").patch(`/api/projects/${lakeside}`, { name: "Lakeside 2030" })).body.project.name,
    ).toBe("Lakeside 2030");
    expect((await as("carol").patch(`/api/projects/${lakeside}`, { name: "x" })).status).toBe(403);
    expect(
      (
        await as("bob").post(`/api/projects/${lakeside}/members`, {
          email: "carol@example.org",
          role: "viewer",
        })
      ).status,
    ).toBe(403);
    expect((await as("bob").post(`/api/projects/${lakeside}/archive`)).status).toBe(403);

    const role = await as("alice").put(`/api/projects/${lakeside}/members/${browsers.bob?.id}`, {
      role: "viewer",
    });
    expect(role.body.members.find((m: { userId: string }) => m.userId === browsers.bob?.id).role).toBe(
      "viewer",
    );
    expect(
      (await as("alice").put(`/api/projects/${lakeside}/members/${browsers.alice?.id}`, { role: "viewer" }))
        .status,
    ).toBe(409);
  });

  it("lets a member leave and the owner remove members", async () => {
    expect((await as("carol").del(`/api/projects/${lakeside}/members/${browsers.carol?.id}`)).status).toBe(
      200,
    );
    expect((await as("carol").get("/api/projects")).body.projects).toEqual([]);
    expect((await as("bob").del(`/api/projects/${lakeside}/members/${browsers.alice?.id}`)).status).toBe(403);
    expect((await as("alice").del(`/api/projects/${lakeside}/members/${browsers.alice?.id}`)).status).toBe(
      409,
    );
  });

  it("opens through the view-only link for anyone signed in", async () => {
    expect((await as("carol").get(`/api/projects/${lakeside}`)).status).toBe(404);
    expect(
      (await as("alice").put(`/api/projects/${lakeside}/link`, { linkAccess: true })).body.project.linkAccess,
    ).toBe(true);
    const viaLink = await as("carol").get(`/api/projects/${lakeside}`);
    expect(viaLink.body.project).toMatchObject({ myRole: "viewer", viaLink: true });
    // The link does not put the project on Carol's home.
    expect((await as("carol").get("/api/projects")).body.projects).toEqual([]);
  });

  it("duplicates into a project the caller owns", async () => {
    const dup = await as("bob").post(`/api/projects/${lakeside}/duplicate`);
    expect(dup.status).toBe(201);
    expect(dup.body.project).toMatchObject({ name: "Lakeside 2030 (copy)", myRole: "owner", memberCount: 1 });
    const names = (await as("bob").get("/api/projects")).body.projects.map((p: { name: string }) => p.name);
    expect(names.sort()).toEqual(["Lakeside 2030", "Lakeside 2030 (copy)"]);
  });

  it("archives for everyone and brings back", async () => {
    expect(
      (await as("alice").post(`/api/projects/${lakeside}/archive`)).body.project.archivedAt,
    ).toBeTruthy();
    expect((await as("bob").get("/api/projects")).body.projects.map((p: { name: string }) => p.name)).toEqual(
      ["Lakeside 2030 (copy)"],
    );
    expect((await as("bob").get("/api/projects?archived=true")).body.projects[0].id).toBe(lakeside);
    expect((await as("alice").post(`/api/projects/${lakeside}/archive`)).status).toBe(409);
    expect(
      (await as("alice").post(`/api/projects/${lakeside}/unarchive`)).body.project.archivedAt,
    ).toBeNull();
  });

  it("deletes only when the owner types the name, and audits each change on the project's chain", async () => {
    expect((await as("alice").del(`/api/projects/${lakeside}`, { confirmName: "Lakeside" })).status).toBe(
      400,
    );
    expect((await as("bob").del(`/api/projects/${lakeside}`, { confirmName: "Lakeside 2030" })).status).toBe(
      403,
    );
    expect(
      (await as("alice").del(`/api/projects/${lakeside}`, { confirmName: "Lakeside 2030" })).status,
    ).toBe(200);
    expect((await as("alice").get(`/api/projects/${lakeside}`)).status).toBe(404);
    expect((await as("bob").get("/api/projects")).body.projects).toHaveLength(1);

    const sql = await db.superuser();
    const { rows } = await sql.query<{ action: string }>(
      "SELECT action FROM audit.record WHERE chain = $1 ORDER BY seq",
      [`project:${lakeside}`],
    );
    const verify = await sql.query<{ broken: string | null }>("SELECT audit.verify($1) AS broken", [
      `project:${lakeside}`,
    ]);
    await sql.end();
    expect(rows.map((r) => r.action)).toEqual([
      "project.created",
      "project.member_added",
      "project.member_added",
      "project.updated",
      "project.member_role_changed",
      "project.member_left",
      "project.link_access_changed",
      "project.duplicated",
      "project.archived",
      "project.unarchived",
      "project.deleted",
    ]);
    expect(verify.rows[0]?.broken).toBeNull();
  });

  it("stores the language and other preferences on the account", async () => {
    expect((await as("bob").get("/api/auth/me")).body.user.preferences).toEqual({});
    const put = await as("bob").put("/api/auth/preferences", { language: "de", units: "metric" });
    expect(put.body.preferences).toEqual({ language: "de", units: "metric" });
    await as("bob").put("/api/auth/preferences", { language: "system" });
    expect((await as("bob").get("/api/auth/me")).body.user.preferences).toEqual({
      language: "system",
      units: "metric",
    });
    expect((await as("bob").put("/api/auth/preferences", { language: "<script>" })).status).toBe(400);
    expect((await as("bob").put("/api/auth/preferences", { colour: "red" })).status).toBe(400);
  });
});
