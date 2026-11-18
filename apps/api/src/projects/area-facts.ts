import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { DATABASE, type Database } from "../db/database";
import { BenefitsService } from "../benefits/benefits.service";
import { EconomyService, type PlaceCountry } from "../economy/economy.service";
import { NagerClient } from "../gateway/nager.client";
import { OpenMeteoClient } from "../gateway/openmeteo.client";
import { factKey, ProjectDataCache } from "./data-cache";
import { type AreaRegion, type Bbox, projectArea } from "./project-area";

/** A country of the project area with the share of the area's sample points in it. */
export interface AreaCountry {
  iso2: string;
  iso3: string | null;
  name: string;
  /** Share of the sample points, 0 to 1. */
  share: number;
}

/** The countries of the project area: the main one (largest share) is the project's country. */
export interface AreaCountries {
  /** The box they were looked up for; a different area looks them up again. */
  bbox: Bbox;
  main: AreaCountry | null;
  /** Largest first; more than one when the area crosses a border. */
  countries: AreaCountry[];
}

/**
 * Price base year the cost tables ask the economy figures for (the library's `cost.price_base_year`,
 * apps/web/src/features/costs/defaults.generated.json; a test keeps the two the same).
 */
export const PRICE_BASE_YEAR = 2023;

/** Shortest time between two look-ups of one project's facts that did not change its area, ms. */
const RETRY_MS = 10 * 60_000;

/** Sample points across the box per side (n × n points). */
const GRID = 3;

/**
 * Purpose: points to ask the country of: a grid over the box, kept to those inside the picked regions when
 * there are regions (else the whole grid), and the box centre.
 */
export function samplePoints(bbox: Bbox, regions: readonly AreaRegion[]): [number, number][] {
  const [w, s, e, n] = bbox;
  const grid: [number, number][] = [];
  for (let i = 0; i < GRID; i++)
    for (let j = 0; j < GRID; j++)
      grid.push([w + ((i + 0.5) / GRID) * (e - w), s + ((j + 0.5) / GRID) * (n - s)]);
  const inside = regions.length ? grid.filter((p) => regions.some((r) => inRing(p, r.ring))) : grid;
  const centre: [number, number] = [(w + e) / 2, (s + n) / 2];
  return [centre, ...inside.filter((p) => p[0] !== centre[0] || p[1] !== centre[1])];
}

/** Purpose: the countries of the sample points with their shares, largest first (sea points left out). */
export function countryShares(places: readonly PlaceCountry[]): AreaCountry[] {
  const by = new Map<string, { c: PlaceCountry; n: number }>();
  let total = 0;
  for (const c of places) {
    if (!c.iso2 || !c.name) continue;
    total++;
    const x = by.get(c.iso2);
    if (x) x.n++;
    else by.set(c.iso2, { c, n: 1 });
  }
  return [...by.values()]
    .sort((a, b) => b.n - a.n)
    .map(({ c, n }) => ({
      iso2: c.iso2!,
      iso3: c.iso3,
      name: c.name!,
      share: Math.round((n / total) * 100) / 100,
    }));
}

