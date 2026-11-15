/**
 * Regions the planner draws or imports from OpenStreetMap in the GIS tab, with values that take priority
 * over the sourced data in the benefit tables (ADR-0040): primary land use, land value, tax revenue,
 * population density, jobs, GDP per person and employment. Saved as the drawing kind `regions`.
 */

export type LonLat = [number, number];

export type LandUse = "residential" | "commercial" | "industrial" | "mixed" | "public";

export const LAND_USES: { id: LandUse; label: string }[] = [
  { id: "residential", label: "Residential" },
  { id: "commercial", label: "Commercial (shops and offices)" },
  { id: "industrial", label: "Industrial" },
  { id: "mixed", label: "Mixed" },
  { id: "public", label: "Public (schools, hospitals, government)" },
];

/** Values a region can set; each one left empty keeps the sourced data. */
export interface RegionValues {
  /** Main use of buildings OpenStreetMap does not describe. */
  landUse?: LandUse;
  /** Land and building value per m² of floor area, project currency. */
  landValuePerM2?: number;
  /** Property tax collected in the region a year, project currency. */
  taxRevenuePerYear?: number;
  /** People per km². */
  populationDensity?: number;
  /** Jobs in the whole region. */
  jobs?: number;
  /** GDP per person a year, project currency. */
  gdpPerCapita?: number;
  /** Share of all residents who have a job (0–1). */
  employmentRate?: number;
}

export interface Region {
  id: string;
  name: string;
  /** Closed outline, `[lon, lat]`. */
  ring: LonLat[];
  source: "drawn" | "osm";
  /** OpenStreetMap id (`r123`, `w456`) of an imported area. */
  osmId?: string;
  values: RegionValues;
}

/** The drawing kind `regions`. */
export interface RegionsDoc {
  regions: Region[];
}

/** The numeric region values with their labels and units, for forms and tables. */
export const REGION_FIELDS: {
  key: Exclude<keyof RegionValues, "landUse">;
  label: string;
  unit: string;
  /** Shown as a percentage, stored as a share. */
  percent?: boolean;
}[] = [
  { key: "landValuePerM2", label: "Land and building value", unit: "per m² of floor area" },
  { key: "taxRevenuePerYear", label: "Property tax revenue", unit: "a year" },
  { key: "populationDensity", label: "Population density", unit: "people per km²" },
  { key: "jobs", label: "Jobs in the region", unit: "jobs" },
  { key: "gdpPerCapita", label: "GDP per person", unit: "a year" },
  { key: "employmentRate", label: "Residents with a job", unit: "% of all residents", percent: true },
];

/** Purpose: whether a point is inside a ring (even-odd rule). */
export function inRing(p: LonLat, ring: LonLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Purpose: area of a ring in m² (equirectangular around its centre; fine at city scale). */
export function ringAreaM2(ring: LonLat[]): number {
  if (ring.length < 3) return 0;
  const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110_574;
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[(i + 1) % ring.length]!;
    a += x1 * kx * (y2 * ky) - x2 * kx * (y1 * ky);
  }
  return Math.abs(a) / 2;
}

/** Purpose: the mean of a ring's points (the centre of a building, good enough for distances). */
export function ringCentre(ring: LonLat[]): LonLat {
  const pts =
    ring.length > 1 && ring[0]![0] === ring.at(-1)![0] && ring[0]![1] === ring.at(-1)![1]
      ? ring.slice(0, -1)
      : ring;
  const n = Math.max(1, pts.length);
  return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
}

/** Purpose: the first region (latest drawn wins: the list is searched from the end) that contains a point. */
export function regionAt(regions: Region[], p: LonLat): Region | null {
  for (let i = regions.length - 1; i >= 0; i--) {
    const r = regions[i]!;
    if (r.ring.length >= 4 && inRing(p, r.ring)) return r;
  }
  return null;
}

/** Purpose: a value is a usable number (finite and not negative). */
export function usable(v: number | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}
