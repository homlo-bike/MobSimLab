import { inflateSync } from "node:zlib";
import { z } from "zod";

/**
 * Copernicus GLO-30 DEM reader (06-gis §4): a provider of the outbound gateway (ADR-0017).
 * The DEM is published as one Cloud Optimized GeoTIFF per 1°×1° cell (float32, DEFLATE, floating-point
 * predictor, 1024×1024 internal tiles). The client reads only what it needs with HTTP range requests:
 * the TIFF header of a cell, then the internal tiles the sampled points fall in. Headers and tiles
 * are kept in small LRU caches. Cells the DEM does not cover (open sea) answer 404 and give `null`.
 * Same outbound rules as the Overpass client: https endpoint, identifying User-Agent, timeout,
 * size limits, retries with backoff on 429/5xx and timeouts.
 */

export const DEFAULT_COPERNICUS_URL = "https://copernicus-dem-30m.s3.amazonaws.com";
const USER_AGENT = "MobSimLab/0.1 (+https://github.com/homlo-bike/MobSimLab)";
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const HEADER_BYTES = 16 * 1024;

/** Settings, with defaults for production. */
export interface CopernicusOptions {
  endpoint: string;
  timeoutMs: number;
  maxTileBytes: number;
  backoffMs: number[];
  headerCacheSize: number;
  tileCacheSize: number;
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
}

/** Error with an HTTP status the API can pass on (502 upstream failure, 504 timeout). */
export class DemError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Purpose: read the endpoint from `MOBSIMLAB_COPERNICUS_URL`; only https URLs are accepted. */
export function copernicusEndpoint(env: NodeJS.ProcessEnv = process.env): string {
  const v = env.MOBSIMLAB_COPERNICUS_URL;
  if (!v) return DEFAULT_COPERNICUS_URL;
  return z
    .url({ protocol: /^https$/ })
    .parse(v)
    .replace(/\/+$/, "");
}

/** Purpose: name of the 1° cell holding a point, such as Copernicus_DSM_COG_10_N50_00_E007_00_DEM. */
export function cellName(lon: number, lat: number): string {
  const la = Math.floor(lat);
  const lo = Math.floor(lon);
  const ns = `${la < 0 ? "S" : "N"}${String(Math.abs(la)).padStart(2, "0")}_00`;
  const ew = `${lo < 0 ? "W" : "E"}${String(Math.abs(lo)).padStart(3, "0")}_00`;
  return `Copernicus_DSM_COG_10_${ns}_${ew}_DEM`;
}

/** The parts of a cell's first image directory that sampling needs. */
export interface CellHeader {
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
  scaleLon: number;
  scaleLat: number;
}

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8, 16: 8 };

/**
 * Purpose: parse the first image directory of a little- or big-endian classic TIFF.
 * Inputs: the first bytes of the file (must hold the directory and its arrays).
 * Output: the header, or throws when the bytes are not enough or the file is not a GLO-30 COG.
 */
export function parseHeader(buf: Uint8Array): CellHeader {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const le = buf[0] === 0x49 && buf[1] === 0x49;
  if (!le && !(buf[0] === 0x4d && buf[1] === 0x4d)) throw new DemError("Not a TIFF file", 502);
  if (dv.getUint16(2, le) !== 42) throw new DemError("Not a classic TIFF file", 502);
  const need = (end: number) => {
    if (end > buf.byteLength) throw new RangeError(`TIFF header needs ${end} bytes`);
  };
  const ifd = dv.getUint32(4, le);
  need(ifd + 2);
  const count = dv.getUint16(ifd, le);
  need(ifd + 2 + count * 12);
  const tags = new Map<number, number[]>();
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12;
    const tag = dv.getUint16(e, le);
    const type = dv.getUint16(e + 2, le);
    const n = dv.getUint32(e + 4, le);
    const size = (TYPE_SIZE[type] ?? 1) * n;
    const at = size <= 4 ? e + 8 : dv.getUint32(e + 8, le);
    need(at + size);
    const vals: number[] = [];
    for (let k = 0; k < n && type !== 2; k++) {
      if (type === 3) vals.push(dv.getUint16(at + 2 * k, le));
      else if (type === 4) vals.push(dv.getUint32(at + 4 * k, le));
      else if (type === 12) vals.push(dv.getFloat64(at + 8 * k, le));
      else if (type === 16) vals.push(Number(dv.getBigUint64(at + 8 * k, le)));
      else if (type === 1) vals.push(dv.getUint8(at + k));
    }
    tags.set(tag, vals);
  }
  const one = (t: number, dflt?: number) => {
    const v = tags.get(t)?.[0] ?? dflt;
    if (v === undefined) throw new DemError(`TIFF tag ${t} missing`, 502);
    return v;
  };
  const tie = tags.get(33922);
  const scale = tags.get(33550);
  if (!tie || tie.length < 6 || !scale || scale.length < 2)
    throw new DemError("TIFF has no georeference", 502);
  if (one(258) !== 32 || one(339, 1) !== 3) throw new DemError("DEM is not float32", 502);
  if (!tags.has(322)) throw new DemError("DEM is not tiled", 502);
  return {
    width: one(256),
    height: one(257),
    tileWidth: one(322),
    tileHeight: one(323),
    tileOffsets: tags.get(324) ?? [],
    tileByteCounts: tags.get(325) ?? [],
    predictor: one(317, 1),
    compression: one(259, 1),
    originLon: tie[3]! - tie[0]! * scale[0]!,
    originLat: tie[4]! + tie[1]! * scale[1]!,
    scaleLon: scale[0]!,
    scaleLat: scale[1]!,
  };
}

