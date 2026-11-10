import { createWriteStream } from "node:fs";
import { mkdir, open, readdir, rename, rm, stat, utimes } from "node:fs/promises";
import { basename, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";

/**
 * WorldPop population grid reader (ADR-0038 step N2, population exposure): a provider of the
 * outbound gateway (ADR-0017).
 *
 * WorldPop publishes one GeoTIFF per country and year: the constrained 100 m estimates of release
 * R2025A (people per 3-arc-second cell, float32, LZW with the horizontal predictor, 512×512 tiles,
 * image directory at the end of the file). Its file server does not answer byte ranges, so a
 * country's file is downloaded once into the data directory (`MOBSIMLAB_DATA_DIR/worldpop`, the
 * `/data` volume) and read from there; least recently used files are deleted beyond
 * `MOBSIMLAB_WORLDPOP_CACHE_MB`. The catalogue (which file holds which country and year) comes
 * from WorldPop's REST API. Same outbound rules as the other clients: https only, identifying
 * User-Agent, timeouts, size limits, retries with backoff on 429/5xx and timeouts.
 */

export const DEFAULT_WORLDPOP_API = "https://hub.worldpop.org/rest/data/pop";
/** The WorldPop dataset used: constrained estimates 2015–2030, 100 m, release R2025A. */
export const WORLDPOP_ALIAS = "G2_CN_POP_R25A_100m";
/** Files are only fetched from WorldPop's file server. */
const FILE_HOST = "data.worldpop.org";
const USER_AGENT = "MobSimLab/0.1 (+https://github.com/homlo-bike/MobSimLab)";
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
/** WorldPop's 3-arc-second lattice, degrees. */
export const CELL_DEG = 1 / 1200;

/** Settings, with defaults for production. */
export interface WorldPopOptions {
  api: string;
  cacheDir: string;
  /** Largest country file downloaded, bytes (the United States are about 1.5 GB). */
  maxFileBytes: number;
  /** Disk kept for downloaded files, bytes. */
  maxCacheBytes: number;
  timeoutMs: number;
  downloadTimeoutMs: number;
  backoffMs: number[];
  tileCacheSize: number;
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
}

/** Error with an HTTP status the API can pass on (502 upstream failure, 504 timeout). */
export class WorldPopError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Purpose: the settings from the environment (`MOBSIMLAB_WORLDPOP_*`, `MOBSIMLAB_DATA_DIR`). */
export function worldPopSettings(
  env: NodeJS.ProcessEnv = process.env,
): Pick<WorldPopOptions, "api" | "cacheDir" | "maxFileBytes" | "maxCacheBytes"> {
  const mb = (v: string | undefined, dflt: number) =>
    z.coerce
      .number()
      .int()
      .min(1)
      .max(1_000_000)
      .parse(v || dflt) *
    1024 *
    1024;
  const api = env.MOBSIMLAB_WORLDPOP_API
    ? z
        .url({ protocol: /^https$/ })
        .parse(env.MOBSIMLAB_WORLDPOP_API)
        .replace(/\/+$/, "")
    : DEFAULT_WORLDPOP_API;
  return {
    api,
    cacheDir: join(env.MOBSIMLAB_DATA_DIR || "/data", "worldpop"),
    maxFileBytes: mb(env.MOBSIMLAB_WORLDPOP_MAX_FILE_MB, 2_000),
    maxCacheBytes: mb(env.MOBSIMLAB_WORLDPOP_CACHE_MB, 6_000),
  };
}

/** One country and year of the dataset, from the catalogue. */
export interface WorldPopEntry {
  iso3: string;
  year: number;
  url: string;
  citation: string;
  doi: string;
}

/** Purpose: the entry for the year nearest `year` in a catalogue answer; null when there is none. */
export function pickEntry(json: unknown, iso3: string, year: number): WorldPopEntry | null {
  const data = (json as { data?: unknown[] })?.data;
  if (!Array.isArray(data)) return null;
  let best: WorldPopEntry | null = null;
  for (const d of data as Record<string, unknown>[]) {
    const y = Number(d.popyear);
    const files = Array.isArray(d.files) ? (d.files as unknown[]) : [];
    const url = files.find((f): f is string => typeof f === "string" && f.endsWith(".tif"));
    if (!Number.isInteger(y) || !url) continue;
    let host: string;
    try {
      const u = new URL(url);
      host = u.protocol === "https:" ? u.hostname : "";
    } catch {
      continue;
    }
    if (host !== FILE_HOST) continue;
    if (best && Math.abs(y - year) >= Math.abs(best.year - year)) continue;
    best = {
      iso3,
      year: y,
      url,
      citation: typeof d.citation === "string" ? d.citation : "",
      doi: typeof d.doi === "string" ? d.doi : "",
    };
  }
  return best;
}

/** The parts of a population file's image directory that reading needs. */
export interface GridHeader {
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  tileOffsets: number[];
  tileByteCounts: number[];
  predictor: number;
  compression: number;
  /** Longitude and latitude of the outer corner of the top-left pixel. */
  originLon: number;
  originLat: number;
  /** Pixel size in degrees. */
  scale: number;
  noData: number | null;
}

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8, 16: 8, 17: 8 };

