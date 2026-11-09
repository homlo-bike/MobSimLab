import { describe, expect, it } from "vitest";
import { CopernicusDemClient } from "../src/gateway/copernicus-dem.client";
import { OverpassClient } from "../src/gateway/overpass.client";
import { railQuery, streetQuery, walkQuery } from "../src/street-network/street-network.service";
import { buildingQuery, crossings } from "../src/terrain/buildings";
import { TerrainService } from "../src/terrain/terrain.service";

/**
 * Live checks of the outside data sources the app depends on: Overpass (streets, walkways, railways,
 * buildings), the Copernicus GLO-30 bucket and the OpenFreeMap basemap. They talk to the real services,
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
      const found = crossings(ACROSS_CATHEDRAL, json);
      expect(found.length).toBeGreaterThan(0);
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
