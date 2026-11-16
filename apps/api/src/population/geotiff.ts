import { inflateSync } from "node:zlib";
import { lzwDecode } from "../gateway/worldpop.client";

/**
 * A GeoTIFF reader for population grids from GHSL and from planners' own files (06-gis §3, FR-GIS-04).
 *
 * Reads the first image of a classic or BigTIFF file in either byte order, tiled or in strips, one or more
 * bands (the first band is read), unsigned, signed or floating point samples of 8 to 64 bits, uncompressed,
 * PackBits, LZW or Deflate, with no predictor, the horizontal predictor or the floating point predictor. The
 * georeference comes from the model transformation or the tie point and pixel scale; the coordinate reference
 * system from the GeoKeys (EPSG code, or "user defined", which needs the planner's own definition).
 */

/** A file that cannot be read as a population grid; the message is shown to the planner. */
export class GeoTiffError extends Error {}

/** Reads `len` bytes at `offset`. */
export type ByteReader = (offset: number, len: number) => Promise<Uint8Array>;

/** Purpose: a byte reader over bytes in memory. */
export function bufferReader(buf: Uint8Array): ByteReader {
  return async (offset, len) => {
    if (offset < 0 || offset + len > buf.length) throw new GeoTiffError("The GeoTIFF file is truncated");
    return buf.subarray(offset, offset + len);
  };
}

/** Coordinate reference system named by the GeoKeys. */
export interface TiffCrs {
  /** EPSG code of the projected or geographic system; null when none is given or it is user defined. */
  epsg: number | null;
  /** Whether coordinates are longitude and latitude. */
  geographic: boolean;
  /** Citation text of the file, if any (often the system's name). */
  citation: string | null;
}

/** An opened GeoTIFF. */
export interface GeoTiff {
  width: number;
  height: number;
  /**
   * Pixel corner to model coordinates: `x = t[0] + col·t[1] + row·t[2]`, `y = t[3] + col·t[4] + row·t[5]`
   * (column and row of the pixel's top-left corner; 0.5 is a pixel centre).
   */
  transform: [number, number, number, number, number, number];
  crs: TiffCrs;
  noData: number | null;
  /** Number of bands; the first is read. */
  bands: number;
  /** Purpose: the values of columns `[x0, x1)` and rows `[y0, y1)`, row by row from the top; no data is NaN. */
  window(x0: number, y0: number, x1: number, y1: number): Promise<Float64Array>;
}

const TYPE_SIZE: Record<number, number> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  6: 1,
  7: 1,
  8: 2,
  9: 4,
  10: 8,
  11: 4,
  12: 8,
  16: 8,
  17: 8,
  18: 8,
};

/** Largest decoded chunk (tile or strip), bytes, so a damaged file cannot ask for gigabytes. */
const MAX_CHUNK_BYTES = 256 * 1024 * 1024;

type Tags = Map<number, number[] | string>;

