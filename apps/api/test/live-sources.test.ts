import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CopernicusDemClient } from "../src/gateway/copernicus-dem.client";
import { countryQuery, parseCountry } from "../src/economy/economy.service";
import { OverpassClient } from "../src/gateway/overpass.client";
import { WorldPopClient } from "../src/gateway/worldpop.client";
import { PopulationService } from "../src/population/population.service";
import { WorldBankClient } from "../src/gateway/worldbank.client";
import { railQuery, streetQuery, walkQuery } from "../src/street-network/street-network.service";
import { buildingQuery, crossings } from "../src/terrain/buildings";
import { TerrainService } from "../src/terrain/terrain.service";

/**
 * Live checks of the outside data sources the app depends on: Overpass (streets, walkways, railways,
 * buildings), the Copernicus GLO-30 bucket, the WorldPop population grid and the OpenFreeMap basemap. They talk to the real services,
 * so they run only with MOBSIMLAB_LIVE=1 (the "Live data sources" workflow), never in the normal suite.
 */
const live = process.env.MOBSIMLAB_LIVE === "1";
const T = 120_000;

// Köln: the zoom-14 tile with the cathedral and the main station.
const TILE = [8508, 5489] as const;
// From the Domplatte across the cathedral (OSM way 4532022, about 157 m tall) towards the Rhine.
const ACROSS_CATHEDRAL: Array<[number, number]> = [
  [6.9562, 50.9413],
  [6.96, 50.9413],
];

describe.skipIf(!live)("live: OpenStreetMap through Overpass", () => {
  const overpass = new OverpassClient();

  it(
    "returns the streets of a tile",
    async () => {
      const xml = await overpass.run(streetQuery(14, ...TILE));
      expect(xml).toContain("<osm");
      expect((xml.match(/<way /g) ?? []).length).toBeGreaterThan(100);
      expect(xml).toContain('k="highway"');
    },
    T,
  );

  it(
    "returns the walkways of a tile",
    async () => {
      const xml = await overpass.run(walkQuery(14, ...TILE));
      expect((xml.match(/<way /g) ?? []).length).toBeGreaterThan(100);
      expect(xml).toMatch(/v="(footway|pedestrian|steps)"/);
    },
    T,
  );

  it(
    "returns the railways of a tile",
    async () => {
      const xml = await overpass.run(railQuery(14, ...TILE));
      expect(xml).toContain('k="railway"');
      expect(xml).toMatch(/v="(rail|tram|light_rail)"/);
    },
    T,
  );

  it(
    "finds the cathedral under a line across it, with a real height",
    async () => {
      const json = await overpass.run(buildingQuery(ACROSS_CATHEDRAL));
      const parsed = JSON.parse(json) as { remark?: string; elements?: Array<{ type: string; id: number }> };
      const seen = (parsed.elements ?? []).map((e) => `${e.type}/${e.id}`).join(", ");
      const found = crossings(ACROSS_CATHEDRAL, json);
      if (!found.length) {
        // Diagnostics: the same area with a point radius and with a bounding box.
        const count = async (q: string) =>
          ((JSON.parse(await overpass.run(q)) as { elements?: unknown[] }).elements ?? []).length;
        const point = await count(
          '[out:json];(way["building"](around:60,50.9413,6.9581);rel["building"](around:60,50.9413,6.9581););out ids;',
        );
        const box = await count(
          '[out:json];(way["building"](50.9405,6.9560,50.9420,6.9600);rel["building"](50.9405,6.9560,50.9420,6.9600););out ids;',
        );
        throw new Error(
          `No crossings. Line query: [${seen}], point query: ${point}, bbox query: ${box}. Query: ${buildingQuery(ACROSS_CATHEDRAL)}`,
        );
      }
      expect(found.length, `Overpass returned [${seen}]; remark: ${parsed.remark ?? "none"}`).toBeGreaterThan(
        0,
      );
      const tallest = found.reduce((a, b) => (b.heightM > a.heightM ? b : a));
      expect(tallest.heightM).toBeGreaterThan(100);
      expect(tallest.estimated).toBe(false);
    },
    T,
  );
});

