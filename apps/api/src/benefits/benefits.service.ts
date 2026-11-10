import { Injectable } from "@nestjs/common";
import { OverpassClient, OverpassError } from "../gateway/overpass.client";
import { type IndicatorValue, WorldBankClient, WorldBankError } from "../gateway/worldbank.client";
import {
  type Bbox,
  MAX_SIDE_DEG,
  POPULATION_SOURCE,
  PopulationService,
} from "../population/population.service";

/** World Bank indicators the benefit tables use (ADR-0040). */
export const BENEFIT_INDICATORS = {
  /** GDP per capita, current local currency units. */
  gdpPerCapita: "NY.GDP.PCAP.CN",
  /** Employment to population ratio, 15+, total (%), modelled ILO estimate. */
  employment: "SL.EMP.TOTL.SP.ZS",
  /** Population ages 0–14 (% of total population). */
  under15: "SP.POP.0014.TO.ZS",
  /** Population, total. */
  population: "SP.POP.TOTL",
} as const;

export const BENEFIT_INDICATOR_SOURCE = {
  name: "World Bank World Development Indicators",
  note: "GDP per capita in local currency (NY.GDP.PCAP.CN), employment to population ratio 15+ (SL.EMP.TOTL.SP.ZS, ILO modelled), population 0–14 (SP.POP.0014.TO.ZS) and total population (SP.POP.TOTL), latest year available.",
  licence: "CC BY 4.0",
  url: "https://data.worldbank.org/",
} as const;

/** What the benefit tables need of a country. */
export interface BenefitIndicators {
  iso3: string;
  gdpPerCapita: IndicatorValue | null;
  employmentRatio: IndicatorValue | null;
  under15Share: IndicatorValue | null;
  population: IndicatorValue | null;
  source: typeof BENEFIT_INDICATOR_SOURCE;
}

/** One area of the population request. */
export interface PopulationArea {
  id: string;
  ring: [number, number][];
}

/** Answer of the population request: people per area (null where WorldPop could not answer). */
export interface PopulationAnswer {
  /** The WorldPop year of the counts (null when no area was answered). */
  year: number | null;
  populations: Record<string, number | null>;
  failed: number;
  /** Why areas were not answered, e.g. a country grid still downloading to the server. */
  reasons: string[];
  source: typeof POPULATION_SOURCE;
}

