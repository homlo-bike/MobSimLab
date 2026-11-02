import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TILE_SOURCE, type TileSource } from "../src/agents/network.service";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/app.setup";
import type { AppConfig } from "../src/config/env";
import { testConfig } from "./support/app";
import { startDatabase, type TestDatabase } from "./support/database";
import { cookieValue, signIn, startIdp, type TestIdp } from "./support/idp";

/** The WebAssembly kernels must be built (tools/wasm/build-api.sh); CI builds them before the tests. */
const WASM = existsSync(join(__dirname, "..", "wasm", "street-routing", "street_routing_wasm.js"));

const LON0 = 7.0;
const LAT0 = 50.0;
const DLAT = 1 / 111_195;
const DLON = 1 / (111_195 * Math.cos((LAT0 * Math.PI) / 180));
const ll = (x: number, y: number): [number, number] => [LON0 + x * DLON, LAT0 + y * DLAT];

/** A 2 km × 2 km grid of residential streets every 100 m around (7°E, 50°N), as one OSM tile. */
function gridXml(): string {
  const id = (i: number, j: number) => 1 + (i + 10) * 100 + (j + 10);
  let xml = "<osm>";
  for (let i = -10; i <= 10; i++)
    for (let j = -10; j <= 10; j++) {
      const [lon, lat] = ll(i * 100, j * 100);
      xml += `<node id="${id(i, j)}" lat="${lat}" lon="${lon}"/>`;
    }
  let w = 1;
  for (let i = -10; i <= 10; i++) {
    for (const nodes of [
      Array.from({ length: 21 }, (_, j) => id(j - 10, i)),
      Array.from({ length: 21 }, (_, j) => id(i, j - 10)),
    ]) {
      xml += `<way id="${w++}">${nodes.map((n) => `<nd ref="${n}"/>`).join("")}<tag k="highway" v="residential"/></way>`;
    }
  }
  return `${xml}</osm>`;
}

const EMPTY = "<osm></osm>";
/** Every tile but the one holding the grid is empty. */
function tiles(): TileSource {
  const grid = gridXml();
  const holds = (x: number, y: number) => {
    const n = 2 ** 14;
    const lon0 = (x / n) * 360 - 180;
    const lon1 = ((x + 1) / n) * 360 - 180;
    const lat = (j: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * j) / n))) * 180) / Math.PI;
    return LON0 >= lon0 && LON0 < lon1 && LAT0 <= lat(y) && LAT0 > lat(y + 1);
  };
  return {
    tile: async (x, y) => (holds(x, y) ? grid : EMPTY),
    walkTile: async (x, y) => (holds(x, y) ? grid : EMPTY),
  };
}

const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