async function readTags(read: ByteReader): Promise<{ tags: Tags; little: boolean }> {
  const head = await read(0, 16).catch(() => {
    throw new GeoTiffError("The file is not a TIFF file");
  });
  const order = String.fromCharCode(head[0]!, head[1]!);
  if (order !== "II" && order !== "MM") throw new GeoTiffError("The file is not a TIFF file");
  const little = order === "II";
  const dv0 = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const magic = dv0.getUint16(2, little);
  if (magic !== 42 && magic !== 43) throw new GeoTiffError("The file is not a TIFF file");
  const big = magic === 43;
  const ifd = big ? Number(dv0.getBigUint64(8, little)) : dv0.getUint32(4, little);
  const countBytes = await read(ifd, big ? 8 : 2);
  const cdv = new DataView(countBytes.buffer, countBytes.byteOffset, countBytes.byteLength);
  const count = big ? Number(cdv.getBigUint64(0, little)) : cdv.getUint16(0, little);
  if (count > 1000) throw new GeoTiffError("The TIFF directory is damaged");
  const entrySize = big ? 20 : 12;
  const dir = await read(ifd + (big ? 8 : 2), count * entrySize);
  const dv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  const tags: Tags = new Map();
  for (let i = 0; i < count; i++) {
    const e = i * entrySize;
    const tag = dv.getUint16(e, little);
    const type = dv.getUint16(e + 2, little);
    const n = big ? Number(dv.getBigUint64(e + 4, little)) : dv.getUint32(e + 4, little);
    const size = (TYPE_SIZE[type] ?? 1) * n;
    if (size > 64 * 1024 * 1024) throw new GeoTiffError("A TIFF tag is too large");
    const inline = size <= (big ? 8 : 4);
    const valueAt = e + (big ? 12 : 8);
    const bytes = inline
      ? dir.subarray(valueAt, valueAt + size)
      : await read(big ? Number(dv.getBigUint64(valueAt, little)) : dv.getUint32(valueAt, little), size);
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (type === 2) {
      tags.set(tag, new TextDecoder().decode(bytes).replace(/\0+$/, ""));
      continue;
    }
    const vals: number[] = [];
    for (let k = 0; k < n; k++) {
      if (type === 1 || type === 7) vals.push(v.getUint8(k));
      else if (type === 6) vals.push(v.getInt8(k));
      else if (type === 3) vals.push(v.getUint16(2 * k, little));
      else if (type === 8) vals.push(v.getInt16(2 * k, little));
      else if (type === 4) vals.push(v.getUint32(4 * k, little));
      else if (type === 9) vals.push(v.getInt32(4 * k, little));
      else if (type === 11) vals.push(v.getFloat32(4 * k, little));
      else if (type === 12) vals.push(v.getFloat64(8 * k, little));
      else if (type === 16 || type === 18) vals.push(Number(v.getBigUint64(8 * k, little)));
      else if (type === 17) vals.push(Number(v.getBigInt64(8 * k, little)));
      else if (type === 5) vals.push(v.getUint32(8 * k, little) / (v.getUint32(8 * k + 4, little) || 1));
      else if (type === 10) vals.push(v.getInt32(8 * k, little) / (v.getInt32(8 * k + 4, little) || 1));
      else break;
    }
    tags.set(tag, vals);
  }
  return { tags, little };
}

/** Purpose: undo PackBits run-length coding into `size` bytes. */
export function packBitsDecode(input: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size);
  let i = 0;
  let o = 0;
  while (i < input.length && o < size) {
    const n = (input[i++]! << 24) >> 24;
    if (n >= 0) {
      for (let k = 0; k <= n && i < input.length && o < size; k++) out[o++] = input[i++]!;
    } else if (n !== -128) {
      const b = input[i++] ?? 0;
      for (let k = 0; k < 1 - n && o < size; k++) out[o++] = b;
    }
  }
  return out;
}

/**
 * Purpose: open the first image of a GeoTIFF file.
 * Output: its size, georeference, reference system and a window reader. Throws GeoTiffError with a message
 * for the planner when the file is not a georeferenced grid this reader can read.
 */
