import { Injectable } from "@nestjs/common";
import DEFAULTS from "./defaults.json";
import { NetworkError, NetworkService } from "./network.service";
import {
  clockS,
  HIGH_CAPACITY,
  type Line,
  type LonLat,
  modeDefaults,
  type ScenarioDoc,
  serviceSchema,
  stopsBbox,
} from "./scenario";
import { journeyPlanner, streetRouting, type WalkAnalysisWasm } from "./wasm";

/**
 * Deterministic analyses on agent scenarios (ADR-0035 §5–§7): stop spacing, walk coverage with the
 * 15-minute walk rule as the headline, SDG 11.2.1, catchments, coverage gaps, suggested stops, journeys and
 * a benchmark table. Every number comes with the rule, parameters and assumption keys it rests on. The same
 * services will back the map layers and reports; agent tools are thin wrappers over them.
 */

export type Period = "peak" | "off_peak";
export const PRESETS = ["walk_minutes", "sdg_11_2_1", "catchment_by_mode", "frequent_only"] as const;
export type Preset = (typeof PRESETS)[number];

export interface DemandPoint {
  lon: number;
  lat: number;
  weight?: number;
}

export interface CoverageOptions {
  preset: Preset;
  /** `walk_minutes` and `frequent_only`: the walk limit; default `analysis.walk_rule_minutes`. */
  minutes?: number;
  /** Count stops with service in this period; default peak. */
  period?: Period;
  /** `frequent_only`: longest headway; default `analysis.frequent_headway_min`. */
  maxHeadwayMin?: number;
  stepFree?: boolean;
  demand?: DemandPoint[];
  walkSpeedKmh?: number;
}

interface WalkSettings {
  walk_speed_kmh: number;
  crossing_delay_s: number;
  step_free: boolean;
  max_snap_m: number;
}

interface Group {
  label: string;
  stops: number[];
  metric: "time" | "distance";
  limit: number;
}

/** Raw result of the Rust coverage (crates/street-routing `walk::CoverageResult`). */
export interface CoverageResult {
  demand_kind: "points" | "street_length_m" | "street_cells";
  total: number;
  covered: number;
  share: number;
  buffer_share: number;
  groups: { label: string; covered: number; share: number }[];
  minutes_bands: { from_min: number; to_min: number | null; demand: number }[];
  study_area: [number, number, number, number];
  stops_off_network: string[];
  demand_off_network: number;
  uncovered: { lon: number; lat: number; weight: number; nearest: number | null }[];
}

/** Purpose: whether a line runs in a period, and its headway there (minutes). */
export function headwayIn(l: Line, period: Period): number | null {
  return period === "peak" ? (l.headway_min.peak ?? null) : (l.headway_min.off_peak ?? null);
}

const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const pct = (v: number) => round(v * 100, 1);

@Injectable()
export class AnalysisService {
  constructor(private readonly network: NetworkService) {}

  /** Purpose: the area an analysis covers: the scenario's study area, else the stops plus a margin. */
  studyArea(doc: ScenarioDoc, marginM: number): [number, number, number, number] {
    return doc.study_area ?? stopsBbox(doc.stops, marginM);
  }

  private settings(o: { stepFree?: boolean; walkSpeedKmh?: number }): WalkSettings {
    return {
      walk_speed_kmh: o.walkSpeedKmh ?? DEFAULTS.walk_speed_kmh,
      crossing_delay_s: DEFAULTS.crossing_delay_s,
      step_free: o.stepFree ?? false,
      max_snap_m: 250,
    };
  }

