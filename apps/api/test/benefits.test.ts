import { Test } from "@nestjs/testing";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { BenefitsModule } from "../src/benefits/benefits.module";
import {
  areasQuery,
  groupAreas,
  inRing,
  joinRings,
  parseAreas,
  ringAreaKm2,
  thin,
} from "../src/benefits/benefits.service";
import { OverpassClient } from "../src/gateway/overpass.client";
import { WorldBankClient } from "../src/gateway/worldbank.client";
import { type Bbox, PopulationService } from "../src/population/population.service";

const SQUARE: [number, number][] = [
  [7, 50],
  [7.01, 50],
  [7.01, 50.01],
  [7, 50.01],
  [7, 50],
];

/** A fake population grid: one person per cell east of 8°, a country file still loading further east. */
function fakePopulation() {
  const boxes: Bbox[] = [];
  const svc = {
    grid: async (bbox: Bbox) => {
      boxes.push(bbox);
      if (bbox[0] > 8.5)
        return {
          status: "loading",
          reason: "The WorldPop grid of XYZ is being downloaded",
          countries: ["XYZ"],
        };
      const d = 1 / 1200;
      const x0 = Math.floor(bbox[0] / d) * d;
      const y0 = Math.floor(bbox[1] / d) * d;
      const nx = Math.ceil((bbox[2] - x0) / d);
      const ny = Math.ceil((bbox[3] - y0) / d);
      return {
        status: "ready",
        grid: { x0, y0, dx: d, dy: d, nx, ny, people: new Array<number>(nx * ny).fill(1) },
        source: { licence: "CC BY 4.0", year: 2026, countries: ["DEU"] },
      };
    },
  } as unknown as PopulationService;
  return { svc, boxes };
}

const shift = (dx: number) => SQUARE.map(([x, y]) => [x + dx, y] as [number, number]);

describe("population of station areas", () => {
  it("tests points in rings and groups nearby areas into one grid box", () => {
    expect(inRing(7.005, 50.005, SQUARE)).toBe(true);
    expect(inRing(7.02, 50.005, SQUARE)).toBe(false);
    const g = groupAreas([
      { id: "a", ring: SQUARE },
      { id: "b", ring: shift(0.05) },
      { id: "c", ring: shift(2) },
    ]);
    expect(g.map((x) => x.areas.map((a) => a.id))).toEqual([["a", "b"], ["c"]]);
    expect(g[0]!.box[2]).toBeCloseTo(7.06);
  });
});

describe("OpenStreetMap areas", () => {
  it("builds the query", () => {
    const q = areasQuery(2.35, 48.85);
    expect(q).toContain("is_in(48.850000,2.350000)");
    // Relations need their members' geometry: `out tags geom` leaves the members out.
    expect(q.endsWith("out geom;")).toBe(true);
    expect(q).toContain(
      '"place"~"^(city|town|village|borough|suburb|quarter|neighbourhood|district|city_block)$"',
    );
  });

  it("joins outer ways into rings, measures and thins them", () => {
    const rings = joinRings([
      [
        [0, 0],
        [1, 0],
      ],
      [
        [1, 1],
        [1, 0],
      ],
      [
        [1, 1],
        [0, 1],
        [0, 0],
      ],
    ]);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(5);
    expect(ringAreaKm2(SQUARE)).toBeCloseTo(0.716 * 1.113, 1);
    const big = Array.from(
      { length: 3001 },
      (_, i) => [Math.cos(i / 477), Math.sin(i / 477)] as [number, number],
    );
    big[3000] = big[0]!;
    const t = thin(big, 100);
    expect(t).toHaveLength(100);
    expect(t[99]).toEqual(t[0]);
  });

  it("lists named areas smallest first", () => {
    const g = (r: [number, number][]) => r.map(([lon, lat]) => ({ lon, lat }));
    const json = JSON.stringify({
      elements: [
        {
          type: "relation",
          id: 1,
          tags: { name: "City", boundary: "administrative", admin_level: "8" },
          members: [
            { type: "way", role: "outer", geometry: g(shift(0).map(([x, y]) => [x * 1, y + (y - 50) * 9])) },
          ],
        },
        { type: "way", id: 2, tags: { name: "Quarter", place: "quarter" }, geometry: g(SQUARE) },
        { type: "way", id: 3, tags: { place: "suburb" }, geometry: g(SQUARE) },
      ],
    });
    const a = parseAreas(json);
    expect(a.map((x) => [x.id, x.name, x.kind, x.adminLevel])).toEqual([
      ["w2", "Quarter", "quarter", null],
      ["r1", "City", "administrative", 8],
    ]);
  });

  it("refuses an answer Overpass cut short", () => {
    const json = JSON.stringify({ elements: [], remark: "runtime error: Query run out of memory" });
    expect(() => parseAreas(json)).toThrow(/out of memory/);
  });
});

describe("benefit routes", () => {
  it("serve indicators, population and areas, and validate input", async () => {
    const wb = {
      countries: async () => [{ iso3: "FRA", iso2: "FR", name: "France" }],
      latest: async (_c: string, ind: string) => ({ year: 2024, value: ind === "SP.POP.TOTL" ? 68e6 : 42 }),
    } as unknown as WorldBankClient;
    const { svc, boxes } = fakePopulation();
    const overpass = {
      run: async () =>
        JSON.stringify({
          elements: [
            {
              type: "way",
              id: 2,
              tags: { name: "Q", place: "quarter" },
              geometry: SQUARE.map(([lon, lat]) => ({ lon, lat })),
            },
          ],
        }),
    } as unknown as OverpassClient;
    const mod = await Test.createTestingModule({ imports: [BenefitsModule] })
      .overrideProvider(WorldBankClient)
      .useValue(wb)
      .overrideProvider(PopulationService)
      .useValue(svc)
      .overrideProvider(OverpassClient)
      .useValue(overpass)
      .compile();
    const app = mod.createNestApplication();
    await app.init();
    const http = () => request(app.getHttpServer());

    const ind = await http().get("/api/benefits/indicators?code=FR").expect(200);
    expect(ind.body).toMatchObject({
      iso3: "FRA",
      gdpPerCapita: { year: 2024, value: 42 },
      population: { value: 68e6 },
    });
    await http().get("/api/benefits/indicators?code=ZZZ").expect(404);

    const pop = await http()
      .post("/api/benefits/population")
      .send({
        areas: [
          { id: "a", ring: SQUARE },
          { id: "b", ring: shift(2) },
        ],
      })
      .expect(200);
    // 0.01° × 0.01° holds 12 × 12 cells of 3 arc seconds.
    expect(pop.body).toMatchObject({ year: 2026, populations: { a: 144, b: null }, failed: 1 });
    expect(pop.body.reasons[0]).toContain("being downloaded");
    expect(boxes).toHaveLength(2);
    await http().post("/api/benefits/population").send({ areas: [] }).expect(400);
    await http()
      .post("/api/benefits/population")
      .send({ areas: [{ id: "x", ring: [[500, 0]] }] })
      .expect(400);

    const areas = await http().get("/api/benefits/osm-areas?lon=7.005&lat=50.005").expect(200);
    expect(areas.body.areas[0]).toMatchObject({ id: "w2", name: "Q" });
    expect(areas.body.source.licence).toContain("OpenStreetMap");
    await http().get("/api/benefits/osm-areas?lon=999&lat=0").expect(400);
    await app.close();
  });
});
