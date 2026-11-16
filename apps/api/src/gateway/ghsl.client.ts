import { open, rm, stat, utimes } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { type GeoTiff, GeoTiffError, openGeoTiff } from "../population/geotiff";
import { DownloadCache, fileNameOf, UpstreamStatus } from "./download-cache";
import { extractEntry, zipEntries, ZipFileError } from "./zipfile";

/**
 * GHSL population grid reader (06-gis §3, FR-GIS-04): a provider of the outbound gateway (ADR-0017).
 *
 * The Global Human Settlement Layer of the European Commission's Joint Research Centre publishes GHS-POP
 * (release R2023A): people per cell for the epochs 1975 to 2030 in steps of 5 years, on a 3-arc-second
 * (about 100 m) and a 30-arc-second (about 1 km) longitude and latitude grid (EPSG:4326). The grids come as
 * tiles of 10° × 10° (rows R1… from the north, columns C1… from 180° W), each a ZIP archive holding a
 * GeoTIFF. A tile is downloaded once into `MOBSIMLAB_DATA_DIR/ghsl`, unpacked there and read from the
 * GeoTIFF; least recently used files are deleted beyond `MOBSIMLAB_GHSL_CACHE_MB`. Tiles over open sea do not
 * exist (404) and count as nobody. The address, tile size and origin are settings, in case the JRC moves them.
 */

export const DEFAULT_GHSL_URL = "https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL";
/** Path of a tile under the base address: `{epoch}`, `{res}` (3ss or 30ss), `{row}`, `{col}`. */
export const DEFAULT_GHSL_PATH =
  "GHS_POP_GLOBE_R2023A/GHS_POP_E{epoch}_GLOBE_R2023A_4326_{res}/V1-0/tiles/GHS_POP_E{epoch}_GLOBE_R2023A_4326_{res}_V1_0_R{row}_C{col}.zip";
/** Epochs of GHS-POP R2023A. */
export const GHSL_EPOCHS = [1975, 1980, 1985, 1990, 1995, 2000, 2005, 2010, 2015, 2020, 2025, 2030] as const;
/** Grid resolutions: 3 arc seconds (about 100 m) and 30 arc seconds (about 1 km). */
export const GHSL_RESOLUTIONS = ["3ss", "30ss"] as const;
export type GhslResolution = (typeof GHSL_RESOLUTIONS)[number];
/** Nominal cell size in metres at the equator, for each resolution. */
export const GHSL_RESOLUTION_M: Record<GhslResolution, number> = { "3ss": 100, "30ss": 1000 };

/** Where the people counts come from, shown next to them (C-09). */
export const GHSL_SOURCE = {
  name: "GHSL",
  dataset: "GHS-POP R2023A, GHS population grid multitemporal (1975–2030)",
  url: "https://doi.org/10.2905/2FF68A52-5B5B-4A22-8F40-C41DA8332CFE",
  licence: "© European Union, Joint Research Centre (JRC); CC BY 4.0",
  citation:
    "Schiavina M., Freire S., Carioli A., MacManus K. (2023): GHS-POP R2023A - GHS population grid multitemporal (1975-2030). European Commission, Joint Research Centre (JRC). doi:10.2905/2FF68A52-5B5B-4A22-8F40-C41DA8332CFE",
} as const;

/** Error with an HTTP status the API can pass on (502 upstream failure, 504 timeout). */
export class GhslError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Settings, with defaults for production. */
export interface GhslOptions {
  base: string;
  path: string;
  cacheDir: string;
  /** Largest ZIP archive downloaded, bytes. */
  maxFileBytes: number;
  /** Largest GeoTIFF unpacked from an archive, bytes. */
  maxTifBytes: number;
  /** Disk kept for downloaded and unpacked files, bytes. */
  maxCacheBytes: number;
  /** Tile size, degrees, and the north-west corner of tile R1 C1. */
  tileDeg: number;
  originLon: number;
  originLat: number;
  timeoutMs: number;
  downloadTimeoutMs: number;
  backoffMs: number[];
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
}

