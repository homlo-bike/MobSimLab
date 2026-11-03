/**
 * Service lines of the railway design (ADR-0032 §2): pure edits of `doc.lines` and the conversion to
 * the engine's form. The engine plans them on the design (timetable planner) and publishes the trips
 * for the journey planner.
 */
import { TRAINS } from "./trains";
import type { CatalogueTrain, EngineServiceLine, Network, RailMode, ServiceLine } from "./types";

/** Line colours in the order new lines take them. */
export const LINE_COLORS = ["#1d4ed8", "#b91c1c", "#15803d", "#7e22ce", "#c2410c", "#0e7490", "#a16207"];

/** Name prefix of new lines per mode (M1, T1, S1, RE1…). */
const PREFIX: Record<RailMode, string> = {
  tram: "T",
  light_rail: "L",
  metro: "M",
  commuter_rail: "S",
  regional_rail: "RE",
  long_distance_rail: "IC",
  high_speed_rail: "HS",
};

/** Default headways per mode, minutes: [peak, off-peak]. Policy floors of `timetable.policy_headway_*`. */
const HEADWAYS: Record<RailMode, [number, number]> = {
  tram: [6, 10],
  light_rail: [7.5, 15],
  metro: [4, 8],
  commuter_rail: [10, 20],
  regional_rail: [30, 60],
  long_distance_rail: [60, 120],
  high_speed_rail: [60, 120],
};

/** Purpose: the catalogue trains of a mode (all rail trains when the mode has none). */
export function trainsFor(mode: RailMode, all: readonly CatalogueTrain[] = TRAINS): CatalogueTrain[] {
  const own = all.filter((t) => t.mode === mode);
  return own.length ? own : [...all];
}

/** Purpose: a catalogue train by id. */
export function trainById(id: string, all: readonly CatalogueTrain[] = TRAINS): CatalogueTrain | null {
  return all.find((t) => t.id === id) ?? null;
}

/**
 * Purpose: the catalogue train that suits the design best: the longest whose train fits the platforms
 * (`train_length_m`), else the shortest of the mode.
 */
export function suggestTrain(
  mode: RailMode,
  maxLengthM: number,
  all: readonly CatalogueTrain[] = TRAINS,
): CatalogueTrain | null {
  const list = trainsFor(mode, all);
  const fits = list.filter((t) => t.length_m <= maxLengthM).sort((a, b) => b.length_m - a.length_m);
  return fits[0] ?? [...list].sort((a, b) => a.length_m - b.length_m)[0] ?? null;
}

/** Purpose: the mode a line runs in: that of its first station, else the network's. */
export function lineMode(doc: Network, line: ServiceLine): RailMode {
  const first = doc.stations.find((s) => s.id === line.stations[0]);
  return first?.mode ?? doc.mode;
}

/**
 * Purpose: add a line. It starts with the first and last station of the drawing (by position along
 * the longest axis), the suggested train and the mode's headways, 05:00–24:00.
 * Output: the document and the new line's id.
 */
export function addLine(doc: Network, trainLengthM: number): [Network, string] {
  const lines = doc.lines ?? [];
  let n = lines.length + 1;
  const ids = new Set(lines.map((l) => l.id));
  while (ids.has(`line${n}`)) n++;
  const id = `line${n}`;
  const mode = doc.mode;
  const names = new Set(lines.map((l) => l.name));
  let k = 1;
  while (names.has(`${PREFIX[mode]}${k}`)) k++;
  const [peak, off] = HEADWAYS[mode];
  const st = endStations(doc);
  const train = suggestTrain(mode, trainLengthM);
  const line: ServiceLine = {
    id,
    name: `${PREFIX[mode]}${k}`,
    color: LINE_COLORS[lines.length % LINE_COLORS.length]!,
    stations: st,
    vehicle: train?.id ?? "",
    units: 1,
    first_min: 5 * 60,
    last_min: 24 * 60,
    peak_headway_min: peak,
    offpeak_headway_min: off,
  };
  return [{ ...doc, lines: [...lines, line] }, id];
}

/** Purpose: the two stations farthest apart (empty with fewer than two). */
function endStations(doc: Network): number[] {
  const s = doc.stations;
  let best: [number, number, number] | null = null;
  for (let i = 0; i < s.length; i++)
    for (let j = i + 1; j < s.length; j++) {
      const d = Math.hypot(s[i]!.x - s[j]!.x, s[i]!.y - s[j]!.y);
      if (!best || d > best[2]) best = [i, j, d];
    }
  if (!best) return s.slice(0, 1).map((x) => x.id);
  const [a, b] = [s[best[0]]!, s[best[1]]!];
  // West to east (or south to north) reads naturally.
  const flip = Math.abs(a.x - b.x) >= Math.abs(a.y - b.y) ? a.x > b.x : a.y > b.y;
  return flip ? [b.id, a.id] : [a.id, b.id];
}

