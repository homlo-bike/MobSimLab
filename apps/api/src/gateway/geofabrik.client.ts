import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

/**
 * Geofabrik extracts (06-gis §2.1, PBF path): the region index and the `.osm.pbf` downloads, through the outbound
 * gateway's rules (https only, identifying User-Agent, timeouts, size limits, no redirects off the server).
 * Files are kept on the data volume and reused for `cacheDays`. Data © OpenStreetMap contributors, ODbL.
 */

const USER_AGENT = "MobSimLab/0.1 (+https://github.com/homlo-bike/MobSimLab)";
const INDEX_MAX_BYTES = 64 * 1024 * 1024;
const INDEX_MAX_AGE_MS = 24 * 3600 * 1000;

export class GeofabrikError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** One region a planner can pick, smallest first. */
export interface GeofabrikRegion {
  id: string;
  name: string;
  parent: string | null;
  pbfUrl: string;
  /** Area of the region's bounding box, km², to show which is smallest. */
  bboxKm2: number;
}

type Ring = [number, number][];
interface IndexFeature {
  properties: { id: string; name: string; parent?: string; urls?: { pbf?: string } };
  geometry: { type: "Polygon"; coordinates: Ring[] } | { type: "MultiPolygon"; coordinates: Ring[][] } | null;
}