/** Purpose: the settings from the environment (`MOBSIMLAB_GHSL_*`, `MOBSIMLAB_DATA_DIR`). */
export function ghslSettings(
  env: NodeJS.ProcessEnv = process.env,
): Pick<
  GhslOptions,
  | "base"
  | "path"
  | "cacheDir"
  | "maxFileBytes"
  | "maxTifBytes"
  | "maxCacheBytes"
  | "tileDeg"
  | "originLon"
  | "originLat"
> {
  const mb = (v: string | undefined, dflt: number) =>
    z.coerce
      .number()
      .int()
      .min(1)
      .max(1_000_000)
      .parse(v || dflt) *
    1024 *
    1024;
  const num = (v: string | undefined, dflt: number, min: number, max: number) =>
    z.coerce
      .number()
      .min(min)
      .max(max)
      .parse(v || dflt);
  const path = env.MOBSIMLAB_GHSL_PATH?.trim() || DEFAULT_GHSL_PATH;
  if (!["{epoch}", "{res}", "{row}", "{col}"].every((k) => path.includes(k)) || path.includes(".."))
    throw new Error("MOBSIMLAB_GHSL_PATH must contain {epoch}, {res}, {row} and {col}");
  return {
    base: env.MOBSIMLAB_GHSL_URL
      ? z
          .url({ protocol: /^https$/ })
          .parse(env.MOBSIMLAB_GHSL_URL)
          .replace(/\/+$/, "")
      : DEFAULT_GHSL_URL,
    path,
    cacheDir: join(env.MOBSIMLAB_DATA_DIR || "/data", "ghsl"),
    maxFileBytes: mb(env.MOBSIMLAB_GHSL_MAX_FILE_MB, 1_000),
    maxTifBytes: mb(env.MOBSIMLAB_GHSL_MAX_TIF_MB, 2_000),
    maxCacheBytes: mb(env.MOBSIMLAB_GHSL_CACHE_MB, 6_000),
    tileDeg: num(env.MOBSIMLAB_GHSL_TILE_DEG, 10, 0.1, 180),
    originLon: num(env.MOBSIMLAB_GHSL_ORIGIN_LON, -180, -180, 180),
    originLat: num(env.MOBSIMLAB_GHSL_ORIGIN_LAT, 90, -90, 90),
  };
}

/** One tile of the grid: row and column from 1. */
export interface GhslTile {
  row: number;
  col: number;
}

/** Purpose: the tiles a box `[west, south, east, north]` touches, with the tile size and origin of `o`. */
export function tilesFor(
  bbox: [number, number, number, number],
  o: Pick<GhslOptions, "tileDeg" | "originLon" | "originLat">,
): GhslTile[] {
  const eps = 1e-9;
  const c0 = Math.floor((bbox[0] - o.originLon) / o.tileDeg + eps) + 1;
  const c1 = Math.floor((bbox[2] - o.originLon) / o.tileDeg - eps) + 1;
  const r0 = Math.floor((o.originLat - bbox[3]) / o.tileDeg + eps) + 1;
  const r1 = Math.floor((o.originLat - bbox[1]) / o.tileDeg - eps) + 1;
  const out: GhslTile[] = [];
  for (let row = Math.max(1, r0); row <= r1; row++)
    for (let col = Math.max(1, c0); col <= c1; col++) out.push({ row, col });
  return out;
}

/** Purpose: the address of a tile's ZIP archive. */
export function tileUrl(
  o: Pick<GhslOptions, "base" | "path">,
  epoch: number,
  res: GhslResolution,
  t: GhslTile,
) {
  const path = o.path
    .replaceAll("{epoch}", String(epoch))
    .replaceAll("{res}", res)
    .replaceAll("{row}", String(t.row))
    .replaceAll("{col}", String(t.col));
  return `${o.base}/${path}`;
}

