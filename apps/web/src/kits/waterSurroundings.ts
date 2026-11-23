/**
 * What the water route kit checks a ferry line against (ADR-0036 §6): OpenStreetMap water (sea, lakes, river
 * areas and rivers), bridges and locks around the line, and GEBCO depths at the points on open sea the kit asks
 * for. Fetched from the API; the kit does the checking (crates/mode-kits/src/water_checks.rs).
 */
import { get } from "../session/api";
import { csrfHeader } from "../session/csrf";
import { loadWater, waterBox, type WaterBox } from "../features/schematic/water";
import type { LonLat, Surroundings, WaterBridge, WaterLock } from "./types";

/** The surroundings of a box, without the depths. */
export type SurroundingsLoader = (box: WaterBox) => Promise<Omit<Surroundings, "depths">>;
/** Depths in metres below sea level at points (land negative), null where there is none. */
export type DepthFetcher = (points: LonLat[]) => Promise<(number | null)[]>;

/** Purpose: OpenStreetMap water, bridges and locks of a box from the API. */
export const loadSurroundings: SurroundingsLoader = async (box) => {
  const bbox = box.map((x) => x.toFixed(4)).join(",");
  const [water, crossings] = await Promise.all([
    loadWater(box),
    get<{ bridges: WaterBridge[]; locks: WaterLock[] }>(`/api/street-network/water-crossings?bbox=${bbox}`),
  ]);
  return {
    bbox: box,
    areas: water.areas,
    sea: water.sea,
    rivers: water.rivers.map((r) => r.line),
    bridges: crossings.bridges,
    locks: crossings.locks,
  };
};

/** Purpose: GEBCO depths at points from the API. */
export const fetchDepths: DepthFetcher = async (points) => {
  const res = await fetch("/api/terrain/depths", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...csrfHeader() },
    credentials: "same-origin",
    body: JSON.stringify({ points }),
  });
  if (!res.ok) throw new Error(`depths: ${res.status}`);
  return ((await res.json()) as { depthsM: (number | null)[] }).depthsM;
};

/**
 * Purpose: the box to fetch the surroundings for (the piers and via points with a margin, at most 1° a side),
 * and a key that stays the same while the line moves within a hundredth of a degree.
 */
export function surroundingsBox(points: readonly LonLat[]): { box: WaterBox; key: string } | null {
  const box = waterBox(points);
  return box ? { box, key: box.map((x) => x.toFixed(2)).join(",") } : null;
}

/** Purpose: the key a depth is kept under (its point to about 10 cm). */
export const depthKey = ([lon, lat]: LonLat) => `${lon.toFixed(6)},${lat.toFixed(6)}`;