/** Reads `len` bytes at `offset` of a file. */
export type ByteReader = (offset: number, len: number) => Promise<Uint8Array>;

/**
 * Purpose: read the first image directory of a little-endian classic or BigTIFF file.
 * Output: the header; throws when the file is not a tiled float32 population grid.
 */
export async function readHeader(read: ByteReader): Promise<GridHeader> {
  const head = await read(0, 16);
  const dv0 = new DataView(head.buffer, head.byteOffset, head.byteLength);
  if (head[0] !== 0x49 || head[1] !== 0x49) throw new WorldPopError("Not a little-endian TIFF file", 502);
  const big = dv0.getUint16(2, true) === 43;
  if (!big && dv0.getUint16(2, true) !== 42) throw new WorldPopError("Not a TIFF file", 502);
  const ifd = big ? Number(dv0.getBigUint64(8, true)) : dv0.getUint32(4, true);
  const countBytes = await read(ifd, big ? 8 : 2);
  const cdv = new DataView(countBytes.buffer, countBytes.byteOffset, countBytes.byteLength);
  const count = big ? Number(cdv.getBigUint64(0, true)) : cdv.getUint16(0, true);
  if (count > 500) throw new WorldPopError("TIFF directory too large", 502);
  const entrySize = big ? 20 : 12;
  const dir = await read(ifd + (big ? 8 : 2), count * entrySize);
  const dv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  const tags = new Map<number, number[] | string>();
  for (let i = 0; i < count; i++) {
    const e = i * entrySize;
    const tag = dv.getUint16(e, true);
    const type = dv.getUint16(e + 2, true);
    const n = big ? Number(dv.getBigUint64(e + 4, true)) : dv.getUint32(e + 4, true);
    const size = (TYPE_SIZE[type] ?? 1) * n;
    const inline = size <= (big ? 8 : 4);
    const valueAt = e + (big ? 12 : 8);
    if (size > 64 * 1024 * 1024) throw new WorldPopError("TIFF tag too large", 502);
    const bytes = inline
      ? dir.subarray(valueAt, valueAt + size)
      : await read(big ? Number(dv.getBigUint64(valueAt, true)) : dv.getUint32(valueAt, true), size);
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (type === 2) {
      tags.set(tag, new TextDecoder().decode(bytes).replace(/\0+$/, ""));
      continue;
    }
    const vals: number[] = [];
    for (let k = 0; k < n; k++) {
      if (type === 3) vals.push(v.getUint16(2 * k, true));
      else if (type === 4) vals.push(v.getUint32(4 * k, true));
      else if (type === 12) vals.push(v.getFloat64(8 * k, true));
      else if (type === 16) vals.push(Number(v.getBigUint64(8 * k, true)));
      else if (type === 1) vals.push(v.getUint8(k));
      else break;
    }
    tags.set(tag, vals);
  }
  const num = (t: number, dflt?: number) => {
    const v = tags.get(t);
    const x = Array.isArray(v) ? v[0] : dflt;
    if (x === undefined) throw new WorldPopError(`TIFF tag ${t} missing`, 502);
    return x;
  };
  const arr = (t: number) => {
    const v = tags.get(t);
    return Array.isArray(v) ? v : [];
  };
  const tie = arr(33922);
  const scale = arr(33550);
  if (tie.length < 6 || scale.length < 2) throw new WorldPopError("TIFF has no georeference", 502);
  if (num(258) !== 32 || num(339, 1) !== 3) throw new WorldPopError("Population grid is not float32", 502);
  if (!tags.has(322)) throw new WorldPopError("Population grid is not tiled", 502);
  if (num(277, 1) !== 1) throw new WorldPopError("Population grid has more than one band", 502);
  if (Math.abs(scale[0]! - CELL_DEG) > 1e-9 || Math.abs(scale[1]! - CELL_DEG) > 1e-9)
    throw new WorldPopError("Population grid is not on the 3-arc-second lattice", 502);
  const nd = tags.get(42113);
  const noData = typeof nd === "string" && nd.trim() !== "" ? Number(nd) : null;
  return {
    width: num(256),
    height: num(257),
    tileWidth: num(322),
    tileHeight: num(323),
    tileOffsets: arr(324),
    tileByteCounts: arr(325),
    predictor: num(317, 1),
    compression: num(259, 1),
    originLon: tie[3]! - tie[0]! * scale[0]!,
    originLat: tie[4]! + tie[1]! * scale[1]!,
    scale: scale[0]!,
    noData: Number.isFinite(noData) ? noData : null,
  };
}