/** Purpose: whether a point is inside a ring (even-odd). */
function inRing(r: Ring, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i]!;
    const [xj, yj] = r[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Purpose: whether a point is inside a (multi)polygon with holes. */
function inGeometry(g: NonNullable<IndexFeature["geometry"]>, x: number, y: number): boolean {
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  return polys.some(
    (rings) => rings.length > 0 && inRing(rings[0]!, x, y) && !rings.slice(1).some((h) => inRing(h, x, y)),
  );
}

/**
 * Purpose: the regions of a Geofabrik index that hold a whole box, smallest first.
 * Inputs: the parsed index, `[west, south, east, north]`. The box counts as held when its corners, its centre
 * and the middles of its sides are all inside the region.
 */
export function regionsHolding(
  index: { features?: IndexFeature[] },
  b: [number, number, number, number],
): GeofabrikRegion[] {
  const [w, s, e, n] = b;
  const mx = (w + e) / 2;
  const my = (s + n) / 2;
  const probes: [number, number][] = [
    [w, s],
    [e, s],
    [e, n],
    [w, n],
    [mx, my],
    [mx, s],
    [mx, n],
    [w, my],
    [e, my],
  ];
  const out: GeofabrikRegion[] = [];
  for (const f of index.features ?? []) {
    const g = f.geometry;
    const pbf = f.properties?.urls?.pbf;
    if (!g || !pbf || !probes.every(([x, y]) => inGeometry(g, x, y))) continue;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    for (const p of polys)
      for (const [x, y] of p[0] ?? []) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    const lat = (((minY + maxY) / 2) * Math.PI) / 180;
    out.push({
      id: f.properties.id,
      name: f.properties.name,
      parent: f.properties.parent ?? null,
      pbfUrl: pbf,
      bboxKm2: Math.round((maxX - minX) * 111.32 * Math.cos(lat) * (maxY - minY) * 111.32),
    });
  }
  return out.sort((a, b2) => a.bboxKm2 - b2.bboxKm2);
}

export interface GeofabrikOptions {
  baseUrl: string;
  dir: string;
  cacheDays: number;
  maxBytes: number;
  timeoutMs: number;
  fetchImpl: typeof fetch;
}

export class GeofabrikClient {
  private index: Promise<{ features?: IndexFeature[] }> | null = null;
  private indexAt = 0;

  constructor(private readonly o: GeofabrikOptions) {}

  /** Purpose: the regions holding a box, smallest first. Side effects: fetches the index at most daily. */
  async regions(b: [number, number, number, number]): Promise<GeofabrikRegion[]> {
    return regionsHolding(await this.loadIndex(), b);
  }

  /** Purpose: one region by id, or null. */
  async region(id: string): Promise<GeofabrikRegion | null> {
    const idx = await this.loadIndex();
    const f = (idx.features ?? []).find((x) => x.properties?.id === id);
    if (!f?.properties.urls?.pbf) return null;
    return {
      id,
      name: f.properties.name,
      parent: f.properties.parent ?? null,
      pbfUrl: f.properties.urls.pbf,
      bboxKm2: 0,
    };
  }

  /**
   * Purpose: the region's `.osm.pbf` on the data volume, downloaded when missing or older than `cacheDays`.
   * Output: the file path. Side effects: one streamed download of at most `maxBytes`.
   */
  async download(
    region: GeofabrikRegion,
    progress?: (bytes: number, total: number | null) => void,
  ): Promise<string> {
    if (!region.pbfUrl.startsWith(`${this.o.baseUrl}/`))
      throw new GeofabrikError("The region's download is not on the Geofabrik server", 400);
    const file = join(this.o.dir, `${region.id.replace(/[^a-z0-9_-]/gi, "_")}.osm.pbf`);
    try {
      const st = await stat(file);
      if (Date.now() - st.mtimeMs < this.o.cacheDays * 86_400_000) return file;
    } catch {
      // not downloaded yet
    }
    await mkdir(this.o.dir, { recursive: true });
    const res = await this.get(region.pbfUrl, 6 * 3600 * 1000);
    const declared = Number(res.headers.get("content-length") ?? 0) || null;
    if (declared && declared > this.o.maxBytes)
      throw new GeofabrikError(
        `${region.name} is ${Math.round(declared / 1e6)} MB, more than the ${Math.round(this.o.maxBytes / 1e6)} MB limit`,
        413,
      );
    const part = `${file}.part`;
    let bytes = 0;
    const max = this.o.maxBytes;
    const count = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        bytes += chunk.length;
        if (bytes > max) return cb(new GeofabrikError("The download is larger than the limit", 413));
        progress?.(bytes, declared);
        cb(null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(res.body as WebReadableStream), count, createWriteStream(part));
      await rename(part, file);
    } catch (e) {
      await rm(part, { force: true });
      throw e instanceof GeofabrikError
        ? e
        : new GeofabrikError(`Download failed: ${(e as Error).message}`, 502);
    }
    return file;
  }

  private loadIndex(): Promise<{ features?: IndexFeature[] }> {
    if (this.index && Date.now() - this.indexAt < INDEX_MAX_AGE_MS) return this.index;
    this.indexAt = Date.now();
    this.index = this.readIndex();
    this.index.catch(() => {
      this.index = null;
    });
    return this.index;
  }

  private async readIndex(): Promise<{ features?: IndexFeature[] }> {
    const file = join(this.o.dir, "index-v1.json");
    try {
      const st = await stat(file);
      if (Date.now() - st.mtimeMs < INDEX_MAX_AGE_MS) return JSON.parse(await readFile(file, "utf8"));
    } catch {
      // fetch it
    }
    const res = await this.get(`${this.o.baseUrl}/index-v1.json`, 120_000);
    const text = await res.text();
    if (text.length > INDEX_MAX_BYTES) throw new GeofabrikError("The Geofabrik index is too large", 502);
    const parsed = JSON.parse(text) as { features?: IndexFeature[] };
    await mkdir(this.o.dir, { recursive: true });
    await writeFile(file, text);
    return parsed;
  }

  private async get(url: string, timeoutMs: number): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.max(timeoutMs, this.o.timeoutMs));
    timer.unref();
    try {
      const res = await this.o.fetchImpl(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: ctrl.signal,
        redirect: "error",
      });
      if (!res.ok || !res.body) throw new GeofabrikError(`Geofabrik answered ${res.status}`, 502);
      return res;
    } catch (e) {
      if (e instanceof GeofabrikError) throw e;
      throw new GeofabrikError(
        ctrl.signal.aborted
          ? "Geofabrik did not answer in time"
          : `Geofabrik is unreachable: ${(e as Error).message}`,
        ctrl.signal.aborted ? 504 : 502,
      );
    } finally {
      // The body of a download is read after `get` returns; keep the timer for small requests only.
      if (timeoutMs <= 120_000) clearTimeout(timer);
    }
  }
}