  /** Purpose: the coverage groups of a preset, and a sentence saying exactly what is measured. */
  groups(doc: ScenarioDoc, o: CoverageOptions): { groups: Group[]; basis: string; keys: string[] } {
    const period = o.period ?? "peak";
    const minutes = o.minutes ?? DEFAULTS.walk_rule_minutes;
    const served = (pred: (l: Line) => boolean) => {
      const ids = new Set(
        doc.lines.filter((l) => headwayIn(l, period) !== null && pred(l)).flatMap((l) => l.stop_ids),
      );
      return doc.stops.flatMap((s, i) => (ids.has(s.id) ? [i] : []));
    };
    const speed = o.walkSpeedKmh ?? DEFAULTS.walk_speed_kmh;
    const walk = `walk at ${speed} km/h on the street network, ${DEFAULTS.crossing_delay_s} s per signalised crossing${o.stepFree ? ", step-free" : ""}`;
    const when = period === "peak" ? "stops with peak service" : "stops with off-peak service";
    switch (o.preset) {
      case "walk_minutes":
        return {
          groups: [
            {
              label: `${minutes}-minute walk`,
              stops: served(() => true),
              metric: "time",
              limit: minutes * 60,
            },
          ],
          basis: `${minutes}-minute walk to the nearest stop or station; ${walk}; all ${when}`,
          keys: ["analysis.walk_rule_minutes", "demand.walk_speed_kmh", "walk.crossing_delay_s"],
        };
      case "frequent_only": {
        const h = o.maxHeadwayMin ?? DEFAULTS.frequent_headway_min;
        return {
          groups: [
            {
              label: `${minutes}-minute walk, every ${h} min or better`,
              stops: served((l) => (headwayIn(l, period) ?? Infinity) <= h),
              metric: "time",
              limit: minutes * 60,
            },
          ],
          basis: `${minutes}-minute walk to a stop served at least every ${h} min (${period.replace("_", "-")}); ${walk}`,
          keys: ["analysis.walk_rule_minutes", "analysis.frequent_headway_min", "demand.walk_speed_kmh"],
        };
      }
      case "sdg_11_2_1":
        return {
          groups: [
            {
              label: "low capacity (bus, tram) within 500 m",
              stops: served((l) => !HIGH_CAPACITY.includes(l.mode)),
              metric: "distance",
              limit: 500,
            },
            {
              label: "high capacity (rail, metro) within 1000 m",
              stops: served((l) => HIGH_CAPACITY.includes(l.mode)),
              metric: "distance",
              limit: 1000,
            },
          ],
          basis:
            "UN SDG indicator 11.2.1: 500 m walking distance to a low-capacity stop or 1000 m to a high-capacity " +
            `stop, along the street network; fixed by the UN-Habitat definition; ${when}`,
          keys: [],
        };
      case "catchment_by_mode": {
        const modes = [...new Set(doc.lines.map((l) => l.mode))];
        return {
          groups: modes.map((m) => ({
            label: `${m} within ${modeDefaults(m).catchment_m} m`,
            stops: served((l) => l.mode === m),
            metric: "distance" as const,
            limit: modeDefaults(m).catchment_m,
          })),
          basis: `walking distance per mode from mode.catchment_m, along the street network; ${when}`,
          keys: ["mode.catchment_m"],
        };
      }
    }
  }