/**
 * Purpose: decode TIFF LZW (MSB first, codes of 9 to 12 bits, early change).
 * Inputs: the compressed bytes, the decoded size. Output: exactly `size` bytes (zero padded).
 */
export function lzwDecode(input: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size);
  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  const first = new Uint8Array(4096);
  const len = new Uint16Array(4096);
  for (let i = 0; i < 256; i++) {
    suffix[i] = i;
    first[i] = i;
    len[i] = 1;
  }
  const nbits = input.length * 8;
  let bit = 0;
  let width = 9;
  let next = 258;
  let old = -1;
  let op = 0;
  const write = (code: number) => {
    const n = len[code]!;
    let c = code;
    for (let i = n - 1; i >= 0; i--) {
      if (op + i < size) out[op + i] = suffix[c]!;
      c = prefix[c]!;
    }
    op += n;
  };
  while (op < size && bit + width <= nbits) {
    const at = bit >>> 3;
    const chunk = (input[at]! << 16) | ((input[at + 1] ?? 0) << 8) | (input[at + 2] ?? 0);
    const code = (chunk >>> (24 - (bit & 7) - width)) & ((1 << width) - 1);
    bit += width;
    if (code === 257) break;
    if (code === 256) {
      width = 9;
      next = 258;
      old = -1;
      continue;
    }
    if (old === -1) {
      if (code > 255) throw new WorldPopError("Corrupt LZW data", 502);
      write(code);
      old = code;
      continue;
    }
    let f: number;
    if (code < next) {
      write(code);
      f = first[code]!;
    } else if (code === next) {
      f = first[old]!;
      write(old);
      if (op - 1 < size) out[op] = f;
      op += 1;
    } else {
      throw new WorldPopError("Corrupt LZW data", 502);
    }
    if (next < 4096) {
      prefix[next] = old;
      suffix[next] = f;
      first[next] = first[old]!;
      len[next] = len[old]! + 1;
      next++;
    }
    if (next >= (1 << width) - 1 && width < 12) width++;
    old = code;
  }
  return out;
}

/**
 * Purpose: decode one internal tile into people per cell, row by row; no-data and negative
 * values become 0.
 */
export function decodeTile(raw: Uint8Array, h: GridHeader): Float32Array {
  const n = h.tileWidth * h.tileHeight;
  let bytes: Uint8Array;
  if (h.compression === 1) bytes = raw;
  else if (h.compression === 5) bytes = lzwDecode(raw, n * 4);
  else throw new WorldPopError(`TIFF compression ${h.compression} is not supported`, 502);
  if (bytes.byteLength < n * 4) throw new WorldPopError("Population tile is truncated", 502);
  const words = new Uint32Array(n);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < n; i++) words[i] = dv.getUint32(4 * i, true);
  if (h.predictor === 2) {
    // Horizontal differencing of the 32-bit words, row by row.
    for (let y = 0; y < h.tileHeight; y++)
      for (let x = 1, o = y * h.tileWidth; x < h.tileWidth; x++)
        words[o + x] = (words[o + x]! + words[o + x - 1]!) >>> 0;
  } else if (h.predictor !== 1) {
    throw new WorldPopError(`TIFF predictor ${h.predictor} is not supported`, 502);
  }
  const out = new Float32Array(words.buffer);
  for (let i = 0; i < n; i++) {
    const v = out[i]!;
    if (!(v > 0) || v === h.noData) out[i] = 0;
  }
  return out;
}

