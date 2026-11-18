import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config/env";
import { createApp, testConfig } from "./support/app";
import { startDatabase, type TestDatabase } from "./support/database";
import { cookieValue, signIn, startIdp, type TestIdp } from "./support/idp";

/** Integration: comments on project objects and the project roles that may write them. */
describe("comments", () => {
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
      del: (path: string) => write(request(server).delete(path)).send({}),
    };
  };

  let project = "";
  const url = (rest = "") => `/api/projects/${project}/comments${rest}`;

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
    for (const who of ["bob", "carol", "dave", "erin"]) await login(who);
    project = (await as("alice").post("/api/projects", { name: "Riverside" })).body.project.id;
    const roles = { bob: "editor", carol: "commenter", dave: "viewer" } as const;
    for (const [who, role] of Object.entries(roles))
      expect(
        (await as("alice").post(`/api/projects/${project}/members`, { email: `${who}@example.org`, role }))
          .status,
      ).toBe(201);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await idp?.server.stop();
    await db?.container.stop();
  });

  let thread = "";

  it("lets a Commenter start a thread on an object and everyone with access read it", async () => {
    const res = await as("carol").post(url(), {
      objectType: "station",
      objectId: "7",
      body: "  Too close to 6?  ",
    });
    expect(res.status).toBe(201);
    expect(res.body.comment).toMatchObject({
      objectType: "station",
      objectId: "7",
      parentId: null,
      body: "Too close to 6?",
      author: { id: browsers.carol?.id },
      resolvedAt: null,
    });
    thread = res.body.comment.id;
    for (const who of ["alice", "bob", "carol", "dave"]) {
      const list = await as(who).get(url());
      expect(list.status).toBe(200);
      expect(list.body.comments.map((c: { id: string }) => c.id)).toEqual([thread]);
    }
  });

  it("keeps Viewers and outsiders from writing, and outsiders from reading", async () => {
    expect((await as("dave").post(url(), { objectType: "track", objectId: "1", body: "hi" })).status).toBe(
      403,
    );
    expect((await as("erin").get(url())).status).toBe(404);
    expect((await as("erin").post(url(), { objectType: "track", objectId: "1", body: "hi" })).status).toBe(
      404,
    );
  });

  it("checks the object type and the text", async () => {
    expect((await as("bob").post(url(), { objectType: "planet", objectId: "1", body: "hi" })).status).toBe(
      400,
    );
    expect((await as("bob").post(url(), { objectType: "depot", objectId: "d1", body: "   " })).status).toBe(
      400,
    );
    const long = "x".repeat(4001);
    expect((await as("bob").post(url(), { objectType: "depot", objectId: "d1", body: long })).status).toBe(
      400,
    );
  });

  it("puts replies on the thread's object and refuses replies to replies", async () => {
    const reply = await as("bob").post(url(), {
      objectType: "depot",
      objectId: "elsewhere",
      body: "Agreed, move it",
      parentId: thread,
    });
    expect(reply.status).toBe(201);
    expect(reply.body.comment).toMatchObject({ objectType: "station", objectId: "7", parentId: thread });
    const nested = await as("carol").post(url(), {
      objectType: "station",
      objectId: "7",
      body: "nested",
      parentId: reply.body.comment.id,
    });
    expect(nested.status).toBe(400);
  });

  it("lets only the author edit a comment", async () => {
    expect((await as("bob").patch(url(`/${thread}`), { body: "changed" })).status).toBe(403);
    const res = await as("carol").patch(url(`/${thread}`), { body: "Too close to station 6?" });
    expect(res.status).toBe(200);
    expect(res.body.comment.body).toBe("Too close to station 6?");
    expect(res.body.comment.editedAt).not.toBeNull();
  });

  it("resolves and reopens whole threads only", async () => {
    const resolved = await as("bob").put(url(`/${thread}/resolved`), { resolved: true });
    expect(resolved.status).toBe(200);
    expect(resolved.body.comment.resolvedBy).toMatchObject({ id: browsers.bob?.id });
    const reply = (await as("alice").get(url())).body.comments.find(
      (c: { parentId: string | null }) => c.parentId,
    );
    expect((await as("bob").put(url(`/${reply.id}/resolved`), { resolved: true })).status).toBe(400);
    expect((await as("dave").put(url(`/${thread}/resolved`), { resolved: false })).status).toBe(403);
    const reopened = await as("carol").put(url(`/${thread}/resolved`), { resolved: false });
    expect(reopened.body.comment.resolvedAt).toBeNull();
  });

  it("lets authors delete their own comments and the Owner delete any, with the replies", async () => {
    const other = await as("bob").post(url(), {
      objectType: "track",
      objectId: "3",
      body: "Check the radius",
    });
    expect((await as("carol").del(url(`/${other.body.comment.id}`))).status).toBe(403);
    expect((await as("bob").del(url(`/${other.body.comment.id}`))).status).toBe(200);
    expect((await as("alice").del(url(`/${thread}`))).status).toBe(200);
    expect((await as("alice").get(url())).body.comments).toEqual([]);
  });

  it("audits comment changes without their text", async () => {
    const su = await db.superuser();
    try {
      const rows = await su.query(
        "SELECT action, after FROM audit.record WHERE chain = $1 AND action LIKE 'comment.%' ORDER BY seq",
        [`project:${project}`],
      );
      expect(rows.rows.map((r) => r.action)).toEqual([
        "comment.added",
        "comment.added",
        "comment.edited",
        "comment.resolved",
        "comment.reopened",
        "comment.added",
        "comment.deleted",
        "comment.deleted",
      ]);
      expect(JSON.stringify(rows.rows)).not.toContain("Too close");
    } finally {
      await su.end();
    }
  });

  it("lists new comments and replies by others in the bell until they are read", async () => {
    const first = (
      await as("bob").post(url(), { objectType: "station", objectId: "7", body: "Platform too short" })
    ).body.comment;
    const mine = await as("alice").get("/api/comments/new");
    expect(mine.status).toBe(200);
    const notice = mine.body.comments.find((c: { id: string }) => c.id === first.id);
    expect(notice).toMatchObject({ projectId: project, projectName: "Riverside", objectType: "station" });
    expect(mine.body.total).toBeGreaterThanOrEqual(1);
    // Not one's own comments, and nothing for people who are not members.
    const bobs = (await as("bob").get("/api/comments/new")).body.comments;
    expect(bobs.some((c: { id: string }) => c.id === first.id)).toBe(false);
    expect((await as("erin").get("/api/comments/new")).body).toEqual({ total: 0, comments: [] });

    expect((await as("alice").post("/api/comments/read", { ids: [first.id] })).status).toBe(201);
    const after = (await as("alice").get("/api/comments/new")).body.comments;
    expect(after.some((c: { id: string }) => c.id === first.id)).toBe(false);
    // The read mark is per person: the Commenter still sees the Editor's comment.
    const carols = (await as("carol").get("/api/comments/new")).body.comments;
    expect(carols.some((c: { id: string }) => c.id === first.id)).toBe(true);

    const reply = (
      await as("carol").post(url(), {
        objectType: "station",
        objectId: "7",
        body: "Agreed",
        parentId: first.id,
      })
    ).body.comment;
    const again = (await as("alice").get("/api/comments/new")).body.comments;
    expect(again.find((c: { id: string }) => c.id === reply.id)).toMatchObject({ parentId: first.id });

    expect((await as("alice").post("/api/comments/read", { all: true })).status).toBe(201);
    expect((await as("alice").get("/api/comments/new")).body).toEqual({ total: 0, comments: [] });
    expect((await as("alice").post("/api/comments/read", { ids: ["nope"] })).status).toBe(400);
  });

  it("stops a Commenter from writing once their role is lowered to Viewer", async () => {
    await as("alice").put(`/api/projects/${project}/members/${browsers.carol?.id}`, { role: "viewer" });
    expect((await as("carol").post(url(), { objectType: "signal", objectId: "2", body: "hi" })).status).toBe(
      403,
    );
  });
});
