import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type OverpassClient, OverpassError } from "../gateway/overpass.client";
import type { Box } from "./osm-tools";

/**
 * The Overpass path of the OpenStreetMap import (06-gis §2.1 and §2.3): the area is split into square tiles,
 * each tile is fetched as OSM XML (nodes, ways, multipolygon and turn-restriction relations, as Spike S3 settled),
 * answers are cached on the data volume, and a tile that times out or is too large is split into four.
 */

const KM_PER_DEG = 111.32;

/**
 * Purpose: Overpass QL for everything in a box that the import keeps. Other relations (routes, boundaries)
 * are left out: recursing into their members pulls in ways far outside the box (Spike S3).
 */
export function areaQuery(b: Box, timeoutS: number, maxBytes: number): string {
  const s = [b[1], b[0], b[3], b[2]].map((v) => v.toFixed(7)).join(",");
  return (
    `[out:xml][timeout:${timeoutS}][maxsize:${maxBytes}];` +
    `(node(${s});way(${s});rel(${s})["type"~"^(multipolygon|restriction)$"];);(._;>;);out body;`
  );
}

/** Purpose: split a box into tiles of about `km` a side (at least one tile). */
export function splitBox(b: Box, km: number): Box[] {
  const midLat = ((b[1] + b[3]) / 2) * (Math.PI / 180);
  const dLat = km / KM_PER_DEG;
  const dLon = km / (KM_PER_DEG * Math.max(0.01, Math.cos(midLat)));
  const nx = Math.max(1, Math.ceil((b[2] - b[0]) / dLon - 1e-9));
  const ny = Math.max(1, Math.ceil((b[3] - b[1]) / dLat - 1e-9));
  const out: Box[] = [];
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++)
      out.push([
        b[0] + ((b[2] - b[0]) * i) / nx,
        b[1] + ((b[3] - b[1]) * j) / ny,
        b[0] + ((b[2] - b[0]) * (i + 1)) / nx,
        b[1] + ((b[3] - b[1]) * (j + 1)) / ny,
      ]);
  return out;
}

/** Purpose: the four quarters of a box. */
export function quarters(b: Box): Box[] {
  const mx = (b[0] + b[2]) / 2;
  const my = (b[1] + b[3]) / 2;
  return [
    [b[0], b[1], mx, my],
    [mx, b[1], b[2], my],
    [b[0], my, mx, b[3]],
    [mx, my, b[2], b[3]],
  ];
}

/** Purpose: side of a box in km (the longer side). */
function sideKm(b: Box): number {
  const lat = ((b[1] + b[3]) / 2) * (Math.PI / 180);
  return Math.max((b[2] - b[0]) * KM_PER_DEG * Math.cos(lat), (b[3] - b[1]) * KM_PER_DEG);
}

/** Purpose: the `osm_base` timestamp in an Overpass XML answer, or null. */
export function osmBase(xml: string): string | null {
  return xml.slice(0, 2_000).match(/<meta\s+osm_base="([^"]+)"/)?.[1] ?? null;
}

/** Purpose: whether an Overpass answer reports that the query failed (timeout or memory) inside a 200. */
export function runtimeError(xml: string): string | null {
  const m = xml.slice(0, 20_000).match(/<remark>\s*(runtime error[^<]*)<\/remark>/);
  return m ? m[1]!.trim() : null;
}

export interface OverpassFetchOptions {
  tileKm: number;
  minTileKm: number;
  queryTimeoutS: number;
  maxBytes: number;
  cacheDir: string;
  cacheDays: number;
  endpoint: string;
  /** Called after each tile with the tiles done and the tiles known so far. */
  progress?: (done: number, total: number) => void | Promise<void>;
  /** Checked between tiles; throwing stops the fetch (cancelled import). */
  checkCancelled?: () => void | Promise<void>;
}

export interface OverpassFetchResult {
  /** One OSM XML file per tile, in the work folder. */
  files: string[];
  /** Oldest `osm_base` of the answers (the data is at least this recent). */
  dataTimestamp: string | null;
  tiles: number;
  bytes: number;
  cachedTiles: number;
}

/**
 * Purpose: fetch a box from Overpass tile by tile into `workDir`.
 * Side effects: Overpass requests (spaced by the client), files in `workDir` and the cache folder.
 * Throws OverpassError when a tile still fails at the smallest size, or another request error.
 */
export async function fetchArea(
  client: OverpassClient,
  box: Box,
  workDir: string,
  o: OverpassFetchOptions,
): Promise<OverpassFetchResult> {
  await mkdir(workDir, { recursive: true });
  await mkdir(o.cacheDir, { recursive: true });
  const queue = splitBox(box, o.tileKm);
  let total = queue.length;
  let done = 0;
  let bytes = 0;
  let cachedTiles = 0;
  const files: string[] = [];
  const stamps: string[] = [];
  while (queue.length) {
    await o.checkCancelled?.();
    const b = queue.shift()!;
    const query = areaQuery(b, o.queryTimeoutS, o.maxBytes);
    const key = createHash("sha256").update(`${o.endpoint}\n${query}`).digest("hex");
    const cached = join(o.cacheDir, `${key}.osm`);
    let xml: string | null = null;
    try {
      const st = await stat(cached);
      if (Date.now() - st.mtimeMs < o.cacheDays * 86_400_000) {
        xml = await readFile(cached, "utf8");
        cachedTiles++;
      }
    } catch {
      // not cached
    }
    if (xml === null) {
      let failure: string | null;
      try {
        xml = await client.run(query);
        failure = runtimeError(xml);
      } catch (e) {
        const tooBig = e instanceof OverpassError && (e.status === 504 || /too large/.test(e.message));
        if (!tooBig) throw e;
        failure = e.message;
      }
      if (failure) {
        if (sideKm(b) / 2 < o.minTileKm)
          throw new OverpassError(
            `Overpass could not answer a ${sideKm(b).toFixed(1)} km tile: ${failure}`,
            502,
          );
        queue.unshift(...quarters(b));
        total += 3;
        continue;
      }
      await writeFile(cached, xml!);
    }
    const file = join(workDir, `tile-${files.length}.osm`);
    await writeFile(file, xml!);
    files.push(file);
    bytes += Buffer.byteLength(xml!);
    const stamp = osmBase(xml!);
    if (stamp) stamps.push(stamp);
    done++;
    await o.progress?.(done, total);
  }
  stamps.sort();
  return { files, dataTimestamp: stamps[0] ?? null, tiles: done, bytes, cachedTiles };
}
