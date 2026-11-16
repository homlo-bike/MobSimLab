import type { DemWindow } from "../gateway/copernicus-dem.client";
import { type Converter, converterFor, CrsError } from "../population/crs";
import { type ByteReader, GeoTiffError, openGeoTiff } from "../population/geotiff";
import type { Box } from "./osm-tools";

/**
 * The planner's own elevation grid (06-gis §4, ADR-0045): a GeoTIFF in any coordinate system (read with the
 * population import's GeoTIFF reader and proj4 converter), resampled bilinearly to a longitude and latitude grid
 * over the project area at about the file's own resolution, then stored like the GLO-30 tiles with a higher
 * priority, so it wins wherever it has a height.
 */

/** A problem with the planner's file; the message is shown to the planner. */
export class DemUploadError extends Error {}

export interface ResampledDem {
  window: DemWindow;
  /** Pixel size of the stored grid, metres (about the file's own, coarser when the area held too many cells). */
  resolutionM: number;
  /** Pixel size of the file, metres. */
  fileResolutionM: number;
  /** Cells of the stored grid with a height. */
  cellsWithData: number;
  /** The file's coordinate system, as the record names it. */
  crs: string;
  notes: string[];
}

const M_PER_DEG = 111_320;

/**
 * Purpose: read a planner's elevation GeoTIFF over the project area and resample it to a WGS 84 grid.
 * Inputs: the file's bytes, the project area, the planner's own coordinate system text (PROJ, WKT or EPSG:n; it
 * wins over the file's), and the most cells to read or write. Values are taken as metres; no-data stays empty.
 * Throws DemUploadError with a message for the planner.
 */
