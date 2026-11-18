import { describe, expect, it } from "vitest";
import { cut, peopleIn, staticFetch } from "../src/static/shim";

/** The static viewer's stand-in for the API (src/static/shim.ts): answers from the unpacked project files. */
const ID = "0194f3a2-0000-7b2e-9f00-4a5b6c7d8e9f";
const RUN = "0194f3a2-6c1d-7b2e-9f00-4a5b6c7d8e9f";
const SITE: Record<string, unknown> = {
  "/projects/index.json": {
    projects: [
      {
        id: ID,
        name: "Lakeside",
        description: "",
        areaName: "Lakeside",
        modes: ["tram"],
        createdAt: "2026-11-16T10:00:00.000Z",
        updatedAt: "2026-11-16T10:00:00.000Z",
        dir: ID,
        map: true,
        runs: 1,
      },
    ],
  },
  [`/projects/${ID}/manifest.json`]: {
    files: {
      "data/railway.json": {},
      [`runs/${RUN}/run.json`]: {},
      "map/population.json": {},
      "map/reference.json": {},
      "results/noise.json": {},
    },
  },
  [`/projects/${ID}/results/noise.json`]: {
    kind: "noise",
    inputs: "0123456789abcdef",
    computedAt: "2026-11-16T10:02:00.000Z",
    doc: { version: 1, value: { result: { kind: "done" } } },
  },
  [`/projects/${ID}/map/reference.json`]: {
    "@facts": { "holidays/DE/2027": [{ date: "2027-01-01", name: "New Year" }] },
  },
  [`/projects/${ID}/data/railway.json`]: {
    kind: "railway",
    schemaVersion: 1,
    updatedAt: "2026-11-16T10:00:00.000Z",
    doc: { origin: [13.4, 52.5] },
  },
  [`/projects/${ID}/runs/${RUN}/run.json`]: {
    id: RUN,
    kind: "capacity",
    status: "done",
    input: { network: { kind: "example" }, params: { period: "am" }, sweep: false },
    progress: null,
    result: { run: { verdict: "works" } },
    error: null,
    createdAt: "2026-11-16T10:00:00.000Z",
    startedAt: null,
    finishedAt: "2026-11-16T10:01:00.000Z",
  },
  [`/projects/${ID}/map/population.json`]: {
    grids: [{ x0: 0, y0: 0, dx: 1, dy: 1, nx: 2, ny: 2, people: [1, 2, 3, 4] }],
    info: { name: "Test grid", year: 2020 },
  },
  [`/projects/${ID}/map/streets/8192-5450.xml`]: "<osm>streets</osm>",
};

const base: typeof fetch = async (input) => {
  const path = new URL(String(input), "http://localhost").pathname;
  const body = SITE[path];
  if (body === undefined)
    return new Response("<!doctype html>", { headers: { "Content-Type": "text/html" } });
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    headers: { "Content-Type": path.endsWith(".json") ? "application/json" : "application/xml" },
  });
};

describe("static viewer", () => {
  const api = staticFetch(base);
  const getJson = async (path: string) => (await api(path)).json();

  it("serves the results saved with the project and the facts it kept", async () => {
    expect((await getJson(`/api/projects/${ID}/results`)).results).toMatchObject([
      { kind: "noise", inputs: "0123456789abcdef" },
    ]);
    const res = await api(`/api/projects/${ID}/results/noise`);
    expect(res.headers.get("X-Inputs")).toBe("0123456789abcdef");
    expect(await res.json()).toEqual({ version: 1, value: { result: { kind: "done" } } });
    expect((await api(`/api/projects/${ID}/results/walk-coverage`)).status).toBe(404);
    window.history.pushState({}, "", `/projects/${ID}`);
    const h = await getJson(`/api/calendar/holidays?country=DE&year=2027&project=${ID}`);
    expect(h).toMatchObject({ country: "DE", year: 2027, holidays: [{ name: "New Year" }] });
    window.history.pushState({}, "", "/");
  });

  it("lists the site's projects and opens them read-only", async () => {
    expect((await getJson("/api/projects")).projects).toMatchObject([{ id: ID, myRole: "viewer" }]);
    expect((await getJson(`/api/projects/${ID}`)).project).toMatchObject({
      name: "Lakeside",
      myRole: "viewer",
    });
    expect((await getJson(`/api/projects/${ID}/drawings`)).drawings.railway).toMatchObject({
      kind: "railway",
      doc: { origin: [13.4, 52.5] },
    });
    const put = await api(`/api/projects/${ID}/drawings/railway`, { method: "PUT", body: "{}" });
    expect(put.status).toBe(403);
    expect((await api("/api/places/search?q=x")).status).toBe(404);
  });

  it("serves the saved runs as the API does", async () => {
    expect((await getJson(`/api/projects/${ID}/simulation-runs`)).runs).toEqual([
      expect.objectContaining({ id: RUN, kind: "capacity", verdict: "works", params: { period: "am" } }),
    ]);
    expect((await getJson(`/api/projects/${ID}/simulation-runs/${RUN}`)).run).toMatchObject({
      id: RUN,
      result: { run: { verdict: "works" } },
    });
  });

  it("answers map tiles and population from the open project's map data", async () => {
    window.history.pushState(null, "", `/projects/${ID}/simulator`);
    expect(await (await api("/api/street-network/tiles/14/8192/5450")).text()).toBe("<osm>streets</osm>");
    // A tile outside the saved area is empty.
    expect(await (await api("/api/street-network/tiles/14/1/1")).text()).toContain("<osm");
    expect(await (await api("/api/street-network/building-tiles/14/1/1")).json()).toEqual({ buildings: [] });
    const post = (path: string, body: unknown) => api(path, { method: "POST", body: JSON.stringify(body) });
    const grid = await (await post(`/api/projects/${ID}/population/grid`, { bbox: [0, 0, 2, 2] })).json();
    expect(grid).toMatchObject({ status: "ready", grid: { nx: 2, ny: 2, people: [1, 2, 3, 4] } });
    const ring = [
      [0, 0],
      [2, 0],
      [2, 1],
      [0, 1],
      [0, 0],
    ];
    const c = await (
      await post(`/api/projects/${ID}/population/catchments`, { areas: [{ id: "a", ring }] })
    ).json();
    expect(c.populations).toEqual({ a: 3 });
    window.history.pushState(null, "", "/");
  });

  it("cuts and sums the saved population cells", () => {
    const g = [{ x0: 0, y0: 0, dx: 1, dy: 1, nx: 2, ny: 2, people: [1, 2, 3, 4] }];
    expect(cut(g, [1, 1, 2, 2]).people).toEqual([4]);
    expect(
      peopleIn(g, [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ]),
    ).toBe(10);
  });
});
