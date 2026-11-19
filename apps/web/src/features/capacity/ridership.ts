/**
 * Weekday boardings at the stations and stops of the project's lines for the system test's passenger loads:
 * the Tables tab's ridership estimate (ADR-0040, the `ridership_daily` formula over the people, jobs and
 * students near each station), or the planner's own number for a station or stop, which takes priority.
 */
import { tNow } from "../../i18n/i18n";
import {
  benefitsApi,
  type BenefitsApi,
  catchmentTiles,
  countryFigures,
  loadTiles,
  MAX_TILES,
} from "../benefits/data";
import { compile } from "../benefits/formula";
import { type BenefitsDoc, FORMULA_BY_ID, formulaText } from "../benefits/formulas";
import { catchment, circle, prepare, type Zone } from "../benefits/model";
import { networkOf } from "../benefits/network";
import { paramValue } from "../benefits/params";
import type { Region } from "../benefits/regions";
import type { Timetable } from "../journey-planner/types";
import { sameNameStationM } from "../../workspace/preferences";

/** The planner's own weekday boardings, by station or stop name (kept in the `benefits` drawing). */
export type Boardings = Record<string, number>;

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** What the estimate needs from the project. */
export interface RidershipInput {
  /** The published network, as the Tables tab sees it. */
  timetable: Timetable | null;
  regions: Region[];
  prefs: Record<string, number> | undefined;
  doc: BenefitsDoc | null;
  /** ISO 3166-1 alpha-3 code of the project's country (cost tables), for the share of children and workers. */
  country: string | null;
}

/** The estimate's zones (one per station), with a note when part of the data did not load. */
export interface RidershipZones {
  zones: Zone[];
  notes: string[];
}

/**
 * Purpose: the zones of the published network with their people, jobs and students, as the Tables tab finds
 * them (OpenStreetMap buildings, WorldPop, World Bank figures and the GIS tab's regions).
 * Output: the zones; none when nothing is published. Side effects: asks the API for the data.
 */
export async function loadZones(
  input: RidershipInput,
  api: BenefitsApi = benefitsApi(),
): Promise<RidershipZones> {
  const tt = input.timetable;
  if (!tt) return { zones: [], notes: [] };
  const net = networkOf(tt, sameNameStationM(input.prefs));
  if (!net.stations.length) return { zones: [], notes: [] };
  const st = net.stations.map((s) => ({ id: s.id, at: s.at, radius: catchment(s.modes, input.prefs) }));
  const all = catchmentTiles(st);
  const areas = st.map((s) => ({ id: s.id, ring: circle(s.at, s.radius) }));
  const [tiles, pop, ind] = await Promise.all([
    loadTiles(api, all.slice(0, MAX_TILES)).catch(() => ({ buildings: [], places: [], failed: all.length })),
    api.population(areas).catch(() => null),
    input.country ? api.indicators(input.country).catch(() => null) : Promise.resolve(null),
  ]);
  const p = prepare({
    timetable: tt,
    buildings: tiles.buildings,
    places: tiles.places,
    worldpop: pop?.populations ?? {},
    country: countryFigures(ind),
    regions: input.regions,
    prefs: input.prefs,
  });
  return { zones: p.zones, notes: p.notes.map((n) => tNow(n.key, n.vars)) };
}

/**
 * Purpose: the Tables tab's weekday boardings of one line at each of its stops (medium estimate): the
 * `ridership_daily` formula with the line's mode's parameters, over the station's people, jobs and students
 * shared among the lines calling there.
 * Inputs: the zones, the line's mode, its stop names, the project's values and formulas.
 * Output: boardings by stop name (stops without a zone are left out).
 */
export function estimatedBoardings(
  zones: readonly Zone[],
  mode: string,
  stops: readonly string[],
  prefs: Record<string, number> | undefined,
  doc: BenefitsDoc | null,
): Boardings {
  const def = FORMULA_BY_ID.ridership_daily;
  const fn = compile(
    formulaText(doc, "ridership_daily"),
    def.vars.map((v) => v.name),
  ).fn;
  const resident = paramValue("benefit.ridership.resident_share", mode, prefs)[1];
  const trips = paramValue("benefit.ridership.trips_per_user", mode, prefs)[1];
  const byName = new Map(zones.map((z) => [norm(z.name), z]));
  const out: Boardings = {};
  for (const s of stops) {
    const z = byName.get(norm(s));
    if (!z) continue;
    const k = z.lines.length || 1;
    const v = fn({
      pop: z.pop / k,
      jobs: z.jobs / k,
      students: z.students / k,
      resident_share: resident,
      trips_per_user: trips,
    });
    if (Number.isFinite(v)) out[s] = Math.max(0, v);
  }
  return out;
}

/**
 * Purpose: a line's boardings at its stops: the planner's own number for a station or stop (shared among the
 * test's lines that call there), else the estimate.
 * Inputs: the estimate, the planner's numbers, how many of the test's lines call at each stop name.
 */
export function lineBoardings(
  stops: readonly string[],
  estimate: Boardings,
  own: Boardings | undefined,
  linesAt: (name: string) => number,
): Boardings {
  const out: Boardings = {};
  const ownByName = new Map(Object.entries(own ?? {}).map(([k, v]) => [norm(k), v]));
  for (const s of stops) {
    const mine = ownByName.get(norm(s));
    if (mine !== undefined && Number.isFinite(mine)) out[s] = Math.max(0, mine) / Math.max(1, linesAt(s));
    else if (estimate[s] !== undefined) out[s] = estimate[s]!;
  }
  return out;
}