/** Purpose: whether a point `[lon, lat]` lies inside a ring (even–odd rule). */
export function inRing(x: number, y: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Purpose: the box `[west, south, east, north]` around a ring. */
export function ringBox(ring: [number, number][]): Bbox {
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/**
 * Purpose: areas grouped so that each group's box stays within the population grid's largest side,
 * so that nearby station catchments share one grid request.
 */
export function groupAreas(
  areas: PopulationArea[],
  maxSide = MAX_SIDE_DEG * 0.95,
): { box: Bbox; areas: PopulationArea[] }[] {
  const groups: { box: Bbox; areas: PopulationArea[] }[] = [];
  const sorted = areas.map((a) => ({ a, b: ringBox(a.ring) })).sort((p, q) => p.b[0] - q.b[0]);
  for (const { a, b } of sorted) {
    const g = groups.find((g) => {
      const u: Bbox = [
        Math.min(g.box[0], b[0]),
        Math.min(g.box[1], b[1]),
        Math.max(g.box[2], b[2]),
        Math.max(g.box[3], b[3]),
      ];
      return u[2] - u[0] <= maxSide && u[3] - u[1] <= maxSide;
    });
    if (g) {
      g.box = [
        Math.min(g.box[0], b[0]),
        Math.min(g.box[1], b[1]),
        Math.max(g.box[2], b[2]),
        Math.max(g.box[3], b[3]),
      ];
      g.areas.push(a);
    } else groups.push({ box: [...b], areas: [a] });
  }
  return groups;
}

/** An OpenStreetMap area (administrative boundary or named place) that contains a point. */
export interface OsmArea {
  id: string;
  name: string;
  kind: string;
  adminLevel: number | null;
  ring: [number, number][];
  areaKm2: number;
}

export const OSM_AREA_SOURCE = {
  name: "OpenStreetMap boundaries and places",
  licence: "© OpenStreetMap contributors, ODbL 1.0",
  url: "https://www.openstreetmap.org/copyright",
} as const;

const PLACE_KINDS = "city|town|village|borough|suburb|quarter|neighbourhood|district|city_block";

/** Purpose: Overpass QL for the administrative areas and named places that contain a point, with geometry. */
export function areasQuery(lon: number, lat: number): string {
  const f = (x: number) => x.toFixed(6);
  return (
    `[out:json][timeout:60][maxsize:67108864];is_in(${f(lat)},${f(lon)})->.a;` +
    `(rel(pivot.a)["boundary"="administrative"]["admin_level"~"^([6-9]|1[01])$"];` +
    `rel(pivot.a)["place"~"^(${PLACE_KINDS})$"];` +
    `way(pivot.a)["place"~"^(${PLACE_KINDS})$"];` +
    `way(pivot.a)["landuse"]["name"];);out geom;`
  );
}

type Pt = [number, number];
interface El {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: ({ lat: number; lon: number } | null)[];
  members?: { type: string; role: string; geometry?: ({ lat: number; lon: number } | null)[] }[];
}

const same = (a: Pt, b: Pt) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;

/** Purpose: closed rings joined from way pieces that meet end to end (a relation's outer members). */
export function joinRings(pieces: Pt[][]): Pt[][] {
  const left = pieces.filter((p) => p.length >= 2).map((p) => [...p]);
  const rings: Pt[][] = [];
  while (left.length) {
    let cur = left.shift()!;
    for (let grew = true; grew && !same(cur[0]!, cur[cur.length - 1]!);) {
      grew = false;
      const end = cur[cur.length - 1]!;
      for (let i = 0; i < left.length; i++) {
        const p = left[i]!;
        if (same(p[0]!, end)) cur = cur.concat(p.slice(1));
        else if (same(p[p.length - 1]!, end)) cur = cur.concat([...p].reverse().slice(1));
        else continue;
        left.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (cur.length >= 4 && same(cur[0]!, cur[cur.length - 1]!)) rings.push(cur);
  }
  return rings;
}

/** Purpose: area of a ring `[lon, lat]` in km² (equirectangular around its centre). */
export function ringAreaKm2(ring: Pt[]): number {
  if (ring.length < 3) return 0;
  const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const kx = 111.32 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 111.32;
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[(i + 1) % ring.length]!;
    a += x1 * kx * (y2 * ky) - x2 * kx * (y1 * ky);
  }
  return Math.abs(a) / 2;
}

/** Purpose: at most `max` points of a ring, evenly picked, still closed. */
export function thin(ring: Pt[], max = 1500): Pt[] {
  if (ring.length <= max) return ring;
  const step = (ring.length - 1) / (max - 1);
  const out: Pt[] = [];
  for (let i = 0; i < max - 1; i++) out.push(ring[Math.round(i * step)]!);
  out.push(out[0]!);
  return out;
}

/** Purpose: the areas in an Overpass answer, smallest first (the neighbourhood before the city). */
export function parseAreas(body: string): OsmArea[] {
  let doc: { elements?: El[] };
  try {
    doc = JSON.parse(body) as typeof doc;
  } catch {
    throw new OverpassError("Overpass answered something other than JSON", 502);
  }
  // Overpass answers 200 with a remark when a query ran out of time or memory: the list is incomplete.
  const remark = (doc as { remark?: unknown }).remark;
  if (typeof remark === "string" && /error/i.test(remark))
    throw new OverpassError(`Overpass: ${remark}`, 502);
  const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
  const pts = (g: El["geometry"]): Pt[] =>
    (g ?? []).filter((p): p is { lat: number; lon: number } => !!p).map((p) => [r6(p.lon), r6(p.lat)]);
  const out: OsmArea[] = [];
  for (const e of doc.elements ?? []) {
    const t = e.tags ?? {};
    const name = t["name"] ?? t["name:en"];
    if (!name) continue;
    const rings =
      e.type === "way"
        ? joinRings([pts(e.geometry)])
        : joinRings(
            (e.members ?? [])
              .filter((m) => m.type === "way" && m.role === "outer")
              .map((m) => pts(m.geometry)),
          );
    if (!rings.length) continue;
    const ring = rings.reduce((a, b) => (ringAreaKm2(b) > ringAreaKm2(a) ? b : a));
    const level = Number(t.admin_level);
    out.push({
      id: `${e.type[0]}${e.id}`,
      name,
      kind:
        t.place ??
        (t.boundary === "administrative" ? "administrative" : t.landuse ? `landuse ${t.landuse}` : "area"),
      adminLevel: Number.isFinite(level) ? level : null,
      ring: thin(ring),
      areaKm2: ringAreaKm2(ring),
    });
  }
  return out.sort((a, b) => a.areaKm2 - b.areaKm2);
}

@Injectable()
export class BenefitsService {
  constructor(
    private readonly worldBank: WorldBankClient,
    private readonly population_: PopulationService,
    private readonly overpass: OverpassClient,
  ) {}

  /** Purpose: a country's GDP per capita, employment ratio, share of children and population. */
  async indicators(code: string): Promise<BenefitIndicators> {
    const all = await this.worldBank.countries();
    const c = code.toUpperCase();
    const country = all.find((x) => x.iso3 === c || x.iso2 === c);
    if (!country) throw new WorldBankError("The World Bank has no data for this country", 404);
    const iso3 = country.iso3;
    const [gdpPerCapita, employmentRatio, under15Share, population] = await Promise.all([
      this.worldBank.latest(iso3, BENEFIT_INDICATORS.gdpPerCapita),
      this.worldBank.latest(iso3, BENEFIT_INDICATORS.employment),
      this.worldBank.latest(iso3, BENEFIT_INDICATORS.under15),
      this.worldBank.latest(iso3, BENEFIT_INDICATORS.population),
    ]);
    return {
      iso3,
      gdpPerCapita,
      employmentRatio,
      under15Share,
      population,
      source: BENEFIT_INDICATOR_SOURCE,
    };
  }

  /**
   * Purpose: the WorldPop population of each area, summed over the 100 m cells whose centre lies inside
   * it (the population grid of ADR-0038); an area WorldPop cannot answer yet gets null.
   */
  async population(areas: PopulationArea[]): Promise<PopulationAnswer> {
    const populations: Record<string, number | null> = {};
    const reasons = new Set<string>();
    let failed = 0;
    let year: number | null = null;
    for (const g of groupAreas(areas)) {
      const pad = 0.001;
      const box: Bbox = [g.box[0] - pad, g.box[1] - pad, g.box[2] + pad, g.box[3] + pad];
      let ans: Awaited<ReturnType<PopulationService["grid"]>>;
      try {
        ans = await this.population_.grid(box);
      } catch (e) {
        ans = { status: "unavailable", reason: e instanceof Error ? e.message : String(e) };
      }
      if (ans.status !== "ready") {
        reasons.add(ans.reason);
        for (const a of g.areas) populations[a.id] = null;
        failed += g.areas.length;
        continue;
      }
      year = ans.source.year;
      const { x0, y0, dx, dy, nx, ny, people } = ans.grid;
      for (const a of g.areas) {
        const [w, s, e, n] = ringBox(a.ring);
        const i0 = Math.max(0, Math.floor((w - x0) / dx));
        const i1 = Math.min(nx - 1, Math.ceil((e - x0) / dx));
        const j0 = Math.max(0, Math.floor((s - y0) / dy));
        const j1 = Math.min(ny - 1, Math.ceil((n - y0) / dy));
        let sum = 0;
        for (let j = j0; j <= j1; j++)
          for (let i = i0; i <= i1; i++)
            if (inRing(x0 + (i + 0.5) * dx, y0 + (j + 0.5) * dy, a.ring)) sum += people[j * nx + i] ?? 0;
        populations[a.id] = sum;
      }
    }
    return { year, populations, failed, reasons: [...reasons], source: POPULATION_SOURCE };
  }

  /** Purpose: the OpenStreetMap areas (boundaries, neighbourhoods, named places) that contain a point. */
  async areasAt(lon: number, lat: number): Promise<OsmArea[]> {
    return parseAreas(await this.overpass.run(areasQuery(lon, lat)));
  }
}
