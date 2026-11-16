import { Injectable } from "@nestjs/common";
import { AnalysisService, type DemandPoint, headwayIn, median, type Period } from "./analysis.service";
import DEFAULTS from "./defaults.json";
import { DESTINATION_CATEGORIES, DESTINATION_LIST_VERSION, type DestinationPoint } from "./destinations";
import { solveMaxCover } from "./mclp";
import { NetworkError, NetworkService } from "./network.service";
import { type Mode, type ScenarioDoc } from "./scenario";
import { journeyPlanner } from "./wasm";

/**
 * Accessibility analyses for agents (ADR-0035 §6): TfL PTAL, the 15-minute city (destinations by category within
 * X minutes on foot, by bicycle, or on foot and public transport) and the exact stop-placement optimiser. Like
 * the walk coverage, every result names its method, parameters and sources.
 */

/** TfL PTAL mode groups, with the walk limit and reliability allowance of the TfL 2015 method. */
const PTAL_MODES: Record<Mode, { group: string; max_walk_m: number; reliability_min: number }> = {
  bus: { group: "bus", max_walk_m: 640, reliability_min: 2 },
  brt: { group: "bus", max_walk_m: 640, reliability_min: 2 },
  trolleybus: { group: "bus", max_walk_m: 640, reliability_min: 2 },
  intercity_bus: { group: "bus", max_walk_m: 640, reliability_min: 2 },
  tram: { group: "tram", max_walk_m: 640, reliability_min: 0.75 },
  light_rail: { group: "light_rail", max_walk_m: 960, reliability_min: 0.75 },
  metro: { group: "underground", max_walk_m: 960, reliability_min: 0.75 },
  commuter_rail: { group: "rail", max_walk_m: 960, reliability_min: 0.75 },
  regional_rail: { group: "rail", max_walk_m: 960, reliability_min: 0.75 },
  long_distance_rail: { group: "rail", max_walk_m: 960, reliability_min: 0.75 },
  high_speed_rail: { group: "rail", max_walk_m: 960, reliability_min: 0.75 },
};
const PTAL_WALK_M_PER_MIN = 80;
export const PTAL_SOURCE =
  "Transport for London, Assessing transport connectivity in London (PTAL methodology), 2015";

export type AccessMode = "walk" | "cycle" | "walk_transit";

export interface DestinationInput {
  category: string;
  lon: number;
  lat: number;
  name?: string;
}

interface PtalRaw {
  demand_kind: "points" | "street_cells";
  total: number;
  mean_ai: number;
  bands: { band: string; ai_from: number; ai_to: number | null; demand: number }[];
  points: { lon: number; lat: number; weight: number; ai: number; band: string }[];
  stops_off_network: string[];
  demand_off_network: number;
}

interface ReachRaw {
  demand_kind: "points" | "street_cells";
  origins: { lon: number; lat: number; weight: number; counts: number[]; nearest_s: (number | null)[] }[];
  origins_off_network: number;
  destinations_off_network: number[];
}

interface MatrixRaw {
  from: number[];
  to: number[];
  cost: number[];
}

const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const pct = (v: number) => round(v * 100, 1);
/** Most origins evaluated by walk + public transport (each needs a planner run per departure). */
export const MAX_TRANSIT_ORIGINS = 400;
/** Most destinations one run uses (evenly thinned beyond). */
export const MAX_DESTINATIONS = 5000;

@Injectable()
export class AccessService {
  constructor(
    private readonly network: NetworkService,
    private readonly analysis: AnalysisService,
  ) {}