/** Purpose: replace one line by id with an updated copy. */
export function updateLine(doc: Network, id: string, f: (l: ServiceLine) => ServiceLine): Network {
  return { ...doc, lines: (doc.lines ?? []).map((l) => (l.id === id ? f(l) : l)) };
}

/** Purpose: remove a line. */
export function removeLine(doc: Network, id: string): Network {
  const lines = (doc.lines ?? []).filter((l) => l.id !== id);
  return { ...doc, lines: lines.length ? lines : null };
}

/**
 * Purpose: add a station to a line where it fits best: between the two consecutive stops it is
 * closest to the straight line between, else at the nearer end. A station already on the line is
 * left out.
 */
export function insertStop(doc: Network, line: ServiceLine, station: number): ServiceLine {
  if (line.stations.includes(station)) return line;
  const at = doc.stations.find((s) => s.id === station);
  if (!at) return line;
  const pos = (id: number) => doc.stations.find((s) => s.id === id);
  const pts = line.stations.map(pos);
  if (pts.length < 2 || pts.some((p) => !p)) return { ...line, stations: [...line.stations, station] };
  const d = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
  // The cheapest place: before the first stop, between two (the detour), or after the last.
  let best = { i: 0, cost: d(at, pts[0]!) };
  for (let i = 0; i + 1 < pts.length; i++) {
    const cost = d(pts[i]!, at) + d(at, pts[i + 1]!) - d(pts[i]!, pts[i + 1]!);
    if (cost < best.cost) best = { i: i + 1, cost };
  }
  if (d(pts[pts.length - 1]!, at) < best.cost) best = { i: pts.length, cost: 0 };
  const stations = [...line.stations];
  stations.splice(best.i, 0, station);
  return { ...line, stations };
}

/** Purpose: move the stop at `i` by `by` places (−1 earlier, +1 later). */
export function moveStop(line: ServiceLine, i: number, by: number): ServiceLine {
  const j = i + by;
  if (j < 0 || j >= line.stations.length) return line;
  const stations = [...line.stations];
  [stations[i], stations[j]] = [stations[j]!, stations[i]!];
  return { ...line, stations };
}

/**
 * Purpose: what is wrong with a line before it can be published, in words; `null` when it can be.
 */
export function lineProblem(doc: Network, line: ServiceLine): string | null {
  const known = line.stations.filter((id) => doc.stations.some((s) => s.id === id));
  if (known.length < 2) return "Needs at least two stops.";
  if (!trainById(line.vehicle)) return "Choose a train.";
  if (line.last_min <= line.first_min) return "The last departure must be after the first.";
  if (line.peak_headway_min < 1 || line.offpeak_headway_min < 1) return "Headways must be at least 1 min.";
  return null;
}

/** Purpose: the lines in the engine's form (stations as topology ids, the train's catalogue values). */
export function engineLines(
  doc: Network,
  lines: readonly ServiceLine[] = doc.lines ?? [],
): EngineServiceLine[] {
  return lines.flatMap((l) => {
    const t = trainById(l.vehicle);
    if (!t || lineProblem(doc, l)) return [];
    const vehicle = {
      id: t.id,
      name: t.name,
      length_m: t.length_m,
      top_speed_kmh: t.top_speed_kmh,
      power_kw: t.power_kw,
      empty_mass_t: t.empty_mass_t,
      capacity: t.capacity,
    };
    return [
      {
        id: l.id,
        name: l.name || l.id,
        color: l.color,
        stations: l.stations.filter((id) => doc.stations.some((s) => s.id === id)).map((id) => `st${id}`),
        vehicle,
        units: Math.max(1, Math.round(l.units)),
        mode: lineMode(doc, l),
        first_s: l.first_min * 60,
        last_s: l.last_min * 60,
        peak_headway_s: l.peak_headway_min * 60,
        offpeak_headway_s: l.offpeak_headway_min * 60,
        dwell_s: l.dwell_s ?? null,
      },
    ];
  });
}

/** Purpose: "HH:MM" from minutes after midnight (24:30 stays 24:30). */
export function hhmm(min: number): string {
  const m = Math.round(min);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Purpose: minutes after midnight from "HH:MM" (hours up to 27), or null. */
export function parseHhmm(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 27 || mm > 59) return null;
  return h * 60 + mm;
}
