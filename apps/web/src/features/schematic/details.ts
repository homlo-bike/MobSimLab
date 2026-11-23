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
import { distanceM, type SchematicLine, type SchematicNetwork, type SectionLevel } from "./lines";

/**
 * The ground along a line, sampled every `PROFILE_STEP_M` along the way it runs: distance from the first stop,
 * m, and the ground height there, m above sea level (null where unknown). `stationD`: each stop's distance.
 */
export interface LineProfile {
  d: number[];
  h: (number | null)[];
  stationD: number[];
}

/** The profile samples the ground this often along the line, m. */
export const PROFILE_STEP_M = 50;
/** At most this many samples per line (the terrain service takes 20 000 a request). */
const MAX_PROFILE_SAMPLES = 19_000;

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

/** Box round each track's centre line `[west, south, east, north]`, worked out once per built design. */
const trackBoxes = new WeakMap<TrackView, [number, number, number, number]>();

function boxOf(tr: TrackView): [number, number, number, number] {
  let b = trackBoxes.get(tr);
  if (!b) {
    b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [lon, lat] of tr.centre) {
      b[0] = Math.min(b[0], lon);
      b[1] = Math.min(b[1], lat);
      b[2] = Math.max(b[2], lon);
      b[3] = Math.max(b[3], lat);
    }
    trackBoxes.set(tr, b);
  }
  return b;
}

/**
 * Purpose: the tracks that may come within `NEAR_TRACK_M` of the box round `points` (with a wide margin, so
 * none that could is left out). Every station checked every track of the network before (the Schematic of
 * the Damascus network spent seconds here); a track this leaves out is never near enough to count.
 */
