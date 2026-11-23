import { gzipSync } from "node:zlib";

/**
 * A writer of PMTiles version 3 archives (https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md): one file
 * holding many tiles, with a directory a reader fetches first and then reads each tile by byte range. The `.mslab`
 * map data (format 1.4) keeps one archive per kind of OpenStreetMap tile; the static viewer reads it
 * (apps/web/src/static/pmtiles.ts). Tiles and directories are gzipped; the tile type is "unknown", since the tiles
 * are the street network API's OSM XML or JSON, not vector tiles.
 */

/** Size of the fixed header. */
const HEADER_BYTES = 127;
/** A reader fetches this many bytes first; the header and root directory must fit in them (spec §3). */
const FIRST_READ_BYTES = 16_384;
const COMPRESSION_GZIP = 2;
const TILE_TYPE_UNKNOWN = 0;

/** One tile to write. */
export interface ArchiveTile {
  z: number;
  x: number;
  y: number;
  /** The tile as served, before compression. */
  body: Buffer;
}

interface Entry {
  tileId: number;
  offset: number;
  length: number;
  runLength: number;
}

/** Purpose: the Hilbert tile id of z/x/y (spec §2.3): tiles of lower zooms first, then along the Hilbert curve. */
export function tileId(z: number, x: number, y: number): number {
  let acc = 0;
  for (let i = 0; i < z; i++) acc += 4 ** i;
  const n = 2 ** z;
  let tx = x;
  let ty = y;
  let d = 0;
  for (let s = n / 2; s >= 1; s /= 2) {
    const rx = (tx & s) > 0 ? 1 : 0;
    const ry = (ty & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) {
        tx = n - 1 - tx;
        ty = n - 1 - ty;
      }
      [tx, ty] = [ty, tx];
    }
  }
  return acc + d;
}

function varint(out: number[], v: number): void {
  let n = v;
  while (n >= 0x80) {
    out.push((n % 0x80) | 0x80);
    n = Math.floor(n / 0x80);
  }
  out.push(n);
}

/** Purpose: a directory, encoded (spec §4) and gzipped. */
function directory(entries: readonly Entry[]): Buffer {
  const b: number[] = [];
  varint(b, entries.length);
  let last = 0;
  for (const e of entries) {
    varint(b, e.tileId - last);
    last = e.tileId;
  }
  for (const e of entries) varint(b, e.runLength);
  for (const e of entries) varint(b, e.length);
  entries.forEach((e, i) => {
    const prev = entries[i - 1];
    if (i > 0 && prev && e.offset === prev.offset + prev.length) varint(b, 0);
    else varint(b, e.offset + 1);
  });
  return gzipSync(Buffer.from(b));
}

/** Purpose: the root directory and the leaf directories, with the root small enough for the first read. */
function directories(entries: Entry[]): { root: Buffer; leaves: Buffer } {
  const root = directory(entries);
  if (HEADER_BYTES + root.length <= FIRST_READ_BYTES) return { root, leaves: Buffer.alloc(0) };
  for (let size = 4096; ; size *= 2) {
    const parts: Buffer[] = [];
    const pointers: Entry[] = [];
    let offset = 0;
    for (let i = 0; i < entries.length; i += size) {
      const leaf = directory(entries.slice(i, i + size));
      pointers.push({ tileId: entries[i]!.tileId, offset, length: leaf.length, runLength: 0 });
      parts.push(leaf);
      offset += leaf.length;
    }
    const r = directory(pointers);
    if (HEADER_BYTES + r.length <= FIRST_READ_BYTES) return { root: r, leaves: Buffer.concat(parts) };
  }
}

function u64(b: Buffer, at: number, v: number): void {
  b.writeBigUInt64LE(BigInt(v), at);
}

/**
 * Purpose: one PMTiles archive of the given tiles. Identical tiles are kept once. Inputs: the tiles (any order)
 * and metadata stored as the archive's JSON metadata. Output: the archive's bytes.
 */
export function writeArchive(
  tiles: readonly ArchiveTile[],
  metadata: Record<string, unknown>,
  bounds: [number, number, number, number],
): Buffer {
  const sorted = tiles
    .map((t) => ({ id: tileId(t.z, t.x, t.y), t }))
    .sort((a, b) => a.id - b.id)
    .filter((t, i, all) => i === 0 || all[i - 1]!.id !== t.id);
  const bodies: Buffer[] = [];
  const seen = new Map<string, { offset: number; length: number }>();
  const entries: Entry[] = [];
  let size = 0;
  let clustered = true;
  for (const { id, t } of sorted) {
    const key = t.body.toString("base64");
    let at = seen.get(key);
    if (at) clustered = false;
    else {
      const gz = gzipSync(t.body);
      at = { offset: size, length: gz.length };
      seen.set(key, at);
      bodies.push(gz);
      size += gz.length;
    }
    const prev = entries.at(-1);
    // Neighbouring ids holding the same tile share one entry.
    if (prev && prev.tileId + prev.runLength === id && prev.offset === at.offset) prev.runLength++;
    else entries.push({ tileId: id, offset: at.offset, length: at.length, runLength: 1 });
  }
  const { root, leaves } = directories(entries);
  const meta = gzipSync(Buffer.from(JSON.stringify(metadata), "utf8"));
  const data = Buffer.concat(bodies);
  const zooms = tiles.map((t) => t.z);
  const minZoom = zooms.length ? Math.min(...zooms) : 0;
  const maxZoom = zooms.length ? Math.max(...zooms) : 0;

  const h = Buffer.alloc(HEADER_BYTES);
  h.write("PMTiles", 0, "ascii");
  h.writeUInt8(3, 7);
  const rootAt = HEADER_BYTES;
  const metaAt = rootAt + root.length;
  const leavesAt = metaAt + meta.length;
  const dataAt = leavesAt + leaves.length;
  u64(h, 8, rootAt);
  u64(h, 16, root.length);
  u64(h, 24, metaAt);
  u64(h, 32, meta.length);
  u64(h, 40, leavesAt);
  u64(h, 48, leaves.length);
  u64(h, 56, dataAt);
  u64(h, 64, data.length);
  u64(h, 72, sorted.length);
  u64(h, 80, entries.length);
  u64(h, 88, bodies.length);
  h.writeUInt8(clustered ? 1 : 0, 96);
  h.writeUInt8(COMPRESSION_GZIP, 97);
  h.writeUInt8(COMPRESSION_GZIP, 98);
  h.writeUInt8(TILE_TYPE_UNKNOWN, 99);
  h.writeUInt8(minZoom, 100);
  h.writeUInt8(maxZoom, 101);
  const e7 = (v: number) => Math.round(v * 1e7);
  h.writeInt32LE(e7(bounds[0]), 102);
  h.writeInt32LE(e7(bounds[1]), 106);
  h.writeInt32LE(e7(bounds[2]), 110);
  h.writeInt32LE(e7(bounds[3]), 114);
  h.writeUInt8(maxZoom, 118);
  h.writeInt32LE(e7((bounds[0] + bounds[2]) / 2), 119);
  h.writeInt32LE(e7((bounds[1] + bounds[3]) / 2), 123);
  return Buffer.concat([h, root, meta, leaves, data]);
}