export async function openGeoTiff(read: ByteReader): Promise<GeoTiff> {
  const { tags, little } = await readTags(read);
  const nums = (t: number): number[] => {
    const v = tags.get(t);
    return Array.isArray(v) ? v : [];
  };
  const num = (t: number, dflt?: number): number => {
    const x = nums(t)[0] ?? dflt;
    if (x === undefined) throw new GeoTiffError(`The TIFF file has no tag ${t}`);
    return x;
  };
  const width = num(256);
  const height = num(257);
  const bands = num(277, 1);
  const bits = num(258, 1);
  const format = num(339, 1);
  const compression = num(259, 1);
  const predictor = num(317, 1);
  const planar = num(284, 1);
  if (width < 1 || height < 1) throw new GeoTiffError("The GeoTIFF file has no pixels");
  if (![8, 16, 32, 64].includes(bits) || nums(258).some((b) => b !== bits))
    throw new GeoTiffError(`Samples of ${bits} bits are not supported`);
  if (![1, 2, 3].includes(format)) throw new GeoTiffError("The GeoTIFF samples are not numbers");
  if (format === 3 && bits < 32)
    throw new GeoTiffError(`Floating point samples of ${bits} bits are not supported`);
  if (![1, 5, 8, 32946, 32773].includes(compression))
    throw new GeoTiffError(
      `TIFF compression ${compression} is not supported; save the file uncompressed or with LZW or Deflate`,
    );
  if (![1, 2, 3].includes(predictor)) throw new GeoTiffError(`TIFF predictor ${predictor} is not supported`);

  // Georeference.
  let transform: GeoTiff["transform"];
  const matrix = nums(34264);
  const tie = nums(33922);
  const scale = nums(33550);
  if (matrix.length >= 16)
    transform = [matrix[3]!, matrix[0]!, matrix[1]!, matrix[7]!, matrix[4]!, matrix[5]!];
  else if (tie.length >= 6 && scale.length >= 2)
    transform = [tie[3]! - tie[0]! * scale[0]!, scale[0]!, 0, tie[4]! + tie[1]! * scale[1]!, 0, -scale[1]!];
  else throw new GeoTiffError("The TIFF file has no georeference (it is not a GeoTIFF)");
  if (![transform[1], transform[5]].every((v) => Number.isFinite(v) && v !== 0))
    throw new GeoTiffError("The GeoTIFF pixel size is zero");

  // GeoKeys.
  const keys = new Map<number, number | string>();
  const dir = nums(34735);
  const ascii = typeof tags.get(34737) === "string" ? (tags.get(34737) as string) : "";
  const doubles = nums(34736);
  for (let k = 4; k + 3 < dir.length && k < 4 + 4 * (dir[3] ?? 0); k += 4) {
    const [id, loc, count, value] = [dir[k]!, dir[k + 1]!, dir[k + 2]!, dir[k + 3]!];
    if (loc === 0) keys.set(id, value);
    else if (loc === 34737) keys.set(id, ascii.slice(value, value + count).replace(/[|\0]+$/, ""));
    else if (loc === 34736) keys.set(id, doubles[value] ?? NaN);
  }
  const model = keys.get(1024);
  const geographic = model === 2;
  const code = (k: number) => {
    const v = keys.get(k);
    return typeof v === "number" && v > 0 && v < 32767 ? v : null;
  };
  const epsg = geographic ? code(2048) : (code(3072) ?? (model === undefined ? code(2048) : null));
  const citation = [keys.get(3073), keys.get(1026), keys.get(2049)].find((v) => typeof v === "string") as
    string | undefined;
  if (keys.get(1025) === 2) {
    // RasterPixelIsPoint: the tie point names a pixel centre; move it to the corner.
    transform[0] -= 0.5 * (transform[1] + transform[2]);
    transform[3] -= 0.5 * (transform[4] + transform[5]);
  }
  const nd = tags.get(42113);
  const noDataRaw = typeof nd === "string" && nd.trim() !== "" ? Number(nd) : null;
  const noData = noDataRaw !== null && Number.isFinite(noDataRaw) ? noDataRaw : null;

  // Chunks: tiles, or strips as tiles one image wide.
  const tiled = tags.has(322);
  const cw = tiled ? num(322) : width;
  const ch = tiled ? num(323) : Math.min(num(278, height), height);
  const offsets = tiled ? nums(324) : nums(273);
  const counts = tiled ? nums(325) : nums(279);
  const across = Math.ceil(width / cw);
  const down = Math.ceil(height / ch);
  const perPlane = across * down;
  const spp = planar === 2 ? 1 : bands;
  const bytesPer = bits / 8;
  if (offsets.length < perPlane || counts.length < perPlane)
    throw new GeoTiffError("The TIFF chunk index is damaged");
  if (cw * ch * spp * bytesPer > MAX_CHUNK_BYTES)
    throw new GeoTiffError("The TIFF tiles or strips are too large");

  const decodeChunk = async (index: number): Promise<Float64Array> => {
    // Strips at the bottom may hold fewer rows.
    const rows = tiled ? ch : Math.min(ch, height - Math.floor(index / across) * ch);
    const n = cw * rows;
    const size = n * spp * bytesPer;
    const len = counts[index]!;
    let bytes: Uint8Array;
    if (len === 0) bytes = new Uint8Array(size);
    else {
      const raw = await read(offsets[index]!, len);
      if (compression === 1) bytes = raw;
      else if (compression === 5) bytes = lzwDecode(raw, size);
      else if (compression === 32773) bytes = packBitsDecode(raw, size);
      else {
        try {
          bytes = inflateSync(raw, { maxOutputLength: Math.max(size, 1) });
        } catch {
          throw new GeoTiffError("The GeoTIFF file has damaged Deflate data");
        }
      }
    }
    if (bytes.length < size) {
      const pad = new Uint8Array(size);
      pad.set(bytes);
      bytes = pad;
    }
    const rowBytes = cw * spp * bytesPer;
    let view: DataView;
    let le = little;
    if (predictor === 3) {
      // Floating point predictor: per row, bytes differenced, then split into planes, most significant first.
      const out = new Uint8Array(size);
      for (let r = 0; r < rows; r++) {
        const row = bytes.slice(r * rowBytes, (r + 1) * rowBytes);
        for (let i = spp; i < row.length; i++) row[i] = (row[i]! + row[i - spp]!) & 0xff;
        const samples = cw * spp;
        for (let s = 0; s < samples; s++)
          for (let b = 0; b < bytesPer; b++) out[r * rowBytes + s * bytesPer + b] = row[b * samples + s]!;
      }
      view = new DataView(out.buffer);
      le = false;
    } else {
      const copy = bytes.slice(0, size);
      view = new DataView(copy.buffer);
      if (predictor === 2) {
        // Horizontal differencing of whole samples, row by row.
        for (let r = 0; r < rows; r++)
          for (let x = 1; x < cw; x++)
            for (let s = 0; s < spp; s++) {
              const at = r * rowBytes + (x * spp + s) * bytesPer;
              const prev = at - spp * bytesPer;
              if (bytesPer === 1) view.setUint8(at, (view.getUint8(at) + view.getUint8(prev)) & 0xff);
              else if (bytesPer === 2)
                view.setUint16(at, (view.getUint16(at, le) + view.getUint16(prev, le)) & 0xffff, le);
              else if (bytesPer === 4)
                view.setUint32(at, (view.getUint32(at, le) + view.getUint32(prev, le)) >>> 0, le);
              else
                view.setBigUint64(
                  at,
                  BigInt.asUintN(64, view.getBigUint64(at, le) + view.getBigUint64(prev, le)),
                  le,
                );
            }
      }
    }
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const at = i * spp * bytesPer;
      let v: number;
      if (format === 3) v = bytesPer === 4 ? view.getFloat32(at, le) : view.getFloat64(at, le);
      else if (format === 2)
        v =
          bytesPer === 1
            ? view.getInt8(at)
            : bytesPer === 2
              ? view.getInt16(at, le)
              : bytesPer === 4
                ? view.getInt32(at, le)
                : Number(view.getBigInt64(at, le));
      else
        v =
          bytesPer === 1
            ? view.getUint8(at)
            : bytesPer === 2
              ? view.getUint16(at, le)
              : bytesPer === 4
                ? view.getUint32(at, le)
                : Number(view.getBigUint64(at, le));
      out[i] =
        !Number.isFinite(v) || (noData !== null && (v === noData || Math.fround(v) === Math.fround(noData)))
          ? NaN
          : v;
    }
    return out;
  };

  // A few decoded chunks are kept, since windows usually walk along rows of chunks.
  const cache = new Map<number, Promise<Float64Array>>();
  const chunk = (i: number) => {
    let p = cache.get(i);
    if (!p) {
      p = decodeChunk(i);
      cache.set(i, p);
      if (cache.size > Math.max(8, across + 1)) cache.delete(cache.keys().next().value!);
    }
    return p;
  };

  return {
    width,
    height,
    transform,
    crs: { epsg, geographic, citation: citation ?? null },
    noData,
    bands,
    async window(x0, y0, x1, y1) {
      x0 = Math.max(0, Math.floor(x0));
      y0 = Math.max(0, Math.floor(y0));
      x1 = Math.min(width, Math.ceil(x1));
      y1 = Math.min(height, Math.ceil(y1));
      const w = Math.max(0, x1 - x0);
      const h = Math.max(0, y1 - y0);
      const out = new Float64Array(w * h).fill(NaN);
      for (let ty = Math.floor(y0 / ch); ty * ch < y1; ty++)
        for (let tx = Math.floor(x0 / cw); tx * cw < x1; tx++) {
          const data = await chunk(ty * across + tx);
          const rows = data.length / cw;
          for (let y = Math.max(y0, ty * ch); y < Math.min(y1, ty * ch + rows); y++)
            for (let x = Math.max(x0, tx * cw); x < Math.min(x1, (tx + 1) * cw); x++)
              out[(y - y0) * w + (x - x0)] = data[(y - ty * ch) * cw + (x - tx * cw)]!;
        }
      return out;
    },
  };
}
