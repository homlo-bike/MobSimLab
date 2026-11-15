/**
 * Types and pure helpers of the cargo bike plugin's tab (plugins/cargo-bike): which street tiles a trip
 * needs, the bearings of the range map, and how German 2024 prices become the start point's country's.
 */
import type { CountryEconomy } from "../costs/economy";

export type LonLat = [number, number];
export type StreetClass = "separated" | "lane" | "quiet" | "mixed";
export const CLASSES: readonly StreetClass[] = ["separated", "lane", "quiet", "mixed"];

/** What the tab keeps in the project (drawing kind "cargo-bike"). */
export interface CargoBikeDoc {
  start?: LonLat | null;
  destination?: LonLat | null;
  /** The project's own values, by parameter key without `cargo_bike.`; money in the local currency. */
  values?: Record<string, number>;
}

/** One parameter of the plugin (crates/cargo-bike/data/defaults.json). */
export interface ParamDefault {
  label: string;
  unit: string;
  low: number;
  central: number;
  high: number;
}

/** A route one way (crates/cargo-bike `Route`). */
export interface Route {
  coords: LonLat[];
  classes: StreetClass[];
  length_m: number;
  signals: number;
  stop_signs: number;
}

/** One way of a trip, ridden (crates/cargo-bike `Leg`). */
export interface Leg {
  distance_m: number;
  climb_m: number;
  descent_m: number;
  battery_wh: number;
  time_s: number;
  /** Metres on separated tracks, bike lanes, quiet streets and main roads in traffic. */
  class_m: [number, number, number, number];
  stops: number;
  steep_m: number;
  max_grade_pct: number;
  /** `[distance m, height m, battery Wh used]`. */
  profile: [number, number, number][];
}

/** A round trip (crates/cargo-bike `Trip`). */
export interface Trip {
  go: Leg;
  back: Leg;
  distance_m: number;
  battery_wh: number;
  usable_wh: number;
  battery_share: number;
  remaining_wh: number;
  feasible: boolean;
  wh_per_km: number;
  range_km: number;
  time_s: number;
}

/** How far the bike gets out and back along one bearing (crates/cargo-bike `Reach`). */
export interface Reach {
  bearing_deg: number;
  straight_m: number;
  street_m: number;
  at: LonLat;
  beyond: boolean;
}

export type SavingsLineId = "purchase" | "energy" | "tax" | "insurance" | "parking" | "maintenance";

/** The savings table (crates/cargo-bike `Savings`), per year in the local currency. */
export interface Savings {
  km_per_year: number;
  lines: { id: SavingsLineId; car: number; bike: number; saving: number }[];
  car_total: number;
  bike_total: number;
  saving_total: number;
  saving_lifetime: number;
  payback_years: number | null;
  fuel_l_per_year: number;
  electricity_kwh_per_year: number;
  values: Record<string, number>;
}

/** Local currency units per EUR: at the market exchange rate (purchase prices) and by price level. */
export interface Conversion {
  fx: number;
  ppp: number;
}

/** Street tiles use web-mercator zoom 14 (apps/api/src/street-network). */
export const TILE_ZOOM = 14;
/** Most walk tiles one trip loads (each one is an Overpass request when not cached). */
export const MAX_TILES = 160;

/** Purpose: the zoom-14 tile of a point. */
export function tileOf([lon, lat]: LonLat, z = TILE_ZOOM): [number, number] {
  const n = 2 ** z;
  const x = Math.min(n - 1, Math.max(0, Math.floor(((lon + 180) / 360) * n)));
  const r = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  const y = Math.min(n - 1, Math.max(0, Math.floor(((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * n)));
  return [x, y];
}

const EARTH_R = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Purpose: great-circle distance in metres. */
export function distanceM(a: LonLat, b: LonLat): number {
  const h =
    Math.sin(rad(b[1] - a[1]) / 2) ** 2 +
    Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(rad(b[0] - a[0]) / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Purpose: the point `distM` from `from` on a compass bearing. */
export function destinationPoint(from: LonLat, bearingDeg: number, distM: number): LonLat {
  const d = distM / EARTH_R;
  const b = rad(bearingDeg);
  const la1 = rad(from[1]);
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(b));
  const lo2 =
    rad(from[0]) +
    Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  return [((deg(lo2) + 540) % 360) - 180, deg(la2)];
}

/**
 * Purpose: the walk tiles a trip between two points needs: a corridor `bufferM` wide either side of the
 * straight line, so the route can bend round rivers and main roads without loading a whole square.
 * Output: tiles `[x, y]`, without repeats; more than MAX_TILES means the destination is too far.
 */
export function corridorTiles(a: LonLat, b: LonLat, bufferM = 1500): [number, number][] {
  const len = distanceM(a, b);
  const steps = Math.max(1, Math.ceil(len / 300));
  const seen = new Set<string>();
  const out: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p: LonLat = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    for (const bearing of [0, 45, 90, 135, 180, 225, 270, 315])
      for (const r of [0, bufferM / 2, bufferM]) {
        const tile = tileOf(r ? destinationPoint(p, bearing, r) : p);
        const k = tile.join("/");
        if (!seen.has(k)) {
          seen.add(k);
          out.push(tile);
        }
      }
  }
  return out;
}

/** Purpose: the far ends of the range map's bearings: `count` evenly spaced, `radiusM` from the origin. */
export function rayEnds(origin: LonLat, radiusM: number, count = 24): { bearing: number; end: LonLat }[] {
  return Array.from({ length: count }, (_, i) => {
    const bearing = (360 * i) / count;
    return { bearing, end: destinationPoint(origin, bearing, radiusM) };
  });
}

/**
 * Purpose: every n-th vertex of a line (always the first and the last), so its height profile stays within
 * the terrain service's sample limit.
 */
export function thin(coords: LonLat[], max: number): LonLat[] {
  if (coords.length <= max) return coords;
  const step = Math.ceil(coords.length / max);
  const out = coords.filter((_, i) => i % step === 0);
  if (out[out.length - 1] !== coords[coords.length - 1]) out.push(coords[coords.length - 1]!);
  return out;
}

/**
 * Purpose: local currency units per EUR of German 2024 prices, from the World Bank values of the start
 * point's country and of Germany: purchase prices at the market exchange rate, the rest by price level.
 * Output: null when either country's values are missing (the tab then shows EUR).
 */
export function conversionFrom(
  local: CountryEconomy | null,
  germany: CountryEconomy | null,
): Conversion | null {
  const fxL = local?.fx?.value;
  const fxD = germany?.fx?.value;
  const pppL = local?.ppp?.value;
  const pppD = germany?.ppp?.value;
  if (!fxL || !fxD || !pppL || !pppD) return null;
  return { fx: fxL / fxD, ppp: pppL / pppD };
}

/** Purpose: whether a parameter is an amount of money (shown in the local currency). */
export function isMoney(p: ParamDefault | undefined): boolean {
  return !!p && p.unit.startsWith("EUR");
}
