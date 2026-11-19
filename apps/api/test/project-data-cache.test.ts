import { describe, expect, it, vi } from "vitest";
import { OverpassClient } from "../src/gateway/overpass.client";
import { countryShares, samplePoints } from "../src/projects/area-facts";
import { type CacheKind, ProjectDataCache } from "../src/projects/data-cache";
import { StreetNetworkService } from "../src/street-network/street-network.service";
import { TerrainService } from "../src/terrain/terrain.service";

/** A project data cache kept in memory instead of the database. */
function memoryCache() {
  const rows = new Map<string, string>();
  const k = (p: string, kind: CacheKind, key: string) => `${p}|${kind}|${key}`;
  const c = new ProjectDataCache();
  c.getMany = async (p, kind, keys) => {
    const out = new Map<string, string>();
    for (const key of keys) {
      const v = rows.get(k(p, kind, key));
      if (v !== undefined) out.set(key, v);
    }
    return out;
  };
  c.putMany = async (p, kind, entries) => {
    for (const [key, body] of entries) rows.set(k(p, kind, key), body);
  };
  return { c, rows };
}

const P = "11111111-1111-4111-8111-111111111111";
const XML = '<osm version="0.6"><node id="1" lat="50" lon="7"/></osm>';

describe("project data cache (#140 step 4)", () => {
  it("keeps a street tile fetched live for the project and serves it from there next time", async () => {
    const fetchImpl = vi.fn(async () => new Response(XML));
    const overpass = new OverpassClient({
      fetchImpl,
      sleep: async () => {},
      minIntervalMs: 0,
      backoffMs: [1],
    });
    const imported = { onChange: () => {}, tileXml: vi.fn(async (): Promise<string | null> => null) };
    const { c, rows } = memoryCache();
    const streets = new StreetNetworkService(overpass, imported as never, c);
    const seen: string[] = [];
    expect(await streets.tile(8508, 5489, P, (s) => seen.push(s))).toBe(XML);
    expect(rows.get(`${P}|osm|road/8508/5489`)).toBe(XML);
    // A fresh process (nothing in memory) reads the project's copy, not Overpass.
    const again = new StreetNetworkService(overpass, imported as never, c);
    expect(await again.tile(8508, 5489, P, (s) => seen.push(s))).toBe(XML);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(["live", "cache"]);
    // The import still comes first.
    imported.tileXml.mockResolvedValueOnce("<osm/>");
    const third = new StreetNetworkService(overpass, imported as never, c);
    expect(await third.tile(8508, 5489, P, (s) => seen.push(s))).toBe("<osm/>");
    expect(seen.at(-1)).toBe("import");
  });

  it("keeps terrain heights read live for the project", async () => {
    const dem = { elevation: vi.fn(async (lon: number) => lon * 10) };
    const { c } = memoryCache();
    const imported = {
      heights: vi.fn(async (_p: string, pts: unknown[]) => ({
        values: pts.map(() => undefined),
        sources: [],
      })),
    };
    const terrain = new TerrainService(dem as never, {} as never, imported as never, undefined, c);
    const pts: [number, number][] = [
      [7.1, 50.1],
      [7.2, 50.2],
    ];
    const first = await terrain.heights(pts, P);
    expect(first.values).toEqual([71, 72]);
    expect(first.live).toBe(2);
    const second = await terrain.heights(pts, P);
    expect(second.values).toEqual([71, 72]);
    expect(second.live).toBe(0);
    expect(dem.elevation).toHaveBeenCalledTimes(2);
  });

  it("fetches without a project, and keeps nothing", async () => {
    const { c, rows } = memoryCache();
    const fetch = vi.fn(async () => "x");
    expect(await c.through(undefined, "facts", "k", fetch)).toEqual({ body: "x", source: "live" });
    expect(await c.through(P, "facts", "k", fetch)).toEqual({ body: "x", source: "live" });
    expect(await c.through(P, "facts", "k", fetch)).toEqual({ body: "x", source: "cache" });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(rows.size).toBe(1);
  });
});

describe("area facts (#140 step 3)", () => {
  it("samples the area inside its polygons, their middles and always its centre", () => {
    const all = samplePoints([0, 0, 3, 3], []);
    expect(all[0]).toEqual([1.5, 1.5]);
    expect(all).toHaveLength(9);
    const west = {
      ring: [
        [0, 0],
        [1.2, 0],
        [1.2, 3],
        [0, 3],
        [0, 0],
      ] as [number, number][],
    };
    const pts = samplePoints([0, 0, 3, 3], [west]);
    expect(pts[1]).toEqual([0.6, 1.5]);
    expect(pts.slice(1).every(([x]) => x < 1.2)).toBe(true);
  });

  it("names the main country and says when the area crosses a border", () => {
    const sy = { iso2: "SY", iso3: "SYR", name: "Syria" };
    const tr = { iso2: "TR", iso3: "TUR", name: "Türkiye" };
    const sea = { iso2: null, iso3: null, name: null };
    expect(countryShares([sy, sy, tr, sea, sy])).toEqual([
      { ...sy, share: 0.75 },
      { ...tr, share: 0.25 },
    ]);
    expect(countryShares([sea])).toEqual([]);
  });
});
