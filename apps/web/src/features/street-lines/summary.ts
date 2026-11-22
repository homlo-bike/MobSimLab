import { engineTextNow } from "../../i18n/engine";
import { tNow } from "../../i18n/i18n";
import type { Timing } from "./modes";
import type { DepotTripView, LineView } from "./types";

/** Numbers in the panel's stat tiles. */
export interface LineStats {
  lengthM: number;
  stops: number;
  endStops: number;
  runMin: number;
  /** Expected wait at level crossings per circuit, min (part of `runMin`). */
  crossingMin: number;
  dwellMin: number;
  layoverMin: number;
  cycleMin: number;
  vehicles: number;
}

/**
 * Purpose: circuit length, stops, cycle time and vehicles needed for the headway.
 * Cycle = running time (with the expected wait at level crossings) + dwell at every stop + layover at
 * every end stop.
 */
export function lineStats(view: LineView, t: Timing): LineStats {
  const stops = view.points.filter((p) => p.kind !== "via").length;
  const endStops = view.points.filter((p) => p.kind === "end_stop").length;
  const runMin = view.time_s / 60;
  const dwellMin = (stops * t.dwellS) / 60;
  const layoverMin = endStops * t.layoverMin;
  const cycleMin = runMin + dwellMin + layoverMin;
  const vehicles = view.legs.length && t.headwayMin > 0 ? Math.ceil(cycleMin / t.headwayMin) : 0;
  const crossingMin = (view.crossing_wait_s ?? 0) / 60;
  return {
    lengthM: view.length_m,
    stops,
    endStops,
    runMin,
    crossingMin,
    dwellMin,
    layoverMin,
    cycleMin,
    vehicles,
  };
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
    if (p.message)
      out.push({
        sev: "error",
        text: tNow("street.check.point", {
          n: p.seq + 1,
          message: engineTextNow({ text: p.message, msg: p.message_msg }),
        }),
        point: p.id,
      });
  }
  for (const l of view.legs) {
    const from = view.points[l.index]!;
    if (l.status === "error" && !from.message && !view.points[(l.index + 1) % n]?.message) {
      out.push({
        sev: "error",
        text: tNow("street.check.after", {
          n: l.index + 1,
          message: engineTextNow({ text: l.message ?? "", msg: l.message_msg }),
        }),
        point: from.id,
      });
    } else if (l.message) {
      out.push({
        sev: l.status === "warning" ? "warn" : "info",
        text: tNow("street.check.after", {
          n: l.index + 1,
          message: engineTextNow({ text: l.message, msg: l.message_msg }),
        }),
        point: from.id,
      });
    }
  }
  for (const t of view.depot_trips) {
    if (t.status === "error")
      out.push({
        sev: "error",
        text: tNow("street.check.depot", {
          message: engineTextNow({ text: t.message ?? "", msg: t.message_msg }),
        }),
        point: t.stop,
      });
  }
  view.issues.forEach((i, k) => {
    if (i.startsWith("Some legs cannot be driven")) return;
    if (i.startsWith("Depot:") && view.depot_trips.some((t) => t.status === "error")) return;
    out.push({
      sev: i.startsWith("A line needs") ? "info" : "warn",
      text: engineTextNow({ text: i, msg: view.issue_msgs?.[k] }),
    });
  });
  if (n < 2) {
    out.push({
      sev: "info",
      text: tNow("street.check.twoPoints"),
    });
  } else if (!view.points.some((p) => p.kind === "end_stop")) {
    out.push({
      sev: "info",
      text: tNow("street.check.endStop"),
    });
  }
  if (n >= 2 && !out.some((c) => c.sev === "error" || c.sev === "warn")) {
    out.unshift({
      sev: "ok",
      text: tNow("street.check.legal"),
    });
  }
  const rank: Record<Severity, number> = { error: 0, warn: 1, ok: 2, info: 3 };
  return out.sort((a, b) => rank[a.sev] - rank[b.sev]);
}

/**
 * Purpose: the end stop a depot run goes to (pull-out) or comes from (pull-in) when the planner has not chosen one:
 * the one with the shortest routed run, so buses do not run empty to the far end of the line.
 * Inputs: the line's depot runs; which kind. Output: the end stop's point id, or undefined when there are no runs.
 */
export function nearestTerminal(trips: DepotTripView[], kind: DepotTripView["kind"]): number | undefined {
  const routed = trips.filter((t) => t.kind === kind && t.status !== "error" && t.length_m > 0);
  const best = routed.reduce<DepotTripView | undefined>(
    (a, t) => (!a || t.length_m < a.length_m ? t : a),
    undefined,
  );
  return best?.stop ?? trips[0]?.stop;
}
