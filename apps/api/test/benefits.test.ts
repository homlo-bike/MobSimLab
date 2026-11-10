import { Test } from "@nestjs/testing";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { BenefitsModule } from "../src/benefits/benefits.module";
import { areasQuery, joinRings, parseAreas, ringAreaKm2, thin } from "../src/benefits/benefits.service";
import { OverpassClient } from "../src/gateway/overpass.client";
import { WorldBankClient } from "../src/gateway/worldbank.client";
import { ringGeoJson, WorldPopClient, WorldPopError, worldPopEndpoint } from "../src/gateway/worldpop.client";

const SQUARE: [number, number][] = [
  [7, 50],
  [7.01, 50],
  [7.01, 50.01],
  [7, 50.01],
  [7, 50],
];

/** A fake WorldPop host: answers at once, through a task, or with an error, by the polygon's first longitude. */
function fakeWorldPop(fail: Set<number> = new Set(), html: Set<number> = new Set()) {
  const calls: string[] = [];
  let polls = 0;
  const fetchImpl = (async (url: string | URL) => {
    const u = String(url);
    calls.push(u);
    if (fail.has(calls.length)) return new Response("busy", { status: 503 });
    if (html.has(calls.length)) return new Response("<html>Bad gateway</html>", { status: 200 });
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (u.includes("/tasks/t1")) {
      polls++;
      return json(
        polls < 2
          ? { status: "started", taskid: "t1" }
          : { status: "finished", error: false, data: { total_population: 4321.5 } },
      );
    }
    const geo = decodeURIComponent(new URL(u).searchParams.get("geojson") ?? "");
    if (geo.includes("[8,")) return json({ status: "created", taskid: "t1" });
    if (geo.includes("[9,")) return json({ status: "finished", error: true, error_message: "outside" });
    return json({ status: "finished", error: false, data: { total_population: 1234.25 } });
  }) as typeof fetch;
  const client = new WorldPopClient({
    fetchImpl,
    sleep: async () => {},
    endpoint: "https://wp.test/v1",
    backoffMs: [1],
  });
  return { client, calls };
}

const shift = (dx: number) => SQUARE.map(([x, y]) => [x + dx, y] as [number, number]);

describe("WorldPop client", () => {
  it("accepts only https endpoints", () => {
    expect(worldPopEndpoint({})).toBe("https://api.worldpop.org/v1");
    expect(() => worldPopEndpoint({ MOBSIMLAB_WORLDPOP_URL: "http://wp.example" })).toThrow();
  });

  it("closes rings and rounds coordinates", () => {
    const g = JSON.parse(
      ringGeoJson([
        [7.123456789, 50],
        [7.2, 50],
        [7.2, 50.1],
      ]),
    );
    const c = g.features[0].geometry.coordinates[0];
    expect(c[0]).toEqual([7.12346, 50]);
    expect(c[c.length - 1]).toEqual(c[0]);
  });

  it("reads an immediate answer and caches it", async () => {
    const { client, calls } = fakeWorldPop();
    expect(await client.population(SQUARE)).toBe(1234.25);
    expect(calls[0]).toContain("dataset=wpgppop");
    expect(calls[0]).toContain("year=2020");
    await client.population(SQUARE);
    expect(calls).toHaveLength(1);
  });

  it("polls a task until it is finished, retries a busy host and reports errors", async () => {
    const { client, calls } = fakeWorldPop(new Set([1]));
    expect(await client.population(shift(1))).toBe(4321.5);
    expect(calls.filter((c) => c.includes("/tasks/t1"))).toHaveLength(2);
    await expect(client.population(shift(2))).rejects.toBeInstanceOf(WorldPopError);
  });

  it("retries an HTML error page answered with status 200", async () => {
    const { client, calls } = fakeWorldPop(new Set(), new Set([1]));
    expect(await client.population(SQUARE)).toBe(1234.25);
    expect(calls).toHaveLength(2);
  });
});

describe("OpenStreetMap areas", () => {
  it("builds the query", () => {
    const q = areasQuery(2.35, 48.85);
    expect(q).toContain("is_in(48.850000,2.350000)");
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
      range: async () => [{ year: 2020, value: 67e6 }],
    } as unknown as WorldBankClient;
    const { client } = fakeWorldPop();
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
      .overrideProvider(WorldPopClient)
      .useValue(client)
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
      populationWorldPopYear: { year: 2020, value: 67e6 },
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
    expect(pop.body).toMatchObject({ year: 2020, populations: { a: 1234.25, b: null }, failed: 1 });
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