describe.skipIf(!WASM)("AI agent integration (ADR-0035)", () => {
  let db: TestDatabase;
  let idp: TestIdp;
  let app: NestExpressApplication;
  let config: AppConfig;
  const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
  const browsers: Record<string, { cookie: string; csrf: string }> = {};
  let clientId = "";
  let tokens: { access_token: string; refresh_token: string } = { access_token: "", refresh_token: "" };

  const server = () => app.getHttpServer();
  async function login(sub: string) {
    const res = await signIn(app, idp, sub);
    const token = cookieValue(res, "msl_session");
    const cookie = `msl_session=${token}`;
    const me = (await request(server()).get("/api/auth/me").set("Cookie", cookie)).body;
    browsers[sub] = { cookie, csrf: me.csrfToken };
  }
  const as = (sub: string) => {
    const b = browsers[sub]!;
    const w = (r: request.Test) =>
      r.set("Cookie", b.cookie).set("Origin", config.publicUrl.origin).set("X-CSRF-Token", b.csrf);
    return {
      get: (p: string) => request(server()).get(p).set("Cookie", b.cookie),
      post: (p: string, body: object = {}) => w(request(server()).post(p)).send(body),
      put: (p: string, body: object) => w(request(server()).put(p)).send(body),
      del: (p: string) => w(request(server()).delete(p)),
    };
  };

  /** Run the browser half of the OAuth flow for `sub` and return the code exchange response. */
  async function connect(sub: string, scope?: string) {
    const { verifier, challenge } = pkce();
    const q = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "xyz",
      resource: `${config.publicUrl.origin}/mcp`,
      ...(scope ? { scope } : {}),
    });
    const start = await request(server()).get(`/oauth/authorize?${q}`);
    expect(start.status).toBe(302);
    const consentUrl = new URL(start.headers.location as string, config.publicUrl);
    expect(consentUrl.pathname).toBe("/agents/consent");
    const id = consentUrl.searchParams.get("request")!;
    const details = await as(sub).get(`/api/agents/consent/${encodeURIComponent(id)}`);
    const decision = await as(sub).post(`/api/agents/consent/${encodeURIComponent(id)}`, { approve: true });
    return { details, decision, verifier };
  }

  async function exchange(code: string, verifier: string) {
    return request(server()).post("/oauth/token").type("form").send({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id: clientId,
      redirect_uri: REDIRECT,
    });
  }

  let rpcId = 1;
  async function mcp(token: string, method: string, params: object = {}) {
    return request(server())
      .post("/mcp")
      .set("Authorization", `Bearer ${token}`)
      .set("Accept", "application/json, text/event-stream")
      .set("Content-Type", "application/json")
      .send({ jsonrpc: "2.0", id: rpcId++, method, params });
  }
  async function tool(token: string, name: string, args: object = {}) {
    const r = await mcp(token, "tools/call", { name, arguments: args });
    expect(r.status).toBe(200);
    const result = r.body.result as { content: { text: string }[]; isError?: boolean };
    const text = result.content[0]?.text ?? "";
    return { error: result.isError === true, text, json: result.isError ? null : JSON.parse(text) };
  }

  beforeAll(async () => {
    db = await startDatabase();
    idp = await startIdp();
    config = testConfig({
      db: { host: db.host, port: db.port, name: "mobsimlab" },
      secrets: { ...testConfig().secrets, db_app_password: db.appPassword },
      oidc: { issuer: idp.issuer, clientId: "mobsimlab", allowInsecureHttp: true },
    });
    const mod = await Test.createTestingModule({ imports: [AppModule.forRoot(config)] })
      .overrideProvider(TILE_SOURCE)
      .useValue(tiles())
      .compile();
    app = mod.createNestApplication<NestExpressApplication>({ logger: false });
    configureApp(app, config);
    await app.init();
    await login("alice");
    await as("alice").post("/api/setup/finish");
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await idp?.server.stop();
    await db?.container.stop();
  });

  it("publishes resource and authorization server metadata", async () => {
    const pr = await request(server()).get("/.well-known/oauth-protected-resource/mcp");
    expect(pr.body.resource).toBe("http://127.0.0.1:8080/mcp");
    expect(pr.body.authorization_servers).toEqual(["http://127.0.0.1:8080"]);
    const as = await request(server()).get("/.well-known/oauth-authorization-server");
    expect(as.body.code_challenge_methods_supported).toEqual(["S256"]);
    expect(as.body.registration_endpoint).toBe("http://127.0.0.1:8080/oauth/register");
  });

  it("answers an unauthenticated MCP call with 401 and a pointer to the metadata", async () => {
    const r = await request(server()).post("/mcp").send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(r.status).toBe(401);
    expect(r.headers["www-authenticate"]).toContain(
      'resource_metadata="http://127.0.0.1:8080/.well-known/oauth-protected-resource/mcp"',
    );
  });

  it("registers a client dynamically, without cookies or Origin", async () => {
    const bad = await request(server())
      .post("/oauth/register")
      .send({ redirect_uris: ["http://evil.example/cb"], client_name: "x" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("invalid_redirect_uri");
    const r = await request(server())
      .post("/oauth/register")
      .send({ redirect_uris: [REDIRECT], client_name: "Claude", token_endpoint_auth_method: "none" });
    expect(r.status).toBe(201);
    clientId = r.body.client_id;
    expect(clientId).toMatch(/^msl_client_/);
  });

  it("connects through consent, code with PKCE, and tokens; a code works once", async () => {
    const { details, decision, verifier } = await connect("alice");
    expect(details.body.client.name).toBe("Claude");
    expect(details.body.allowed).toBe(true);
    const back = new URL(decision.body.redirect);
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(back.searchParams.get("state")).toBe("xyz");
    expect(back.searchParams.get("iss")).toBe("http://127.0.0.1:8080");
    const code = back.searchParams.get("code")!;
    const wrong = await exchange(code, "b".repeat(43));
    expect(wrong.body.error).toBe("invalid_grant");
    const ok = await exchange(code, verifier);
    // The wrong verifier did not burn the code, so the right one still works once.
    expect(ok.status).toBe(200);
    expect(ok.body.token_type).toBe("Bearer");
    expect(ok.body.scope).toBe("project:read analysis:run scenario:write");
    tokens = ok.body;
    const again = await exchange(code, verifier);
    expect(again.body.error).toBe("invalid_grant");
    // Reusing a code revokes the connection it made (OAuth 2.1 §4.1.3).
    expect((await mcp(tokens.access_token, "tools/list")).status).toBe(401);
    const fresh = await connect("alice");
    const code2 = new URL(fresh.decision.body.redirect).searchParams.get("code")!;
    tokens = (await exchange(code2, fresh.verifier)).body;
    expect(tokens.access_token).toMatch(/^msl_at_/);
  });

  it("lists tools with their annotations", async () => {
    const r = await mcp(tokens.access_token, "tools/list");
    const names = (r.body.result.tools as { name: string }[]).map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "apply_changes",
        "benchmark_scenarios",
        "coverage_report",
        "create_scenario",
        "delete_agent_scenario",
        "diff_scenarios",
        "find_coverage_gaps",
        "get_assumptions",
        "get_scenario",
        "list_scenarios",
        "measure_stop_spacing",
        "plan_journey",
        "suggest_stop_locations",
        "validate_scenario",
        "walk_catchment",
      ].sort(),
    );
  });

  let scenario = "";
  it("creates a scenario, adds a routed bus line and a metro line, and audits it", async () => {
    const c = await tool(tokens.access_token, "create_scenario", {
      name: "Grid test",
      description: "agent made",
    });
    scenario = c.json.id;
    const stops = [
      ["W", -800, 0],
      ["C", 0, 0],
      ["E", 800, 0],
      ["N", 0, 800],
    ].map(([id, x, y]) => {
      const [lon, lat] = ll(x as number, y as number);
      return { op: "add_stop", stop: { id, name: `Stop ${id}`, lon, lat } };
    });
    const r = await tool(tokens.access_token, "apply_changes", {
      scenario_id: scenario,
      changes: [
        ...stops,
        {
          op: "add_line",
          line: {
            id: "B1",
            name: "1",
            mode: "bus",
            stop_ids: ["W", "C", "E"],
            headway_min: { peak: 10, off_peak: 20 },
          },
        },
        {
          op: "add_line",
          line: {
            id: "M1",
            name: "U1",
            mode: "metro",
            stop_ids: ["C", "N"],
            headway_min: { peak: 5, off_peak: 10 },
          },
        },
      ],
    });
    expect(r.error).toBe(false);
    expect(r.json.version).toBe(2);
    const bus = r.json.summary.lines.find((l: { id: string }) => l.id === "B1");
    expect(bus.routing).toBe("street-router");
    expect(bus.length_km).toBeCloseTo(1.6, 1);
    const sql = await db.superuser();
    const { rows } = await sql.query(
      "SELECT action, after FROM audit.record WHERE action LIKE 'agent.scenario%' ORDER BY id",
    );
    await sql.end();
    expect(rows.map((x) => x.action)).toEqual(["agent.scenario_created", "agent.scenario_changed"]);
    expect(rows[1].after.via).toBe("Claude");
    expect(rows[1].after.tool).toBe("apply_changes");
    expect(rows[1].after.args_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses a bad batch as a whole", async () => {
    const r = await tool(tokens.access_token, "apply_changes", {
      scenario_id: scenario,
      changes: [
        { op: "rename_stop", stop_id: "W", name: "West" },
        { op: "remove_line", line_id: "nope" },
      ],
    });
    expect(r.error).toBe(true);
    expect(r.text).toContain("no line nope");
    expect((await tool(tokens.access_token, "get_scenario", { scenario_id: scenario })).json.version).toBe(2);
  });

  it("reports 15-minute walk coverage along streets with its basis", async () => {
    const r = await tool(tokens.access_token, "coverage_report", { scenario_id: scenario });
    expect(r.error).toBe(false);
    expect(r.json.basis).toContain("15-minute walk to the nearest stop or station");
    expect(r.json.basis).toContain("4.5 km/h");
    expect(r.json.covered_share_pct).toBeGreaterThan(50);
    expect(r.json.crow_flies_share_pct).toBeGreaterThanOrEqual(r.json.covered_share_pct);
    expect(r.json.assumption_keys).toContain("analysis.walk_rule_minutes");
    const sdg = await tool(tokens.access_token, "coverage_report", {
      scenario_id: scenario,
      preset: "sdg_11_2_1",
    });
    expect(sdg.json.groups).toHaveLength(2);
    // Demand points: one next to C, one in the far corner (1000 m + 1000 m from C on the grid).
    const [a, b] = [ll(50, 0), ll(1000, -1000)];
    const pts = await tool(tokens.access_token, "coverage_report", {
      scenario_id: scenario,
      demand_points: [
        { lon: a[0], lat: a[1], weight: 10 },
        { lon: b[0], lat: b[1], weight: 30 },
      ],
    });
    expect(pts.json.covered_share_pct).toBe(25);
  });

  it("measures stop spacing along the route and on foot", async () => {
    const r = await tool(tokens.access_token, "measure_stop_spacing", {
      scenario_id: scenario,
      line_id: "B1",
    });
    expect(r.error).toBe(false);
    const l = r.json.lines[0];
    expect(l.measured_along).toBe("routed path");
    expect(l.along_m.median).toBeCloseTo(800, -1);
    expect(l.on_foot_m.median).toBeCloseTo(800, -1);
    expect(l.guidance_m).toEqual({ low: 250, central: 400, high: 600 });
    expect(l.too_long).toBe(2);
  });

  it("finds gaps, suggests stops, plans a journey and benchmarks", async () => {
    const gaps = await tool(tokens.access_token, "find_coverage_gaps", {
      scenario_id: scenario,
      minutes: 5,
      limit: 5,
    });
    expect(gaps.json.gaps.features).toHaveLength(5);
    const sug = await tool(tokens.access_token, "suggest_stop_locations", {
      scenario_id: scenario,
      k: 2,
      minutes: 5,
    });
    expect(sug.error).toBe(false);
    expect(sug.json.suggestions.length).toBeGreaterThan(0);
    expect(sug.json.covered_after_pct).toBeGreaterThan(sug.json.covered_before_pct);
    const j = await tool(tokens.access_token, "plan_journey", {
      scenario_id: scenario,
      from: ll(-800, 50),
      to: ll(0, 750),
      time: "08:00",
    });
    expect(j.error).toBe(false);
    expect(j.json.journeys[0].rides.length).toBeGreaterThanOrEqual(1);
    const copy = await tool(tokens.access_token, "create_scenario", {
      name: "Copy",
      parent_scenario_id: scenario,
    });
    const bench = await tool(tokens.access_token, "benchmark_scenarios", {
      scenario_ids: [scenario, copy.json.id],
      od_pairs: [[ll(-800, 0), ll(0, 800)]],
    });
    expect(bench.error).toBe(false);
    const [r0, r1] = bench.json.rows;
    expect(r0.kpi.peak_vehicles).toBeGreaterThan(0);
    expect(r0.kpi.walk_15_min_coverage_pct).toBe(r1.kpi.walk_15_min_coverage_pct);
    expect(r0.kpi.median_journey_min).toBeGreaterThan(0);
  });

  it("enforces scopes", async () => {
    const c = await connect("alice", "project:read");
    const t = (await exchange(new URL(c.decision.body.redirect).searchParams.get("code")!, c.verifier)).body;
    const r = await tool(t.access_token, "create_scenario", { name: "nope" });
    expect(r.error).toBe(true);
    expect(r.text).toContain("scenario:write");
    // Re-consent narrowed the one connection of this client, so restore the full grant for later tests.
    const full = await connect("alice");
    tokens = (await exchange(new URL(full.decision.body.redirect).searchParams.get("code")!, full.verifier))
      .body;
  });

  it("rotates refresh tokens and revokes the connection on reuse", async () => {
    const r1 = await request(server())
      .post("/oauth/token")
      .type("form")
      .send({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId });
    expect(r1.status).toBe(200);
    const reuse = await request(server())
      .post("/oauth/token")
      .type("form")
      .send({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId });
    expect(reuse.body.error).toBe("invalid_grant");
    expect((await mcp(r1.body.access_token, "tools/list")).status).toBe(401);
  });

  it("personal access tokens work, only delete their own scenarios, and can be revoked", async () => {
    const pat = await as("alice").post("/api/agents/tokens", {
      name: "CI",
      scopes: ["project:read", "scenario:write"],
      expiresInDays: 30,
    });
    expect(pat.status).toBe(201);
    expect(pat.body.token).toMatch(/^msl_pat_/);
    const del = await tool(pat.body.token, "delete_agent_scenario", { scenario_id: scenario });
    expect(del.error).toBe(true);
    expect(del.text).toContain("only delete scenarios it created");
    const own = await tool(pat.body.token, "create_scenario", { name: "PAT made" });
    expect((await tool(pat.body.token, "delete_agent_scenario", { scenario_id: own.json.id })).error).toBe(
      false,
    );
    const list = await as("alice").get("/api/agents/connections");
    const c = list.body.connections.find((x: { name: string }) => x.name === "CI");
    expect(c.recentActions.map((a: { tool: string }) => a.tool)).toContain("create_scenario");
    expect((await as("alice").del(`/api/agents/connections/${c.id}`)).status).toBe(200);
    expect((await mcp(pat.body.token, "tools/list")).status).toBe(401);
  });

  it("does not let Viewers connect, and cuts a token when its user becomes a Viewer", async () => {
    const pat = await as("alice").post("/api/agents/tokens", {
      name: "demote test",
      scopes: ["project:read"],
      expiresInDays: 1,
    });
    await login("victor");
    const sql = await db.superuser();
    await sql.query(
      "UPDATE iam.user SET status = 'active', instance_role = 'viewer' WHERE email = 'victor@example.org'",
    );
    const { verifier, challenge } = pkce();
    const q = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    void verifier;
    const id = new URL(
      (await request(server()).get(`/oauth/authorize?${q}`)).headers.location as string,
      "http://x",
    ).searchParams.get("request")!;
    await login("victor");
    expect((await as("victor").get(`/api/agents/consent/${id}`)).body.allowed).toBe(false);
    expect((await as("victor").post(`/api/agents/consent/${id}`, { approve: true })).status).toBe(403);
    expect((await mcp(pat.body.token, "tools/list")).status).toBe(200);
    await sql.query("UPDATE iam.user SET instance_role = 'viewer' WHERE email = 'alice@example.org'");
    expect((await mcp(pat.body.token, "tools/list")).status).toBe(401);
    await sql.query("UPDATE iam.user SET instance_role = 'owner' WHERE email = 'alice@example.org'");
    await sql.end();
  });

  it("lets an Admin switch off client registration", async () => {
    expect((await as("alice").put("/api/agents/settings", { dynamicRegistration: false })).body).toEqual({
      dynamicRegistration: false,
    });
    const r = await request(server())
      .post("/oauth/register")
      .send({ redirect_uris: [REDIRECT] });
    expect(r.status).toBe(403);
    const meta = await request(server()).get("/.well-known/oauth-authorization-server");
    expect(meta.body.registration_endpoint).toBeUndefined();
  });

  it("keeps sign-in return paths on this instance", async () => {
    const r = await request(server()).get("/api/auth/login?return_to=//evil.example/x");
    expect(r.status).toBe(302);
    const sql = await db.superuser();
    const { rows } = await sql.query("SELECT return_to FROM iam.auth_flow ORDER BY expires_at DESC LIMIT 1");
    await sql.end();
    expect(rows[0].return_to).toBe("/");
  });
});
