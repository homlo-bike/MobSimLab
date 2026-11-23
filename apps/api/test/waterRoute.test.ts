import { Test } from "@nestjs/testing";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { CopernicusDemClient } from "../src/gateway/copernicus-dem.client";
import { GebcoClient, gebcoSettings } from "../src/gateway/gebco.client";
import { OpenElevationClient } from "../src/gateway/open-elevation.client";
import { OverpassClient } from "../src/gateway/overpass.client";
import { crossingsQuery, metres, waterCrossings } from "../src/street-network/water-crossings";
import { TerrainModule } from "../src/terrain/terrain.module";

/** A GEBCO server that answers each point with an elevation of minus ten times its latitude. */
function fakeGebco() {
  const asked: number[] = [];
  const client = new GebcoClient({
    endpoint: "https://depth.example/v1/gebco2020",
    batchSize: 2,
    minIntervalMs: 0,
    backoffMs: [],
    fetchImpl: (async (url: string, init: RequestInit) => {
      expect(url).toBe("https://depth.example/v1/gebco2020");
      const body = JSON.parse(String(init.body)) as { locations: string };
      const locs = body.locations.split("|").map((l) => l.split(",").map(Number) as [number, number]);
      asked.push(locs.length);
      return new Response(
        JSON.stringify({ results: locs.map(([lat]) => ({ elevation: lat > 80 ? null : -10 * lat })) }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch,
  });
  return { client, asked };
}

describe("bridges and locks for the ferry route checks", () => {
  it("asks Overpass for bridges and locks", () => {
    const q = crossingsQuery([9.9, 53.5, 10.1, 53.6]);
    expect(q).toContain("(53.500000,9.900000,53.600000,10.100000)");
    for (const tag of ['"bridge"', "lock_gate", '"lock"="yes"', "out tags geom"]) expect(q).toContain(tag);
  });

  it("reads heights in metres and feet", () => {
    expect(metres("12")).toBe(12);
    expect(metres("12.5 m")).toBe(12.5);
    expect(metres("7,2")).toBe(7.2);
    expect(metres("10'")).toBeCloseTo(3.05, 2);
    expect(metres("default")).toBeNull();
    expect(metres(undefined)).toBeNull();
  });

  it("gives each bridge its clearance and whether it opens, and the locks", () => {
    const g = [
      { lat: 53.5, lon: 9.95 },
      { lat: 53.51, lon: 9.95 },
    ];
    const json = JSON.stringify({
      elements: [
        {
          type: "way",
          id: 1,
          tags: { highway: "primary", bridge: "yes", name: "Low", "seamark:bridge:clearance_height": "6.5" },
          geometry: g,
        },
        {
          type: "way",
          id: 2,
          tags: { railway: "rail", bridge: "movable", "seamark:bridge:clearance_height_closed": "3" },
          geometry: g,
        },
        {
          type: "way",
          id: 3,
          tags: { highway: "footway", bridge: "yes", "seamark:bridge:category": "fixed" },
          geometry: g,
        },
        {
          type: "node",
          id: 4,
          lat: 53.55,
          lon: 10,
          tags: { waterway: "lock_gate", lock_name: "Kanalschleuse" },
        },
        { type: "way", id: 5, tags: { waterway: "canal", lock: "yes", name: "Main lock" }, geometry: g },
      ],
    });
    const { bridges, locks } = waterCrossings(json);
    expect(bridges).toEqual([
      {
        name: "Low",
        line: [
          [9.95, 53.5],
          [9.95, 53.51],
        ],
        clearance_m: 6.5,
        movable: false,
      },
      {
        name: "",
        line: [
          [9.95, 53.5],
          [9.95, 53.51],
        ],
        clearance_m: 3,
        movable: true,
      },
      {
        name: "",
        line: [
          [9.95, 53.5],
          [9.95, 53.51],
        ],
        clearance_m: null,
        movable: false,
      },
    ]);
    expect(locks).toEqual([
      { name: "Kanalschleuse", line: [[10, 53.55]] },
      {
        name: "Main lock",
        line: [
          [9.95, 53.5],
          [9.95, 53.51],
        ],
      },
    ]);
  });
});

describe("GEBCO water depths", () => {
  it("reads the server from the environment, or none when off", () => {
    expect(gebcoSettings({})).toEqual({ endpoint: "https://api.opentopodata.org/v1/gebco2020" });
    expect(gebcoSettings({ MOBSIMLAB_GEBCO_URL: "https://depth.example/v1/gebco2020/" })).toEqual({
      endpoint: "https://depth.example/v1/gebco2020",
    });
    expect(gebcoSettings({ MOBSIMLAB_GEBCO: "off" })).toBeNull();
    expect(() => gebcoSettings({ MOBSIMLAB_GEBCO_URL: "http://depth.example" })).toThrow();
  });

  it("gives depths below sea level in batches and keeps them", async () => {
    const { client, asked } = fakeGebco();
    expect(
      await client.depths([
        [3, 1],
        [3, 2],
        [3, 3],
        [3, 85],
      ]),
    ).toEqual([10, 20, 30, null]);
    expect(asked).toEqual([2, 2]);
    expect(await client.depths([[3, 2]])).toEqual([20]);
    expect(asked).toEqual([2, 2]);
  });

  it("answers the editor's depth request, and 503 when depths are off", async () => {
    const make = async (gebco: GebcoClient | null) => {
      const mod = await Test.createTestingModule({ imports: [TerrainModule] })
        .overrideProvider(CopernicusDemClient)
        .useValue(new CopernicusDemClient())
        .overrideProvider(OverpassClient)
        .useValue(new OverpassClient())
        .overrideProvider(OpenElevationClient)
        .useValue(null)
        .overrideProvider(GebcoClient)
        .useValue(gebco)
        .compile();
      const app = mod.createNestApplication();
      await app.init();
      return app;
    };
    const app = await make(fakeGebco().client);
    const res = await request(app.getHttpServer())
      .post("/api/terrain/depths")
      .send({
        points: [
          [3, 1],
          [3, 4],
        ],
      })
      .expect(200);
    expect(res.body.depthsM).toEqual([10, 40]);
    expect(res.body.source.id).toBe("gebco");
    await request(app.getHttpServer()).post("/api/terrain/depths").send({ points: [] }).expect(400);
    await app.close();
    const off = await make(null);
    await request(off.getHttpServer())
      .post("/api/terrain/depths")
      .send({ points: [[3, 1]] })
      .expect(503);
    await off.close();
  });
});
