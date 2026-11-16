import { crc32, deflateRawSync, deflateSync } from "node:zlib";

/** What a test GeoTIFF holds and how it is written. */
export interface TiffSpec {
  width: number;
  height: number;
  /** Value of the pixel in column `c`, row `r` (from the top). */
  value: (c: number, r: number) => number;
  /** Sample type. */
  type?: "float32" | "float64" | "int16" | "uint8" | "uint16";
  littleEndian?: boolean;
  /** Tile size; absent writes strips of `rowsPerStrip` rows. */
  tile?: number;
  rowsPerStrip?: number;
  compression?: "none" | "deflate";
  predictor?: 1 | 2 | 3;
  /** Model coordinates of the top-left corner and the pixel size. */
  origin: [number, number];
  pixel: [number, number];
  /** EPSG code: geographic (4326…) or projected. */
  epsg?: number | null;
  geographic?: boolean;
  noData?: number | null;
}

const BYTES = { float32: 4, float64: 8, int16: 2, uint8: 1, uint16: 2 } as const;
const FORMAT = { float32: 3, float64: 3, int16: 2, uint8: 1, uint16: 1 } as const;

/** Purpose: a classic TIFF file with GeoTIFF tags, for reader tests. */
export function buildTiff(spec: TiffSpec): Uint8Array {
  const type = spec.type ?? "float32";
  const le = spec.littleEndian ?? true;
  const bps = BYTES[type];
  const pred = spec.predictor ?? 1;
  const cw = spec.tile ?? spec.width;
  const ch = spec.tile ?? spec.rowsPerStrip ?? spec.height;
  const across = Math.ceil(spec.width / cw);
  const down = Math.ceil(spec.height / ch);
  const chunks: Uint8Array[] = [];
  for (let ty = 0; ty < down; ty++)
    for (let tx = 0; tx < across; tx++) {
      const rows = spec.tile ? ch : Math.min(ch, spec.height - ty * ch);
      const raw = new Uint8Array(cw * rows * bps);
      const dv = new DataView(raw.buffer);
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cw; c++) {
          const [gc, gr] = [tx * cw + c, ty * ch + r];
          const v = gc < spec.width && gr < spec.height ? spec.value(gc, gr) : (spec.noData ?? 0);
          const at = (r * cw + c) * bps;
          // The floating point predictor works on big-endian bytes.
          const e = pred === 3 ? false : le;
          if (type === "float32") dv.setFloat32(at, v, e);
          else if (type === "float64") dv.setFloat64(at, v, e);
          else if (type === "int16") dv.setInt16(at, v, e);
          else if (type === "uint16") dv.setUint16(at, v, e);
          else dv.setUint8(at, v);
        }
      let out = raw;
      if (pred === 2) {
        out = raw.slice();
        const o = new DataView(out.buffer);
        for (let r = 0; r < rows; r++)
          for (let c = cw - 1; c > 0; c--) {
            const at = (r * cw + c) * bps;
            const prev = at - bps;
            if (bps === 1) o.setUint8(at, (dv.getUint8(at) - dv.getUint8(prev)) & 0xff);
            else if (bps === 2) o.setUint16(at, (dv.getUint16(at, le) - dv.getUint16(prev, le)) & 0xffff, le);
            else o.setUint32(at, (dv.getUint32(at, le) - dv.getUint32(prev, le)) >>> 0, le);
          }
      } else if (pred === 3) {
        out = new Uint8Array(raw.length);
        const rowBytes = cw * bps;
        for (let r = 0; r < rows; r++) {
          const row = new Uint8Array(rowBytes);
          for (let s = 0; s < cw; s++)
            for (let b = 0; b < bps; b++) row[b * cw + s] = raw[r * rowBytes + s * bps + b]!;
          for (let i = rowBytes - 1; i > 0; i--) row[i] = (row[i]! - row[i - 1]!) & 0xff;
          out.set(row, r * rowBytes);
        }
      }
      chunks.push(spec.compression === "deflate" ? new Uint8Array(deflateSync(out)) : out);
    }
  // Layout: header, chunks, directory, tag values.
  const parts: Uint8Array[] = [new Uint8Array(8)];
  let at = 8;
  const offsets: number[] = [];
  for (const c of chunks) {
    offsets.push(at);
    parts.push(c);
    at += c.length;
    if (at % 2) {
      parts.push(new Uint8Array(1));
      at++;
    }
  }
  const geographic = spec.geographic ?? (spec.epsg === undefined || spec.epsg === 4326);
  const keys: number[] = [1, 1, 0, 0];
  const addKey = (id: number, v: number) => {
    keys.push(id, 0, 1, v);
    keys[3]!++;
  };
  addKey(1024, geographic ? 2 : 1);
  addKey(1025, 1);
  if (spec.epsg !== null) addKey(geographic ? 2048 : 3072, spec.epsg ?? 4326);
  const entries: [number, number, number[] | Uint8Array][] = [
    [256, 4, [spec.width]],
    [257, 4, [spec.height]],
    [258, 3, [bps * 8]],
    [259, 3, [spec.compression === "deflate" ? 8 : 1]],
    [262, 3, [1]],
    [277, 3, [1]],
    [317, 3, [pred]],
    [339, 3, [FORMAT[type]]],
    ...(spec.tile
      ? ([
          [322, 3, [cw]],
          [323, 3, [ch]],
          [324, 4, offsets],
          [325, 4, chunks.map((c) => c.length)],
        ] as [number, number, number[]][])
      : ([
          [273, 4, offsets],
          [278, 4, [ch]],
          [279, 4, chunks.map((c) => c.length)],
        ] as [number, number, number[]][])),
    [33550, 12, [spec.pixel[0], spec.pixel[1], 0]],
    [33922, 12, [0, 0, 0, spec.origin[0], spec.origin[1], 0]],
    [34735, 3, keys],
  ];
  if (spec.noData !== undefined && spec.noData !== null)
    entries.push([42113, 2, new TextEncoder().encode(`${spec.noData}\0`)]);
  entries.sort((a, b) => a[0] - b[0]);
  const size: Record<number, number> = { 2: 1, 3: 2, 4: 4, 12: 8 };
  const ifd = at;
  const dirLen = 2 + entries.length * 12 + 4;
  let extra = ifd + dirLen;
  const dir = new DataView(new ArrayBuffer(dirLen));
  dir.setUint16(0, entries.length, le);
  const tail: Uint8Array[] = [];
  entries.forEach(([tag, t, vals], i) => {
    const bytes =
      vals instanceof Uint8Array
        ? vals
        : (() => {
            const b = new DataView(new ArrayBuffer(size[t]! * vals.length));
            vals.forEach((v, k) => {
              if (t === 3) b.setUint16(2 * k, v, le);
              else if (t === 4) b.setUint32(4 * k, v, le);
              else b.setFloat64(8 * k, v, le);
            });
            return new Uint8Array(b.buffer);
          })();
    const e = 2 + i * 12;
    dir.setUint16(e, tag, le);
    dir.setUint16(e + 2, t, le);
    dir.setUint32(e + 4, vals.length, le);
    if (bytes.length <= 4) new Uint8Array(dir.buffer).set(bytes, e + 8);
    else {
      dir.setUint32(e + 8, extra, le);
      tail.push(bytes);
      extra += bytes.length + (bytes.length % 2);
      if (bytes.length % 2) tail.push(new Uint8Array(1));
    }
  });
  parts.push(new Uint8Array(dir.buffer), ...tail);
  const head = new DataView(parts[0]!.buffer);
  head.setUint8(0, le ? 0x49 : 0x4d);
  head.setUint8(1, le ? 0x49 : 0x4d);
  head.setUint16(2, 42, le);
  head.setUint32(4, ifd, le);
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Purpose: a ZIP archive (deflated entries) holding the given files, for the GHSL tests. */
export function buildZip(files: Record<string, Uint8Array>): Uint8Array<ArrayBuffer> {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const raw = deflateRawSync(data);
    const n = Buffer.from(name);
    const crc = crc32(data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(8, 8);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(raw.length, 18);
    h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(n.length, 26);
    local.push(h, n, Buffer.from(raw));
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(raw.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, n);
    offset += 30 + n.length + raw.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...local, cd, end]));
}