  /**
   * Purpose: TfL PTAL on the scenario: access index and band 0 to 6b per point, demand by band, the mean index.
   * Walk distances follow the street network at TfL's 80 m/min; frequencies are the lines' headways in the period.
   */
  async ptal(doc: ScenarioDoc, o: { period?: Period; demand?: DemandPoint[]; listPoints?: number }) {
    if (doc.stops.length === 0) throw new NetworkError("The scenario has no stops yet.");
    const period = o.period ?? "peak";
    const index = new Map(doc.stops.map((s, i) => [s.id, i]));
    const routes = doc.lines.flatMap((l) => {
      const h = headwayIn(l, period);
      if (!h) return [];
      const m = PTAL_MODES[l.mode];
      return [
        {
          id: l.id,
          mode: m.group,
          stops: l.stop_ids.map((id) => index.get(id)!).filter((i) => i !== undefined),
          frequency_per_hour: 60 / h,
          max_walk_m: m.max_walk_m,
          reliability_min: m.reliability_min,
        },
      ];
    });
    if (routes.length === 0)
      throw new NetworkError(`No line has a ${period.replace("_", "-")} headway; PTAL needs service.`);
    const area = this.analysis.studyArea(doc, 960);
    const w = await this.network.walkGraph(area);
    const raw = JSON.parse(
      w.ptal(
        JSON.stringify({
          stops: doc.stops.map((s) => ({ id: s.id, lon: s.lon, lat: s.lat })),
          routes,
          demand: o.demand?.map((d) => ({ lon: d.lon, lat: d.lat, weight: d.weight ?? 1 })) ?? null,
          cell_m: 100,
          study_area: area,
          walk_m_per_min: PTAL_WALK_M_PER_MIN,
          list_points: o.listPoints ?? 0,
        }),
      ),
    ) as PtalRaw;
    const share = (v: number) => (raw.total > 0 ? pct(v / raw.total) : 0);
    const atLeast = (band: string) => {
      const i = raw.bands.findIndex((b) => b.band === band);
      return share(raw.bands.slice(i).reduce((a, b) => a + b.demand, 0));
    };
    const when = period === "peak" ? "peak headways" : "off-peak headways";
    const basis =
      `TfL PTAL: walk along the street network at ${PTAL_WALK_M_PER_MIN} m/min to each line's nearest stop ` +
      "(at most 640 m to bus and tram, 960 m to rail, metro and light rail), plus half the headway and a " +
      "reliability allowance (2 min bus, 0.75 min rail and tram); equivalent doorstep frequency 30 / access time, " +
      `the best line of each mode in full and the others at half weight; ${when}`;
    return {
      preset: "ptal",
      headline: `Mean access index ${round(raw.mean_ai, 1)} (PTAL ${bandOf(raw.mean_ai)}); ${atLeast("4")} % at PTAL 4 or better: ${basis}`,
      mean_access_index: round(raw.mean_ai, 2),
      mean_band: bandOf(raw.mean_ai),
      share_with_any_access_pct: atLeast("1a"),
      share_ptal_4_or_better_pct: atLeast("4"),
      bands: raw.bands.map((b) => ({
        band: b.band,
        access_index: b.ai_to === null ? `> ${b.ai_from}` : b.band === "0" ? "0" : `${b.ai_from}–${b.ai_to}`,
        share_pct: share(b.demand),
      })),
      basis,
      method_source: PTAL_SOURCE,
      parameters_fixed_by:
        "the TfL method (not the project's walk speed), so results compare with published PTAL maps",
      demand:
        raw.demand_kind === "points"
          ? "the demand points given (weights summed)"
          : "street points on a 100 m grid weighted by walkable street length, a stand-in until the population layer is used",
      demand_total: round(raw.total, 0),
      study_area: area.map((v) => round(v, 5)),
      stops_off_network: raw.stops_off_network,
      demand_off_network: raw.demand_off_network,
      ...(o.listPoints
        ? {
            points: {
              type: "FeatureCollection",
              features: raw.points.map((p) => ({
                type: "Feature",
                geometry: { type: "Point", coordinates: [round(p.lon, 6), round(p.lat, 6)] },
                properties: { access_index: p.ai, ptal: p.band, weight: round(p.weight, 0) },
              })),
            },
          }
        : {}),
    };
  }

