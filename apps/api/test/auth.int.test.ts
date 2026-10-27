import type { NestExpressApplication } from "@nestjs/platform-express";
import { Kysely, PostgresDialect } from "kysely";
import { OAuth2Server } from "oauth2-mock-server";
import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetOwner } from "../src/cli/admin";
import type { AppConfig } from "../src/config/env";
import type { DB } from "../src/db/database";
import { createApp, testConfig } from "./support/app";
import { startDatabase, type TestDatabase } from "./support/database";

/** Integration: real PostgreSQL (production init script + migrations) and a mock OIDC provider. */
describe("sign-in, setup mode and audit", () => {
  let db: TestDatabase;
  let idp: OAuth2Server;
  let app: NestExpressApplication;
  let config: AppConfig;
  /** nonce -> claims to put in the ID token for that login. */
  const users = new Map<string, Record<string, unknown>>();

  beforeAll(async () => {
    db = await startDatabase();
    idp = new OAuth2Server();
    await idp.issuer.keys.generate("RS256");
    await idp.start(0, "127.0.0.1");
    idp.service.on("beforeTokenSigning", (token: { payload: Record<string, unknown> }) => {
      const claims = users.get(String(token.payload.nonce));
      if (claims) Object.assign(token.payload, claims);
    });
    config = testConfig({
      db: { host: db.host, port: db.port, name: "mobsimlab" },
      secrets: { ...testConfig().secrets, db_app_password: db.appPassword },
      oidc: { issuer: new URL(String(idp.issuer.url)), clientId: "mobsimlab", allowInsecureHttp: true },
    });
    app = await createApp(config);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await idp?.stop();
    await db?.container.stop();
  });

  const server = () => app.getHttpServer();
  const origin = () => config.publicUrl.origin;
  const cookieValue = (res: request.Response, name: string): string | undefined => {
    const raw = res.headers["set-cookie"] as unknown as string[] | undefined;
    const c = raw?.find((s) => s.startsWith(`${name}=`));
    return c ? decodeURIComponent(c.slice(name.length + 1).split(";")[0] ?? "") : undefined;
  };

  /** Runs the whole browser flow for one user. Returns the callback response. */
  async function signIn(sub: string, email = `${sub}@example.org`): Promise<request.Response> {
    const start = await request(server()).get("/api/auth/login");
    expect(start.status).toBe(302);
    const authorize = new URL(start.headers.location as string);
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    users.set(authorize.searchParams.get("nonce") ?? "", { sub, email, email_verified: true, name: sub });
    const flow = cookieValue(start, "msl_auth_flow");
    const idpRes = await fetch(authorize, { redirect: "manual" });
    const back = new URL(idpRes.headers.get("location") ?? "");
    return request(server()).get(`${back.pathname}${back.search}`).set("Cookie", `msl_auth_flow=${flow}`);
  }

  const session = (res: request.Response) => `msl_session=${cookieValue(res, "msl_session")}`;
  async function me(cookie: string) {
    return (await request(server()).get("/api/auth/me").set("Cookie", cookie)).body;
  }

  it("starts in setup mode and refuses everything that needs a session", async () => {
    const body = (await request(server()).get("/api/auth/me")).body;
    expect(body).toMatchObject({ instance: { mode: "setup" }, signInAvailable: true });
    expect(body.user).toBeUndefined();
    expect((await request(server()).get("/api/setup")).status).toBe(401);
  });

  it("makes exactly one Owner when two people sign in at the same time", async () => {
    const [a, b] = await Promise.all([signIn("alice"), signIn("bob")]);
    const locations = [a.headers.location, b.headers.location].sort();
    expect(locations).toEqual(["/", "/?signin=setup_in_progress"]);
    const sql = await db.superuser();
    const owners = await sql.query("SELECT email FROM iam.user WHERE instance_role = 'owner'");
    await sql.end();
    expect(owners.rowCount).toBe(1);
  });

  it("lets the Owner sign in again during setup and refuses others", async () => {
    const sql = await db.superuser();
    const { rows } = await sql.query<{ email: string }>(
      "SELECT email FROM iam.user WHERE instance_role = 'owner'",
    );
    await sql.end();
    const ownerSub = rows[0]?.email.split("@")[0] ?? "";
    const other = ownerSub === "alice" ? "bob" : "alice";
    const ok = await signIn(ownerSub);
    expect(ok.headers.location).toBe("/");
    const m = await me(session(ok));
    expect(m.user).toMatchObject({ role: "owner", email: `${ownerSub}@example.org` });
    expect(m.csrfToken).toBeTruthy();
    expect((await signIn(other)).headers.location).toBe("/?signin=setup_in_progress");
    expect((await signIn("carol")).headers.location).toBe("/?signin=setup_in_progress");
  });

  it("rejects a callback without the browser-bound state cookie", async () => {
    const start = await request(server()).get("/api/auth/login");
    const authorize = new URL(start.headers.location as string);
    users.set(authorize.searchParams.get("nonce") ?? "", { sub: "mallory" });
    const idpRes = await fetch(authorize, { redirect: "manual" });
    const back = new URL(idpRes.headers.get("location") ?? "");
    const res = await request(server()).get(`${back.pathname}${back.search}`);
    expect(res.headers.location).toBe("/?signin=invalid_request");
  });

  it("runs the setup wizard with CSRF and Origin checks, then opens the instance", async () => {
    const sql = await db.superuser();
    const { rows } = await sql.query<{ email: string }>(
      "SELECT email FROM iam.user WHERE instance_role = 'owner'",
    );
    await sql.end();
    const cookie = session(await signIn(rows[0]?.email.split("@")[0] ?? ""));
    const { csrfToken } = await me(cookie);

    const put = (body: object) =>
      request(server()).put("/api/setup/instance").set("Cookie", cookie).set("Origin", origin()).send(body);
    expect((await put({ name: "Köln planning" })).status).toBe(403); // no CSRF token
    expect(
      (
        await request(server())
          .put("/api/setup/instance")
          .set("Cookie", cookie)
          .set("Origin", "https://evil.example")
          .set("X-CSRF-Token", csrfToken)
          .send({ name: "x" })
      ).status,
    ).toBe(403);
    expect((await put({ name: "Köln planning", extra: 1 }).set("X-CSRF-Token", csrfToken)).status).toBe(400);
    const ok = await put({ name: "Köln planning" }).set("X-CSRF-Token", csrfToken);
    expect(ok.status).toBe(200);

    const fin = await request(server())
      .post("/api/setup/finish")
      .set("Cookie", cookie)
      .set("Origin", origin())
      .set("X-CSRF-Token", csrfToken);
    expect(fin.status).toBe(200);
    expect((await me(cookie)).instance).toEqual({ mode: "open", name: "Köln planning" });
  });

  it("puts new users on hold until approved when auto-registration is off", async () => {
    expect((await signIn("dave")).headers.location).toBe("/?signin=pending_approval");
    expect((await signIn("dave")).headers.location).toBe("/?signin=pending_approval");
    const sql = await db.superuser();
    const { rows } = await sql.query(
      "SELECT status, instance_role FROM iam.user WHERE email = 'dave@example.org'",
    );
    await sql.end();
    expect(rows).toEqual([{ status: "pending", instance_role: "viewer" }]);
  });

  it("refuses the setup wizard to non-owners and ends sessions on logout", async () => {
    const sql = await db.superuser();
    await sql.query("UPDATE iam.user SET status = 'active' WHERE email = 'dave@example.org'");
    await sql.end();
    const cookie = session(await signIn("dave"));
    const { csrfToken, user } = await me(cookie);
    expect(user.role).toBe("viewer");
    expect((await request(server()).get("/api/setup").set("Cookie", cookie)).status).toBe(403);

    const out = await request(server())
      .post("/api/auth/logout")
      .set("Cookie", cookie)
      .set("Origin", origin())
      .set("X-CSRF-Token", csrfToken);
    expect(out.status).toBe(200);
    expect(out.body.endSessionUrl).toContain("/endsession");
    expect((await me(cookie)).user).toBeUndefined();
  });

  it("keeps an intact audit chain and detects tampering", async () => {
    const sql = await db.superuser();
    const actions = await sql.query<{ action: string }>("SELECT action FROM audit.record ORDER BY seq");
    expect(actions.rows.map((r) => r.action)).toEqual(
      expect.arrayContaining([
        "instance.owner_claimed",
        "auth.login",
        "instance.updated",
        "instance.setup_finished",
        "user.registered",
        "auth.logout",
      ]),
    );
    expect((await sql.query("SELECT audit.verify('instance') AS b")).rows[0].b).toBeNull();

    // The app role cannot write audit records directly.
    const appPool = new Pool({
      host: db.host,
      port: db.port,
      database: "mobsimlab",
      user: "mobsimlab_app",
      password: db.appPassword,
    });
    await expect(appPool.query("UPDATE audit.record SET reason = 'x'")).rejects.toThrow(/permission denied/);
    await expect(appPool.query("DELETE FROM audit.record")).rejects.toThrow(/permission denied/);
    await appPool.end();

    await sql.query("UPDATE audit.record SET reason = 'edited' WHERE seq = 2 AND chain = 'instance'");
    expect((await sql.query("SELECT audit.verify('instance') AS b")).rows[0].b).toBe("2");
    await sql.query("UPDATE audit.record SET reason = NULL WHERE seq = 2 AND chain = 'instance'");
    expect((await sql.query("SELECT audit.verify('instance') AS b")).rows[0].b).toBeNull();
    await sql.end();
  });

  it("reset-owner returns the instance to setup mode and the next sign-in becomes Owner", async () => {
    const k = new Kysely<DB>({
      dialect: new PostgresDialect({
        pool: new Pool({
          host: db.host,
          port: db.port,
          database: "mobsimlab",
          user: "mobsimlab_app",
          password: db.appPassword,
        }),
      }),
    });
    expect(await resetOwner(k)).toBe(1);
    await k.destroy();
    const res = await signIn("erin");
    expect(res.headers.location).toBe("/");
    expect((await me(session(res))).user.role).toBe("owner");
  });
});
