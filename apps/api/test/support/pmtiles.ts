import { gunzipSync } from "node:zlib";

/**
 * Test helper: every tile of a PMTiles 3 archive, "z/x/y" → text, read straight from the spec
 * (https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md), so the writer is checked against the spec and
 * not against its own code. Follows leaf directories and run lengths.
 */
export function readArchive(b: Buffer): Map<string, string> {
  if (b.subarray(0, 7).toString("ascii") !== "PMTiles" || b[7] !== 3) throw new Error("not PMTiles 3");
  const n = (at: number) => Number(b.readBigUInt64LE(at));
  const [rootAt, rootLen, leavesAt, dataAt] = [n(8), n(16), n(40), n(56)];
  const unzip = (x: Buffer, flag: number) => (flag === 2 ? gunzipSync(x) : x);
  const out = new Map<string, string>();
  const walk = (dir: Buffer) => {
    let p = 0;
    const v = () => {
      let r = 0;
      let m = 1;
      for (;;) {
        const c = dir[p++]!;
        r += (c & 0x7f) * m;
        if (c < 0x80) return r;
        m *= 128;
      }
    };
    const count = v();
    const ids: number[] = [];
    let last = 0;
    for (let i = 0; i < count; i++) ids.push((last += v()));
    const runs = ids.map(() => v());
    const lens = ids.map(() => v());
    const offs: number[] = [];
    for (let i = 0; i < count; i++) {
      const o = v();
      offs.push(o === 0 && i > 0 ? offs[i - 1]! + lens[i - 1]! : o - 1);
    }
    for (let i = 0; i < count; i++) {
      if (runs[i] === 0) walk(unzip(b.subarray(leavesAt + offs[i]!, leavesAt + offs[i]! + lens[i]!), b[97]!));
      else
        for (let r = 0; r < runs[i]!; r++) {
          const body = unzip(b.subarray(dataAt + offs[i]!, dataAt + offs[i]! + lens[i]!), b[98]!).toString(
            "utf8",
          );
          out.set(zxy(ids[i]! + r), body);
        }
    }
  };
  walk(unzip(b.subarray(rootAt, rootAt + rootLen), b[97]!));
  return out;
}

/** The z/x/y of a Hilbert tile id (spec §2.3, the inverse of the writer's numbering). */
function zxy(id: number): string {
  let acc = 0;
  for (let z = 0; z < 27; z++) {
    const count = 4 ** z;
    if (id < acc + count) {
      let t = id - acc;
      const size = 2 ** z;
      let x = 0;
      let y = 0;
      for (let s = 1; s < size; s *= 2) {
        const rx = 1 & (t / 2);
        const ry = 1 & (t ^ rx);
        if (ry === 0) {
          if (rx === 1) {
            x = s - 1 - x;
            y = s - 1 - y;
          }
          [x, y] = [y, x];
        }
        x += s * rx;
        y += s * ry;
        t = Math.floor(t / 4);
      }
      return `${z}/${x}/${y}`;
    }
    acc += count;
  }
  throw new Error("tile id out of range");
}
