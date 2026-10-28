import type { Timing } from "./modes";
import type { LineView, LonLat } from "./types";

/** Numbers in the panel's stat tiles. */
export interface LineStats {
  lengthM: number;
  stops: number;
  endStops: number;
  runMin: number;
  dwellMin: number;
  layoverMin: number;
  cycleMin: number;
  vehicles: number;
}

/**
 * Purpose: circuit length, stops, cycle time and vehicles needed for the headway.
 * Cycle = running time + dwell at every stop + layover at every end stop.
 */
export function lineStats(view: LineView, t: Timing): LineStats {
  const stops = view.points.filter((p) => p.kind !== "via").length;
  const endStops = view.points.filter((p) => p.kind === "end_stop").length;
  const runMin = view.time_s / 60;
  const dwellMin = (stops * t.dwellS) / 60;
  const layoverMin = endStops * t.layoverMin;
  const cycleMin = runMin + dwellMin + layoverMin;
  const vehicles = view.legs.length && t.headwayMin > 0 ? Math.ceil(cycleMin / t.headwayMin) : 0;
  return { lengthM: view.length_m, stops, endStops, runMin, dwellMin, layoverMin, cycleMin, vehicles };
}

export type Severity = "ok" | "info" | "warn" | "error";

/** One line in the panel's Checks list; `point` lets the planner jump to it. */
export interface Check {
  sev: Severity;
  text: string;
  point?: number;
}

/** Purpose: everything the planner should know about the line, worst first. */
export function lineChecks(view: LineView): Check[] {
  const out: Check[] = [];
  const n = view.points.length;
  for (const p of view.points) {
    if (p.message) out.push({ sev: "error", text: `Point ${p.seq + 1}: ${p.message}`, point: p.id });
  }
  for (const l of view.legs) {
    const from = view.points[l.index]!;
    if (l.status === "error" && !from.message && !view.points[(l.index + 1) % n]?.message) {
      out.push({ sev: "error", text: `After point ${l.index + 1}: ${l.message}`, point: from.id });
    } else if (l.message) {
      out.push({
        sev: l.status === "warning" ? "warn" : "info",
        text: `After point ${l.index + 1}: ${l.message}`,
        point: from.id,
      });
    }
  }
  for (const t of view.depot_trips) {
    if (t.status === "error") out.push({ sev: "error", text: `Depot: ${t.message}`, point: t.stop });
  }
  for (const i of view.issues) {
    if (i.startsWith("Some legs cannot be driven")) continue;
    if (i.startsWith("Depot:") && view.depot_trips.some((t) => t.status === "error")) continue;
    out.push({ sev: i.startsWith("A line needs") ? "info" : "warn", text: i });
  }
  if (n < 2) {
    out.push({
      sev: "info",
      text: "Click on at least two streets to make a line. The last point routes back to the first.",
    });
  } else if (!view.points.some((p) => p.kind === "end_stop")) {
    out.push({
      sev: "info",
      text: "Mark an end stop. End stops hold layover time and split the circuit into directions for the timetable.",
    });
  }
  if (n >= 2 && !out.some((c) => c.sev === "error" || c.sev === "warn")) {
    out.unshift({
      sev: "ok",
      text: "Every leg is routed legally: no U-turns, every stop approached with its sidewalk on the door side.",
    });
  }
  const rank: Record<Severity, number> = { error: 0, warn: 1, ok: 2, info: 3 };
  return out.sort((a, b) => rank[a.sev] - rank[b.sev]);
}

/** A vehicle position along the circuit for the preview run. */
export interface Circuit {
  coords: LonLat[];
  /** Cumulative metres at each coordinate. */
  cum: number[];
  /** Metres along the circuit where each stop is. */
  stops: number[];
  length: number;
}

const R = 6_371_008.8;

function metres(a: LonLat, b: LonLat): number {
  const kx = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  const dx = (((b[0] - a[0]) * Math.PI) / 180) * kx;
  const dy = ((b[1] - a[1]) * Math.PI) / 180;
  return Math.hypot(dx, dy) * R;
}

/** Purpose: the whole circuit as one polyline with stop positions, starting at point 1. */
export function circuitPath(view: LineView): Circuit | null {
  if (view.legs.length < 2 || view.legs.some((l) => l.status === "error")) return null;
  const coords: LonLat[] = [];
  const cum: number[] = [];
  const stops: number[] = [];
  let acc = 0;
  for (const l of view.legs) {
    if (view.points[l.index]?.kind !== "via") stops.push(acc);
    l.coords.forEach((c, i) => {
      if (coords.length) acc += metres(coords[coords.length - 1]!, c);
      if (i > 0 || !coords.length) {
        coords.push(c);
        cum.push(acc);
      }
    });
  }
  return { coords, cum, stops, length: acc };
}

/** Purpose: position and bearing (degrees from north) at `s` metres along the circuit. */
export function along(c: Circuit, s: number): { at: LonLat; bearing: number } {
  const d = ((s % c.length) + c.length) % c.length;
  let i = 1;
  while (i < c.cum.length - 1 && c.cum[i]! < d) i++;
  const [a, b] = [c.coords[i - 1]!, c.coords[i]!];
  const span = c.cum[i]! - c.cum[i - 1]! || 1;
  const f = Math.min(1, Math.max(0, (d - c.cum[i - 1]!) / span));
  const bearing = (Math.atan2((b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180), b[1] - a[1]) * 180) / Math.PI;
  return { at: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], bearing };
}