  /**
   * Purpose: run a coverage preset on a scenario.
   * Output: covered share with the crow-flies comparison, per group, by 5-minute band, the basis sentence,
   * and the demand used. Side effects: may fetch walk tiles.
   */
  async coverage(
    doc: ScenarioDoc,
    o: CoverageOptions,
    extra: { listUncovered?: number; cellsM?: number } = {},
  ) {
    if (doc.stops.length === 0) throw new NetworkError("The scenario has no stops yet.");
    const { groups, basis, keys } = this.groups(doc, o);
    const settings = this.settings(o);
    const reach = Math.max(
      ...groups.map((g) =>
        g.metric === "time" ? (g.limit / 3600) * settings.walk_speed_kmh * 1000 : g.limit,
      ),
    );
    const area = this.studyArea(doc, reach);
    const w = await this.network.walkGraph(area);
    const raw = JSON.parse(
      w.coverage(
        JSON.stringify({
          stops: doc.stops.map((s) => ({ id: s.id, lon: s.lon, lat: s.lat })),
          groups,
          demand: o.demand?.map((d) => ({ lon: d.lon, lat: d.lat, weight: d.weight ?? 1 })) ?? null,
          study_area: area,
          settings,
          list_uncovered: extra.listUncovered ?? 0,
          street_cells_m: o.demand ? null : (extra.cellsM ?? null),
        }),
      ),
    ) as CoverageResult;
    const demand =
      raw.demand_kind === "points"
        ? "the demand points given (weights summed)"
        : "walkable street length in the study area, a stand-in until the population layer exists";
    return {
      preset: o.preset,
      headline: `${pct(raw.share)} % covered: ${basis}`,
      covered_share_pct: pct(raw.share),
      crow_flies_share_pct: pct(raw.buffer_share),
      basis,
      demand,
      demand_total: round(raw.total, 0),
      demand_covered: round(raw.covered, 0),
      groups: raw.groups.map((g) => ({ label: g.label, share_pct: pct(g.share) })),
      minutes_bands: raw.minutes_bands.map((b) => ({
        minutes: b.to_min === null ? `${b.from_min}+` : `${b.from_min}–${b.to_min}`,
        share_pct: raw.total > 0 ? pct(b.demand / raw.total) : 0,
      })),
      study_area: raw.study_area.map((v) => round(v, 5)),
      study_area_source: doc.study_area ? "scenario study area" : `stops plus ${Math.round(reach)} m`,
      stops_off_network: raw.stops_off_network,
      demand_off_network: raw.demand_off_network,
      assumption_keys: keys,
      raw,
    };
  }

