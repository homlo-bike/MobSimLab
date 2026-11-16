import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config/env";
import { WORKER_STOPPED } from "../src/simulation/runs.service";
import { createApp, testConfig } from "./support/app";
import { startDatabase, type TestDatabase } from "./support/database";
import { cookieValue, signIn, startIdp, type TestIdp } from "./support/idp";

/**
 * The Python sim-worker, as built for development: `cd worker && uv sync` and the Rust kernels installed with
 * `uv pip install maturin && uv run maturin develop --release -m ../crates/mobsim-py/Cargo.toml`. Without it
 * these tests are skipped.
 */
const WORKER = join(__dirname, "..", "..", "..", "worker", ".venv", "bin", "mobsim-worker");
const haveWorker = existsSync(WORKER);

type Run = {
  id: string;
  status: string;
  verdict: string | null;
  error: string | null;
  result: { run: { verdict: string } | null; lines: { info: { id: string }; sweep: unknown[] }[] } | null;
};

/**
 * Integration: simulation runs saved with the project and run by the real Python worker through pg-boss, so
 * the worker's queue SQL (worker/src/mobsim_worker/queue.py) is tested against the pinned pg-boss schema.
 */
describe.skipIf(!haveWorker)("simulation runs on the background worker", () => {
  let db: TestDatabase;
  let idp: TestIdp;
  let app: NestExpressApplication;
  let config: AppConfig;
  let worker: ChildProcess | null = null;
  let secretsDir = "";
  let project = "";
  const browsers: Record<string, { cookie: string; csrf: string; id: string }> = {};

  async function login(sub: string): Promise<void> {
    const res = await signIn(app, idp, sub);
    const token = cookieValue(res, "msl_session");
    if (!token) throw new Error(`${sub} could not sign in`);
    const cookie = `msl_session=${token}`;
    const me = (await request(app.getHttpServer()).get("/api/auth/me").set("Cookie", cookie)).body;
    browsers[sub] = { cookie, csrf: me.csrfToken, id: me.user.id };
  }

  const as = (sub: string) => {
    const b = browsers[sub]!;
    const server = app.getHttpServer();
    return {
      get: (path: string) => request(server).get(path).set("Cookie", b.cookie),
      post: (path: string, body: object = {}) =>
        request(server)
          .post(path)
          .set("Cookie", b.cookie)
          .set("Origin", config.publicUrl.origin)
          .set("X-CSRF-Token", b.csrf)
          .send(body),
      del: (path: string) =>
        request(server)
          .delete(path)
          .set("Cookie", b.cookie)
          .set("Origin", config.publicUrl.origin)
          .set("X-CSRF-Token", b.csrf),
      put: (path: string, body: object) =>
        request(server)
          .put(path)
          .set("Cookie", b.cookie)
          .set("Origin", config.publicUrl.origin)
          .set("X-CSRF-Token", b.csrf)
          .send(body),
    };
  };

  const runs = () => `/api/projects/${project}/simulation-runs`;
  const AM = { from_s: 7 * 3600, to_s: 9 * 3600 };

  function startWorker(): void {
    worker = spawn(WORKER, [], {
      env: {
        PATH: process.env.PATH ?? "",
        MOBSIMLAB_DB_HOST: db.host,
        MOBSIMLAB_DB_PORT: String(db.port),
        MOBSIMLAB_SECRETS_DIR: secretsDir,
        // Two processes, as an install with MOBSIMLAB_SIM_WORKERS=2 runs: every job goes to exactly one.
        MOBSIMLAB_SIM_WORKERS: "2",
      },
      stdio: ["ignore", "ignore", "inherit"],
    });
  }

  async function stopWorker(): Promise<void> {
    const w = worker;
    worker = null;
    if (!w || w.exitCode !== null) return;
    await new Promise<void>((done) => {
      w.once("exit", () => done());
      w.kill("SIGTERM");
    });
  }

  /** Purpose: wait until the run is settled (or has the wanted status). */
  async function waitFor(
    id: string,
    until: (r: Run) => boolean = (r) => !["queued", "running"].includes(r.status),
  ) {
    for (let i = 0; i < 300; i++) {
      const r = (await as("alice").get(`${runs()}/${id}`)).body.run as Run;
      if (until(r)) return r;
      await new Promise((ok) => setTimeout(ok, 200));
    }
    throw new Error(`run ${id} did not settle`);
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
    await as("alice").put("/api/admin/registration", {
      autoRegistration: true,
      defaultRole: "user",
      allowedEmailDomains: [],
      allowedGroups: [],
    });
    await login("bob");
    await login("dave");
    project = (await as("alice").post("/api/projects", { name: "Capacity", modes: ["metro"] })).body.project
      .id;
    await as("alice").post(`/api/projects/${project}/members`, { email: "bob@example.org", role: "viewer" });
    secretsDir = mkdtempSync(join(tmpdir(), "msl-worker-"));
    writeFileSync(join(secretsDir, "db_worker_password"), db.workerPassword);
    startWorker();
  }, 180_000);

  afterAll(async () => {
    await stopWorker();
    await app?.close();
    await idp?.server.stop();
    await db?.container.stop();
    if (secretsDir) rmSync(secretsDir, { recursive: true, force: true });
  });

  it("starts with no runs, and only Owners and Editors may start one", async () => {
    expect((await as("alice").get(runs())).body).toEqual({ runs: [] });
    const body = { kind: "capacity", network: { kind: "example" }, params: AM, sweep: false };
    expect((await as("bob").post(runs(), body)).status).toBe(403);
    expect((await as("dave").get(runs())).status).toBe(404);
    expect((await as("alice").post(runs(), { ...body, params: { from_s: 10, to_s: 5 } })).status).toBe(400);
    expect((await as("alice").post(runs(), { ...body, params: { ...AM, nonsense: 1 } })).status).toBe(400);
  });

  it("runs the example metro on the worker and saves it for every member", async () => {
    const res = await as("alice").post(runs(), {
      kind: "capacity",
      network: { kind: "example" },
      params: AM,
      sweep: true,
    });
    expect(res.status).toBe(201);
    expect(res.body.run).toMatchObject({ status: "queued", sweep: true, network: { kind: "example" } });
    const done = await waitFor(res.body.run.id);
    expect(done.status).toBe("done");
    expect(done.error).toBeNull();
    expect(done.result?.lines[0]?.info.id).toBe("M1");
    expect(done.result?.lines[0]?.sweep.length).toBeGreaterThan(0);
    expect(done.verdict).toBe(done.result?.run?.verdict);
    // A Viewer of the project sees the saved run and its result.
    const list = (await as("bob").get(runs())).body.runs;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: done.id, status: "done", createdBy: { id: browsers.alice!.id } });
    expect((await as("bob").get(`${runs()}/${done.id}`)).body.run.result).toEqual(done.result);
    expect((await as("bob").post(`${runs()}/${done.id}/cancel`)).status).toBe(403);
  });

  it("reports a network the kernel cannot read", async () => {
    const res = await as("alice").post(runs(), {
      kind: "capacity",
      network: { kind: "files", topology: "{}", topologyName: "t.json", lines: "[]", linesName: "l.json" },
      params: AM,
      sweep: false,
    });
    const r = await waitFor(res.body.run.id);
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/topology/);
    expect((await as("alice").get(`${runs()}/${r.id}`)).body.run.network).toEqual({
      kind: "files",
      topologyName: "t.json",
      linesName: "l.json",
    });
  });

  it("stops a run that is cancelled, and keeps what it found", async () => {
    const res = await as("alice").post(runs(), {
      kind: "capacity",
      network: { kind: "example" },
      params: AM,
      sweep: true,
    });
    const id = res.body.run.id as string;
    const cancel = await as("alice").post(`${runs()}/${id}/cancel`);
    expect(cancel.status).toBe(200);
    const r = await waitFor(id);
    expect(r.status).toBe("cancelled");
  });

  it("gives the worker role only what it needs", async () => {
    const su = await db.superuser();
    try {
      await su.query("SET ROLE mobsimlab_worker");
      await expect(su.query("SELECT created_by FROM simulation.run")).rejects.toThrow(/permission denied/);
      await expect(su.query("UPDATE simulation.run SET cancel_requested = true")).rejects.toThrow(
        /permission denied/,
      );
      await expect(su.query("SELECT * FROM project.project")).rejects.toThrow(/permission denied/);
      await expect(su.query("DELETE FROM pgboss.job")).rejects.toThrow(/permission denied/);
    } finally {
      await su.end();
    }
  });

  it("runs a saved run again in place, replacing its result", async () => {
    const res = await as("alice").post(runs(), {
      kind: "capacity",
      network: { kind: "files", topology: "{}", topologyName: "t.json", lines: "[]", linesName: "l.json" },
      params: AM,
      sweep: false,
    });
    const id = res.body.run.id as string;
    const failed = await waitFor(id);
    expect(failed.status).toBe("failed");
    expect((await as("bob").post(`${runs()}/${id}/rerun`)).status).toBe(403);
    const again = await as("alice").post(`${runs()}/${id}/rerun`);
    expect(again.status).toBe(200);
    expect(again.body.run).toMatchObject({ id, status: "queued", error: null, result: null });
    // Running again while it is still going is refused.
    const twice = await as("alice").post(`${runs()}/${id}/rerun`);
    expect([200, 409]).toContain(twice.status);
    const r = await waitFor(id);
    expect(r.status).toBe("failed");
    expect((await as("alice").get(runs())).body.runs.filter((x: { id: string }) => x.id === id)).toHaveLength(
      1,
    );
  });

  it("deletes a saved run for everyone", async () => {
    const res = await as("alice").post(runs(), {
      kind: "capacity",
      network: { kind: "example" },
      params: AM,
      sweep: false,
    });
    const id = res.body.run.id as string;
    await waitFor(id);
    expect((await as("bob").del(`${runs()}/${id}`)).status).toBe(403);
    expect((await as("alice").del(`${runs()}/${id}`)).status).toBe(200);
    expect((await as("bob").get(`${runs()}/${id}`)).status).toBe(404);
    expect((await as("alice").del(`${runs()}/${id}`)).status).toBe(404);
    // A run deleted while it is still going is stopped, and the worker carries on with the next one.
    const going = await as("alice").post(runs(), {
      kind: "capacity",
      network: { kind: "example" },
      params: AM,
      sweep: true,
    });
    expect((await as("alice").del(`${runs()}/${going.body.run.id}`)).status).toBe(200);
    const next = await as("alice").post(runs(), {
      kind: "capacity",
      network: { kind: "example" },
      params: AM,
      sweep: false,
    });
    expect((await waitFor(next.body.run.id)).status).toBe("done");
  });

  it("marks a run failed when the worker stops without finishing it", async () => {
    await stopWorker();
    const res = await as("alice").post(runs(), {
      kind: "capacity",
      network: { kind: "example" },
      params: AM,
      sweep: false,
    });
    const id = res.body.run.id as string;
    expect((await as("alice").get(`${runs()}/${id}`)).body.run.status).toBe("queued");
    // What pg-boss's supervisor does when a worker took the job and stopped beating.
    const su = await db.superuser();
    try {
      await su.query(
        "UPDATE pgboss.job SET state = 'failed' FROM simulation.run r WHERE r.id = $1 AND pgboss.job.id = r.job_id",
        [id],
      );
    } finally {
      await su.end();
    }
    const r = (await as("alice").get(`${runs()}/${id}`)).body.run as Run;
    expect(r).toMatchObject({ status: "failed", error: WORKER_STOPPED });
  });
});
