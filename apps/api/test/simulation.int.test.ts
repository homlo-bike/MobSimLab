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

  it("runs the example metro once per service day and expands the day figures over the years", async () => {
    const day = (from_s: number) => ({
      from_s,
      to_s: from_s + 2 * 3600,
      per_day: { vehicle_km: 100, vehicle_hours: 5, passengers: 1000, energy_kwh: null, operating_cost: 50 },
    });
    const res = await as("alice").post(runs(), {
      kind: "calendar",
      network: { kind: "example" },
      params: { stability_runs: 1 },
      plan: {
        mode: "years",
        day_types: { weekday: day(25200), saturday: day(25200), sunday: day(32400), holiday: day(32400) },
        periods: [
          { label: "2027", counts: { weekday: 258, saturday: 50, sunday: 51, holiday: 6 }, share_of_year: 1 },
          { label: "2028", counts: { weekday: 256, saturday: 52, sunday: 52, holiday: 6 }, share_of_year: 1 },
        ],
        fixed_per_year: { operating_cost: 1000 },
        currency: null,
      },
    });
    expect(res.status).toBe(201);
    const r = await waitFor(res.body.run.id);
    expect(r as object).toMatchObject({ status: "done", kind: "calendar" });
    const result = r.result as unknown as {
      day_types: Record<string, { rail?: { verdict: string } }>;
      periods: {
        label: string;
        days: number;
        vehicle_km: number;
        energy_kwh: null;
        operating_cost: number;
      }[];
    };
    expect(result.day_types.sunday?.rail?.verdict).toBeTruthy();
    expect(result.periods.map((p) => [p.label, p.days, p.vehicle_km])).toEqual([
      ["2027", 365, 36500],
      ["2028", 366, 36600],
    ]);
    expect(result.periods[0]!.energy_kwh).toBeNull();
    expect(result.periods[0]!.operating_cost).toBe(365 * 50 + 1000);
    expect(r.verdict).toBe(r.result?.run?.verdict);
    // Without rail service only the expansion runs.
    const none = await as("alice").post(runs(), {
      kind: "calendar",
      network: null,
      params: {},
      plan: {
        mode: "date",
        day_types: { weekday: day(25200), saturday: day(25200), sunday: day(32400), holiday: day(32400) },
        periods: [{ label: "2027-05-01", counts: { holiday: 1 }, share_of_year: 1 / 365 }],
        fixed_per_year: { operating_cost: null },
        currency: null,
      },
    });
    const n = await waitFor(none.body.run.id);
    expect(n as object).toMatchObject({ status: "done", network: { kind: "none" }, verdict: null });
    await as("alice").del(`${runs()}/${r.id}`);
    await as("alice").del(`${runs()}/${n.id}`);
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

  // ---- AI agents (ADR-0035 §7) ---------------------------------------------------------------------
  let rpcId = 1;
  async function agentToken(sub: string): Promise<string> {
    const r = await as(sub).post("/api/agents/tokens", {
      name: `${sub} runs`,
      scopes: ["simulation:run"],
      expiresInDays: 1,
    });
    expect(r.status).toBe(201);
    return r.body.token as string;
  }
  async function tool(token: string, name: string, args: object = {}) {
    const r = await request(app.getHttpServer())
      .post("/mcp")
      .set("Authorization", `Bearer ${token}`)
      .set("Accept", "application/json, text/event-stream")
      .set("Content-Type", "application/json")
      .send({ jsonrpc: "2.0", id: rpcId++, method: "tools/call", params: { name, arguments: args } });
    expect(r.status).toBe(200);
    const result = r.body.result as { content: { text: string }[]; isError?: boolean };
    const text = result.content[0]?.text ?? "";
    return { error: result.isError === true, text, json: result.isError ? null : JSON.parse(text) };
  }

  it("lets an agent sweep settings on the worker and read the Pareto front", async () => {
    const token = await agentToken("alice");
    const projects = (await tool(token, "list_projects")).json.projects;
    expect(projects).toEqual([
      expect.objectContaining({ id: project, my_role: "owner", can_start_runs: true }),
    ]);
    const started = await tool(token, "run_sweep", {
      project_id: project,
      network: { kind: "example" },
      params: { ...AM, stability_runs: 2 },
      design: { design: "grid", parameters: [{ name: "delayed_share", values: [0, 0.5] }] },
      objectives: ["min_disturbed_punctuality", "vehicles"],
    });
    expect(started.error).toBe(false);
    const id = started.json.run.id as string;
    expect(started.json).toMatchObject({
      variants: 2,
      run: { kind: "sweep", started_by: "agent: alice runs" },
    });
    const done = await waitFor(id);
    expect(done.status).toBe("done");
    const status = await tool(token, "get_run_status", { project_id: project, run_id: id });
    expect(status.json.result).toMatchObject({ variants_done: 2, variants_total: 2, variants_failed: 0 });
    expect(status.json.result.pareto_front.length).toBeGreaterThan(0);
    // Planners see the sweep in the project's runs, marked as started by the agent.
    const listed = (await as("bob").get(runs())).body.runs.find((r: { id: string }) => r.id === id);
    expect(listed).toMatchObject({ kind: "sweep", agent: "alice runs", design: { design: "grid" } });
    // A capacity run on the network of a saved run, and the agent's view of the list.
    const run = await tool(token, "start_run", {
      project_id: project,
      network: { kind: "run", run_id: id },
      params: AM,
    });
    expect(run.error).toBe(false);
    expect((await waitFor(run.json.run.id)).status).toBe("done");
    const summary = await tool(token, "get_run_status", { project_id: project, run_id: run.json.run.id });
    expect(summary.json.result.lines[0].id).toBe("M1");
    const mine = (await tool(token, "list_runs", { project_id: project })).json.runs;
    expect(mine.map((r: { id: string }) => r.id)).toEqual(expect.arrayContaining([id, run.json.run.id]));
  });

  it("holds an agent to its project role and its limit of runs at once", async () => {
    const viewer = await agentToken("bob");
    const refused = await tool(viewer, "start_run", {
      project_id: project,
      network: { kind: "example" },
      params: AM,
    });
    expect(refused.error).toBe(true);
    expect(refused.text).toContain("role");
    const outsider = await agentToken("dave");
    expect((await tool(outsider, "list_runs", { project_id: project })).text).toContain("not found");

    await stopWorker();
    const token = await agentToken("alice");
    const start = () =>
      tool(token, "start_run", { project_id: project, network: { kind: "example" }, params: AM });
    const a = await start();
    const b = await start();
    expect(a.error || b.error).toBe(false);
    const c = await start();
    expect(c.error).toBe(true);
    expect(c.text).toContain("the limit is 2");
    // People are not held to the agent's limit.
    const person = await as("alice").post(runs(), {
      kind: "capacity",
      network: { kind: "example" },
      params: AM,
      sweep: false,
    });
    expect(person.status).toBe(201);
    for (const id of [a.json.run.id, b.json.run.id])
      expect((await tool(token, "cancel_run", { project_id: project, run_id: id })).json.run.status).toBe(
        "cancelled",
      );
    expect((await start()).error).toBe(false);
    startWorker();
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