  /** Purpose: uncovered demand, largest first, as GeoJSON points (`find_coverage_gaps`). */
  async gaps(doc: ScenarioDoc, o: CoverageOptions, limit: number) {
    const r = await this.coverage(doc, o, { listUncovered: limit, cellsM: 200 });
    const walk = o.preset === "walk_minutes" || o.preset === "frequent_only";
    const { raw, ...rest } = r;
    return {
      ...rest,
      gaps: {
        type: "FeatureCollection",
        features: raw.uncovered.map((u) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [round(u.lon, 6), round(u.lat, 6)] },
          properties: {
            demand: round(u.weight, 0),
            demand_unit: raw.demand_kind === "points" ? "weight" : "street metres in a 200 m cell",
            nearest_stop:
              u.nearest === null
                ? "unreachable on foot"
                : walk
                  ? `${round(u.nearest / 60)} min`
                  : `${Math.round(u.nearest)} m`,
          },
        })),
      },
    };
  }

  /** Purpose: walk network coloured by minutes to the nearest stop, as GeoJSON (map layer and tool). */
  async catchment(doc: ScenarioDoc, minutes: number, o: { stepFree?: boolean; stopIds?: string[] } = {}) {
    const stops = doc.stops.filter((s) => !o.stopIds || o.stopIds.includes(s.id));
    if (stops.length === 0) throw new NetworkError("No stops to measure from.");
    const settings = this.settings(o);
    const area = this.studyArea(doc, (minutes / 60) * settings.walk_speed_kmh * 1000);
    const w = await this.network.walkGraph(area);
    const gj = JSON.parse(
      w.catchment(
        JSON.stringify(stops.map((s) => ({ id: s.id, lon: s.lon, lat: s.lat }))),
        minutes,
        JSON.stringify(settings),
      ),
    ) as { type: string; features: unknown[] };
    return gj;
  }

  /** Purpose: stop spacing per line direction along the route and on foot (ADR-0035 §5). */
  async spacing(doc: ScenarioDoc, lineId?: string, onFoot = true) {
    const lines = doc.lines.filter((l) => !lineId || l.id === lineId);
    if (lineId && lines.length === 0) throw new NetworkError(`no line ${lineId}`);
    const byId = new Map(doc.stops.map((s) => [s.id, s]));
    let w: WalkAnalysisWasm | null = null;
    let walkNote: string | null = null;
    if (onFoot && lines.length) {
      try {
        const stops = lines.flatMap((l) => l.stop_ids.map((id) => byId.get(id)!));
        w = await this.network.walkGraph(stopsBbox(stops, 300));
      } catch (e) {
        if (!(e instanceof NetworkError)) throw e;
        walkNote = `on-foot distances left out: ${e.message}`;
      }
    }
    const spacingOf = (req: object) => {
      if (w) return JSON.parse(w.spacing(JSON.stringify(req))) as SpacingResult;
      // Spacing does not need a walk graph; use a throw-away analysis object.
      const tmp = new (streetRouting().WalkAnalysis)();
      try {
        return JSON.parse(tmp.spacing(JSON.stringify(req))) as SpacingResult;
      } finally {
        tmp.free();
      }
    };
    const all: number[] = [];
    const out = lines.map((l) => {
      const r = doc.routed[l.id];
      const d = modeDefaults(l.mode);
      const dir = r?.directions[0];
      const res = spacingOf({
        stops: l.stop_ids.map((id) => {
          const s = byId.get(id)!;
          return { id: s.id, lon: s.lon, lat: s.lat };
        }),
        route: dir?.coords ?? null,
        guidance_m: [d.stop_spacing_m[0], d.stop_spacing_m[2]],
        settings: this.settings({}),
      });
      all.push(...res.segments.map((s) => s.along_m));
      return {
        line: l.id,
        mode: l.mode,
        measured_along: res.geometry === "route" ? "routed path" : "straight line between stops",
        guidance_m: { low: d.stop_spacing_m[0], central: d.stop_spacing_m[1], high: d.stop_spacing_m[2] },
        along_m: res.along,
        on_foot_m: res.walk.count ? res.walk : null,
        too_short: res.short,
        too_long: res.long,
        histogram: res.histogram,
        segments: res.segments,
      };
    });
    return {
      lines: out,
      note: walkNote,
      assumption_keys: ["mode.stop_spacing_m"],
      all_lines_median_m: median(all),
    };
  }

  /**
   * Purpose: greedy maximal-covering suggestion of new stops along the scenario's routes (ADR-0035 §6).
   * Candidates are placed every 100 m along each line's routed path, at least the mode's low spacing from
   * every other stop.
   */
  async suggestStops(
    doc: ScenarioDoc,
    k: number,
    o: { lineId?: string; minutes?: number; demand?: DemandPoint[] },
  ) {
    const minutes = o.minutes ?? DEFAULTS.walk_rule_minutes;
    const lines = doc.lines.filter((l) => !o.lineId || l.id === o.lineId);
    if (lines.length === 0)
      throw new NetworkError(o.lineId ? `no line ${o.lineId}` : "The scenario has no lines.");
    const candidates: { id: string; lon: number; lat: number }[] = [];
    for (const l of lines) {
      const coords = doc.routed[l.id]?.directions[0]?.coords ?? [];
      sample(coords, 100).forEach((p, i) =>
        candidates.push({ id: `${l.id}@${i * 100}m`, lon: p[0], lat: p[1] }),
      );
    }
    const minSpacing = Math.min(...lines.map((l) => modeDefaults(l.mode).stop_spacing_m[0] ?? 0));
    const settings = this.settings({});
    const area = this.studyArea(doc, (minutes / 60) * settings.walk_speed_kmh * 1000);
    const w = await this.network.walkGraph(area);
    const r = JSON.parse(
      w.suggest_stops(
        JSON.stringify({
          existing: doc.stops.map((s) => ({ id: s.id, lon: s.lon, lat: s.lat })),
          candidates: thin(candidates, 400),
          demand: o.demand?.map((d) => ({ lon: d.lon, lat: d.lat, weight: d.weight ?? 1 })) ?? null,
          street_cells_m: 150,
          study_area: area,
          limit_s: minutes * 60,
          k,
          min_spacing_m: minSpacing,
          settings,
        }),
      ),
    ) as {
      demand_kind: string;
      total: number;
      covered_before: number;
      covered_after: number;
      suggestions: { candidate: string; lon: number; lat: number; gain: number }[];
    };
    const share = (v: number) => (r.total > 0 ? pct(v / r.total) : 0);
    return {
      method:
        "Maximal Covering Location Problem (Church & ReVelle 1974), greedy: each step adds the candidate that brings " +
        "the most uncovered demand within the walk limit; at least 63 % of the optimum, exact for one stop",
      rule: `${minutes}-minute walk on the street network`,
      demand:
        r.demand_kind === "points"
          ? "the demand points given"
          : "walkable street length in 150 m cells (population stand-in)",
      min_spacing_m: minSpacing,
      covered_before_pct: share(r.covered_before),
      covered_after_pct: share(r.covered_after),
      suggestions: r.suggestions.map((s) => ({
        near: s.candidate,
        lon: round(s.lon, 6),
        lat: round(s.lat, 6),
        gain_pct: share(s.gain),
      })),
      how_to_apply:
        "Add a stop with add_stop and insert its id into the line's stop_ids with update_line, then run coverage_report again.",
    };
  }

  /** Purpose: the scenario's service as a published timetable with frequency patterns (ADR-0034). */
  timetable(doc: ScenarioDoc) {
    const pats: object[] = [];
    for (const l of doc.lines) {
      const r = doc.routed[l.id];
      if (!r) continue;
      const sv = l.service ?? serviceSchema.parse({});
      const d = modeDefaults(l.mode);
      r.directions.forEach((dir, di) => {
        if (dir.run_s.length !== dir.stop_ids.length) return;
        pats.push({
          pattern_id: `${l.id}:${di}`,
          route_id: l.id,
          direction_id: di,
          service_id: "weekday",
          stops: dir.stop_ids.map((s, i) => ({
            stop_id: s,
            run_time: Math.round((dir.run_s[i] ?? 0) * (1 + d.recovery_share)),
            dwell_time: i === 0 || i === dir.stop_ids.length - 1 ? 0 : d.dwell_s,
          })),
          periods: periods(sv, l),
        });
      });
    }
    return {
      stops: doc.stops.map((s) => ({ stop_id: s.id, stop_name: s.name, stop_lat: s.lat, stop_lon: s.lon })),
      routes: doc.lines.map((l) => ({
        route_id: l.id,
        route_short_name: l.name,
        mode: l.mode,
        route_color: (l.colour ?? modeDefaults(l.mode).colour).replace("#", ""),
      })),
      trips: [],
      transfers: [],
      frequency_patterns: pats,
    };
  }

  /**
   * Purpose: plan journeys A → B on the scenario with the journey planner (ADR-0034).
   * Output: the fastest journey and alternatives with fewer changes, summarised.
   */
  planJourney(doc: ScenarioDoc, from: LonLat, to: LonLat, timeS: number, mode: "depart_at" | "arrive_by") {
    const mod = journeyPlanner();
    const p = new mod.JourneyPlanner(JSON.stringify(this.timetable(doc)), "{}");
    try {
      const plan = JSON.parse(p.plan(JSON.stringify({ from, to, time_s: timeS, mode }))) as {
        journeys: Journey[];
      };
      return plan.journeys.map(summariseJourney);
    } finally {
      p.free();
    }
  }

  /** Purpose: operating figures of one line from its routing, headways and service day (TCQSM method). */
  lineFigures(doc: ScenarioDoc, l: Line) {
    const r = doc.routed[l.id];
    const d = modeDefaults(l.mode);
    const sv = l.service ?? serviceSchema.parse({});
    const dirs = r?.directions ?? [];
    const tripS = dirs.map(
      (dir) =>
        dir.run_s.reduce((a, b) => a + b, 0) * (1 + d.recovery_share) +
        Math.max(0, dir.stop_ids.length - 2) * d.dwell_s,
    );
    const cycleS = tripS.reduce((a, b) => a + b, 0) + dirs.length * d.layover_min * 60;
    const peakH = l.headway_min.peak;
    const peakVehicles = peakH ? Math.ceil(cycleS / (peakH * 60)) : 0;
    const departures = periods(sv, l).reduce(
      (a, p) => a + Math.max(0, Math.ceil((p.end_time - p.start_time) / p.headway_secs)),
      0,
    );
    const lengthM = dirs.reduce((a, dir) => a + dir.length_m, 0);
    return {
      line: l.id,
      mode: l.mode,
      length_km: round((dirs[0]?.length_m ?? 0) / 1000, 2),
      one_way_min: round((tripS[0] ?? 0) / 60, 1),
      commercial_speed_kmh: tripS[0] ? round((dirs[0]!.length_m / tripS[0]) * 3.6, 1) : null,
      cycle_min: round(cycleS / 60, 1),
      peak_vehicles: peakVehicles,
      fleet: Math.ceil(peakVehicles * (1 + d.spare_share)),
      departures_per_direction: departures,
      vehicle_km_per_day: round((departures * lengthM) / 1000, 0),
      vehicle_hours_per_day: round((departures * tripS.reduce((a, b) => a + b, 0)) / 3600, 1),
      mean_wait_peak_min: peakH ? round(peakH / 2, 1) : null,
    };
  }

  /**
   * Purpose: one benchmark row for a scenario: network size, operating figures, spacing and coverage KPIs
   * from the KPI catalogue. Journeys are added when origin–destination pairs are given.
   */
  async benchmark(
    doc: ScenarioDoc,
    o: { odPairs?: [LonLat, LonLat][]; departS?: number; demand?: DemandPoint[] },
  ) {
    const figures = doc.lines.map((l) => this.lineFigures(doc, l));
    const sum = (k: "peak_vehicles" | "fleet" | "vehicle_km_per_day" | "vehicle_hours_per_day") =>
      round(
        figures.reduce((a, f) => a + f[k], 0),
        1,
      );
    const kpi: Record<string, number | string | null> = {
      stops: doc.stops.length,
      lines: doc.lines.length,
      route_km: round(
        figures.reduce((a, f) => a + f.length_km, 0),
        1,
      ),
      peak_vehicles: sum("peak_vehicles"),
      fleet: sum("fleet"),
      vehicle_km_per_day: sum("vehicle_km_per_day"),
      vehicle_hours_per_day: sum("vehicle_hours_per_day"),
    };
    const notes: string[] = [];
    try {
      kpi.median_stop_spacing_m = (await this.spacing(doc, undefined, false)).all_lines_median_m;
      const walk = await this.coverage(doc, { preset: "walk_minutes", demand: o.demand });
      kpi.walk_15_min_coverage_pct = walk.covered_share_pct;
      kpi.sdg_11_2_1_pct = (
        await this.coverage(doc, { preset: "sdg_11_2_1", demand: o.demand })
      ).covered_share_pct;
      notes.push(`coverage: ${walk.basis}; demand: ${walk.demand}; area: ${walk.study_area_source}`);
    } catch (e) {
      if (!(e instanceof NetworkError)) throw e;
      notes.push(`coverage left out: ${e.message}`);
    }
    if (o.odPairs?.length) {
      const times = o.odPairs.map(
        ([a, b]) => this.planJourney(doc, a, b, o.departS ?? 8 * 3600, "depart_at")[0],
      );
      const ok = times.filter((j): j is JourneySummary => Boolean(j));
      kpi.median_journey_min = ok.length ? median(ok.map((j) => j.total_min)) : null;
      kpi.journeys_found = `${ok.length} of ${times.length}`;
    }
    return { kpi, lines: figures, notes };
  }
}