/** People per cell of the 3-arc-second lattice over an area, rows from the south. */
export interface PopulationGrid {
  /** Longitude of the west edge, latitude of the south edge, degrees. */
  x0: number;
  y0: number;
  /** Cell size, degrees. */
  dx: number;
  dy: number;
  nx: number;
  ny: number;
  /** People per cell, row by row from the south-west (longitude fastest). */
  people: Float64Array;
}

/**
 * Purpose: the lattice cells covering a box `[west, south, east, north]`, empty (all zero).
 * Cell `i` spans longitude −180 + (c0 + i) × CELL_DEG onwards; rows likewise from latitude −90.
 */
export function emptyGrid(
  bbox: [number, number, number, number],
): PopulationGrid & { c0: number; r0: number } {
  const c0 = Math.floor((bbox[0] + 180) / CELL_DEG + 1e-6);
  const c1 = Math.ceil((bbox[2] + 180) / CELL_DEG - 1e-6);
  const r0 = Math.floor((bbox[1] + 90) / CELL_DEG + 1e-6);
  const r1 = Math.ceil((bbox[3] + 90) / CELL_DEG - 1e-6);
  const nx = Math.max(1, c1 - c0);
  const ny = Math.max(1, r1 - r0);
  return {
    x0: -180 + c0 * CELL_DEG,
    y0: -90 + r0 * CELL_DEG,
    dx: CELL_DEG,
    dy: CELL_DEG,
    nx,
    ny,
    people: new Float64Array(nx * ny),
    c0,
    r0,
  };
}

/** A map with least-recently-used eviction. */
class Lru<K, V> {
  private readonly m = new Map<K, V>();
  constructor(private readonly size: number) {}
  get(k: K): V | undefined {
    const v = this.m.get(k);
    if (v !== undefined) {
      this.m.delete(k);
      this.m.set(k, v);
    }
    return v;
  }
  delete(k: K) {
    this.m.delete(k);
  }
  set(k: K, v: V) {
    this.m.delete(k);
    this.m.set(k, v);
    while (this.m.size > this.size) this.m.delete(this.m.keys().next().value as K);
  }
}

/** A downloaded country file, opened for reading. */
interface GridFile {
  path: string;
  header: GridHeader;
}

export class WorldPopClient {
  private readonly o: WorldPopOptions;
  private readonly entries = new Map<string, Promise<WorldPopEntry | null>>();
  private readonly files = new Map<string, Promise<GridFile>>();
  private readonly tiles: Lru<string, Promise<Float32Array>>;

  constructor(options: Partial<WorldPopOptions> = {}) {
    this.o = {
      ...worldPopSettings(),
      timeoutMs: 30_000,
      downloadTimeoutMs: 30 * 60_000,
      backoffMs: [1_000, 3_000],
      tileCacheSize: 32,
      fetchImpl: (...a) => fetch(...a),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      now: () => new Date(),
      ...options,
    };
    this.tiles = new Lru(this.o.tileCacheSize);
  }

  /**
   * Purpose: the dataset entry of a country for the current year (or the nearest year it has).
   * Output: null when WorldPop has no grid for the country. Side effects: one catalogue request
   * per country, cached while the process runs.
   */
  entry(iso3: string): Promise<WorldPopEntry | null> {
    const key = iso3.toUpperCase();
    if (!/^[A-Z]{3}$/.test(key)) return Promise.resolve(null);
    let p = this.entries.get(key);
    if (!p) {
      p = (async () => {
        const url = `${this.o.api}/${WORLDPOP_ALIAS}?iso3=${key}`;
        const { res, finish } = await this.request(url, this.o.timeoutMs);
        let body: string;
        try {
          body = await res.text();
        } catch {
          throw new WorldPopError("WorldPop catalogue request failed", 502);
        } finally {
          finish();
        }
        if (body.length > 4 * 1024 * 1024)
          throw new WorldPopError("WorldPop catalogue answer too large", 502);
        let json: unknown;
        try {
          json = JSON.parse(body);
        } catch {
          throw new WorldPopError("WorldPop catalogue answer is not JSON", 502);
        }
        return pickEntry(json, key, this.o.now().getUTCFullYear());
      })();
      p.catch(() => this.entries.delete(key));
      this.entries.set(key, p);
    }
    return p;
  }

