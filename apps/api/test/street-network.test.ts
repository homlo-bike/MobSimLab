import { Test } from "@nestjs/testing";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { OverpassClient, OverpassError, overpassEndpoint } from "../src/gateway/overpass.client";
import type { GeodataReader } from "../src/geodata/geodata-reader";
import {
  bikeAmenities,
  bikeAmenityKind,
  bikeAmenityQuery,
  buildingQuery,
  buildingUse,
  footprints,
  osmNumber,
  placeKind,
  placeQuery,
  places,
  railQuery,
  StreetNetworkService,
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

  it("serves walk tiles (with paths and cycle tracks) for the cargo bike plugin", async () => {
    const WALK = '<osm version="0.6"><way id="7"/></osm>';
    const { fetchImpl, c } = client([WALK]);
    const mod = await Test.createTestingModule({ imports: [StreetNetworkModule] })
      .overrideProvider(OverpassClient)
      .useValue(c)
      .compile();
    const app = mod.createNestApplication();
    await app.init();
    const ok = await request(app.getHttpServer()).get("/api/street-network/walk-tiles/14/8508/5489");
    expect(ok.status).toBe(200);
    expect(ok.text).toBe(WALK);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await request(app.getHttpServer()).get("/api/street-network/walk-tiles/14/x/1").expect(400);
    await app.close();
  });

  it("finds bicycle charging points and secure or cargo bike parkings", () => {
    const q = bikeAmenityQuery(14, 8508, 5489);
    expect(q).toContain('["amenity"="charging_station"]["bicycle"~"^(yes|designated)$"]');
    expect(q).toContain('["bicycle_parking"~"^(lockers|shed|building)$"]');
    expect(bikeAmenityKind({ amenity: "charging_station" })).toBeNull();
    expect(bikeAmenityKind({ amenity: "bicycle_parking", bicycle_parking: "stands" })).toBeNull();
    expect(bikeAmenityKind({ amenity: "bicycle_parking", supervised: "yes" })).toBe("secure_parking");
    expect(
      bikeAmenityKind({ amenity: "bicycle_parking", bicycle_parking: "lockers", "capacity:cargo_bike": "4" }),
    ).toBe("cargo_parking");
    const json = JSON.stringify({
      elements: [
        {
          type: "node",
          id: 1,
          lat: 50.1,
          lon: 7.1,
          tags: { amenity: "charging_station", bicycle: "yes", fee: "no" },
        },
        {
          type: "way",
          id: 2,
          center: { lat: 50.2, lon: 7.2 },
          tags: { amenity: "bicycle_parking", bicycle_parking: "shed", name: "Radstation", capacity: "40" },
        },
        { type: "node", id: 3, lat: 50.3, lon: 7.3, tags: { amenity: "bicycle_parking" } },
      ],
    });
    expect(bikeAmenities(json)).toEqual([
      { id: "n1", kind: "charging", lonlat: [7.1, 50.1], fee: "no" },
      { id: "w2", kind: "secure_parking", lonlat: [7.2, 50.2], name: "Radstation", capacity: "40" },
    ]);
  });

  it("serves bike amenity tiles as JSON", async () => {
    const { c } = client([JSON.stringify({ elements: [] })]);
    const mod = await Test.createTestingModule({ imports: [StreetNetworkModule] })
      .overrideProvider(OverpassClient)
      .useValue(c)
      .compile();
    const app = mod.createNestApplication();
    await app.init();
    const ok = await request(app.getHttpServer()).get("/api/street-network/bike-amenity-tiles/14/8508/5489");
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.text)).toEqual({ amenities: [] });
    await request(app.getHttpServer()).get("/api/street-network/bike-amenity-tiles/14/x/1").expect(400);
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

  it("answers an OpenStreetMap failure as JSON the browser does not keep", async () => {
    const { c } = client([503, 503, 503]);
    const mod = await Test.createTestingModule({ imports: [StreetNetworkModule] })
      .overrideProvider(OverpassClient)
      .useValue(c)
      .compile();
    const app = mod.createNestApplication();
    await app.init();
    const bad = await request(app.getHttpServer()).get("/api/street-network/tiles/14/8508/5489");
    expect(bad.status).toBe(502);
    expect(bad.headers["cache-control"]).toBe("no-store");
    expect(bad.headers["content-type"]).toContain("application/json");
    expect(bad.body.message).toMatch(/unavailable/);
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

  it("does not advise importing OSM for a place outside the project's import", async () => {
    const overpass = {
      run: async () => {
        throw new OverpassError("OpenStreetMap's Overpass service is busy ... import the area's data", 502);
      },
    } as unknown as OverpassClient;
    const imported = (has: boolean) =>
      ({
        onChange: () => {},
        buildings: async () => null,
        hasOsm: async () => has,
      }) as unknown as GeodataReader;
    const outside = new StreetNetworkService(overpass, imported(true));
    await expect(outside.buildingTile(1, 2, "p1")).rejects.toThrow(/outside the project's imported/);
    await expect(outside.buildingTile(1, 2, "p1")).rejects.toMatchObject({ status: 502 });
    const none = new StreetNetworkService(overpass, imported(false));
    await expect(none.buildingTile(1, 2, "p1")).rejects.toThrow(/import the area/);
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
    expect(f[1]).toMatchObject({ levels: 2, use: "house" });
    expect(f[0]).toMatchObject({ use: "yes" });
    expect(f[2]!.ring[0]).toEqual([7.04, 50]);
  });

  it("names what a building is used for", () => {
    expect(buildingUse({ building: "Apartments" })).toBe("apartments");
    expect(buildingUse({ building: "yes", shop: "bakery" })).toBe("shop");
    expect(buildingUse({ building: "yes", office: "company" })).toBe("office");
    expect(buildingUse({ building: "yes", amenity: "School" })).toBe("amenity:school");
    expect(buildingUse({})).toBe("yes");
  });

  it("reads schools, universities, hospitals and clinics", () => {
    expect(placeQuery(14, 8508, 5489)).toContain(
      'nwr["amenity"~"^(school|kindergarten|college|university|hospital|clinic|doctors)$"]',
    );
    const json = JSON.stringify({
      elements: [
        { type: "node", id: 1, lat: 50, lon: 7, tags: { amenity: "school", name: "A" } },
        { type: "way", id: 2, center: { lat: 50.1, lon: 7.1 }, tags: { amenity: "university" } },
        { type: "relation", id: 3, center: { lat: 50.2, lon: 7.2 }, tags: { healthcare: "hospital" } },
        { type: "node", id: 4, lat: 50.3, lon: 7.3, tags: { amenity: "doctors" } },
        { type: "node", id: 5, lat: 50.4, lon: 7.4, tags: { amenity: "bench" } },
        { type: "way", id: 6, tags: { amenity: "clinic" } },
      ],
    });
    expect(places(json)).toEqual([
      { id: "n1", kind: "school", lonlat: [7, 50], name: "A" },
      { id: "w2", kind: "university", lonlat: [7.1, 50.1] },
      { id: "r3", kind: "hospital", lonlat: [7.2, 50.2] },
      { id: "n4", kind: "clinic", lonlat: [7.3, 50.3] },
    ]);
    expect(placeKind({ amenity: "kindergarten" })).toBe("school");
    expect(placeKind({ healthcare: "centre" })).toBe("clinic");
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
