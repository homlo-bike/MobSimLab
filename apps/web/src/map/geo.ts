/**
 * Distances between points on the map. Every tool measures with these, so a distance shown in one place
 * matches the same distance anywhere else.
 */

/** Mean Earth radius in metres (IUGG), the same value the simulation crates use. */
export const EARTH_RADIUS_M = 6_371_008.8;

/** A point as [longitude, latitude] in degrees. */
export type LonLat = readonly [number, number];

const rad = (d: number) => (d * Math.PI) / 180;

/** Purpose: great-circle (haversine) distance in metres between two points. */
export function distanceM(a: LonLat, b: LonLat): number {
  const h =
    Math.sin(rad(b[1] - a[1]) / 2) ** 2 +
    Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(rad(b[0] - a[0]) / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Purpose: great-circle distance in km between two points. */
export function distanceKm(a: LonLat, b: LonLat): number {
  return distanceM(a, b) / 1000;
}