  /**
   * Purpose: the file of an entry, downloaded once into the cache directory.
   * Side effects: may download the whole country file (tens to hundreds of MB) and delete least
   * recently used files to stay within the cache size.
   */
  file(entry: WorldPopEntry): Promise<GridFile> {
    const name = entry.url.slice(entry.url.lastIndexOf("/") + 1).replace(/[^A-Za-z0-9._-]/g, "_");
    let p = this.files.get(name);
    if (!p) {
      p = (async () => {
        const path = join(this.o.cacheDir, name);
        const have = await stat(path).catch(() => null);
        if (!have) await this.download(entry.url, path);
        const header = await withFile(path, readHeader);
        return { path, header };
      })();
      p.catch(() => this.files.delete(name));
      this.files.set(name, p);
    }
    return p;
  }

  /**
   * Purpose: add the people of a downloaded file to the cells of `grid` it covers.
   * Side effects: reads and decodes the tiles of the file that the grid overlaps.
   */
  async addTo(grid: ReturnType<typeof emptyGrid>, f: GridFile): Promise<void> {
    const h = f.header;
    // The file's first column and its top row on the global lattice.
    const fc = Math.round((h.originLon + 180) / CELL_DEG);
    const ftop = Math.round((h.originLat + 90) / CELL_DEG);
    // Grid rows count from the south; file rows from the top.
    const col0 = Math.max(grid.c0, fc);
    const col1 = Math.min(grid.c0 + grid.nx, fc + h.width);
    const rowS = Math.max(grid.r0, ftop - h.height);
    const rowN = Math.min(grid.r0 + grid.ny, ftop);
    if (col0 >= col1 || rowS >= rowN) return;
    await utimes(f.path, new Date(), new Date()).catch(() => undefined);
    const across = Math.ceil(h.width / h.tileWidth);
    const fh = await open(f.path, "r");
    try {
      for (let r = rowS; r < rowN; r++) {
        const fy = ftop - 1 - r;
        for (let c = col0; c < col1; c++) {
          const fx = c - fc;
          const t = Math.floor(fy / h.tileHeight) * across + Math.floor(fx / h.tileWidth);
          const tile = await this.tile(f, fh, t);
          const v = tile[(fy % h.tileHeight) * h.tileWidth + (fx % h.tileWidth)]!;
          grid.people[(r - grid.r0) * grid.nx + (c - grid.c0)]! += v;
        }
      }
    } finally {
      await fh.close();
    }
  }

  private tile(f: GridFile, fh: Awaited<ReturnType<typeof open>>, t: number): Promise<Float32Array> {
    const key = `${f.path}#${t}`;
    let p = this.tiles.get(key);
    if (!p) {
      p = (async () => {
        const off = f.header.tileOffsets[t];
        const len = f.header.tileByteCounts[t];
        if (off === undefined || len === undefined)
          throw new WorldPopError("Population tile index out of range", 502);
        if (len === 0) return new Float32Array(f.header.tileWidth * f.header.tileHeight);
        if (len > 64 * 1024 * 1024) throw new WorldPopError("Population tile too large", 502);
        const buf = new Uint8Array(len);
        const { bytesRead } = await fh.read(buf, 0, len, off);
        if (bytesRead < len) throw new WorldPopError("Population file is truncated", 502);
        return decodeTile(buf, f.header);
      })();
      p.catch(() => this.tiles.delete(key));
      this.tiles.set(key, p);
    }
    return p;
  }

  /** Purpose: download a file to `path` through a temporary name, within the size limit. */
  private async download(url: string, path: string): Promise<void> {
    await mkdir(this.o.cacheDir, { recursive: true });
    const { res, finish } = await this.request(url, this.o.downloadTimeoutMs);
    try {
      await this.save(res, path);
    } finally {
      finish();
    }
  }