describe.skipIf(!live)("live: Copernicus GLO-30", () => {
  const dem = new CopernicusDemClient();

  it(
    "gives known heights and null over the open sea",
    async () => {
      // Rhine at Köln (about 40 m), Zugspitze area (about 2,700 m), open Atlantic (no DEM cell).
      expect(await dem.elevation(6.9685, 50.9413)).toBeGreaterThan(30);
      expect(await dem.elevation(6.9685, 50.9413)).toBeLessThan(55);
      expect(await dem.elevation(10.98, 47.42)).toBeGreaterThan(2_400);
      expect(await dem.elevation(-30, 40)).toBeNull();
    },
    T,
  );

  it(
    "samples a profile across a cell boundary",
    async () => {
      const terrain = new TerrainService(dem, new OverpassClient());
      const [line] = await terrain.profiles(
        [
          [
            [6.99, 50.5],
            [7.01, 50.5],
          ],
        ],
        50,
      );
      expect(line!.length).toBeGreaterThan(25);
      expect(line!.every((s) => s.elevationM !== null && s.elevationM > 50)).toBe(true);
    },
    T,
  );
});

describe.skipIf(!live)("live: WorldPop population grid", () => {
  it(
    "downloads Luxembourg and finds people in the city centre",
    async () => {
      const cacheDir = await mkdtemp(join(tmpdir(), "worldpop-live-"));
      try {
        const worldpop = new WorldPopClient({ cacheDir });
        const entry = await worldpop.entry("LUX");
        expect(entry?.url).toMatch(/^https:\/\/data\.worldpop\.org\/.+\.tif$/);
        const svc = new PopulationService(new OverpassClient(), worldpop);
        // Luxembourg City, about 1 km square: some thousands of people.
        const a = await svc.grid([6.125, 49.605, 6.14, 49.615], 110_000);
        expect(a.status).toBe("ready");
        if (a.status !== "ready") return;
        expect(a.source.countries).toEqual(["LUX"]);
        const total = a.grid.people.reduce((s, v) => s + v, 0);
        expect(total).toBeGreaterThan(1_000);
        expect(total).toBeLessThan(50_000);
      } finally {
        await rm(cacheDir, { recursive: true, force: true });
      }
    },
    T,
  );
});

describe.skipIf(!live)("live: OpenFreeMap basemap", () => {
  it(
    "serves the style and its vector tiles",
    async () => {
      const style = (await (await fetch("https://tiles.openfreemap.org/styles/positron")).json()) as {
        sources: Record<string, { url?: string }>;
      };
      const tilejsonUrl = Object.values(style.sources).find((s) => s.url)?.url;
      expect(tilejsonUrl).toBeTruthy();
      const tilejson = (await (await fetch(tilejsonUrl!)).json()) as { tiles: string[] };
      const tile = await fetch(
        tilejson.tiles[0]!.replace("{z}", "14").replace("{x}", "8508").replace("{y}", "5489"),
      );
      expect(tile.status).toBe(200);
      expect((await tile.arrayBuffer()).byteLength).toBeGreaterThan(1_000);
    },
    T,
  );
});

describe.skipIf(!live)("live: World Bank indicators and the country of a point", () => {
  const worldBank = new WorldBankClient();

  it(
    "returns the PPP factor, exchange rate and US deflator the cost tables use",
    async () => {
      const ppp = await worldBank.latest("DEU", "PA.NUS.PPP");
      expect(ppp?.value).toBeGreaterThan(0.4);
      expect(ppp?.value).toBeLessThan(1.2);
      const fx = await worldBank.latest("DEU", "PA.NUS.FCRF");
      expect(fx?.value).toBeGreaterThan(0.6);
      const deflator = await worldBank.range("USA", "NY.GDP.DEFL.ZS", 2023, new Date().getUTCFullYear());
      expect(deflator[0]?.year).toBe(2023);
      expect((await worldBank.countries()).some((c) => c.iso3 === "KEN")).toBe(true);
    },
    T,
  );

  it(
    "finds the country of a point in the OpenStreetMap boundaries",
    async () => {
      const at = parseCountry(await new OverpassClient().run(countryQuery(6.9583, 50.9413)));
      expect(at.iso3 ?? at.iso2).toMatch(/^DEU?$/);
    },
    T,
  );
});
