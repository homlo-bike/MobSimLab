/**
 * What the strip map shows under a line beyond the drawings themselves (ADR-0041 §10): the rail engine's trains
 * per line, round trips and running times between stations, the levels the built track runs at, and the ground
 * height at every station. Street and plugin lines already carry their running times and vehicles
 * (`lines.ts`); rail lines get theirs here once the engine has built the design.
 */
import { useEffect, useMemo, useState } from "react";
import { fetchElevations } from "../../terrain/terrain";
import { offset } from "../journey-planner/network";
import type { Timetable } from "../journey-planner/types";
import { loadRailEngine } from "../railways/engine";
import type { LonLat, Network, RailEngineLoader, TrackView } from "../railways/types";
import { type HeightsFetcher, type RailBuild, useRailBuild } from "../tables/railBuild";
import { project, type Pt } from "./layout";
import type { SchematicLine, SchematicNetwork, SectionLevel } from "./lines";

/** Ground heights of the diagram's stations, m above sea level (null where unknown), by station index. */
export type StationHeights = (number | null)[];

const defaultHeights: HeightsFetcher = (points) => fetchElevations(points).then((r) => r.elevationsM);

/** Points along a section that are checked against the built track. */
const SAMPLES = 11;
/** A sample further than this from every track is not on the track. */
const NEAR_TRACK_M = 120;

/** Purpose: the nearest point of a polyline to `p`: its distance and the distance along the polyline. */
function nearestOn(line: readonly Pt[], p: Pt): { d: number; along: number } {
  let best = { d: Infinity, along: 0 };
  let run = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const l2 = ex * ex + ey * ey;
    const len = Math.sqrt(l2);
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / l2)) : 0;
    const d = Math.hypot(a[0] + ex * t - p[0], a[1] + ey * t - p[1]);
    if (d < best.d) best = { d, along: run + len * t };
    run += len;
  }
  return best;
}

/** Purpose: the level of a track at a distance along its centre line (scaled to the track's length). */
function levelAt(track: TrackView, alongCentre: number, centreLen: number): SectionLevel | null {
  const m = centreLen > 0 ? (alongCentre / centreLen) * track.length_m : 0;
  const hit = track.levels.find((x) => m >= x.from_m && m <= x.to_m) ?? null;
  return hit ? hit.level : null;
}

/**
 * Purpose: what a rail section runs on, from the built tracks: points along the straight line between the
 * two stations are matched to the nearest track and its level there. Output: shares that add up to 1, in the
 * order they are met; null when no sample is near a track.
 */
export function sectionLevels(
  a: LonLat,
  b: LonLat,
  tracks: readonly TrackView[],
): { level: SectionLevel; share: number }[] | null {
  if (!tracks.length) return null;
  const origin = a;
  const lines = tracks.map((tr) => {
    const pts = tr.centre.map((c) => project(origin, c));
    let len = 0;
    for (let i = 1; i < pts.length; i++)
      len += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
    return { tr, pts, len };
  });
  const pb = project(origin, b);
  const found: SectionLevel[] = [];
  for (let k = 0; k < SAMPLES; k++) {
    const f = (k + 0.5) / SAMPLES;
    const p: Pt = [pb[0] * f, pb[1] * f];
    let best: { d: number; level: SectionLevel | null } = { d: Infinity, level: null };
    for (const l of lines) {
      if (l.pts.length < 2) continue;
      const n = nearestOn(l.pts, p);
      if (n.d < best.d) best = { d: n.d, level: levelAt(l.tr, n.along, l.len) };
    }
    if (best.level && best.d <= NEAR_TRACK_M) found.push(best.level);
  }
  if (!found.length) return null;
  const out: { level: SectionLevel; share: number }[] = [];
  for (const lv of found) {
    const last = out[out.length - 1];
    if (last?.level === lv) last.share += 1;
    else out.push({ level: lv, share: 1 });
  }
  return out.map((x) => ({ level: x.level, share: x.share / found.length }));
}