/** Purpose: service periods of a line for the journey planner (peak windows, off-peak in between). */
export function periods(sv: { first: string; last: string; peaks: [string, string][] }, l: Line) {
  const out: { start_time: number; end_time: number; headway_secs: number; kind: Period }[] = [];
  const first = clockS(sv.first);
  const last = clockS(sv.last);
  const peaks = [...sv.peaks].map(([a, b]) => [clockS(a), clockS(b)] as const).sort((a, b) => a[0] - b[0]);
  const push = (a: number, b: number, kind: Period) => {
    const h = headwayIn(l, kind);
    if (h && b > a) out.push({ start_time: a, end_time: b, headway_secs: Math.round(h * 60), kind });
  };
  let t = first;
  for (const [a, b] of peaks) {
    const from = Math.max(a, first);
    const to = Math.min(b, last);
    if (to <= from) continue;
    if (from > t) push(t, from, "off_peak");
    push(from, to, "peak");
    t = to;
  }
  if (last + 1 > t) push(t, last + 1, "off_peak");
  return out;
}

interface SpacingStats {
  count: number;
  mean: number;
  median: number;
  p10: number;
  p90: number;
  min: number;
  max: number;
}
interface SpacingResult {
  geometry: "route" | "straight";
  segments: {
    from: string;
    to: string;
    along_m: number;
    straight_m: number;
    walk_m: number | null;
    flag: string | null;
  }[];
  along: SpacingStats;
  walk: SpacingStats;
  histogram: { from_m: number; to_m: number; count: number }[];
  short: number;
  long: number;
}

