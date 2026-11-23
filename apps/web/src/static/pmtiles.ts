/**
 * A reader of PMTiles version 3 archives (https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md), for the
 * static viewer's map data (`.mslab` format 1.4, `map/<kind>.pmtiles`, written by apps/api/src/mslab/pmtiles.ts).
 * It fetches the header and root directory once, then each tile by byte range, so only the tiles on screen are
 * downloaded. A host that ignores the Range header and sends the whole file still works: the file is then kept
 * and the tiles are cut from it.
 */

/** The first read: the header and root directory fit in it (spec §3). */
const FIRST_READ_BYTES = 16_384;
const HEADER_BYTES = 127;
/** Tiles kept once read, so that tools asking for the same tile again do not download it again. */
const KEEP_TILES = 512;

interface Entry {
  tileId: number;
  offset: number;
  length: number;
  runLength: number;
}

interface Header {
  rootOffset: number;
  rootLength: number;
  leavesOffset: number;
  dataOffset: number;
  internalGzip: boolean;
  tileGzip: boolean;
}

/** Purpose: the Hilbert tile id of z/x/y (spec §2.3), as the writer numbers tiles. */
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

const u64 = (v: DataView, at: number) => Number(v.getBigUint64(at, true));

/** Purpose: gzipped bytes unpacked. */
async function gunzip(b: Uint8Array): Promise<Uint8Array> {
  const stream = new Response(b as BodyInit).body!.pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Purpose: a directory's entries from its bytes (spec §4). */
export function parseDirectory(b: Uint8Array): Entry[] {
  let p = 0;
  const next = () => {
    let v = 0;
    let shift = 1;
    for (;;) {
      if (p >= b.length) throw new Error("damaged map data archive");
      const byte = b[p++]!;
      v += (byte & 0x7f) * shift;
      if (byte < 0x80) return v;
      shift *= 0x80;
    }
  };
  const n = next();
  const entries: Entry[] = Array.from({ length: n }, () => ({
    tileId: 0,
    offset: 0,
    length: 0,
    runLength: 0,
  }));
  let last = 0;
  for (const e of entries) {
    last += next();
    e.tileId = last;
  }
  for (const e of entries) e.runLength = next();
  for (const e of entries) e.length = next();
  entries.forEach((e, i) => {
    const v = next();
    const prev = entries[i - 1];
    e.offset = v === 0 && prev ? prev.offset + prev.length : v - 1;
  });
  return entries;
}

/** Purpose: the entry holding a tile id, or a leaf directory pointer that may; null when none can. */
function find(entries: readonly Entry[], id: number): Entry | null {
  let lo = 0;
  let hi = entries.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = entries[mid]!.tileId;
    if (t === id) return entries[mid]!;
    if (t < id) lo = mid + 1;
    else hi = mid - 1;
  }
  const e = hi >= 0 ? entries[hi]! : null;
  if (!e) return null;
  if (e.runLength === 0) return e;
  return id - e.tileId < e.runLength ? e : null;
}

/** One archive read by byte range from the site. */
export class ArchiveReader {
  private header: Promise<Header | null> | null = null;
  private whole: Uint8Array | null = null;
  private readonly dirs = new Map<number, Promise<Entry[]>>();
  /** The tiles read last, oldest first (a Map keeps insertion order). */
  private readonly kept = new Map<number, Promise<string | null>>();
  /** Bytes downloaded so far (for tests and the network check). */
  downloaded = 0;

  constructor(
    private readonly url: string,
    private readonly base: typeof fetch,
  ) {}

  /** Purpose: bytes `from`…`from + length` of the archive; null when the site does not have the file. */
  private async range(from: number, length: number): Promise<Uint8Array | null> {
    if (this.whole) return this.whole.subarray(from, from + length);
    const r = await this.base(this.url, { headers: { Range: `bytes=${from}-${from + length - 1}` } });
    // A host that answers every path with the app page (single-page fallback) does not have the file.
    if (!r.ok || (r.headers.get("Content-Type") ?? "").includes("text/html")) return null;
    const b = new Uint8Array(await r.arrayBuffer());
    this.downloaded += b.length;
    // A partial answer shorter than asked from the start is the whole file: keep it for the tiles.
    if (r.status === 206 && !(from === 0 && b.length < length)) return b;
    this.whole = b;
    return b.subarray(from, from + length);
  }

  private readHeader(): Promise<Header | null> {
    this.header ??= this.range(0, FIRST_READ_BYTES).then(async (b) => {
      if (!b || b.length < HEADER_BYTES) return null;
      if (new TextDecoder().decode(b.subarray(0, 7)) !== "PMTiles" || b[7] !== 3)
        throw new Error("not a PMTiles 3 archive");
      const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
      const h: Header = {
        rootOffset: u64(v, 8),
        rootLength: u64(v, 16),
        leavesOffset: u64(v, 40),
        dataOffset: u64(v, 56),
        internalGzip: b[97] === 2,
        tileGzip: b[98] === 2,
      };
      // The root directory is in the first read when the writer kept to the spec.
      if (h.rootOffset + h.rootLength <= b.length) {
        const root = b.slice(h.rootOffset, h.rootOffset + h.rootLength);
        this.dirs.set(
          h.rootOffset,
          Promise.resolve(parseDirectory(h.internalGzip ? await gunzip(root) : root)),
        );
      }
      return h;
    });
    return this.header;
  }

  private directory(h: Header, offset: number, length: number): Promise<Entry[]> {
    let d = this.dirs.get(offset);
    if (!d) {
      d = this.range(offset, length).then(async (b) => {
        if (!b) throw new Error("damaged map data archive");
        return parseDirectory(h.internalGzip ? await gunzip(b) : b);
      });
      this.dirs.set(offset, d);
    }
    return d;
  }

  /** Purpose: one tile as text; null when the archive does not hold it or the site does not have the archive. */
  tile(z: number, x: number, y: number): Promise<string | null> {
    const id = tileId(z, x, y);
    let t = this.kept.get(id);
    if (t) {
      this.kept.delete(id);
      this.kept.set(id, t);
      return t;
    }
    t = this.read(id);
    this.kept.set(id, t);
    // A failed read is tried again next time.
    t.catch(() => this.kept.delete(id));
    if (this.kept.size > KEEP_TILES) this.kept.delete(this.kept.keys().next().value!);
    return t;
  }

  private async read(id: number): Promise<string | null> {
    const h = await this.readHeader();
    if (!h) return null;
    let dir = await this.directory(h, h.rootOffset, h.rootLength);
    for (let depth = 0; depth < 4; depth++) {
      const e = find(dir, id);
      if (!e) return null;
      if (e.runLength > 0) {
        const b = await this.range(h.dataOffset + e.offset, e.length);
        if (!b) return null;
        return new TextDecoder().decode(h.tileGzip ? await gunzip(b) : b);
      }
      dir = await this.directory(h, h.leavesOffset + e.offset, e.length);
    }
    return null;
  }
}
