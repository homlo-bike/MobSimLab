import { Injectable } from "@nestjs/common";
import { OverpassClient } from "../gateway/overpass.client";
import { emptyGrid, WorldPopClient, type WorldPopEntry } from "../gateway/worldpop.client";

/** Where the people counts come from, shown next to them (C-09). */
export const POPULATION_SOURCE = {
  id: "worldpop_r2025a",
  name: "WorldPop",
  dataset:
    "Constrained estimates of the people per grid square, 2015–2030, 3 arc seconds (about 100 m), R2025A v1",
  url: "https://doi.org/10.5258/SOTON/WP00839",
  licence: "WorldPop, University of Southampton; CC BY 4.0",
} as const;

/** Longest side of the area a grid is read for, degrees (about 30 km); the noise map needs a few km. */
export const MAX_SIDE_DEG = 0.3;
/** How long a request waits for a country file still downloading before it answers `loading`. */
const WAIT_MS = 20_000;

export type Bbox = [number, number, number, number];

export type PopulationAnswer =
  | {
      status: "ready";
      /** People per cell: south-west corner `x0` longitude, `y0` latitude, cell size in degrees, rows from the south. */
      grid: { x0: number; y0: number; dx: number; dy: number; nx: number; ny: number; people: number[] };
      source: typeof POPULATION_SOURCE & { year: number; countries: string[]; citation: string };
    }
  | { status: "loading" | "unavailable"; reason: string };

/**
 * Purpose: Overpass QL for the countries (ISO 3166-1 alpha-3) at the corners and the centre of a box.
 */
export function countryQuery(b: Bbox): string {
  const pts: [number, number][] = [
    [b[0], b[1]],
    [b[2], b[1]],
    [b[0], b[3]],
    [b[2], b[3]],
    [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2],
  ];
  const isIn = pts.map(([lon, lat]) => `is_in(${lat.toFixed(6)},${lon.toFixed(6)});`).join("");
  return `[out:json][timeout:60];(${isIn});area._["ISO3166-1:alpha3"];out tags;`;
}

/** Purpose: the alpha-3 codes in an Overpass answer to `countryQuery`, once each, sorted. */
export function countries(json: string): string[] {
  const els = (JSON.parse(json) as { elements?: { tags?: Record<string, string> }[] }).elements ?? [];
  const out = new Set<string>();
  for (const e of els) {
    const c = e.tags?.["ISO3166-1:alpha3"]?.trim().toUpperCase();
    if (c && /^[A-Z]{3}$/.test(c)) out.add(c);
  }
  return [...out].sort();
}

/**
 * People per 100 m cell from WorldPop for the noise map's population exposure (ADR-0038 step N2):
 * the countries of the area from OpenStreetMap, each country's grid downloaded once to the server,
 * the cells of the area summed over the countries.
 */
@Injectable()
export class PopulationService {
  private readonly countryCache = new Map<string, Promise<string[]>>();

  constructor(
    private readonly overpass: OverpassClient,
    private readonly worldpop: WorldPopClient,
  ) {}

  /**
   * Purpose: the people per cell over a box `[west, south, east, north]`.
   * Output: `ready` with the grid, `loading` while a country file is still downloading (the next
   * request finds it), or `unavailable` with the reason.
   * Side effects: an Overpass request per new area, a catalogue request and a download per new country.
   */
  async grid(bbox: Bbox, waitMs = WAIT_MS): Promise<PopulationAnswer> {
    if (bbox[2] - bbox[0] > MAX_SIDE_DEG || bbox[3] - bbox[1] > MAX_SIDE_DEG)
      throw new RangeError(`The area is larger than ${MAX_SIDE_DEG}° on a side`);
    if (!(bbox[0] < bbox[2] && bbox[1] < bbox[3])) throw new RangeError("The area is empty");
    const codes = await this.countriesOf(bbox);
    if (!codes.length) return { status: "unavailable", reason: "OpenStreetMap places no country here" };
    const entries = (await Promise.all(codes.map((c) => this.worldpop.entry(c)))).filter(
      (e): e is WorldPopEntry => !!e,
    );
    if (!entries.length)
      return { status: "unavailable", reason: `WorldPop has no population grid for ${codes.join(", ")}` };
    const files = Promise.all(entries.map((e) => this.worldpop.file(e)));
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<"late">((r) => (timer = setTimeout(() => r("late"), waitMs)));
    let got: Awaited<typeof files> | "late";
    try {
      got = await Promise.race([files, late]);
    } catch (e) {
      return { status: "unavailable", reason: e instanceof Error ? e.message : String(e) };
    } finally {
      clearTimeout(timer);
    }
    if (got === "late") {
      files.catch(() => undefined);
      return {
        status: "loading",
        reason: `The WorldPop grid of ${entries.map((e) => e.iso3).join(", ")} is being downloaded to the server`,
      };
    }
    const grid = emptyGrid(bbox);
    for (const f of got) await this.worldpop.addTo(grid, f);
    return {
      status: "ready",
      grid: {
        x0: grid.x0,
        y0: grid.y0,
        dx: grid.dx,
        dy: grid.dy,
        nx: grid.nx,
        ny: grid.ny,
        people: Array.from(grid.people, (v) => Math.round(v * 100) / 100),
      },
      source: {
        ...POPULATION_SOURCE,
        year: entries[0]!.year,
        countries: entries.map((e) => e.iso3),
        citation: entries[0]!.citation,
      },
    };
  }

  private countriesOf(b: Bbox): Promise<string[]> {
    const key = b.map((v) => v.toFixed(3)).join(",");
    let p = this.countryCache.get(key);
    if (!p) {
      p = this.overpass.run(countryQuery(b)).then(countries);
      p.catch(() => this.countryCache.delete(key));
      if (this.countryCache.size > 512) this.countryCache.delete(this.countryCache.keys().next().value!);
      this.countryCache.set(key, p);
    }
    return p;
  }
}
