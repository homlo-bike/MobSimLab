/**
 * The static viewer's stand-in for the API (`pnpm build:static`): it answers the app's `/api/…` requests from
 * the project files unpacked under `/projects/<id>/` (the contents of a `.mslab` file, see
 * apps/api/src/mslab/format.mts) and from `/projects/index.json`. Nothing is sent anywhere and nothing can be
 * changed: every write is refused, and what needs a server (place search, terrain, new runs) says it is not
 * available here.
 */

/** Where the unpacked projects are, relative to the site root. */
export const PROJECTS_PATH = "/projects";

/** One project in `/projects/index.json` (tools/static-site/add-projects.mjs). */
export interface StaticProjectEntry {
  id: string;
  name: string;
  description: string;
  areaName: string | null;
  modes: string[];
  createdAt: string;
  updatedAt: string;
  /** The folder under /projects that holds the unpacked file. */
  dir: string;
  /** Whether the file carries map data and saved runs. */
  map: boolean;
  runs: number;
}

type Json = Record<string, unknown>;
type Grid = { x0: number; y0: number; dx: number; dy: number; nx: number; ny: number; people: number[] };

const EMPTY_TILE: Record<string, string> = {
  streets: '<?xml version="1.0" encoding="UTF-8"?><osm version="0.6"></osm>',
  walk: '<?xml version="1.0" encoding="UTF-8"?><osm version="0.6"></osm>',
  rail: '<?xml version="1.0" encoding="UTF-8"?><osm version="0.6"></osm>',
  buildings: '{"buildings":[]}',
  places: '{"places":[]}',
  "bike-amenities": '{"amenities":[]}',
};
/** API tile path → map data kind. */
const TILE_KINDS: Record<string, string> = {
  tiles: "streets",
  "walk-tiles": "walk",
  "rail-tiles": "rail",
  "building-tiles": "buildings",
  "place-tiles": "places",
  "bike-amenity-tiles": "bike-amenities",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const refuse = (status: number, message: string) => json({ message, statusCode: status }, status);
const NOT_HERE = "This is not available in the static viewer.";
/** Where the climate comes from (apps/api/src/calendar/calendar.controller.ts `CLIMATE_SOURCE`). */
const CLIMATE_SOURCE = { name: "Open-Meteo", url: "https://open-meteo.com/", licence: "CC BY 4.0" };

/**
 * Purpose: answer the app's API requests from the static project files. Inputs: the browser's own fetch (for the
 * files). Output: a fetch function that serves `/api/…` itself and passes everything else on.
 */
export function staticFetch(base: typeof fetch): typeof fetch {
  const files = new Map<string, Promise<string | null>>();
  /** A file of the site as text, fetched once; null when it is not there. */
  const text = (path: string): Promise<string | null> => {
    let p = files.get(path) as Promise<string | null> | undefined;
    if (!p) {
      p = base(path).then(async (r) => {
        if (!r.ok) return null;
        // A host that answers every path with the app page (single-page fallback) does not have the file.
        if ((r.headers.get("Content-Type") ?? "").includes("text/html")) return null;
        return r.text();
      });
      files.set(path, p);
    }
    return p;
  };
  /** A JSON file of the site; null when it is not there or not JSON. */
  const file = async <T>(path: string): Promise<T | null> => {
    const t = await text(path);
    if (t === null) return null;
    try {
      return JSON.parse(t) as T;
    } catch {
      return null;
    }
  };
  const index = () =>
    file<{ projects: StaticProjectEntry[] }>(`${PROJECTS_PATH}/index.json`).then((r) => r?.projects ?? []);
  const entry = async (id: string) => (await index()).find((p) => p.id === id) ?? null;
  const at = (e: StaticProjectEntry, name: string) => `${PROJECTS_PATH}/${encodeURIComponent(e.dir)}/${name}`;
  const manifest = (e: StaticProjectEntry) =>
    file<{ files?: Record<string, unknown>; includes?: { runs?: boolean; map?: boolean } }>(
      at(e, "manifest.json"),
    );
  const names = async (e: StaticProjectEntry) => Object.keys((await manifest(e))?.files ?? {}).sort();

  const project = (e: StaticProjectEntry) => ({
    id: e.id,
    name: e.name,
    description: e.description,
    areaName: e.areaName,
    modes: e.modes,
    myRole: "viewer",
    viaPublic: false,
    owner: { id: "", displayName: null },
    memberCount: 0,
    visibility: "private",
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  });

  const runFiles = async (e: StaticProjectEntry): Promise<Json[]> => {
    const ids = (await names(e))
      .map((n) => /^runs\/([0-9a-f-]{36})\/run\.json$/.exec(n)?.[1])
      .filter((x): x is string => Boolean(x));
    const runs = await Promise.all(ids.map((id) => file<Json>(at(e, `runs/${id}/run.json`))));
    return runs
      .filter((r): r is Json => r !== null)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  };
  // As apps/api/src/simulation/runs.service.ts `summary` and `get` answer.
  const summary = (r: Json) => {
    const input = (r.input ?? {}) as Json;
    const verdict = ((r.result as Json | null)?.run as Json | undefined)?.verdict;
    return {
      id: r.id,
      kind: r.kind,
      status: r.status,
      network: input.network ?? { kind: "none" },
      params: input.params ?? null,
      sweep: Boolean(input.sweep),
      ...(input.design ? { design: input.design, objectives: input.objectives ?? [] } : {}),
      ...(input.plan ? { plan: input.plan } : {}),
      agent: null,
      verdict: typeof verdict === "string" ? verdict : null,
      error: r.error ?? null,
      cancelRequested: false,
      createdBy: null,
      createdAt: r.createdAt,
      startedAt: r.startedAt ?? null,
      finishedAt: r.finishedAt ?? null,
    };
  };

  const population = async (e: StaticProjectEntry | null) => {
    if (!e?.map) return null;
    return file<{ grids: Grid[]; info: Json }>(at(e, "map/population.json"));
  };

  /** The project whose data a request without a project in its path uses: the one open in the address bar. */
  const current = async () => {
    const m = /^\/projects\/([0-9a-fA-F-]{36})/.exec(window.location.pathname);
    return m?.[1] ? entry(m[1]) : null;
  };

  const answer = async (url: URL, method: string, body: unknown): Promise<Response> => {
    const path = url.pathname;
    if (path === "/api/auth/me" && method === "GET")
      return json({
        instance: { mode: "open", name: "MobSimLab" },
        signInAvailable: false,
        user: { id: "viewer", role: "user", email: null, displayName: null, preferences: {} },
        csrfToken: "static",
      });
    if (path === "/api/auth/preferences" && method === "PUT") return json({ preferences: body ?? {} });
    if (path === "/api/logs") return new Response(null, { status: 204 });

    // Population (noise map, walk analysis, benefit tables): from the project's map data.
    if (
      method === "POST" &&
      /^\/api\/(projects\/[0-9a-fA-F-]{36}\/population|population)\/grid$/.test(path)
    ) {
      const pid = /^\/api\/projects\/([0-9a-fA-F-]{36})\//.exec(path)?.[1];
      const pop = await population(pid ? await entry(pid) : await current());
      const bbox = (body as { bbox?: number[] } | null)?.bbox;
      if (!pop || !Array.isArray(bbox) || bbox.length !== 4)
        return json({ status: "unavailable", reason: "The project file has no population data." });
      return json({ status: "ready", grid: cut(pop.grids, bbox as Bbox), source: pop.info });
    }
    if (
      method === "POST" &&
      /^\/api\/(projects\/[0-9a-fA-F-]{36}\/population\/catchments|benefits\/population)$/.test(path)
    ) {
      const pid = /^\/api\/projects\/([0-9a-fA-F-]{36})\//.exec(path)?.[1];
      const pop = await population(pid ? await entry(pid) : await current());
      const areas = (
        (body as { areas?: { id: string; ring: [number, number][] }[] } | null)?.areas ?? []
      ).filter((a) => a && typeof a.id === "string" && Array.isArray(a.ring));
      if (!pop)
        return json({
          year: null,
          populations: Object.fromEntries(areas.map((a) => [a.id, null])),
          failed: areas.length,
          reasons: ["The project file has no population data."],
          source: { id: "", name: "", dataset: "", url: "", licence: "", citation: "" },
        });
      return json({
        year: (pop.info.year as number | undefined) ?? null,
        populations: Object.fromEntries(areas.map((a) => [a.id, peopleIn(pop.grids, a.ring)])),
        failed: 0,
        reasons: [],
        source: pop.info,
      });
    }

    if (method !== "GET") return refuse(403, "The static viewer is read-only.");

    if (path === "/api/comments/new") return json({ total: 0, comments: [] });
    if (path === "/api/projects")
      return json({ projects: url.searchParams.has("public") ? [] : (await index()).map(project) });

    const m = /^\/api\/projects\/([0-9a-fA-F-]{36})(\/.*)?$/.exec(path);
    if (m) {
      const e = await entry(m[1]!);
      if (!e) return refuse(404, "project not found");
      const rest = m[2] ?? "";
      if (rest === "") return json({ project: project(e) });
      if (rest === "/plugins") {
        const p = await file<{ plugins?: { id: string; enabled: boolean; version: string | null }[] }>(
          at(e, "plugins.json"),
        );
        return json({
          plugins: (p?.plugins ?? []).map((x) => ({
            id: x.id,
            name: x.id,
            description: "",
            publisher: { name: "" },
            bundled: x.version === null,
            enabled: x.enabled,
            version: x.version ?? "",
            versions: [],
            permissions: [],
            contributes: { modes: [], tools: [], parameters: 0, calculations: [], mapLayers: [] },
            missing: false,
          })),
        });
      }
      if (rest === "/drawings") {
        const kinds = (await names(e))
          .map((n) => /^data\/([a-z][a-z0-9-]{1,39})\.json$/.exec(n)?.[1])
          .filter((x): x is string => Boolean(x));
        const docs = await Promise.all(kinds.map((k) => file<Json>(at(e, `data/${k}.json`))));
        const drawings: Json = {};
        kinds.forEach((k, i) => {
          const d = docs[i];
          if (d)
            drawings[k] = {
              kind: k,
              schemaVersion: d.schemaVersion,
              doc: d.doc,
              version: 1,
              updatedAt: d.updatedAt,
              updatedBy: null,
            };
        });
        return json({ drawings });
      }
      if (rest === "/simulation-runs") return json({ runs: (await runFiles(e)).map(summary) });
      const run = /^\/simulation-runs\/([0-9a-f-]{36})(\/replay|\/scenario)?$/.exec(rest);
      if (run) {
        const r = await file<Json>(at(e, `runs/${run[1]}/run.json`));
        if (!r) return refuse(404, "run not found");
        if (run[2] === "/scenario") {
          const lines = await text(at(e, `runs/${run[1]}/lines.txt`));
          return lines === null
            ? refuse(404, "no such road run")
            : new Response(lines, { headers: { "Content-Type": "application/json" } });
        }
        if (run[2] === "/replay") {
          const res = await base(at(e, `runs/${run[1]}/replay.json.gz`));
          if (!res.ok || (res.headers.get("Content-Type") ?? "").includes("text/html"))
            return refuse(404, "this run has no replay");
          return new Response(await gunzipped(await res.arrayBuffer()), {
            headers: { "Content-Type": "application/json" },
          });
        }
        return json({ run: { ...summary(r), progress: r.progress ?? null, result: r.result ?? null } });
      }
      // Results the project's tools worked out (format 1.2), as the API answers them; the body is plain JSON.
      if (rest === "/results") {
        const kinds = (await names(e))
          .map((n) => /^results\/([a-z][a-z0-9-]{1,39})\.json$/.exec(n)?.[1])
          .filter((x): x is string => Boolean(x));
        const files = await Promise.all(kinds.map((k) => file<Json>(at(e, `results/${k}.json`))));
        return json({
          results: files
            .filter((f): f is Json => f !== null)
            .map((f) => ({ kind: f.kind, inputs: f.inputs, computedAt: f.computedAt, bytes: 0 })),
        });
      }
      const result = /^\/results\/([a-z][a-z0-9-]{1,39})$/.exec(rest);
      if (result) {
        const f = await file<Json>(at(e, `results/${result[1]}.json`));
        if (!f) return refuse(404, "Nothing saved");
        return new Response(JSON.stringify(f.doc), {
          headers: {
            "Content-Type": "application/octet-stream",
            "X-Inputs": String(f.inputs ?? ""),
            "X-Computed-At": String(f.computedAt ?? ""),
          },
        });
      }
      if (rest === "/comments") return json({ comments: [] });
      if (rest.startsWith("/value-history")) return json({ history: [] });
      return refuse(404, NOT_HERE);
    }

    // OpenStreetMap tiles, water and country figures: from the open project's map data.
    const tile = /^\/api\/street-network\/([a-z-]+)\/14\/(\d{1,5})\/(\d{1,5})$/.exec(path);
    if (tile && TILE_KINDS[tile[1]!]) {
      const kind = TILE_KINDS[tile[1]!]!;
      const e = await current();
      const xml = kind === "streets" || kind === "walk" || kind === "rail";
      const body = e?.map
        ? await text(at(e, `map/${kind}/${tile[2]}-${tile[3]}.${xml ? "xml" : "json"}`))
        : null;
      // A tile outside the saved area is empty, as OpenStreetMap would be where nothing is mapped.
      return new Response(body ?? EMPTY_TILE[kind]!, {
        headers: { "Content-Type": xml ? "application/xml" : "application/json" },
      });
    }
    if (path === "/api/street-network/water") {
      const e = await current();
      const w = e?.map ? await file<Json>(at(e, "map/water.json")) : null;
      return w ? json(w) : refuse(404, NOT_HERE);
    }
    if (
      path.startsWith("/api/economy/") ||
      path.startsWith("/api/benefits/") ||
      path.startsWith("/api/calendar/")
    ) {
      const e = await current();
      const ref = e?.map ? await file<Json>(at(e, "map/reference.json")) : null;
      // The facts the project kept, by the key the API keeps them under.
      const facts = (ref?.["@facts"] ?? null) as Json | null;
      const q = url.searchParams;
      const key = factKeyOf(path, q);
      if (facts && key && facts[key] !== undefined) {
        const v = facts[key];
        // As apps/api answers them (economy, benefits and calendar controllers).
        if (path === "/api/economy/countries") return json({ countries: v });
        if (path === "/api/calendar/holidays")
          return json({
            country: q.get("country")?.toUpperCase(),
            year: Number(q.get("year")),
            holidays: v,
            source: { name: "Nager.Date", url: "https://date.nager.at/" },
          });
        if (path === "/api/calendar/climate") return json({ ...(v as Json), source: CLIMATE_SOURCE });
        if (path === "/api/economy/indicators" || path === "/api/benefits/indicators") return json(v);
      }
      // The file keys answers by path and query without the open project, which the app adds to keep facts.
      const rq = new URLSearchParams(url.search);
      rq.delete("project");
      rq.delete("osm");
      const search = rq.size ? `?${rq.toString()}` : "";
      const hit = ref?.[`${path}${search}`] ?? ref?.[path];
      return hit === undefined ? refuse(404, NOT_HERE) : json(hit);
    }
    return refuse(404, NOT_HERE);
  };

  return async (input, init) => {
    const req = input instanceof Request ? input : null;
    const url = new URL(req ? req.url : String(input), window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) return base(input, init);
    const method = (init?.method ?? req?.method ?? "GET").toUpperCase();
    let body: unknown = null;
    const raw = init?.body;
    if (typeof raw === "string") {
      try {
        body = JSON.parse(raw);
      } catch {
        body = null;
      }
    }
    try {
      return await answer(url, method, body);
    } catch (e) {
      return refuse(500, e instanceof Error ? e.message : String(e));
    }
  };
}

type Bbox = [number, number, number, number];

/**
 * Purpose: the key a fact is kept under for the project (apps/api/src/projects/data-cache.ts `factKey`), for a
 * request the app makes; null for a request that is not a kept fact.
 */
export function factKeyOf(path: string, q: URLSearchParams): string | null {
  const num = (k: string) => {
    const v = q.get(k);
    return v === null || v === "" || Number.isNaN(Number(v)) ? null : Number(v);
  };
  const lon = num("lon");
  const lat = num("lat");
  const code = q.get("code");
  switch (path) {
    case "/api/economy/country-at":
      return lon === null || lat === null ? null : `country-at/${lon.toFixed(4)},${lat.toFixed(4)}`;
    case "/api/economy/countries":
      return "economy-countries";
    case "/api/economy/indicators":
      return code ? `economy/${code.toUpperCase()}/${num("base") ?? 2023}` : null;
    case "/api/benefits/indicators":
      return code ? `benefit-indicators/${code.toUpperCase()}` : null;
    case "/api/benefits/osm-areas":
      return lon === null || lat === null
        ? null
        : `osm-areas/${lon.toFixed(6)},${lat.toFixed(6)}${q.get("wide") === "1" ? "/wide" : ""}`;
    case "/api/calendar/holidays": {
      const country = q.get("country");
      const year = num("year");
      return country && year !== null ? `holidays/${country.toUpperCase()}/${year}` : null;
    }
    case "/api/calendar/climate":
      return lon === null || lat === null ? null : `climate/${lat.toFixed(1)},${lon.toFixed(1)}`;
    default:
      return null;
  }
}

/** Purpose: the people of a box on the saved grids' cells (nearest saved cell for each), as the API answers. */
export function cut(grids: Grid[], bbox: Bbox): Grid {
  const g0 = grids[0];
  const dx = g0?.dx ?? 1 / 1200;
  const dy = g0?.dy ?? 1 / 1200;
  const x0 = Math.floor(bbox[0] / dx) * dx;
  const y0 = Math.floor(bbox[1] / dy) * dy;
  const nx = Math.max(0, Math.min(4000, Math.ceil((bbox[2] - x0) / dx)));
  const ny = Math.max(0, Math.min(4000, Math.ceil((bbox[3] - y0) / dy)));
  const people = new Array<number>(nx * ny).fill(0);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++)
      people[j * nx + i] = valueAt(grids, x0 + (i + 0.5) * dx, y0 + (j + 0.5) * dy);
  return { x0, y0, dx, dy, nx, ny, people };
}