function tracksNear(points: readonly LonLat[], tracks: readonly TrackView[]): TrackView[] {
  const lat0 = points.reduce((m, p) => m + p[1], 0) / points.length;
  const dLat = (3 * NEAR_TRACK_M) / 111_195;
  const dLon = dLat / Math.max(0.1, Math.cos((lat0 * Math.PI) / 180));
  const w = Math.min(...points.map((p) => p[0])) - dLon;
  const e = Math.max(...points.map((p) => p[0])) + dLon;
  const s = Math.min(...points.map((p) => p[1])) - dLat;
  const n = Math.max(...points.map((p) => p[1])) + dLat;
  return tracks.filter((tr) => {
    const b = boxOf(tr);
    return b[0] <= e && b[2] >= w && b[1] <= n && b[3] >= s;
  });
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
  const lines = tracksNear([a, b], tracks).map((tr) => {
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

/** Purpose: a point a share of the way between two points. */
function lerp(a: LonLat, b: LonLat, f: number): LonLat {
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

/** Purpose: the part of a polyline between two distances along it (metres, `pts` its projected form). */
function slicePath(ll: readonly LonLat[], pts: readonly Pt[], from: number, to: number): LonLat[] {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const out: LonLat[] = [];
  let run = 0;
  for (let i = 1; i < pts.length; i++) {
    const len = Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
    const a = run;
    const b = run + len;
    if (b >= lo && a <= hi && len > 0) {
      if (!out.length) out.push(lerp(ll[i - 1]!, ll[i]!, Math.max(0, (lo - a) / len)));
      out.push(b <= hi ? ll[i]! : lerp(ll[i - 1]!, ll[i]!, (hi - a) / len));
    }
    run = b;
  }
  return from <= to ? out : out.reverse();
}

/**
 * Purpose: the way a rail section runs on the built track: the part of the track that passes both stations,
 * from one to the other. Output: null when no track passes near both.
 */
export function trackPath(a: LonLat, b: LonLat, tracks: readonly TrackView[]): LonLat[] | null {
  const pb = project(a, b);
  let best: { score: number; path: LonLat[] } | null = null;
  // A track must pass near both stations.
  const nearA = new Set(tracksNear([a], tracks));
  for (const tr of tracksNear([b], tracks)) {
    if (tr.centre.length < 2 || !nearA.has(tr)) continue;
    const pts = tr.centre.map((c) => project(a, c));
    const na = nearestOn(pts, [0, 0]);
    const nb = nearestOn(pts, pb);
    if (na.d > NEAR_TRACK_M || nb.d > NEAR_TRACK_M || Math.abs(na.along - nb.along) < 1) continue;
    const score = na.d + nb.d;
    if (!best || score < best.score)
      best = { score, path: [a, ...slicePath(tr.centre, pts, na.along, nb.along), b] };
  }
  return best?.path ?? null;
}

/**
 * Purpose: points along a line every `PROFILE_STEP_M` (further apart on very long lines), each section
 * starting at its stop. Output: the points, their distance from the first stop and each stop's distance.
 */
export function profilePoints(paths: readonly LonLat[][]): {
  points: LonLat[];
  d: number[];
  stationD: number[];
} {
  const segLen = (p: readonly LonLat[]) => p.slice(1).reduce((m, x, i) => m + distanceM(p[i]!, x), 0);
  const total = paths.reduce((m, p) => m + segLen(p), 0);
  const step = Math.max(PROFILE_STEP_M, total / MAX_PROFILE_SAMPLES);
  const points: LonLat[] = [];
  const d: number[] = [];
  const stationD: number[] = [0];
  let base = 0;
  paths.forEach((p, k) => {
    if (k === 0 && p[0]) {
      points.push(p[0]);
      d.push(0);
    }
    let run = 0;
    let next = step;
    for (let i = 1; i < p.length; i++) {
      const len = distanceM(p[i - 1]!, p[i]!);
      while (len > 0 && next < run + len) {
        points.push(lerp(p[i - 1]!, p[i]!, (next - run) / len));
        d.push(base + next);
        next += step;
      }
      run += len;
    }
    // Every stop gets a sample of its own; one closer than a fifth of a step replaces the last.
    const end = p[p.length - 1];
    if (end) {
      const lastD = d[d.length - 1]!;
      if (d.length > 1 && lastD > base && base + run - lastD < step / 5) {
        points.pop();
        d.pop();
      }
      points.push(end);
      d.push(base + run);
    }
    base += run;
    stationD.push(base);
  });
  return { points, d, stationD };
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
      paths: l.paths.map((p, k) => {
        const a = where(l.partIds[k]!);
        const b = where(l.partIds[k + 1]!);
        return (a && b && trackPath(a, b, build.view.tracks)) || p;
      }),
    };
  });
  return { ...net, lines };
}

/**
 * Purpose: the strip map's extra facts: the network with the rail engine's details. Inputs: the network, the
 * railway design, the engine loader and the height source the engine uses (tests inject both). Side effects:
 * loads the rail engine.
 */
export function useSchematicDetails(
  net: SchematicNetwork,
  railway: Network | null | undefined,
  loadRail: RailEngineLoader = loadRailEngine,
  fetchHeights: HeightsFetcher = defaultHeights,
): SchematicNetwork {
  const { build } = useRailBuild(railway ?? null, loadRail, fetchHeights);
  return useMemo(() => withRailDetails(net, railway, build), [net, railway, build]);
}

/**
 * Purpose: the ground along a line, for the strip map's height profile. Inputs: the line (null when no strip
 * map is open) and the height source. Output: null while loading. Side effects: fetches terrain heights.
 */
export function useLineProfile(
  line: SchematicLine | null,
  fetchHeights: HeightsFetcher = defaultHeights,
): LineProfile | null {
  const [profile, setProfile] = useState<LineProfile | null>(null);
  const paths = JSON.stringify(line?.paths ?? null);
  useEffect(() => {
    let live = true;
    setProfile(null);
    const p = JSON.parse(paths) as LonLat[][] | null;
    if (!p?.length) return;
    const { points, d, stationD } = profilePoints(p);
    fetchHeights(points)
      .then((h) => live && setProfile({ d, h, stationD }))
      .catch(() => live && setProfile({ d, h: points.map(() => null), stationD }));
    return () => {
      live = false;
    };
  }, [paths, fetchHeights]);
  return profile;
}
