import { z } from "zod";
import DEFAULTS from "./defaults.json";

/**
 * Agent scenario documents and the change commands that edit them (ADR-0035 §3).
 *
 * A scenario is a small, self-contained network sketch: stops, and lines that call at them with a headway per
 * service period. Street lines (bus, BRT, trolleybus, intercity bus) are routed on real streets by the same
 * router as the street line tool (ADR-0029); rail and tram lines run along a geometry the agent gives, or the
 * straight line between stations until the railway editor's alignments can be referenced. Until the projects
 * module and the scenario overlays of ADR-0013 exist, scenarios live in the user's own workspace.
 */

export const MODES = [
  "bus",
  "brt",
  "trolleybus",
  "intercity_bus",
  "tram",
  "light_rail",
  "metro",
  "commuter_rail",
  "regional_rail",
  "long_distance_rail",
  "high_speed_rail",
] as const;
export type Mode = (typeof MODES)[number];

/** Modes routed on streets by the street router. */
export const STREET_MODES: readonly Mode[] = ["bus", "brt", "trolleybus", "intercity_bus"];

/** SDG 11.2.1 high-capacity modes (1000 m); the rest are low capacity (500 m). */
export const HIGH_CAPACITY: readonly Mode[] = [
  "light_rail",
  "metro",
  "commuter_rail",
  "regional_rail",
  "long_distance_rail",
  "high_speed_rail",
];

export type LonLat = [number, number];
export type ModeDefaults = (typeof DEFAULTS.modes)["bus"];

/** Purpose: central defaults of one mode from the assumption library export. */
export function modeDefaults(mode: Mode): ModeDefaults {
  return DEFAULTS.modes[mode];
}

const id = z.string().regex(/^[A-Za-z0-9_.:-]{1,64}$/, "ids are 1–64 letters, digits, '_', '.', ':' or '-'");
const lon = z.number().min(-180).max(180);
const lat = z.number().min(-85).max(85);
export const lonLat = z.tuple([lon, lat]);
const name = z.string().trim().min(1).max(120);
const clock = z
  .string()
  .regex(/^([01]?\d|2[0-9]):[0-5]\d$/, "time as HH:MM, up to 29:59 for after midnight")
  .describe("HH:MM; times after midnight continue past 24:00, e.g. 24:30");
const headway = z.number().min(1).max(240).nullable();

export const stopSchema = z.object({
  id,
  name,
  lon,
  lat,
});
export type Stop = z.infer<typeof stopSchema>;

export const serviceSchema = z.object({
  first: clock.default("05:00"),
  last: clock.default("24:30"),
  peaks: z
    .array(z.tuple([clock, clock]))
    .max(4)
    .default([
      ["07:00", "09:00"],
      ["16:00", "19:00"],
    ]),
});
export type Service = z.infer<typeof serviceSchema>;

export const lineSchema = z.object({
  id,
  name,
  mode: z.enum(MODES),
  stop_ids: z.array(id).min(2).max(200),
  headway_min: z.object({
    peak: headway.describe("minutes between departures in the peaks; null for no peak service"),
    off_peak: headway.describe("minutes between departures outside the peaks; null for none"),
  }),
  service: serviceSchema.optional(),
  route: z
    .array(lonLat)
    .min(2)
    .max(5000)
    .optional()
    .describe(
      "rail and tram: track geometry [lon, lat] from the first to the last stop; else straight lines",
    ),
  colour: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
});
export type Line = z.infer<typeof lineSchema>;

/** One routed direction of a line. */
export interface RoutedDirection {
  stop_ids: string[];
  coords: LonLat[];
  length_m: number;
  /** Running time from the previous stop's departure, per stop (0 at the first). */
  run_s: number[];
}

/** Routing of one line, recomputed when its stops or mode change. */
export interface RoutedLine {
  /** Hash of the inputs, so unchanged lines are not routed again. */
  input: string;
  source: "street-router" | "given-route" | "straight";
  directions: RoutedDirection[];
  issues: string[];
}

export interface ScenarioDoc {
  stops: Stop[];
  lines: Line[];
  study_area?: [number, number, number, number];
  routed: Record<string, RoutedLine>;
}

export const EMPTY_DOC: ScenarioDoc = { stops: [], lines: [], routed: {} };

export const changeSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add_stop"), stop: stopSchema }),
  z.object({ op: z.literal("move_stop"), stop_id: id, lon, lat }),
  z.object({ op: z.literal("rename_stop"), stop_id: id, name }),
  z.object({
    op: z.literal("remove_stop"),
    stop_id: id,
    from_lines: z.boolean().default(false).describe("also remove it from every line that calls there"),
  }),
  z.object({ op: z.literal("add_line"), line: lineSchema }),
  z.object({
    op: z.literal("update_line"),
    line_id: id,
    name: name.optional(),
    mode: z.enum(MODES).optional(),
    stop_ids: z.array(id).min(2).max(200).optional(),
    headway_min: z.object({ peak: headway, off_peak: headway }).partial().optional(),
    service: serviceSchema.optional(),
    route: z.array(lonLat).min(2).max(5000).nullable().optional(),
    colour: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .optional(),
  }),
  z.object({ op: z.literal("remove_line"), line_id: id }),
  z.object({
    op: z.literal("set_study_area"),
    bbox: z
      .tuple([lon, lat, lon, lat])
      .nullable()
      .describe("[west, south, east, north]; null to use the area around the stops"),
  }),
]);
export type Change = z.infer<typeof changeSchema>;