function inRing([x, y]: [number, number], ring: readonly [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * The location facts of the project area, looked up once and kept on the project (#140 step 3): its countries
 * (the main one by share of the area, and a note when the area crosses a border), the main country's public
 * holidays for this year and the next, the climate at the area's centre, and the main country's figures the
 * tables use (currency, exchange rate and price levels, GDP per capita, employment, population). Kept in the project's data cache
 * under the keys the calendar and economy endpoints read through, so the tools find them there.
 */
@Injectable()
export class AreaFactsService {
  private readonly log = new Logger("AreaFacts");
  private readonly running = new Set<string>();
  /** When each project's facts were last looked up, so a failing look-up is not repeated on every request. */
  private readonly tried = new Map<string, number>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly kept: ProjectDataCache,
    @Optional() private readonly economy?: EconomyService,
    @Optional() private readonly nager?: NagerClient,
    @Optional() private readonly openMeteo?: OpenMeteoClient,
    @Optional() private readonly benefits?: BenefitsService,
  ) {}

  /** Purpose: the countries kept for the project's current area, or null (not looked up yet, or the area changed). */
  async countries(projectId: string, bbox: Bbox | null): Promise<AreaCountries | null> {
    if (!bbox) return null;
    const body = await this.kept.get(projectId, "facts", factKey.areaCountries);
    if (!body) return null;
    const c = JSON.parse(body) as AreaCountries;
    return c.bbox.every((v, i) => Math.abs(v - bbox[i]!) < 1e-9) ? c : null;
  }

  /**
   * Purpose: look up the area's facts and keep them, in the background; at most one look-up per project at a
   * time. Each fact that cannot be looked up now is left for the tools to fetch (and keep) later.
   */
  lookUp(projectId: string, force = false): void {
    if (this.running.has(projectId)) return;
    const last = this.tried.get(projectId);
    if (!force && last !== undefined && Date.now() - last < RETRY_MS) return;
    if (this.tried.size > 10_000) this.tried.clear();
    this.tried.set(projectId, Date.now());
    this.running.add(projectId);
    this.lookUpNow(projectId)
      .catch((e: unknown) => this.log.warn(`Project ${projectId}: ${(e as Error).message}`))
      .finally(() => this.running.delete(projectId));
  }

  /** Purpose: look up and keep the area's facts. Output: the countries, or null without an area. */
  async lookUpNow(projectId: string): Promise<AreaCountries | null> {
    const area = await projectArea(this.db, projectId);
    if (!area) return null;
    const places: PlaceCountry[] = [];
    if (this.economy)
      for (const [lon, lat] of samplePoints(area.bbox, area.regions ?? [])) {
        try {
          const r = await this.kept.through(projectId, "facts", factKey.countryAt(lon, lat), async () =>
            JSON.stringify(await this.economy!.countryAt(lon, lat)),
          );
          places.push(JSON.parse(r.body) as PlaceCountry);
        } catch {
          // A point that cannot be asked now does not count.
        }
      }
    const countries = countryShares(places);
    const out: AreaCountries = { bbox: area.bbox, main: countries[0] ?? null, countries };
    if (places.length) await this.kept.put(projectId, "facts", factKey.areaCountries, JSON.stringify(out));
    const year = new Date().getUTCFullYear();
    const main = out.main;
    const tries: Promise<unknown>[] = [];
    if (main && this.nager)
      for (const y of [year, year + 1])
        tries.push(
          this.kept.through(projectId, "facts", factKey.holidays(main.iso2, y), async () =>
            JSON.stringify(await this.nager!.holidays(main.iso2, y)),
          ),
        );
    // The main country's figures, under the code the tables ask with (ISO alpha-3, else alpha-2).
    const code = main ? (main.iso3 ?? main.iso2) : null;
    if (code && this.economy) {
      tries.push(
        this.kept.through(projectId, "facts", factKey.economyCountries, async () =>
          JSON.stringify(await this.economy!.countries()),
        ),
        this.kept.through(projectId, "facts", factKey.economy(code, PRICE_BASE_YEAR), async () =>
          JSON.stringify(await this.economy!.economy(code, PRICE_BASE_YEAR)),
        ),
      );
    }
    if (code && this.benefits)
      tries.push(
        this.kept.through(projectId, "facts", factKey.benefitIndicators(code), async () =>
          JSON.stringify(await this.benefits!.indicators(code)),
        ),
      );
    if (this.openMeteo) {
      const [w, s, e, n] = area.bbox;
      const lat = Math.round(((s + n) / 2) * 10) / 10;
      const lon = Math.round(((w + e) / 2) * 10) / 10;
      tries.push(
        this.kept.through(projectId, "facts", factKey.climate(lat, lon), async () =>
          JSON.stringify(await this.openMeteo!.climate(lat, lon)),
        ),
      );
    }
    await Promise.allSettled(tries);
    return out;
  }
}