  /**
   * Purpose: the 15-minute city: how many daily-needs destinations of each category lie within the limit of each
   * origin on foot, by bicycle, or on foot and public transport (median over departures in a window).
   * Output: per category the share of demand that reaches at least one, the share that reaches every category,
   * median counts, and the origins missing the most.
   */
  async destinations(
    doc: ScenarioDoc,
    o: {
      mode: AccessMode;
      minutes?: number;
      categories?: string[];
      destinations?: DestinationInput[];
      demand?: DemandPoint[];
      window?: [number, number];
      stepMin?: number;
      listGaps?: number;
    },
  ) {
    const minutes = o.minutes ?? DEFAULTS.walk_rule_minutes;
    const cats = DESTINATION_CATEGORIES.filter((c) => !o.categories || o.categories.includes(c.id));
    if (o.categories?.length) {
      const unknown = o.categories.filter((c) => !DESTINATION_CATEGORIES.some((d) => d.id === c));
      if (unknown.length && !o.destinations)
        throw new NetworkError(
          `unknown categories ${unknown.join(", ")}; use ${DESTINATION_CATEGORIES.map((c) => c.id).join(", ")} or give destinations`,
        );
    }
    const catIds = o.destinations
      ? [...new Set(o.destinations.map((d) => d.category))].filter(
          (c) => !o.categories || o.categories.includes(c),
        )
      : cats.map((c) => c.id);
    if (catIds.length === 0) throw new NetworkError("No destination category to count.");
    const speed = o.mode === "cycle" ? DEFAULTS.cycle_speed_kmh : DEFAULTS.walk_speed_kmh;
    if (doc.stops.length === 0 && !doc.study_area)
      throw new NetworkError("Set a study area (set_study_area) or add stops first.");
    const area = this.analysis.studyArea(doc, (minutes / 60) * speed * 1000);

    let points: DestinationPoint[];
    let source: string;
    if (o.destinations) {
      points = o.destinations.map((d, i) => ({
        id: `given-${i}`,
        categories: [d.category],
        lonlat: [d.lon, d.lat],
        ...(d.name ? { name: d.name } : {}),
      }));
      source = "the destinations given";
    } else {
      points = await this.network.destinations(area);
      source = `OpenStreetMap (© OpenStreetMap contributors, ODbL), destination list ${DESTINATION_LIST_VERSION}`;
    }
    const flat = thin(
      points.flatMap((p) =>
        p.categories
          .filter((c) => catIds.includes(c))
          .map((c) => ({ category: catIds.indexOf(c), lon: p.lonlat[0], lat: p.lonlat[1] })),
      ),
      MAX_DESTINATIONS,
    );
    const found = catIds.map((_, i) => flat.filter((d) => d.category === i).length);
    const settings = {
      walk_speed_kmh: speed,
      crossing_delay_s: DEFAULTS.crossing_delay_s,
      step_free: false,
      max_snap_m: 250,
    };
    const g = await this.network.walkGraph(area, o.mode === "cycle" ? "cycle" : "walk");
    const demandIn = o.demand?.map((d) => ({ lon: d.lon, lat: d.lat, weight: d.weight ?? 1 })) ?? null;
    const raw = JSON.parse(
      g.reach_counts(
        JSON.stringify({
          destinations: flat,
          categories: catIds.length,
          origins: demandIn,
          cell_m: 200,
          study_area: area,
          limit_s: minutes * 60,
          settings,
        }),
      ),
    ) as ReachRaw;
    let origins = raw.origins.map((r) => ({ ...r, counts: r.counts as number[] }));
    let transitNote: string | null = null;
    if (o.mode === "walk_transit") {
      const r = this.withTransit(
        doc,
        g,
        flat,
        origins,
        minutes,
        settings,
        o.window ?? [7 * 3600, 9 * 3600],
        o.stepMin ?? 10,
      );
      origins = r.origins;
      transitNote = r.note;
    }
    const total = origins.reduce((a, r) => a + r.weight, 0);
    const share = (pred: (r: (typeof origins)[number]) => boolean) =>
      total > 0 ? pct(origins.filter(pred).reduce((a, r) => a + r.weight, 0) / total) : 0;
    const how =
      o.mode === "walk"
        ? `on foot at ${speed} km/h along the street network, ${DEFAULTS.crossing_delay_s} s per signalised crossing`
        : o.mode === "cycle"
          ? `by bicycle at ${speed} km/h on streets, cycleways and paths open to bicycles, ${DEFAULTS.crossing_delay_s} s per signalised crossing`
          : `on foot (${DEFAULTS.walk_speed_kmh} km/h on the street network) and on the scenario's lines, median over departures every ${o.stepMin ?? 10} min from ${clock((o.window ?? [7 * 3600])[0])} to ${clock((o.window ?? [0, 9 * 3600])[1])}`;
    const basis = `destinations reachable within ${minutes} min ${how}`;
    const complete = share((r) => r.counts.every((c) => c > 0));
    const label = (id: string) => DESTINATION_CATEGORIES.find((c) => c.id === id)?.label ?? id;
    return {
      preset: "fifteen_minute_city",
      headline: `${complete} % reach every category (${catIds.map(label).join(", ")}): ${basis}`,
      mode: o.mode,
      minutes,
      share_reaching_all_pct: complete,
      categories: catIds.map((id, i) => ({
        id,
        label: label(id),
        destinations_found: found[i],
        share_reaching_one_pct: share((r) => (r.counts[i] ?? 0) > 0),
        median_count: median(origins.map((r) => r.counts[i] ?? 0)),
        ...(o.destinations ? {} : { osm_tags: DESTINATION_CATEGORIES.find((c) => c.id === id)?.osm }),
      })),
      basis,
      method_source:
        "Cumulative-opportunity accessibility (Geurs & van Wee 2004) for the 15-minute city of Moreno et al. 2021",
      destinations_source: source,
      demand:
        raw.demand_kind === "points"
          ? "the demand points given (weights summed)"
          : "street points on a 200 m grid weighted by walkable street length, a stand-in until the population layer is used",
      demand_total: round(total, 0),
      origins_off_network: raw.origins_off_network,
      destinations_off_network: Object.fromEntries(
        catIds.map((id, i) => [id, raw.destinations_off_network[i] ?? 0]),
      ),
      assumption_keys: [
        "analysis.walk_rule_minutes",
        o.mode === "cycle" ? "analysis.cycle_speed_kmh" : "demand.walk_speed_kmh",
        "walk.crossing_delay_s",
      ],
      notes: [
        ...(transitNote ? [transitNote] : []),
        ...(flat.length === MAX_DESTINATIONS ? [`destinations thinned to ${MAX_DESTINATIONS}`] : []),
      ],
      gaps: {
        type: "FeatureCollection",
        features: origins
          .filter((r) => r.counts.some((c) => c === 0))
          .sort((a, b) => b.weight - a.weight)
          .slice(0, o.listGaps ?? 25)
          .map((r) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: [round(r.lon, 6), round(r.lat, 6)] },
            properties: {
              weight: round(r.weight, 0),
              missing: catIds.filter((_, i) => r.counts[i] === 0),
            },
          })),
      },
    };
  }

  /**
   * Purpose: counts by walk + public transport. For each origin and departure, a destination counts when it is
   * within the limit on foot from the origin, or within the time left on foot from a stop the journey planner
   * reaches (RAPTOR one-to-many). The count per category is the median over the departures.
   */
  private withTransit(
    doc: ScenarioDoc,
    g: { matrix(json: string): string },
    dests: { category: number; lon: number; lat: number }[],
    walkOrigins: ReachRaw["origins"],
    minutes: number,
    settings: object,
    window: [number, number],
    stepMin: number,
  ) {
    const limit = minutes * 60;
    const origins = thin(walkOrigins, MAX_TRANSIT_ORIGINS);
    const k = Math.max(0, ...dests.map((d) => d.category)) + 1;
    const pairs = (sources: { lon: number; lat: number }[]) => {
      const m = JSON.parse(
        g.matrix(
          JSON.stringify({
            sources: sources.map((s) => ({ lon: s.lon, lat: s.lat })),
            targets: dests.map((d) => ({ lon: d.lon, lat: d.lat })),
            metric: "time",
            limit,
            settings,
          }),
        ),
      ) as MatrixRaw;
      const out: [number, number][][] = sources.map(() => []);
      m.from.forEach((s, i) => out[s]!.push([m.to[i]!, m.cost[i]!]));
      return out;
    };
    const fromOrigin = pairs(origins);
    const fromStop = pairs(doc.stops);
    const mod = journeyPlanner();
    const p = new mod.JourneyPlanner(JSON.stringify(this.analysis.timetable(doc)), "{}");
    const stopIndex = new Map(doc.stops.map((s, i) => [s.id, i]));
    const departures: number[] = [];
    for (let t = window[0]; t <= window[1]; t += stepMin * 60) departures.push(t);
    try {
      const out = origins.map((o, oi) => {
        const perDep: number[][] = departures.map((t0) => {
          const reached = new Set<number>(fromOrigin[oi]!.map(([d]) => d));
          const r = JSON.parse(p.reach(o.lon, o.lat, t0)) as {
            stop_ids: string[];
            arrive_s: (number | null)[];
          };
          r.stop_ids.forEach((id, i) => {
            const a = r.arrive_s[i];
            const si = stopIndex.get(id);
            if (a == null || si === undefined) return;
            const left = limit - (a - t0);
            if (left <= 0) return;
            for (const [d, c] of fromStop[si]!) if (c <= left) reached.add(d);
          });
          const counts = new Array<number>(k).fill(0);
          for (const d of reached) counts[dests[d]!.category]!++;
          return counts;
        });
        return {
          ...o,
          counts: Array.from({ length: k }, (_, c) => median(perDep.map((x) => x[c]!))),
        };
      });
      return {
        origins: out,
        note:
          `walk + public transport evaluated for ${origins.length} origins` +
          (walkOrigins.length > origins.length ? ` (thinned from ${walkOrigins.length})` : "") +
          "; walks from the origin to the first stop use the journey planner's straight line × journey.walk_detour_factor, walks from the last stop follow the street network",
      };
    } finally {
      p.free();
    }
  }

  /**
   * Purpose: the exact Maximal Covering Location Problem for `suggest_stop_locations`: the greedy run gives the
   * covering problem and a starting solution, HiGHS solves the MIP under a time limit. The better of the two is
   * returned, with whether it is proved optimal.
   */
  async suggestStopsExact(
    doc: ScenarioDoc,
    k: number,
    o: { lineId?: string; minutes?: number; demand?: DemandPoint[]; timeLimitS?: number },
  ) {
    const greedy = await this.analysis.suggestStops(doc, k, { ...o, returnInstance: true });
    const { instance: inst, suggestions_raw: greedyPicks, context, ...report } = greedy;
    void context;
    const limitS = o.timeLimitS ?? 10;
    if (!inst || inst.candidates.length === 0)
      return { ...report, solver: "nothing left to cover; no MIP needed", optimal: true };
    const sol = await solveMaxCover(inst, k, limitS);
    const greedyGain = greedyPicks.reduce((a, s) => a + s.gain, 0);
    if (!sol || sol.objective <= greedyGain + 1e-6) {
      return {
        ...report,
        method: `${report.method}; checked with an exact MIP (HiGHS)`,
        solver: !sol
          ? "HiGHS gave no solution; the greedy choice is kept"
          : sol.optimal
            ? "exact: HiGHS proved the greedy choice optimal"
            : `HiGHS found nothing better within ${limitS} s but did not prove optimality; the greedy choice is kept`,
        optimal: sol?.optimal ?? false,
      };
    }
    const exact = this.analysis.applyChoice(
      greedy,
      sol.chosen.map((i) => inst.candidates[i]!),
    );
    return {
      ...exact,
      solver: sol.optimal
        ? "exact: HiGHS proved this choice optimal"
        : `HiGHS best found within ${limitS} s (better than greedy, optimality not proved)`,
      optimal: sol.optimal,
      greedy_covered_after_pct: report.covered_after_pct,
    };
  }
}

function bandOf(ai: number): string {
  if (ai <= 0) return "0";
  const bands: [number, string][] = [
    [2.5, "1a"],
    [5, "1b"],
    [10, "2"],
    [15, "3"],
    [20, "4"],
    [25, "5"],
    [40, "6a"],
  ];
  return bands.find(([to]) => ai <= to)?.[1] ?? "6b";
}

function clock(s: number): string {
  return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
}

/** Purpose: keep at most `n` items, evenly spread. */
function thin<T>(v: T[], n: number): T[] {
  if (v.length <= n) return v;
  return Array.from({ length: n }, (_, i) => v[Math.floor((i * v.length) / n)]!);
}