interface Journey {
  depart_s: number;
  arrive_s: number;
  total_s: number;
  rides: number;
  transfers: number;
  walk_m: number;
  breakdown: Record<string, number>;
  legs: {
    type: string;
    route_short_name?: string;
    from?: { name: string };
    to?: { name: string };
    start_s: number;
    end_s: number;
  }[];
}
export interface JourneySummary {
  depart: string;
  arrive: string;
  total_min: number;
  transfers: number;
  walk_m: number;
  breakdown_min: Record<string, number>;
  rides: string[];
}

function clock(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function summariseJourney(j: Journey): JourneySummary {
  return {
    depart: clock(j.depart_s),
    arrive: clock(j.arrive_s),
    total_min: round(j.total_s / 60, 1),
    transfers: j.transfers,
    walk_m: Math.round(j.walk_m),
    breakdown_min: Object.fromEntries(
      Object.entries(j.breakdown).map(([k, v]) => [k.replace(/_s$/, ""), round(v / 60, 1)]),
    ),
    rides: j.legs
      .filter((l) => l.type === "ride")
      .map(
        (l) => `${l.route_short_name} ${l.from?.name} ${clock(l.start_s)} → ${l.to?.name} ${clock(l.end_s)}`,
      ),
  };
}

/** Purpose: median of a list (0 when empty). */
export function median(v: number[]): number {
  if (v.length === 0) return 0;
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Purpose: points every `stepM` metres along a polyline. */
export function sample(coords: LonLat[], stepM: number): LonLat[] {
  const out: LonLat[] = [];
  let carry = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1]!;
    const b = coords[i]!;
    const k = Math.cos((a[1] * Math.PI) / 180) * 111_195;
    const len = Math.hypot((b[0] - a[0]) * k, (b[1] - a[1]) * 111_195);
    let t = carry;
    while (t <= len) {
      const f = len > 0 ? t / len : 0;
      out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
      t += stepM;
    }
    carry = t - len;
  }
  return out;
}

/** Purpose: keep at most `n` items, evenly spread. */
function thin<T>(v: T[], n: number): T[] {
  if (v.length <= n) return v;
  return Array.from({ length: n }, (_, i) => v[Math.floor((i * v.length) / n)]!);
}
