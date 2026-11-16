import { deflateSync } from "node:zlib";

/**
 * A small GLO-30-like COG: 8×8 pixels in 4×4 tiles over the cell N50 E007, float32, DEFLATE,
 * floating-point predictor. Height = 100 + col + 10 × row, so bilinear values are easy to check.
 */
export const W = 8;
const T = 4;
export const height = (col: number, row: number) => 100 + col + 10 * row;

function predictRow(values: number[]): Uint8Array {
  const w = values.length;
  const f = new DataView(new ArrayBuffer(4 * w));
  values.forEach((v, i) => f.setFloat32(4 * i, v, false)); // big-endian: byte 0 is the most significant
  const planes = new Uint8Array(4 * w);
  for (let x = 0; x < w; x++) for (let k = 0; k < 4; k++) planes[k * w + x] = f.getUint8(4 * x + k);
  const out = new Uint8Array(4 * w);
  for (let i = 0; i < out.length; i++) out[i] = (planes[i]! - (i ? planes[i - 1]! : 0)) & 0xff;
  return out;
}

export function buildCog(): Uint8Array {
  const tiles: Uint8Array[] = [];
  for (let ty = 0; ty < W / T; ty++)
    for (let tx = 0; tx < W / T; tx++) {
      const rows: Uint8Array[] = [];
      for (let r = 0; r < T; r++)
        rows.push(predictRow(Array.from({ length: T }, (_, c) => height(tx * T + c, ty * T + r))));
      tiles.push(deflateSync(Buffer.concat(rows)));
    }
  const scale = 1 / W;
  const entries: Array<[number, number, number[]]> = [
    [256, 3, [W]],
    [257, 3, [W]],
    [258, 3, [32]],
    [259, 3, [8]],
    [277, 3, [1]],
    [317, 3, [3]],
    [322, 3, [T]],
    [323, 3, [T]],
    [324, 4, [0, 0, 0, 0]],
    [325, 4, tiles.map((t) => t.length)],
    [339, 3, [3]],
    [33550, 12, [scale, scale, 0]],
    [33922, 12, [0, 0, 0, 7 - scale / 2, 51 + scale / 2, 0]],
  ];
  const ifd = 8;
  const size = (t: number) => ({ 3: 2, 4: 4, 12: 8 })[t as 3 | 4 | 12];
  let extra = ifd + 2 + entries.length * 12 + 4;
  const layout = entries.map(([, type, vals]) => {
    const n = size(type) * vals.length;
    if (n <= 4) return -1;
    const at = extra;
    extra += n;
    return at;
  });
  let dataAt = extra;
  entries[8]![2] = tiles.map((t) => {
    const at = dataAt;
    dataAt += t.length;
    return at;
  });
  const buf = new Uint8Array(dataAt);
  const dv = new DataView(buf.buffer);
  buf.set([0x49, 0x49]);
  dv.setUint16(2, 42, true);
  dv.setUint32(4, ifd, true);
  dv.setUint16(ifd, entries.length, true);
  entries.forEach(([tag, type, vals], i) => {
    const e = ifd + 2 + i * 12;
    dv.setUint16(e, tag, true);
    dv.setUint16(e + 2, type, true);
    dv.setUint32(e + 4, vals.length, true);
    const at = layout[i]! < 0 ? e + 8 : layout[i]!;
    if (layout[i]! >= 0) dv.setUint32(e + 8, at, true);
    vals.forEach((v, k) => {
      if (type === 3) dv.setUint16(at + 2 * k, v, true);
      else if (type === 4) dv.setUint32(at + 4 * k, v, true);
      else dv.setFloat64(at + 8 * k, v, true);
    });
  });
  let at = extra;
  for (const t of tiles) {
    buf.set(t, at);
    at += t.length;
  }
  return buf;
}