/**
 * Purpose: decode one internal tile into float32 values, row by row.
 * Inputs: the compressed bytes, the header. Output: tileWidth × tileHeight values.
 */
export function decodeTile(raw: Uint8Array, h: CellHeader): Float32Array {
  let bytes: Uint8Array;
  if (h.compression === 1) bytes = raw;
  else if (h.compression === 8 || h.compression === 32946) bytes = inflateSync(raw);
  else throw new DemError(`TIFF compression ${h.compression} is not supported`, 502);
  const w = h.tileWidth;
  const rows = h.tileHeight;
  const rowBytes = w * 4;
  if (bytes.byteLength < rowBytes * rows) throw new DemError("DEM tile is truncated", 502);
  const out = new Float32Array(w * rows);
  const outBytes = new Uint8Array(out.buffer);
  const little = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
  if (h.predictor === 3) {
    // Floating-point predictor: each row holds the byte planes (most significant first),
    // differenced byte by byte.
    const row = new Uint8Array(rowBytes);
    for (let y = 0; y < rows; y++) {
      row.set(bytes.subarray(y * rowBytes, (y + 1) * rowBytes));
      for (let i = 1; i < rowBytes; i++) row[i] = (row[i]! + row[i - 1]!) & 0xff;
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        for (let k = 0; k < 4; k++) outBytes[o + (little ? 3 - k : k)] = row[k * w + x]!;
      }
    }
  } else if (h.predictor === 1) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < w * rows; i++) out[i] = dv.getFloat32(i * 4, true);
  } else {
    throw new DemError(`TIFF predictor ${h.predictor} is not supported`, 502);
  }
  return out;
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

export class CopernicusDemClient {
  private readonly o: CopernicusOptions;
  private readonly headers: Lru<string, Promise<CellHeader | null>>;
  private readonly tiles: Lru<string, Promise<Float32Array>>;

  constructor(options: Partial<CopernicusOptions> = {}) {
    this.o = {
      endpoint: copernicusEndpoint(),
      timeoutMs: 30_000,
      maxTileBytes: 16 * 1024 * 1024,
      backoffMs: [1_000, 3_000],
      headerCacheSize: 256,
      tileCacheSize: 24,
      fetchImpl: (...a) => fetch(...a),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      ...options,
    };
    this.headers = new Lru(this.o.headerCacheSize);
    this.tiles = new Lru(this.o.tileCacheSize);
  }

