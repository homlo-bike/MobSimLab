import { Test } from "@nestjs/testing";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { OverpassClient, overpassEndpoint } from "../src/gateway/overpass.client";
import {
  buildingQuery,
  footprints,
  osmNumber,
  railQuery,
  streetQuery,
  tileBbox,
} from "../src/street-network/street-network.service";
import { StreetNetworkModule } from "../src/street-network/street-network.module";

const XML = '<osm version="0.6"><node id="1" lat="50" lon="7"/></osm>';

function client(responses: Array<number | string>) {
  const fetchImpl = vi.fn(async () => {
    const r = responses.shift();
    return typeof r === "number" ? new Response("busy", { status: r }) : new Response(r ?? XML);
  });
  return {
    fetchImpl,
    c: new OverpassClient({ fetchImpl, sleep: async () => {}, minIntervalMs: 0, backoffMs: [1, 1] }),
  };
}

describe("street tiles", () => {
  it("computes tile bounds", () => {
    const [s, w, n, e] = tileBbox(14, 8508, 5489); // Köln
    expect(w).toBeCloseTo(6.9434, 3);
    expect(e - w).toBeCloseTo(360 / 2 ** 14, 9);
    expect(n).toBeGreaterThan(s);
    expect(s).toBeGreaterThan(50.9);
  });

  it("asks only for roads and their turn restrictions", () => {
    const q = streetQuery(14, 8508, 5489);
    expect(q).toContain('way["highway"~"^(motorway|');
    expect(q).toContain('rel(bw.w)["type"="restriction"]');
    expect(q).not.toContain('"building"');
  });

  it("asks for railway tracks of every kind, not roads", () => {
    const q = railQuery(14, 8508, 5489);
    expect(q).toContain('way["railway"~"^(rail|light_rail|tram|subway|');
    expect(q).toContain("node(w.w)");
    expect(q).not.toContain('"highway"');
  });

  it("serves railway tiles apart from street tiles", async () => {
    const RAIL = '<osm version="0.6"><way id="9"/></osm>';
    const { fetchImpl, c } = client([RAIL, XML]);
    const mod = await Test.createTestingModule({ imports: [StreetNetworkModule] })
      .overrideProvider(OverpassClient)
      .useValue(c)
      .compile();
    const app = mod.createNestApplication();
    await app.init();
    const rail = await request(app.getHttpServer()).get("/api/street-network/rail-tiles/14/8508/5489");
    expect(rail.status).toBe(200);
    expect(rail.text).toBe(RAIL);
    const road = await request(app.getHttpServer()).get("/api/street-network/tiles/14/8508/5489");
    expect(road.text).toBe(XML);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await request(app.getHttpServer()).get("/api/street-network/rail-tiles/14/x/1").expect(400);
    await app.close();
  });

  it("serves a tile, caches it, and rejects invalid tiles", async () => {
    const { fetchImpl, c } = client([XML]);
    const mod = await Test.createTestingModule({ imports: [StreetNetworkModule] })
      .overrideProvider(OverpassClient)
      .useValue(c)
      .compile();
    const app = mod.createNestApplication();
    await app.init();
    const ok = await request(app.getHttpServer()).get("/api/street-network/tiles/14/8508/5489");
    expect(ok.status).toBe(200);
    expect(ok.headers["content-type"]).toContain("application/xml");
    expect(ok.text).toBe(XML);
    await request(app.getHttpServer()).get("/api/street-network/tiles/14/8508/5489").expect(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await request(app.getHttpServer()).get("/api/street-network/tiles/14/99999/1").expect(400);
    await request(app.getHttpServer()).get("/api/street-network/tiles/14/-1/1").expect(400);
    await app.close();
  });

  it("retries busy answers and gives up with 502", async () => {
    const ok = client([429, 504, XML]);
    await expect(ok.c.run("q")).resolves.toBe(XML);
    expect(ok.fetchImpl).toHaveBeenCalledTimes(3);
    const bad = client([503, 503, 503]);
    await expect(bad.c.run("q")).rejects.toMatchObject({ status: 502 });
    const notFound = client([400]);
    await expect(notFound.c.run("q")).rejects.toMatchObject({ status: 502 });
    expect(notFound.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("only accepts an https Overpass endpoint", () => {
    expect(overpassEndpoint({})).toContain("https://");
    expect(() => overpassEndpoint({ MOBSIMLAB_OVERPASS_URL: "http://example.org/api" })).toThrow();
  });

  it("asks for buildings, not building=no, as JSON with geometry", () => {
    const q = buildingQuery(14, 8508, 5489);
    expect(q).toContain("[out:json]");
    expect(q).toContain('way["building"]["building"!="no"]');
    expect(q).toContain('rel["building"]["building"!="no"]["type"="multipolygon"]');
    expect(q).toContain("out tags geom;");
  });

  it("reads OSM heights and storeys", () => {
    expect(osmNumber("12")).toBe(12);
    expect(osmNumber("12.5 m")).toBe(12.5);
    expect(osmNumber("7,5")).toBe(7.5);
    expect(osmNumber("3;4")).toBe(3);
    expect(osmNumber("tall")).toBeUndefined();
    expect(osmNumber("0")).toBeUndefined();
    expect(osmNumber(undefined)).toBeUndefined();
  });

  it("turns ways and multipolygons into footprints", () => {
    const sq = (x: number) => [
      { lat: 50, lon: x },
      { lat: 50, lon: x + 0.001 },
      { lat: 50.001, lon: x + 0.001 },
      { lat: 50, lon: x },
    ];
    const json = JSON.stringify({
      elements: [
        { type: "way", id: 1, tags: { building: "yes", height: "15 m" }, geometry: sq(7) },
        { type: "way", id: 2, tags: { building: "house", "building:levels": "2" }, geometry: sq(7.01) },
        { type: "way", id: 3, tags: { building: "yes", location: "underground" }, geometry: sq(7.02) },
        { type: "way", id: 4, tags: { building: "yes" }, geometry: sq(7.03).slice(0, 3) },
        {
          type: "relation",
          id: 5,
          tags: { building: "yes", type: "multipolygon" },
          members: [
            { type: "way", role: "outer", geometry: sq(7.04) },
            { type: "way", role: "inner", geometry: sq(7.05) },
          ],
        },
      ],
    });
    const f = footprints(json);
    expect(f.map((b) => b.id)).toEqual(["w1", "w2", "r5"]);
    expect(f[0]).toMatchObject({ height_m: 15 });
    expect(f[0]).not.toHaveProperty("levels");
    expect(f[1]).toMatchObject({ levels: 2 });
    expect(f[2]!.ring[0]).toEqual([7.04, 50]);
  });

  it("serves building tiles as footprints", async () => {
    const OSM = JSON.stringify({
      elements: [
        {
          type: "way",
          id: 7,
          tags: { building: "yes" },
          geometry: [
            { lat: 50, lon: 7 },
            { lat: 50, lon: 7.001 },
            { lat: 50.001, lon: 7 },
            { lat: 50, lon: 7 },
          ],
        },
      ],
    });
    const { fetchImpl, c } = client([OSM]);
    const mod = await Test.createTestingModule({ imports: [StreetNetworkModule] })
      .overrideProvider(OverpassClient)
      .useValue(c)
      .compile();
    const app = mod.createNestApplication();
    await app.init();
    const res = await request(app.getHttpServer()).get("/api/street-network/building-tiles/14/8508/5489");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(JSON.parse(res.text).buildings).toHaveLength(1);
    await request(app.getHttpServer()).get("/api/street-network/building-tiles/14/8508/5489").expect(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await app.close();
  });
});