/** Purpose: the epoch nearest a year. */
export function nearestEpoch(year: number): number {
  return GHSL_EPOCHS.reduce(
    (best, e) => (Math.abs(e - year) < Math.abs(best - year) ? e : best),
    GHSL_EPOCHS[0],
  );
}

/** A grid cell with people: its box in degrees and the people in it. */
export type CellSink = (west: number, south: number, east: number, north: number, people: number) => void;

export class GhslClient {
  private readonly o: GhslOptions;
  private readonly cache: DownloadCache;
  private readonly opened = new Map<string, Promise<string | null>>();

  constructor(options: Partial<GhslOptions> = {}) {
    this.o = {
      ...ghslSettings(),
      timeoutMs: 30_000,
      downloadTimeoutMs: 30 * 60_000,
      backoffMs: [1_000, 3_000],
      fetchImpl: (...a) => fetch(...a),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      ...options,
    };
    this.cache = new DownloadCache({
      ...this.o,
      label: "GHSL",
      error: (m, status) => new GhslError(m, status),
      onEvict: (name) => {
        for (const k of [...this.opened.keys()])
          if (k.startsWith(name.replace(/\.(zip|tif)$/, ""))) this.opened.delete(k);
      },
    });
  }

  /** Purpose: the settings in use (tile size and origin), for the import's notes. */
  get settings(): Readonly<GhslOptions> {
    return this.o;
  }

  /**
   * Purpose: how far the download of the tiles of a box is, summed; null when none is under way.
   */
  progress(urls: string[]): { receivedBytes: number; totalBytes: number | null } | null {
    const each = urls.map((u) => this.cache.progress(u)).filter((p) => !!p);
    if (!each.length) return null;
    return {
      receivedBytes: each.reduce((a, p) => a + p.receivedBytes, 0),
      totalBytes: each.some((p) => p.totalBytes === null)
        ? null
        : each.reduce((a, p) => a + p.totalBytes!, 0),
    };
  }

  /**
   * Purpose: the path of a tile's GeoTIFF, downloaded and unpacked once. Output: null when the tile does not
   * exist (sea). Side effects: may download the tile's archive (tens to hundreds of MB), unpack it and delete
   * the archive.
   */
  tile(epoch: number, res: GhslResolution, t: GhslTile): Promise<string | null> {
    const url = tileUrl(this.o, epoch, res, t);
    const base = fileNameOf(url).replace(/\.zip$/i, "");
    let p = this.opened.get(base);
    if (!p) {
      p = (async () => {
        const tif = join(this.o.cacheDir, `${base}.tif`);
        if (!(await stat(tif).catch(() => null))) {
          const { path: zip, present } = await this.cache.cached(url);
          if (!present) {
            try {
              await this.cache.download(url, zip, [404]);
            } catch (e) {
              if (e instanceof UpstreamStatus) return null;
              throw e;
            }
          }
          try {
            const entry = (await zipEntries(zip)).find((e) => /\.tiff?$/i.test(e.name));
            if (!entry) throw new GhslError("The GHSL archive holds no GeoTIFF", 502);
            await this.cache.makeRoom(entry.size);
            await extractEntry(zip, entry, tif, this.o.maxTifBytes);
          } catch (e) {
            if (e instanceof ZipFileError)
              throw new GhslError(`The GHSL archive cannot be read: ${e.message}`, 502);
            throw e;
          } finally {
            await rm(zip, { force: true });
          }
        }
        return tif;
      })();
      p.catch(() => this.opened.delete(base));
      this.opened.set(base, p);
    }
    return p;
  }

  /** Purpose: the archive addresses of the tiles over a box. */
  urls(bbox: [number, number, number, number], epoch: number, res: GhslResolution): string[] {
    return tilesFor(bbox, this.o).map((t) => tileUrl(this.o, epoch, res, t));
  }

