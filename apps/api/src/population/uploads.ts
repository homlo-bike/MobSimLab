import { z } from "zod";
import type { Bbox } from "../projects/project-area";
import { type Converter, converterFor, CrsError } from "./crs";
import { bufferReader, GeoTiffError, openGeoTiff } from "./geotiff";

/**
 * Planners' own population data (06-gis §3, FR-GIS-04): a GeoTIFF grid (census grid), GeoJSON zones or points
 * with a people field, or a CSV of points (longitude and latitude columns) or of values per zone id, joined to
 * uploaded GeoJSON zones. Coordinates in any system proj4js can read: the file's own (GeoTIFF GeoKeys, the
 * legacy GeoJSON `crs` member) or the planner's PROJ string or WKT, which wins.
 */

/** A file the planner must fix; the message is shown to them. */
export class UploadError extends Error {}

export type Geometry =
  | { type: "Point"; coordinates: [number, number] }
  | { type: "Polygon"; coordinates: [number, number][][] }
  | { type: "MultiPolygon"; coordinates: [number, number][][][] };

/** One feature to store: geometry in WGS 84 degrees, people, and the zone id of a zone. */
export interface PopulationFeatureIn {
  geom: Geometry;
  people: number;
  zoneId: string | null;
}

/** What a parsed upload holds. */
export interface ParsedUpload {
  kind: "grid" | "zones" | "points";
  features: PopulationFeatureIn[];
  /** Nominal cell size of a grid, metres. */
  resolutionM: number | null;
  /** Notes for the planner (cells outside the area left out, rows skipped…). */
  notes: string[];
}

const text = (max: number) => z.string().trim().max(max);
const field = z.string().trim().min(1).max(200);

/** What the planner says about an upload. */
export const uploadMeta = z.union([
  z.strictObject({
    format: z.literal("geotiff"),
    /** People per cell (count) or per km² (density). */
    values: z.enum(["count", "density_km2"]).default("count"),
    crs: text(20_000).optional(),
    /** Keep only cells whose centre lies in the project area. */
    clipToArea: z.boolean().default(true),
  }),
  z.strictObject({
    format: z.literal("geojson"),
    peopleField: field,
    zoneField: field.optional(),
    crs: text(20_000).optional(),
  }),
  z.strictObject({
    format: z.literal("csv"),
    mode: z.literal("points"),
    lonField: field,
    latField: field,
    peopleField: field,
    crs: text(20_000).optional(),
  }),
  z.strictObject({
    format: z.literal("csv"),
    mode: z.literal("zones"),
    zoneField: field,
    peopleField: field,
    /** The project's GeoJSON zone layer the values are joined to. */
    zonesLayerId: z.uuid(),
  }),
]);
export type UploadMeta = z.infer<typeof uploadMeta>;

/** Limits of one upload. */
export interface UploadLimits {
  /** Most features (cells with people, zones or points) kept. */
  maxFeatures: number;
}

const R = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;

/** Purpose: the area of a ring of degrees on the sphere, m² (always positive). */
export function ringAreaM2(ring: [number, number][]): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const [l1, p1] = ring[i]!;
    const [l2, p2] = ring[(i + 1) % ring.length]!;
    s += rad(l2 - l1) * (2 + Math.sin(rad(p1)) + Math.sin(rad(p2)));
  }
  return Math.abs((s * R * R) / 2);
}

