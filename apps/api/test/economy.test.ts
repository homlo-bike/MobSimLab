import { Test } from "@nestjs/testing";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { EconomyModule } from "../src/economy/economy.module";
import { countryQuery, parseCountry } from "../src/economy/economy.service";
import { OverpassClient } from "../src/gateway/overpass.client";
import { WorldBankClient, WorldBankError, worldBankEndpoint } from "../src/gateway/worldbank.client";

const COUNTRIES = [
  { page: 1, pages: 1, per_page: 400, total: 4 },
  [
    { id: "DEU", iso2Code: "DE", name: "Germany", region: { id: "ECS", value: "Europe & Central Asia" } },
    { id: "USA", iso2Code: "US", name: "United States", region: { id: "NAC", value: "North America" } },
    { id: "EUU", iso2Code: "EU", name: "European Union", region: { id: "NA", value: "Aggregates" } },
    { id: "KEN", iso2Code: "KE", name: "Kenya", region: { id: "SSF", value: "Sub-Saharan Africa" } },
  ],
];

const series = (rows: Array<[string, number | null]>, iso3 = "DEU") => [
  { page: 1, pages: 1 },
  rows.map(([date, value]) => ({ date, value, countryiso3code: iso3, country: { id: "x", value: "x" } })),
];

/** A fake World Bank host answering from a table of URL fragments; counts requests. */
function fakeWorldBank(fail: Set<number> = new Set()) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL) => {
    const u = String(url);
    calls.push(u);
    if (fail.has(calls.length)) return new Response("busy", { status: 503 });
    let body: unknown;
    if (u.includes("/country?")) body = COUNTRIES;
    else if (u.includes("country/DEU/indicator/PA.NUS.PPP")) body = series([["2024", 0.72]]);
    else if (u.includes("country/DEU/indicator/PA.NUS.FCRF")) body = series([["2024", 0.924]]);
    else if (u.includes("country/USA/indicator/NY.GDP.DEFL.ZS"))
      body = series(
        [
          ["2025", 129.4],
          ["2024", 125.2],
          ["2023", 122.3],
          ["2026", null],
        ],
        "USA",
      );
    else if (u.includes("country/USA/indicator/PA.NUS")) body = series([["2024", 1]], "USA");
    else
      body = [
        {
          message: [{ id: "120", key: "Invalid value", value: "The provided parameter value is not valid" }],
        },
      ];
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  const client = new WorldBankClient({ fetchImpl, sleep: async () => {}, endpoint: "https://wb.test/v2" });
  return { client, calls };
}

const overpass = {
  run: async (q: string) => {
    expect(q).toContain("is_in(");
    if (q.includes("is_in(0.000000,-30.000000)")) return JSON.stringify({ elements: [] });
    return JSON.stringify({
      elements: [
        {
          type: "area",
          tags: { name: "Deutschland", "name:en": "Germany", "ISO3166-1:alpha3": "DEU", "ISO3166-1": "DE" },
        },
      ],
    });
  },
} as unknown as OverpassClient;

describe("World Bank client", () => {
  it("accepts only https endpoints", () => {
    expect(worldBankEndpoint({})).toBe("https://api.worldbank.org/v2");
    expect(worldBankEndpoint({ MOBSIMLAB_WORLDBANK_URL: "https://mirror.example/v2/" })).toBe(
      "https://mirror.example/v2",
    );
    expect(() => worldBankEndpoint({ MOBSIMLAB_WORLDBANK_URL: "http://mirror.example" })).toThrow();
  });

  it("reads the latest value and ranges, leaves out aggregates and empty years, and caches", async () => {
    const { client, calls } = fakeWorldBank();
    expect(await client.latest("deu", "PA.NUS.PPP")).toEqual({ year: 2024, value: 0.72 });
    expect(await client.range("USA", "NY.GDP.DEFL.ZS", 2023, 2026)).toEqual([
      { year: 2023, value: 122.3 },
      { year: 2024, value: 125.2 },
      { year: 2025, value: 129.4 },
    ]);
    expect((await client.countries()).map((c) => c.iso3)).toEqual(["DEU", "KEN", "USA"]);
    const n = calls.length;
    await client.latest("DEU", "PA.NUS.PPP");
    expect(calls.length).toBe(n);
  });

  it("retries a busy host, and rejects bad codes and unknown countries", async () => {
    const { client, calls } = fakeWorldBank(new Set([1]));
    expect(await client.latest("DEU", "PA.NUS.FCRF")).toEqual({ year: 2024, value: 0.924 });
    expect(calls.length).toBe(2);
    await expect(client.latest("D3U", "PA.NUS.PPP")).rejects.toBeInstanceOf(WorldBankError);
    await expect(client.latest("XXX", "PA.NUS.PPP")).rejects.toMatchObject({ status: 404 });
  });
});

describe("country of a point", () => {
  it("builds the query and reads the codes", () => {
    expect(countryQuery(13.4, 52.52)).toContain("is_in(52.520000,13.400000)");
    expect(
      parseCountry(JSON.stringify({ elements: [{ tags: { "ISO3166-1": "KE", name: "Kenya" } }] })),
    ).toEqual({
      iso3: null,
      iso2: "KE",
      name: "Kenya",
    });
    expect(parseCountry(JSON.stringify({ elements: [] }))).toEqual({ iso3: null, iso2: null, name: null });
  });
});

describe("economy routes", () => {
  it("serve the country at a point, the country list and the indicators", async () => {
    const { client } = fakeWorldBank();
    const mod = await Test.createTestingModule({ imports: [EconomyModule] })
      .overrideProvider(WorldBankClient)
      .useValue(client)
      .overrideProvider(OverpassClient)
      .useValue(overpass)
      .compile();
    const app = mod.createNestApplication();
    await app.init();
    const http = () => request(app.getHttpServer());

    const at = await http().get("/api/economy/country-at?lon=13.4&lat=52.52").expect(200);
    expect(at.body).toMatchObject({ iso3: "DEU", name: "Germany" });
    expect(at.body.source.licence).toContain("OpenStreetMap");
    const sea = await http().get("/api/economy/country-at?lon=-30&lat=0").expect(200);
    expect(sea.body.iso3).toBeNull();

    const list = await http().get("/api/economy/countries").expect(200);
    expect(list.body.countries).toHaveLength(3);

    const de = await http().get("/api/economy/indicators?code=DE&base=2023").expect(200);
    expect(de.body).toMatchObject({
      country: { iso3: "DEU", name: "Germany" },
      ppp: { year: 2024, value: 0.72 },
      fx: { year: 2024, value: 0.924 },
      usDeflator: { base: { year: 2023, value: 122.3 }, latest: { year: 2025, value: 129.4 } },
    });
    expect(de.body.source.licence).toBe("CC BY 4.0");

    await http().get("/api/economy/indicators?code=ZZZ").expect(404);
    await http().get("/api/economy/indicators?code=1").expect(400);
    await http().get("/api/economy/country-at?lon=200&lat=0").expect(400);
    await app.close();
  });
});