/**
 * Purpose: running time between two named stations in a published timetable: from leaving the first to
 * arriving at the second, on the first trip of the line that calls at both in a row (either direction).
 */
function timetableRun(tt: Timetable, routeId: string, from: string, to: string): number | null {
  const name = new Map(tt.stops.map((s) => [s.stop_id, s.stop_name.trim().toLocaleLowerCase()]));
  const f = from.trim().toLocaleLowerCase();
  const t = to.trim().toLocaleLowerCase();
  for (const trip of tt.trips) {
    if (trip.route_id !== routeId) continue;
    const st = [...trip.stop_times].sort((x, y) => x.stop_sequence - y.stop_sequence);
    for (let i = 1; i < st.length; i++) {
      const a = name.get(st[i - 1]!.stop_id);
      const b = name.get(st[i]!.stop_id);
      if ((a === f && b === t) || (a === t && b === f)) {
        const run = st[i]!.arrival_time - st[i - 1]!.departure_time;
        if (run > 0) return run;
      }
    }
  }
  return null;
}

/**
 * Purpose: a network with what the rail engine knows added to its rail lines: trains in service and the round
 * trip (from the line reports), running times between stations (from the timetable) and the levels of each
 * section (from the built tracks). Lines the engine could not publish keep what the drawings say.
 */
export function withRailDetails(
  net: SchematicNetwork,
  railway: Network | null | undefined,
  build: RailBuild | null,
): SchematicNetwork {
  if (!railway || !build) return net;
  const byId = new Map(railway.stations.map((s) => [s.id, s]));
  const where = (part: string): LonLat | null => {
    const s = part.startsWith("rail:") ? byId.get(Number(part.slice(5))) : undefined;
    return s ? offset(railway.origin, s.x, s.y) : null;
  };
  const lines = net.lines.map((l): SchematicLine => {
    if (!l.id.startsWith("rail:")) return l;
    const id = l.id.slice(5);
    const rep = build.reports[id];
    const roundS =
      rep && rep.outbound_s !== null && rep.return_s !== null ? rep.outbound_s + rep.return_s : null;
    return {
      ...l,
      service: {
        ...l.service,
        vehicles: rep ? rep.trains : l.service.vehicles,
        roundTripMin: roundS !== null ? Math.round(roundS / 60) : l.service.roundTripMin,
      },
      runS: l.runS.map((r, k) => {
        if (r !== null || !build.timetable) return r;
        return timetableRun(
          build.timetable,
          id,
          net.stations[l.stops[k]!]!.name,
          net.stations[l.stops[k + 1]!]!.name,
        );
      }),
      levels: l.levels.map((lv, k) => {
        const a = where(l.partIds[k]!);
        const b = where(l.partIds[k + 1]!);
        return (a && b && sectionLevels(a, b, build.view.tracks)) || lv;
      }),
    };
  });
  return { ...net, lines };
}

/**
 * Purpose: the strip map's extra facts: the network with the rail engine's details, and the ground height
 * at every station. Inputs: the network, the railway design, the engine loader and the height source (tests
 * inject both). Side effects: loads the rail engine and fetches terrain heights.
 */
export function useSchematicDetails(
  net: SchematicNetwork,
  railway: Network | null | undefined,
  loadRail: RailEngineLoader = loadRailEngine,
  fetchHeights: HeightsFetcher = defaultHeights,
): { net: SchematicNetwork; heights: StationHeights | null } {
  const { build } = useRailBuild(railway ?? null, loadRail, fetchHeights);
  const detailed = useMemo(() => withRailDetails(net, railway, build), [net, railway, build]);
  const [heights, setHeights] = useState<StationHeights | null>(null);
  const pts = JSON.stringify(net.stations.map((s) => s.lonlat));
  useEffect(() => {
    let live = true;
    const points = JSON.parse(pts) as LonLat[];
    setHeights(null);
    if (!points.length) return;
    fetchHeights(points)
      .then((h) => live && setHeights(h))
      .catch(() => live && setHeights(points.map(() => null)));
    return () => {
      live = false;
    };
  }, [pts, fetchHeights]);
  return { net: detailed, heights };
}