/** Purpose: distance between two points of degrees, metres. */
export function distanceM(a: [number, number], b: [number, number]): number {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const validLonLat = (p: [number, number]) =>
  Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;

/** Purpose: a people value from a property or a CSV cell ("1 234", "1234,5" with a semicolon CSV). */
export function peopleValue(v: unknown, decimalComma = false): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v !== "string") return null;
  let s = v.trim().replace(/[\s\u00a0\u202f']/g, "");
  if (decimalComma && s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  if (!/^[+]?\d*\.?\d+(e[+-]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// ---------------------------------------------------------------------------------------------------------
// GeoTIFF

/**
 * Purpose: the cells with people of a GeoTIFF population grid, as polygons in WGS 84.
 * Inputs: the file, the planner's choices, the project area (cells whose centre lies outside are left out
 * when clipping) and the limits. Throws UploadError with a message for the planner.
 */
export async function parseGeoTiff(
  buf: Uint8Array,
  meta: Extract<UploadMeta, { format: "geotiff" }>,
  area: Bbox | null,
  limits: UploadLimits,
): Promise<ParsedUpload> {
  let tiff;
  try {
    tiff = await openGeoTiff(bufferReader(buf));
  } catch (e) {
    if (e instanceof GeoTiffError) throw new UploadError(e.message);
    throw new UploadError("The file is not a GeoTIFF this reader can open");
  }
  let conv: Converter;
  try {
    conv = converterFor(tiff.crs.geographic ? (tiff.crs.epsg ?? 4326) : tiff.crs.epsg, meta.crs);
  } catch (e) {
    if (e instanceof CrsError) {
      // A geographic file without a code is longitude and latitude on some datum; WGS 84 is close enough.
      if (tiff.crs.geographic && !meta.crs) conv = converterFor(4326);
      else throw new UploadError(e.message);
    } else throw e;
  }
  const [a, b, c, d, e, f] = tiff.transform;
  const det = b * f - c * e;
  const toPixel = ([x, y]: [number, number]): [number, number] => [
    (f * (x - a) - c * (y - d)) / det,
    (-e * (x - a) + b * (y - d)) / det,
  ];
  const corner = (col: number, row: number): [number, number] =>
    conv.toLonLat([a + col * b + row * c, d + col * e + row * f]);
  const clip = meta.clipToArea && area ? area : null;
  // The window: the area's outline (sampled, since a projection bends it) in pixels.
  let [px0, py0, px1, py1] = [0, 0, tiff.width, tiff.height];
  if (clip) {
    let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
    const steps = 32;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      for (const p of [
        [clip[0] + t * (clip[2] - clip[0]), clip[1]],
        [clip[0] + t * (clip[2] - clip[0]), clip[3]],
        [clip[0], clip[1] + t * (clip[3] - clip[1])],
        [clip[2], clip[1] + t * (clip[3] - clip[1])],
      ] as [number, number][]) {
        const [px, py] = toPixel(conv.fromLonLat(p));
        if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
        minX = Math.min(minX, px);
        minY = Math.min(minY, py);
        maxX = Math.max(maxX, px);
        maxY = Math.max(maxY, py);
      }
    }
    px0 = Math.max(0, Math.floor(minX) - 1);
    py0 = Math.max(0, Math.floor(minY) - 1);
    px1 = Math.min(tiff.width, Math.ceil(maxX) + 1);
    py1 = Math.min(tiff.height, Math.ceil(maxY) + 1);
    if (px0 >= px1 || py0 >= py1) throw new UploadError("The grid does not overlap the project area");
  }
  const midC = Math.floor((px0 + px1) / 2);
  const midR = Math.floor((py0 + py1) / 2);
  const resolutionM = distanceM(corner(midC + 0.5, midR + 0.5), corner(midC + 1.5, midR + 0.5));
  if (!Number.isFinite(resolutionM) || resolutionM <= 0)
    throw new UploadError("The grid's coordinate system does not match its coordinates");
  const features: PopulationFeatureIn[] = [];
  let outside = 0;
  const band = 256;
  for (let ya = py0; ya < py1; ya += band) {
    const yb = Math.min(py1, ya + band);
    const vals = await tiff.window(px0, ya, px1, yb).catch((err: unknown) => {
      throw new UploadError(err instanceof Error ? err.message : "The grid cannot be read");
    });
    const w = px1 - px0;
    for (let y = ya; y < yb; y++)
      for (let x = px0; x < px1; x++) {
        const v = vals[(y - ya) * w + (x - px0)]!;
        if (!(v > 0)) continue;
        const centre = corner(x + 0.5, y + 0.5);
        if (!validLonLat(centre)) continue;
        if (
          clip &&
          (centre[0] < clip[0] || centre[0] > clip[2] || centre[1] < clip[1] || centre[1] > clip[3])
        ) {
          outside++;
          continue;
        }
        const ring = [corner(x, y), corner(x + 1, y), corner(x + 1, y + 1), corner(x, y + 1)];
        ring.push(ring[0]!);
        const people = meta.values === "density_km2" ? (v * ringAreaM2(ring)) / 1e6 : v;
        features.push({ geom: { type: "Polygon", coordinates: [ring] }, people, zoneId: null });
        if (features.length > limits.maxFeatures)
          throw new UploadError(
            `The grid has more than ${limits.maxFeatures.toLocaleString("en")} cells with people in the area; use a coarser grid or a smaller area`,
          );
      }
  }
  const notes: string[] = [];
  if (tiff.bands > 1) notes.push(`The file has ${tiff.bands} bands; the first was read.`);
  if (outside) notes.push(`${outside.toLocaleString("en")} cells outside the project area were left out.`);
  if (!features.length) throw new UploadError("The grid has no cells with people in the project area");
  return { kind: "grid", features, resolutionM, notes };
}

// ---------------------------------------------------------------------------------------------------------
// GeoJSON

/** Purpose: the EPSG code named by a legacy GeoJSON `crs` member, or null. */
function legacyCrs(json: Record<string, unknown>): number | null {
  const name = (json.crs as { properties?: { name?: unknown } } | undefined)?.properties?.name;
  if (typeof name !== "string") return null;
  if (/CRS84$/i.test(name)) return 4326;
  const m = /EPSG:{1,2}(\d+)$/i.exec(name);
  return m ? Number(m[1]) : null;
}

/**
 * Purpose: zones (polygons) or points with people from a GeoJSON file.
 * Throws UploadError when the file, its fields or its coordinates cannot be used.
 */
export function parseGeoJson(
  buf: Uint8Array,
  meta: Extract<UploadMeta, { format: "geojson" }>,
  limits: UploadLimits,
): ParsedUpload {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(new TextDecoder().decode(buf)) as Record<string, unknown>;
  } catch {
    throw new UploadError("The file is not valid JSON");
  }
  const raw: Record<string, unknown>[] =
    json?.type === "FeatureCollection" && Array.isArray(json.features)
      ? (json.features as Record<string, unknown>[])
      : json?.type === "Feature"
        ? [json]
        : [];
  if (!raw.length) throw new UploadError("The file has no GeoJSON features");
  if (raw.length > limits.maxFeatures)
    throw new UploadError(`The file has more than ${limits.maxFeatures.toLocaleString("en")} features`);
  const epsg = legacyCrs(json);
  let conv: Converter;
  try {
    conv = converterFor(epsg ?? 4326, meta.crs);
  } catch (e) {
    throw new UploadError(e instanceof Error ? e.message : String(e));
  }
  const pt = (p: unknown): [number, number] => {
    if (!Array.isArray(p) || typeof p[0] !== "number" || typeof p[1] !== "number")
      throw new UploadError("A feature has coordinates that are not numbers");
    const ll = conv.toLonLat([p[0], p[1]]);
    if (!validLonLat(ll))
      throw new UploadError(
        "Coordinates are outside longitude and latitude; give the file's coordinate system",
      );
    return ll;
  };
  const ring = (r: unknown): [number, number][] => {
    if (!Array.isArray(r) || r.length < 4) throw new UploadError("A polygon ring has fewer than 4 points");
    return r.map(pt);
  };
  const features: PopulationFeatureIn[] = [];
  let skipped = 0;
  let missingField = 0;
  let polygons = 0;
  let points = 0;
  for (const f of raw) {
    const g = f.geometry as { type?: string; coordinates?: unknown } | null;
    const props = (f.properties ?? {}) as Record<string, unknown>;
    if (!(meta.peopleField in props)) {
      missingField++;
      continue;
    }
    const people = peopleValue(props[meta.peopleField]);
    if (people === null || !g) {
      skipped++;
      continue;
    }
    const zone = meta.zoneField ? props[meta.zoneField] : undefined;
    const zoneId = zone === undefined || zone === null || zone === "" ? null : String(zone).slice(0, 200);
    let geom: Geometry;
    if (g.type === "Polygon") {
      geom = { type: "Polygon", coordinates: (g.coordinates as unknown[]).map(ring) };
      polygons++;
    } else if (g.type === "MultiPolygon") {
      geom = {
        type: "MultiPolygon",
        coordinates: (g.coordinates as unknown[][]).map((poly) => poly.map(ring)),
      };
      polygons++;
    } else if (g.type === "Point") {
      geom = { type: "Point", coordinates: pt(g.coordinates) };
      points++;
    } else {
      skipped++;
      continue;
    }
    features.push({ geom, people, zoneId });
  }
  if (missingField === raw.length) throw new UploadError(`No feature has the field "${meta.peopleField}"`);
  if (polygons && points) throw new UploadError("The file mixes zones and points; upload them as two files");
  if (!features.length)
    throw new UploadError("No feature has a people value and a point or polygon geometry");
  const notes: string[] = [];
  if (skipped)
    notes.push(`${skipped} features without a number or a point or polygon geometry were left out.`);
  if (missingField)
    notes.push(`${missingField} features without the field "${meta.peopleField}" were left out.`);
  return { kind: polygons ? "zones" : "points", features, resolutionM: null, notes };
}

// ---------------------------------------------------------------------------------------------------------
// CSV

/** Purpose: rows of a CSV file (comma, semicolon or tab, quoted fields, header first). */
export function parseCsv(textIn: string): { header: string[]; rows: string[][]; delimiter: string } {
  const text = textIn.replace(/^\ufeff/, "");
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const delimiter = [",", ";", "\t"].reduce((best, d) =>
    firstLine.split(d).length > firstLine.split(best).length ? d : best,
  );
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  const header = (rows.shift() ?? []).map((h) => h.trim());
  return { header, rows, delimiter };
}

/**
 * Purpose: points with people from a CSV file with coordinate columns.
 * Throws UploadError when a column is missing or no row can be used.
 */
export function parseCsvPoints(
  buf: Uint8Array,
  meta: Extract<UploadMeta, { format: "csv"; mode: "points" }>,
  limits: UploadLimits,
): ParsedUpload {
  const { header, rows, delimiter } = parseCsv(new TextDecoder().decode(buf));
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new UploadError(`The CSV has no column "${name}"`);
    return i;
  };
  const [ix, iy, ip] = [col(meta.lonField), col(meta.latField), col(meta.peopleField)];
  if (rows.length > limits.maxFeatures)
    throw new UploadError(`The CSV has more than ${limits.maxFeatures.toLocaleString("en")} rows`);
  let conv: Converter;
  try {
    conv = converterFor(4326, meta.crs);
  } catch (e) {
    throw new UploadError(e instanceof Error ? e.message : String(e));
  }
  const comma = delimiter !== ",";
  const features: PopulationFeatureIn[] = [];
  let skipped = 0;
  for (const r of rows) {
    const x = Number((r[ix] ?? "").trim().replace(comma ? "," : "\u0000", "."));
    const y = Number((r[iy] ?? "").trim().replace(comma ? "," : "\u0000", "."));
    const people = peopleValue(r[ip] ?? "", comma);
    if (!Number.isFinite(x) || !Number.isFinite(y) || people === null || (r[ix] ?? "").trim() === "") {
      skipped++;
      continue;
    }
    const ll = conv.toLonLat([x, y]);
    if (!validLonLat(ll)) {
      skipped++;
      continue;
    }
    features.push({ geom: { type: "Point", coordinates: ll }, people, zoneId: null });
  }
  if (!features.length) throw new UploadError("No row has coordinates and a people value that can be read");
  return {
    kind: "points",
    features,
    resolutionM: null,
    notes: skipped ? [`${skipped} rows without readable coordinates or people were left out.`] : [],
  };
}

/**
 * Purpose: people per zone id from a CSV file, to be joined to uploaded zones.
 * Output: zone id → people (repeated ids are added up) and the rows left out.
 */
export function parseCsvZones(
  buf: Uint8Array,
  meta: Extract<UploadMeta, { format: "csv"; mode: "zones" }>,
  limits: UploadLimits,
): { values: Map<string, number>; skipped: number } {
  const { header, rows, delimiter } = parseCsv(new TextDecoder().decode(buf));
  const iz = header.indexOf(meta.zoneField);
  const ip = header.indexOf(meta.peopleField);
  if (iz < 0) throw new UploadError(`The CSV has no column "${meta.zoneField}"`);
  if (ip < 0) throw new UploadError(`The CSV has no column "${meta.peopleField}"`);
  if (rows.length > limits.maxFeatures)
    throw new UploadError(`The CSV has more than ${limits.maxFeatures.toLocaleString("en")} rows`);
  const values = new Map<string, number>();
  let skipped = 0;
  for (const r of rows) {
    const id = (r[iz] ?? "").trim().slice(0, 200);
    const people = peopleValue(r[ip] ?? "", delimiter !== ",");
    if (!id || people === null) {
      skipped++;
      continue;
    }
    values.set(id, (values.get(id) ?? 0) + people);
  }
  if (!values.size) throw new UploadError("No row has a zone id and a people value that can be read");
  return { values, skipped };
}