/** A change that could not be applied. The whole batch is refused. */
export class ChangeError extends Error {
  constructor(
    readonly index: number,
    message: string,
  ) {
    super(`change ${index}: ${message}`);
  }
}

/** Largest scenario agents may build (keeps routing and analysis within one request). */
export const LIMITS = { stops: 2000, lines: 100 };

/**
 * Purpose: apply a batch of changes to a copy of a document. All or nothing.
 * Inputs: the document, the changes. Output: the new document (routing of changed lines is left stale).
 * Throws ChangeError naming the first change that cannot be applied.
 */
export function applyChanges(doc: ScenarioDoc, changes: Change[]): ScenarioDoc {
  const d: ScenarioDoc = structuredClone(doc);
  const stop = (i: number, sid: string) => {
    const s = d.stops.find((x) => x.id === sid);
    if (!s) throw new ChangeError(i, `no stop ${sid}`);
    return s;
  };
  const line = (i: number, lid: string) => {
    const l = d.lines.find((x) => x.id === lid);
    if (!l) throw new ChangeError(i, `no line ${lid}`);
    return l;
  };
  const checkStops = (i: number, ids: string[]) => {
    for (const s of ids) stop(i, s);
    for (let k = 1; k < ids.length; k++)
      if (ids[k] === ids[k - 1]) throw new ChangeError(i, `stop ${ids[k]} is listed twice in a row`);
  };
  changes.forEach((c, i) => {
    switch (c.op) {
      case "add_stop":
        if (d.stops.some((s) => s.id === c.stop.id)) throw new ChangeError(i, `stop ${c.stop.id} exists`);
        d.stops.push({ ...c.stop });
        break;
      case "move_stop": {
        const s = stop(i, c.stop_id);
        s.lon = c.lon;
        s.lat = c.lat;
        break;
      }
      case "rename_stop":
        stop(i, c.stop_id).name = c.name;
        break;
      case "remove_stop": {
        stop(i, c.stop_id);
        const users = d.lines.filter((l) => l.stop_ids.includes(c.stop_id));
        if (users.length && !c.from_lines)
          throw new ChangeError(
            i,
            `stop ${c.stop_id} is served by ${users.map((l) => l.id).join(", ")}; set from_lines to remove it there too`,
          );
        for (const l of users) {
          l.stop_ids = l.stop_ids.filter((s) => s !== c.stop_id);
          if (l.stop_ids.length < 2) throw new ChangeError(i, `line ${l.id} would have fewer than two stops`);
        }
        d.stops = d.stops.filter((s) => s.id !== c.stop_id);
        break;
      }
      case "add_line":
        if (d.lines.some((l) => l.id === c.line.id)) throw new ChangeError(i, `line ${c.line.id} exists`);
        checkStops(i, c.line.stop_ids);
        d.lines.push(structuredClone(c.line));
        break;
      case "update_line": {
        const l = line(i, c.line_id);
        if (c.name !== undefined) l.name = c.name;
        if (c.mode !== undefined) l.mode = c.mode;
        if (c.stop_ids !== undefined) {
          checkStops(i, c.stop_ids);
          l.stop_ids = [...c.stop_ids];
        }
        if (c.headway_min) l.headway_min = { ...l.headway_min, ...c.headway_min };
        if (c.service !== undefined) l.service = c.service;
        if (c.route === null) delete l.route;
        else if (c.route !== undefined) l.route = c.route;
        if (c.colour !== undefined) l.colour = c.colour;
        break;
      }
      case "remove_line":
        line(i, c.line_id);
        d.lines = d.lines.filter((l) => l.id !== c.line_id);
        delete d.routed[c.line_id];
        break;
      case "set_study_area":
        if (c.bbox === null) delete d.study_area;
        else {
          const [w, s, e, n] = c.bbox;
          if (e <= w || n <= s)
            throw new ChangeError(i, "study area must have west < east and south < north");
          d.study_area = c.bbox;
        }
        break;
    }
  });
  if (d.stops.length > LIMITS.stops)
    throw new ChangeError(changes.length - 1, `more than ${LIMITS.stops} stops`);
  if (d.lines.length > LIMITS.lines)
    throw new ChangeError(changes.length - 1, `more than ${LIMITS.lines} lines`);
  return d;
}

/** One validation finding, as the editors show it. */
export interface Finding {
  severity: "error" | "warning" | "info";
  where: string;
  message: string;
}

/** Purpose: seconds after midnight for "HH:MM". */
export function clockS(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 3600 + (m ?? 0) * 60;
}

