import { Injectable } from "@nestjs/common";
import { OverpassClient, OverpassError } from "../gateway/overpass.client";
import { type IndicatorValue, WorldBankClient, WorldBankError } from "../gateway/worldbank.client";
import { WORLDPOP_SOURCE, WORLDPOP_YEAR, WorldPopClient } from "../gateway/worldpop.client";

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
  /** Total population in the WorldPop year, to bring WorldPop counts to the latest year. */
  populationWorldPopYear: IndicatorValue | null;
  source: typeof BENEFIT_INDICATOR_SOURCE;
}

/** One area of the population request. */
export interface PopulationArea {
  id: string;
  ring: [number, number][];
}

/** Answer of the population request: people per area (null where WorldPop failed). */
export interface PopulationAnswer {
  year: number;
  populations: Record<string, number | null>;
  failed: number;
  source: typeof WORLDPOP_SOURCE;
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
    `way(pivot.a)["landuse"]["name"];);out tags geom;`
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
    private readonly worldPop: WorldPopClient,
    private readonly overpass: OverpassClient,
  ) {}

  /** Purpose: a country's GDP per capita, employment ratio, share of children and population. */
  async indicators(code: string): Promise<BenefitIndicators> {
    const all = await this.worldBank.countries();
    const c = code.toUpperCase();
    const country = all.find((x) => x.iso3 === c || x.iso2 === c);
    if (!country) throw new WorldBankError("The World Bank has no data for this country", 404);
    const iso3 = country.iso3;
    const [gdpPerCapita, employmentRatio, under15Share, population, popRange] = await Promise.all([
      this.worldBank.latest(iso3, BENEFIT_INDICATORS.gdpPerCapita),
      this.worldBank.latest(iso3, BENEFIT_INDICATORS.employment),
      this.worldBank.latest(iso3, BENEFIT_INDICATORS.under15),
      this.worldBank.latest(iso3, BENEFIT_INDICATORS.population),
      this.worldBank.range(iso3, BENEFIT_INDICATORS.population, WORLDPOP_YEAR, WORLDPOP_YEAR),
    ]);
    return {
      iso3,
      gdpPerCapita,
      employmentRatio,
      under15Share,
      population,
      populationWorldPopYear: popRange[0] ?? null,
      source: BENEFIT_INDICATOR_SOURCE,
    };
  }

  /** Purpose: the WorldPop population of each area; an area WorldPop cannot answer gets null. */
  async population(areas: PopulationArea[]): Promise<PopulationAnswer> {
    const populations: Record<string, number | null> = {};
    let failed = 0;
    await Promise.all(
      areas.map(async (a) => {
        try {
          populations[a.id] = await this.worldPop.population(a.ring);
        } catch {
          populations[a.id] = null;
          failed++;
        }
      }),
    );
    return { year: WORLDPOP_YEAR, populations, failed, source: WORLDPOP_SOURCE };
  }

  /** Purpose: the OpenStreetMap areas (boundaries, neighbourhoods, named places) that contain a point. */
  async areasAt(lon: number, lat: number): Promise<OsmArea[]> {
    return parseAreas(await this.overpass.run(areasQuery(lon, lat)));
  }
}