  /**
   * Purpose: terrain height at a point, interpolated bilinearly between the four nearest pixels.
   * Output: metres above the EGM2008 geoid, or null where the DEM has no data (open sea, voids).
   * Side effects: range requests for the cell header and tiles not yet cached.
   */
  async elevation(lon: number, lat: number): Promise<number | null> {
    if (!(Math.abs(lat) < 90) || !(Math.abs(lon) <= 180)) return null;
    const name = cellName(lon, lat);
    const h = await this.header(name);
    if (!h) return null;
    // Pixel centres sit at origin + (i + 0.5) × scale; clamp at the cell edge.
    const fx = Math.min(Math.max((lon - h.originLon) / h.scaleLon - 0.5, 0), h.width - 1);
    const fy = Math.min(Math.max((h.originLat - lat) / h.scaleLat - 0.5, 0), h.height - 1);
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(x0 + 1, h.width - 1);
    const y1 = Math.min(y0 + 1, h.height - 1);
    const tx = fx - x0;
    const ty = fy - y0;
    const [a, b, c, d] = await Promise.all([
      this.pixel(name, h, x0, y0),
      this.pixel(name, h, x1, y0),
      this.pixel(name, h, x0, y1),
      this.pixel(name, h, x1, y1),
    ]);
    const ws: Array<[number | null, number]> = [
      [a, (1 - tx) * (1 - ty)],
      [b, tx * (1 - ty)],
      [c, (1 - tx) * ty],
      [d, tx * ty],
    ];
    let sum = 0;
    let wsum = 0;
    for (const [v, wt] of ws) {
      if (v !== null && wt > 0) {
        sum += v * wt;
        wsum += wt;
      }
    }
    return wsum > 0 ? Math.round((sum / wsum) * 100) / 100 : null;
  }

  private async pixel(name: string, h: CellHeader, x: number, y: number): Promise<number | null> {
    const across = Math.ceil(h.width / h.tileWidth);
    const t = Math.floor(y / h.tileHeight) * across + Math.floor(x / h.tileWidth);
    const data = await this.tile(name, h, t);
    const v = data[(y % h.tileHeight) * h.tileWidth + (x % h.tileWidth)]!;
    return Number.isFinite(v) && v > -1000 ? v : null;
  }

  private header(name: string): Promise<CellHeader | null> {
    let p = this.headers.get(name);
    if (!p) {
      p = this.readHeader(name);
      p.catch(() => this.headers.delete(name));
      this.headers.set(name, p);
    }
    return p;
  }

  private async readHeader(name: string): Promise<CellHeader | null> {
    let size = HEADER_BYTES;
    for (;;) {
      const buf = await this.range(name, 0, size);
      if (!buf) return null;
      try {
        return parseHeader(buf);
      } catch (e) {
        if (!(e instanceof RangeError) || size >= 256 * 1024 || buf.byteLength < size) throw e;
        size *= 4;
      }
    }
  }

  private tile(name: string, h: CellHeader, t: number): Promise<Float32Array> {
    const key = `${name}/${t}`;
    let p = this.tiles.get(key);
    if (!p) {
      p = (async () => {
        const off = h.tileOffsets[t];
        const len = h.tileByteCounts[t];
        if (off === undefined || !len) throw new DemError("DEM tile index out of range", 502);
        if (len > this.o.maxTileBytes) throw new DemError("DEM tile too large", 502);
        const raw = await this.range(name, off, len);
        if (!raw || raw.byteLength < len) throw new DemError("DEM tile is missing", 502);
        return decodeTile(raw.subarray(0, len), h);
      })();
      p.catch(() => this.tiles.delete(key));
      this.tiles.set(key, p);
    }
    return p;
  }

  /** Purpose: GET bytes [from, from + len) of a cell's file; null when the cell does not exist. */
  private async range(name: string, from: number, len: number): Promise<Uint8Array | null> {
    const url = `${this.o.endpoint}/${name}/${name}.tif`;
    let lastError = new DemError("DEM request failed", 502);
    for (const backoff of [0, ...this.o.backoffMs]) {
      if (backoff) await this.o.sleep(backoff + Math.random() * (backoff / 2));
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.o.timeoutMs);
      try {
        const res = await this.o.fetchImpl(url, {
          headers: { "User-Agent": USER_AGENT, Range: `bytes=${from}-${from + len - 1}` },
          signal: ctrl.signal,
          redirect: "error",
        });
        if (res.status === 404 || res.status === 403) return null;
        if (RETRY_STATUS.has(res.status)) {
          lastError = new DemError(`DEM server answered ${res.status}`, 502);
          continue;
        }
        if (res.status !== 206 && res.status !== 200)
          throw new DemError(`DEM server answered ${res.status}`, 502);
        const declared = Number(res.headers.get("content-length") ?? 0);
        if (res.status === 200 && declared > len + HEADER_BYTES)
          throw new DemError("DEM server ignored the byte range", 502);
        const body = new Uint8Array(await res.arrayBuffer());
        if (body.byteLength > len + HEADER_BYTES) throw new DemError("DEM response too large", 502);
        return body;
      } catch (e) {
        if (e instanceof DemError) throw e;
        lastError = ctrl.signal.aborted
          ? new DemError("DEM request timed out", 504)
          : new DemError(e instanceof Error ? e.message : String(e), 502);
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError;
  }
}