  /**
   * Purpose: every cell with people in a box `[west, south, east, north]`, passed to `sink`.
   * Output: the tiles read (`R4_C19`…) and those that do not exist. Throws GhslError when a tile is not a
   * longitude and latitude grid or does not lie where the tile settings say.
   */
  async read(
    bbox: [number, number, number, number],
    epoch: number,
    res: GhslResolution,
    sink: CellSink,
  ): Promise<{ tiles: string[]; missing: string[] }> {
    const tiles: string[] = [];
    const missing: string[] = [];
    for (const t of tilesFor(bbox, this.o)) {
      const name = `R${t.row}_C${t.col}`;
      const path = await this.tile(epoch, res, t);
      if (!path) {
        missing.push(name);
        continue;
      }
      tiles.push(name);
      await utimes(path, new Date(), new Date()).catch(() => undefined);
      const fh = await open(path, "r");
      try {
        await this.readTile(fh, name, t, bbox, sink);
      } finally {
        await fh.close();
      }
    }
    return { tiles, missing };
  }

  private async readTile(
    fh: Awaited<ReturnType<typeof open>>,
    name: string,
    t: GhslTile,
    bbox: [number, number, number, number],
    sink: CellSink,
  ): Promise<void> {
    {
      let g: GeoTiff;
      try {
        g = await openGeoTiff(async (offset, len) => {
          const buf = new Uint8Array(len);
          const { bytesRead } = await fh.read(buf, 0, len, offset);
          if (bytesRead < len) throw new GeoTiffError("The GHSL file is truncated");
          return buf;
        });
      } catch (e) {
        if (e instanceof GeoTiffError) throw new GhslError(`The GHSL file cannot be read: ${e.message}`, 502);
        throw e;
      }
      const [x0, dx, rx, y0, ry, dy] = g.transform;
      if (
        rx !== 0 ||
        ry !== 0 ||
        dy >= 0 ||
        (g.crs.epsg !== null && g.crs.epsg !== 4326 && !g.crs.geographic)
      )
        throw new GhslError(`The GHSL tile ${name} is not a north-up longitude and latitude grid`, 502);
      // The tile must hold its own centre, or the tile settings do not match the files.
      const cLon = this.o.originLon + (t.col - 0.5) * this.o.tileDeg;
      const cLat = this.o.originLat - (t.row - 0.5) * this.o.tileDeg;
      const cx = (cLon - x0) / dx;
      const cy = (cLat - y0) / dy;
      if (cx < 0 || cx > g.width || cy < 0 || cy > g.height)
        throw new GhslError(
          `The GHSL tile ${name} does not cover ${cLon.toFixed(1)}°, ${cLat.toFixed(1)}°; check the GHSL tile settings`,
          502,
        );
      const cx0 = Math.floor((bbox[0] - x0) / dx);
      const cx1 = Math.ceil((bbox[2] - x0) / dx);
      const cy0 = Math.floor((bbox[3] - y0) / dy);
      const cy1 = Math.ceil((bbox[1] - y0) / dy);
      // Read in bands of rows so a large area never holds a whole tile in memory.
      const band = 256;
      const xa = Math.max(0, cx0);
      const xb = Math.min(g.width, cx1);
      for (let ya = Math.max(0, cy0); ya < Math.min(g.height, cy1); ya += band) {
        const yb = Math.min(ya + band, g.height, cy1);
        const vals = await g.window(xa, ya, xb, yb);
        const w = xb - xa;
        for (let y = ya; y < yb; y++)
          for (let x = xa; x < xb; x++) {
            const v = vals[(y - ya) * w + (x - xa)]!;
            if (!(v > 0)) continue;
            sink(x0 + x * dx, y0 + (y + 1) * dy, x0 + (x + 1) * dx, y0 + y * dy, v);
          }
      }
    }
  }
}