  private async save(res: Response, path: string): Promise<void> {
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > this.o.maxFileBytes) {
      await res.body?.cancel();
      throw new WorldPopError(
        `The WorldPop file is ${Math.round(declared / 1e6)} MB, above the ${Math.round(this.o.maxFileBytes / 1e6)} MB limit`,
        502,
      );
    }
    await this.makeRoom(declared);
    if (!res.body) throw new WorldPopError("WorldPop answered without a body", 502);
    const tmp = `${path}.part-${process.pid}-${Date.now()}`;
    let got = 0;
    const max = this.o.maxFileBytes;
    const limit = new Transform({
      transform(chunk: Buffer, _enc, done) {
        got += chunk.length;
        if (got > max) done(new WorldPopError("The WorldPop file is above the size limit", 502));
        else done(null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(res.body as never), limit, createWriteStream(tmp));
      if (declared && got !== declared) throw new WorldPopError("The WorldPop download was cut short", 502);
      await rename(tmp, path);
    } catch (e) {
      await rm(tmp, { force: true });
      if (e instanceof WorldPopError) throw e;
      if (e instanceof Error && e.name === "AbortError")
        throw new WorldPopError("The WorldPop download timed out", 504);
      throw new WorldPopError(
        `The WorldPop download failed: ${e instanceof Error ? e.message : String(e)}`,
        502,
      );
    }
  }

  /** Purpose: delete the least recently used files until `incoming` more bytes fit the cache. */
  private async makeRoom(incoming: number): Promise<void> {
    const names = await readdir(this.o.cacheDir).catch(() => [] as string[]);
    const files = (
      await Promise.all(
        names.map(async (n) => {
          const p = join(this.o.cacheDir, n);
          const s = await stat(p).catch(() => null);
          return s?.isFile() ? { p, size: s.size, used: s.mtimeMs, part: n.includes(".part-") } : null;
        }),
      )
    ).filter((f): f is NonNullable<typeof f> => !!f);
    // Left-over partial downloads older than the download timeout go first.
    const stale = Date.now() - this.o.downloadTimeoutMs;
    for (const f of files.filter((f) => f.part && f.used < stale)) await rm(f.p, { force: true });
    const kept = files.filter((f) => !f.part).sort((a, b) => a.used - b.used);
    let total = kept.reduce((s, f) => s + f.size, 0) + incoming;
    for (const f of kept) {
      if (total <= this.o.maxCacheBytes) break;
      await rm(f.p, { force: true });
      total -= f.size;
      this.files.delete(basename(f.p));
    }
  }

  /**
   * Purpose: GET with retries. Output: the 200 response and `finish`, which ends its timeout;
   * call it once the body is read (the timeout covers reading the body too).
   */
  private async request(url: string, timeoutMs: number): Promise<{ res: Response; finish: () => void }> {
    let lastError = new WorldPopError("WorldPop request failed", 502);
    for (const backoff of [0, ...this.o.backoffMs]) {
      if (backoff) await this.o.sleep(backoff + Math.random() * (backoff / 2));
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const finish = () => clearTimeout(timer);
      try {
        const res = await this.o.fetchImpl(url, {
          headers: { "User-Agent": USER_AGENT },
          signal: ctrl.signal,
          redirect: "error",
        });
        if (RETRY_STATUS.has(res.status)) {
          finish();
          lastError = new WorldPopError(`WorldPop answered ${res.status}`, 502);
          continue;
        }
        if (res.status !== 200) throw new WorldPopError(`WorldPop answered ${res.status}`, 502);
        return { res, finish };
      } catch (e) {
        finish();
        if (e instanceof WorldPopError) throw e;
        lastError = ctrl.signal.aborted
          ? new WorldPopError("WorldPop request timed out", 504)
          : new WorldPopError(e instanceof Error ? e.message : String(e), 502);
      }
    }
    throw lastError;
  }
}

/** Purpose: run `fn` with a byte reader on a file, closing it afterwards. */
async function withFile<T>(path: string, fn: (read: ByteReader) => Promise<T>): Promise<T> {
  const fh = await open(path, "r");
  try {
    return await fn(async (offset, len) => {
      const buf = new Uint8Array(len);
      const { bytesRead } = await fh.read(buf, 0, len, offset);
      if (bytesRead < len) throw new WorldPopError("Population file is truncated", 502);
      return buf;
    });
  } finally {
    await fh.close();
  }
}
