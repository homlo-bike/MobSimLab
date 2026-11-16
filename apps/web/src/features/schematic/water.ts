/**
 * Water on the network map (ADR-0041 §8): sea, lakes and rivers from OpenStreetMap, fetched for the
 * network's box (`GET /api/street-network/water`) and bent along with the stations, so the river still runs
 * between the stations it runs between on the ground.
 */
import { get } from "../../session/api";
import type { LonLat } from "../street-lines/types";
import { project, type Pt } from "./layout";

/** What the API returns (apps/api/src/street-network/water.ts), `[lon, lat]`. */
export interface WaterShapes {
  areas: LonLat[][];
  rivers: { line: LonLat[]; kind: "river" | "canal" }[];
  sea: LonLat[][];
}

export type WaterBox = [number, number, number, number];
export type WaterLoader = (box: WaterBox) => Promise<WaterShapes>;

/** The API answers boxes of at most 1° a side. */
const MAX_SPAN = 1;

export const loadWater: WaterLoader = (b) =>
  get<WaterShapes>(`/api/street-network/water?bbox=${b.map((x) => x.toFixed(4)).join(",")}`);

/**
 * Purpose: the box to fetch water for: the stations' box with a margin of a fifth of its size (at least
 * 0.01°), cut to 1° a side around its centre. Output: `[west, south, east, north]`, or null without stations.
 */
export function waterBox(points: readonly LonLat[]): WaterBox | null {
  if (!points.length) return null;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const box = (lo: number, hi: number): [number, number] => {
    const m = Math.max(0.01, (hi - lo) * 0.2);
    let a = lo - m;
    let b = hi + m;
    if (b - a > MAX_SPAN) {
      const c = (a + b) / 2;
      a = c - MAX_SPAN / 2 + 1e-6;
      b = c + MAX_SPAN / 2 - 1e-6;
    }
    return [a, b];
  };
  const [w, e] = box(Math.min(...xs), Math.max(...xs));
  const [s, n] = box(Math.min(...ys), Math.max(...ys));
  return [Math.max(-180, w), Math.max(-85, s), Math.min(180, e), Math.min(85, n)];
}

/**
 * Purpose: a map from ground places to the diagram: each point moves by the stations' moves (diagram place
 * minus ground place), weighted by the inverse square of the distance to each station, so water near a
 * station keeps its place next to it. Inputs: the diagram origin, the stations' ground places and their
 * diagram positions (metres from the origin).
 */
export function warp(origin: LonLat, stations: readonly LonLat[], pos: readonly Pt[]): (p: LonLat) => Pt {
  const geo = stations.map((s) => project(origin, s));
  const moves = geo.map((g, i) => [pos[i]![0] - g[0], pos[i]![1] - g[1]] as Pt);
  return (lonlat) => {
    const p = project(origin, lonlat);
    if (!geo.length) return p;
    let wx = 0;
    let wy = 0;
    let wsum = 0;
    for (let i = 0; i < geo.length; i++) {
      const d2 = (geo[i]![0] - p[0]) ** 2 + (geo[i]![1] - p[1]) ** 2;
      if (d2 < 1) return [p[0] + moves[i]![0], p[1] + moves[i]![1]];
      const w = 1 / d2;
      wx += moves[i]![0] * w;
      wy += moves[i]![1] * w;
      wsum += w;
    }
    return [p[0] + wx / wsum, p[1] + wy / wsum];
  };
}