/** Purpose: straight-line distance in metres (equirectangular, fine within a city region). */
export function distanceM(a: LonLat, b: LonLat): number {
  const k = Math.PI / 180;
  const x = (b[0] - a[0]) * k * Math.cos(((a[1] + b[1]) / 2) * k);
  const y = (b[1] - a[1]) * k;
  return Math.hypot(x, y) * 6_371_008.8;
}

/**
 * Purpose: the checks a planner would see, without routing: unused stops, missing service, headways below
 * the mode's minimum following distance, stops far apart, plus the routing issues of each line.
 */
export function validate(doc: ScenarioDoc): Finding[] {
  const out: Finding[] = [];
  const used = new Set(doc.lines.flatMap((l) => l.stop_ids));
  for (const s of doc.stops)
    if (!used.has(s.id)) out.push({ severity: "info", where: `stop ${s.id}`, message: "no line calls here" });
  const byId = new Map(doc.stops.map((s) => [s.id, s]));
  for (const l of doc.lines) {
    const where = `line ${l.id}`;
    if (l.headway_min.peak === null && l.headway_min.off_peak === null)
      out.push({ severity: "warning", where, message: "no service: both headways are null" });
    const sv = l.service ?? serviceSchema.parse({});
    if (clockS(sv.last) <= clockS(sv.first))
      out.push({ severity: "error", where, message: "service ends before it starts" });
    const d = modeDefaults(l.mode);
    const spacing = d.stop_spacing_m;
    for (let i = 1; i < l.stop_ids.length; i++) {
      const a = byId.get(l.stop_ids[i - 1] ?? "");
      const b = byId.get(l.stop_ids[i] ?? "");
      if (!a || !b) continue;
      const m = distanceM([a.lon, a.lat], [b.lon, b.lat]);
      if (m < 50)
        out.push({
          severity: "warning",
          where,
          message: `${a.id} and ${b.id} are only ${Math.round(m)} m apart`,
        });
      else if (m > (spacing[2] ?? Infinity) * 5)
        out.push({
          severity: "warning",
          where,
          message: `${a.id} → ${b.id} is ${Math.round(m)} m, far beyond the ${l.mode} spacing guidance`,
        });
    }
    if (l.route && STREET_MODES.includes(l.mode))
      out.push({
        severity: "info",
        where,
        message: "route is ignored for street modes; the street router routes it",
      });
    const r = doc.routed[l.id];
    for (const issue of r?.issues ?? []) out.push({ severity: "warning", where, message: issue });
  }
  return out;
}

/** Purpose: bounding box `[w, s, e, n]` of the stops, grown by `marginM` metres. */
export function stopsBbox(
  stops: { lon: number; lat: number }[],
  marginM: number,
): [number, number, number, number] {
  if (stops.length === 0) return [0, 0, 0, 0];
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of stops) {
    w = Math.min(w, p.lon);
    e = Math.max(e, p.lon);
    s = Math.min(s, p.lat);
    n = Math.max(n, p.lat);
  }
  const dLat = marginM / 111_195;
  const dLon = marginM / (111_195 * Math.cos((((s + n) / 2) * Math.PI) / 180));
  return [w - dLon, s - dLat, e + dLon, n + dLat];
}

/**
 * Purpose: running time over a distance with the kinematic profile of the mode (accelerate to the line speed,
 * cruise, brake; a triangle when the distance is too short to reach it). Used for rail and tram lines until
 * the railway operations timetables (ADR-0032) publish exact trips.
 */
export function kinematicRunS(distance: number, mode: Mode): number {
  const d = modeDefaults(mode);
  const v = d.max_speed_kmh / 3.6;
  const a = d.acceleration_ms2;
  const b = d.service_braking_ms2;
  const dAcc = (v * v) / (2 * a) + (v * v) / (2 * b);
  if (distance >= dAcc) return v / a + v / b + (distance - dAcc) / v;
  // Peak speed of the triangle: d = vp²/2a + vp²/2b.
  const vp = Math.sqrt((2 * distance * a * b) / (a + b));
  return vp / a + vp / b;
}

/** Summary of a scenario for list and get tools. */
export function summarise(doc: ScenarioDoc) {
  return {
    stops: doc.stops.length,
    lines: doc.lines.map((l) => {
      const r = doc.routed[l.id];
      const out = r?.directions[0];
      return {
        id: l.id,
        name: l.name,
        mode: l.mode,
        stops: l.stop_ids.length,
        headway_min: l.headway_min,
        length_km: out ? Math.round(out.length_m / 100) / 10 : null,
        one_way_min: out
          ? Math.round(out.run_s.reduce((x, y) => x + y, 0) / 6 + dwellTotal(l) / 6) / 10
          : null,
        routing: r?.source ?? "not routed",
        issues: r?.issues.length ?? 0,
      };
    }),
    study_area: doc.study_area ?? null,
  };
}

function dwellTotal(l: Line): number {
  return Math.max(0, l.stop_ids.length - 2) * modeDefaults(l.mode).dwell_s;
}