export async function resampleDem(
  read: ByteReader,
  area: Box,
  o: { crs?: string | null; maxCells: number },
): Promise<ResampledDem> {
  let tiff;
  try {
    tiff = await openGeoTiff(read);
  } catch (e) {
    if (e instanceof GeoTiffError) throw new DemUploadError(e.message);
    throw new DemUploadError("The file is not a GeoTIFF this reader can open");
  }
  let conv: Converter;
  try {
    conv = converterFor(tiff.crs.geographic ? (tiff.crs.epsg ?? 4326) : tiff.crs.epsg, o.crs);
  } catch (e) {
    if (!(e instanceof CrsError)) throw e;
    // A geographic file without a code is longitude and latitude on some datum; WGS 84 is close enough.
    if (tiff.crs.geographic && !o.crs?.trim()) conv = converterFor(4326);
    else throw new DemUploadError(e.message);
  }
  const crs = o.crs?.trim()
    ? o.crs.trim().slice(0, 200)
    : tiff.crs.epsg
      ? `EPSG:${tiff.crs.epsg}`
      : (tiff.crs.citation ?? "WGS 84");

  const [a, b, c, d, e, f] = tiff.transform;
  const det = b * f - c * e;
  if (!Number.isFinite(det) || det === 0) throw new DemUploadError("The file has no usable georeference");
  // Pixel coordinates measured from pixel corners (0.5 is the first pixel's centre).
  const toPixel = ([x, y]: [number, number]): [number, number] => [
    (f * (x - a) - c * (y - d)) / det,
    (-e * (x - a) + b * (y - d)) / det,
  ];
  const toLonLat = (col: number, row: number) =>
    conv.toLonLat([a + col * b + row * c, d + col * e + row * f]);

  // The source window: the area's outline, sampled because a projection bends it, in pixels.
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  const steps = 32;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const lon = area[0] + t * (area[2] - area[0]);
    const lat = area[1] + t * (area[3] - area[1]);
    for (const p of [
      [lon, area[1]],
      [lon, area[3]],
      [area[0], lat],
      [area[2], lat],
    ] as [number, number][]) {
      const [px, py] = toPixel(conv.fromLonLat(p));
      if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
      minX = Math.min(minX, px);
      minY = Math.min(minY, py);
      maxX = Math.max(maxX, px);
      maxY = Math.max(maxY, py);
    }
  }
  const px0 = Math.max(0, Math.floor(minX) - 1);
  const py0 = Math.max(0, Math.floor(minY) - 1);
  const px1 = Math.min(tiff.width, Math.ceil(maxX) + 1);
  const py1 = Math.min(tiff.height, Math.ceil(maxY) + 1);
  if (!(px0 < px1 && py0 < py1)) throw new DemUploadError("The grid does not overlap the project area");
  const sw = px1 - px0;
  const sh = py1 - py0;
  if (sw * sh > o.maxCells)
    throw new DemUploadError(
      `The grid has ${(sw * sh).toLocaleString("en")} cells over the project area, more than the ${o.maxCells.toLocaleString("en")} an upload may hold; use a coarser grid or a smaller area`,
    );

  const src = new Float32Array(sw * sh);
  const band = 256;
  for (let ya = py0; ya < py1; ya += band) {
    const yb = Math.min(py1, ya + band);
    const vals = await tiff.window(px0, ya, px1, yb).catch((err: unknown) => {
      throw new DemUploadError(err instanceof Error ? err.message : "The grid cannot be read");
    });
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i]!;
      // Heights outside what the Earth has are no data written as a number (such as -32767 without a tag).
      src[(ya - py0) * sw + i] = Number.isFinite(v) && v > -1000 && v < 9000 ? v : NaN;
    }
  }

  // The file's pixel size in metres at the middle of the window.
  const mc = px0 + Math.floor(sw / 2);
  const mr = py0 + Math.floor(sh / 2);
  const p0 = toLonLat(mc + 0.5, mr + 0.5);
  const px = toLonLat(mc + 1.5, mr + 0.5);
  const py = toLonLat(mc + 0.5, mr + 1.5);
  const cosMid = Math.cos((p0[1] * Math.PI) / 180);
  const metres = (q: [number, number]) =>
    Math.hypot((q[0] - p0[0]) * M_PER_DEG * cosMid, (q[1] - p0[1]) * M_PER_DEG);
  const fileResolutionM = Math.min(metres(px), metres(py));
  if (!Number.isFinite(fileResolutionM) || fileResolutionM <= 0)
    throw new DemUploadError("The grid's coordinate system does not match its coordinates");

  // The stored grid: the project area at about the file's resolution, coarser when that holds too many cells.
  let resolutionM = fileResolutionM;
  const notes: string[] = [];
  const cellsAt = (r: number) => {
    const sLat = r / M_PER_DEG;
    const sLon = sLat / Math.max(0.01, Math.cos((((area[1] + area[3]) / 2) * Math.PI) / 180));
    return {
      stepLat: sLat,
      stepLon: sLon,
      width: Math.max(1, Math.ceil((area[2] - area[0]) / sLon)),
      height: Math.max(1, Math.ceil((area[3] - area[1]) / sLat)),
    };
  };
  let g = cellsAt(resolutionM);
  if (g.width * g.height > o.maxCells) {
    resolutionM *= Math.sqrt((g.width * g.height) / o.maxCells);
    g = cellsAt(resolutionM);
    // Whole cells round up; widen a little more until the grid fits.
    while (g.width * g.height > o.maxCells) g = cellsAt((resolutionM *= 1.02));
    notes.push(
      `The grid was stored at ${Math.round(resolutionM)} m instead of ${Math.round(fileResolutionM * 10) / 10} m to stay within ${o.maxCells.toLocaleString("en")} cells.`,
    );
  }
  if (tiff.bands > 1) notes.push(`The file has ${tiff.bands} bands; the first was read.`);

  const originLon = area[0] + g.stepLon / 2;
  const originLat = area[3] - g.stepLat / 2;
  const values = new Float32Array(g.width * g.height).fill(NaN);
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= sw || y >= sh ? NaN : src[y * sw + x]!);
  let cellsWithData = 0;
  for (let y = 0; y < g.height; y++) {
    const lat = originLat - y * g.stepLat;
    for (let x = 0; x < g.width; x++) {
      const lon = originLon + x * g.stepLon;
      const [cx, cy] = toPixel(conv.fromLonLat([lon, lat]));
      // Position between pixel centres of the window.
      const fx = cx - 0.5 - px0;
      const fy = cy - 0.5 - py0;
      if (!(fx > -0.5 && fy > -0.5 && fx < sw - 0.5 && fy < sh - 0.5)) continue;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      let sum = 0;
      let wsum = 0;
      for (const [v, w] of [
        [at(x0, y0), (1 - tx) * (1 - ty)],
        [at(x0 + 1, y0), tx * (1 - ty)],
        [at(x0, y0 + 1), (1 - tx) * ty],
        [at(x0 + 1, y0 + 1), tx * ty],
      ] as Array<[number, number]>) {
        if (!Number.isNaN(v) && w > 0) {
          sum += v * w;
          wsum += w;
        }
      }
      if (wsum > 0) {
        values[y * g.width + x] = sum / wsum;
        cellsWithData++;
      }
    }
  }
  if (!cellsWithData) throw new DemUploadError("The grid has no heights inside the project area");
  return {
    window: {
      width: g.width,
      height: g.height,
      originLon,
      originLat,
      stepLon: g.stepLon,
      stepLat: g.stepLat,
      values,
    },
    resolutionM,
    fileResolutionM,
    cellsWithData,
    crs,
    notes,
  };
}