/** Purpose: people in the saved cell under a point, 0 outside the saved grids. */
function valueAt(grids: Grid[], lon: number, lat: number): number {
  for (const g of grids) {
    const i = Math.floor((lon - g.x0) / g.dx);
    const j = Math.floor((lat - g.y0) / g.dy);
    if (i >= 0 && j >= 0 && i < g.nx && j < g.ny) return g.people[j * g.nx + i] ?? 0;
  }
  return 0;
}

/** Purpose: people inside a ring: the cells whose centre lies inside (apps/api/src/benefits/benefits.service.ts). */
export function peopleIn(grids: Grid[], ring: [number, number][]): number {
  let sum = 0;
  for (const g of grids) {
    let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of ring) {
      w = Math.min(w, x);
      s = Math.min(s, y);
      e = Math.max(e, x);
      n = Math.max(n, y);
    }
    const i0 = Math.max(0, Math.floor((w - g.x0) / g.dx));
    const i1 = Math.min(g.nx - 1, Math.ceil((e - g.x0) / g.dx));
    const j0 = Math.max(0, Math.floor((s - g.y0) / g.dy));
    const j1 = Math.min(g.ny - 1, Math.ceil((n - g.y0) / g.dy));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++)
        if (inRing(g.x0 + (i + 0.5) * g.dx, g.y0 + (j + 0.5) * g.dy, ring))
          sum += g.people[j * g.nx + i] ?? 0;
  }
  return sum;
}

function inRing(x: number, y: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Purpose: gzipped bytes unpacked; bytes that are not gzipped (a host already unpacked them) as they are. */
async function gunzipped(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const b = new Uint8Array(buf);
  if (b[0] !== 0x1f || b[1] !== 0x8b) return buf;
  return new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
}
