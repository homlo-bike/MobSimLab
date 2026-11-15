/**
 * Sea, lakes and rivers for the Schematic tab (ADR-0040 §8): OSM water inside a bounding box, simplified and
 * ready to draw. Lakes and river areas are polygons; rivers and canals without an area are centre lines; the
 * sea is built from the coastline (land on the left of each way, water on the right) and the box edge.
 * Data © OpenStreetMap contributors, ODbL.
 */

export type Pt = [number, number];
/** `[west, south, east, north]`. */
export type Bbox = [number, number, number, number];

/** Largest box side accepted, degrees (about 110 km north–south): larger areas would take Overpass too long. */
export const MAX_WATER_SPAN_DEG = 1;

export interface WaterShapes {
  /** Lakes, reservoirs and river areas: rings `[lon, lat]`, closed. Inner rings (islands) are listed too and
   * drawn with the even-odd rule. */
  areas: Pt[][];
  /** Rivers and canals as centre lines. */
  rivers: { line: Pt[]; kind: "river" | "canal" }[];
  /** Sea inside the box: rings, closed; islands inside it are listed as further rings (even-odd). */
  sea: Pt[][];
}

/**
 * Purpose: Overpass QL for the water of a box: water areas (ways and multipolygons), rivers and canals, and
 * the coastline, with their geometry.
 */
export function waterQuery(b: Bbox): string {
  const box = [b[1], b[0], b[3], b[2]].map((v) => v.toFixed(6)).join(",");
  return (
    `[out:json][timeout:120][maxsize:134217728];(` +
    `way["natural"="water"](${box});` +
    `rel["natural"="water"]["type"="multipolygon"](${box});` +
    `way["waterway"="riverbank"](${box});` +
    `rel["waterway"="riverbank"]["type"="multipolygon"](${box});` +
    `way["landuse"="reservoir"](${box});` +
    `way["waterway"~"^(river|canal)$"](${box});` +
    `way["natural"="coastline"](${box});` +
    `);out tags geom;`
  );
}

interface El {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: ({ lat: number; lon: number } | null)[];
  members?: { type: string; role: string; geometry?: ({ lat: number; lon: number } | null)[] }[];
}

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
const pts = (g: El["geometry"]): Pt[] =>
  (g ?? []).filter((p): p is { lat: number; lon: number } => !!p).map((p) => [r6(p.lon), r6(p.lat)]);
const same = (a: Pt, b: Pt) => a[0] === b[0] && a[1] === b[1];

/** Purpose: the area of a ring in square degrees (shoelace; positive when counter-clockwise). */
export function ringArea(r: readonly Pt[]): number {
  let a = 0;
  for (let i = 1; i < r.length; i++) a += r[i - 1]![0] * r[i]![1] - r[i]![0] * r[i - 1]![1];
  return a / 2;
}

/** Purpose: a line simplified with Douglas–Peucker to `tol` (degrees); ends kept. */
export function simplify(line: readonly Pt[], tol: number): Pt[] {
  if (line.length <= 2) return [...line];
  const keep = new Array<boolean>(line.length).fill(false);
  keep[0] = keep[line.length - 1] = true;
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const [ax, ay] = line[i]!;
    const [bx, by] = line[j]!;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    let best = -1;
    let bestD = tol;
    for (let k = i + 1; k < j; k++) {
      const [px, py] = line[k]!;
      const d = len < 1e-12 ? Math.hypot(px - ax, py - ay) : Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
      if (d > bestD) {
        bestD = d;
        best = k;
      }
    }
    if (best >= 0) {
      keep[best] = true;
      stack.push([i, best], [best, j]);
    }
  }
  return line.filter((_, k) => keep[k]);
}

/** Purpose: closed rings from way pieces (multipolygon members), joined end to end; open leftovers dropped. */
export function joinRings(pieces: Pt[][]): Pt[][] {
  const left = pieces.filter((p) => p.length >= 2).map((p) => [...p]);
  const out: Pt[][] = [];
  while (left.length) {
    let ring = left.shift()!;
    let grew = true;
    while (!same(ring[0]!, ring[ring.length - 1]!) && grew) {
      grew = false;
      for (let i = 0; i < left.length; i++) {
        const p = left[i]!;
        const end = ring[ring.length - 1]!;
        if (same(p[0]!, end)) ring = [...ring, ...p.slice(1)];
        else if (same(p[p.length - 1]!, end)) ring = [...ring, ...[...p].reverse().slice(1)];
        else continue;
        left.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (ring.length >= 4 && same(ring[0]!, ring[ring.length - 1]!)) out.push(ring);
  }
  return out;
}

/** Purpose: coastline ways joined into chains end to start (direction kept: land on the left). */
export function joinChains(ways: Pt[][]): Pt[][] {
  const left = ways.filter((w) => w.length >= 2).map((w) => [...w]);
  const out: Pt[][] = [];
  while (left.length) {
    let c = left.shift()!;
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = 0; i < left.length; i++) {
        const w = left[i]!;
        if (same(w[0]!, c[c.length - 1]!)) c = [...c, ...w.slice(1)];
        else if (same(w[w.length - 1]!, c[0]!)) c = [...w, ...c.slice(1)];
        else continue;
        left.splice(i, 1);
        grew = true;
        break;
      }
    }
    out.push(c);
  }
  return out;
}

const inside = (p: Pt, b: Bbox) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];

/** Purpose: the parts of a polyline inside a box (Liang–Barsky per segment), in order. */
export function clipLine(line: readonly Pt[], b: Bbox): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  for (let i = 1; i < line.length; i++) {
    const p = line[i - 1]!;
    const q = line[i]!;
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    let t0 = 0;
    let t1 = 1;
    let ok = true;
    for (const [pv, qv] of [
      [-dx, p[0] - b[0]],
      [dx, b[2] - p[0]],
      [-dy, p[1] - b[1]],
      [dy, b[3] - p[1]],
    ] as const) {
      if (pv === 0) {
        if (qv < 0) ok = false;
        continue;
      }
      const r = qv / pv;
      if (pv < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
    }
    if (!ok || t0 > t1) {
      if (cur.length >= 2) out.push(cur);
      cur = [];
      continue;
    }
    const a: Pt = [p[0] + dx * t0, p[1] + dy * t0];
    const c: Pt = [p[0] + dx * t1, p[1] + dy * t1];
    if (!cur.length) cur.push(a);
    cur.push(c);
    if (t1 < 1) {
      if (cur.length >= 2) out.push(cur);
      cur = [];
    }
  }
  if (cur.length >= 2) out.push(cur);
  return out;
}

/** Purpose: where a point on the box edge lies along the edge, clockwise from the north-west corner (0 to 4). */
function edgeParam(p: Pt, b: Bbox): number {
  const w = b[2] - b[0];
  const h = b[3] - b[1];
  const e = 1e-9;
  if (Math.abs(p[1] - b[3]) < e) return (p[0] - b[0]) / w; // north, west to east
  if (Math.abs(p[0] - b[2]) < e) return 1 + (b[3] - p[1]) / h; // east, north to south
  if (Math.abs(p[1] - b[1]) < e) return 2 + (b[2] - p[0]) / w; // south, east to west
  return 3 + (p[1] - b[1]) / h; // west, south to north
}

/** The box corners at edge positions 1, 2, 3 and 4 (= 0): north-east, south-east, south-west, north-west. */
function corner(k: number, b: Bbox): Pt {
  return [
    [b[2], b[3]],
    [b[2], b[1]],
    [b[0], b[1]],
    [b[0], b[3]],
  ][(k - 1) % 4]! as Pt;
}

/**
 * Purpose: the sea inside a box from coastline chains (land on the left, water on the right).
 * Chains crossing the box are cut at its edge and closed clockwise along it; closed chains inside are
 * islands (or, oriented clockwise, lakes of sea water seen from inside). Output: rings for the even-odd rule;
 * none when the box holds no coastline.
 */
export function seaRings(chains: readonly Pt[][], b: Bbox): Pt[][] {
  const pieces: Pt[][] = [];
  const islands: Pt[][] = [];
  for (const c of chains) {
    const closed = c.length >= 4 && same(c[0]!, c[c.length - 1]!);
    if (closed && c.every((p) => inside(p, b))) islands.push(c);
    else
      for (const piece of clipLine(c, b)) {
        // A piece that starts or ends inside the box (an unfinished coastline) cannot be closed: skip it.
        const onEdge = (p: Pt) => !inside(p, [b[0] + 1e-9, b[1] + 1e-9, b[2] - 1e-9, b[3] - 1e-9]);
        if (onEdge(piece[0]!) && onEdge(piece[piece.length - 1]!)) pieces.push(piece);
      }
  }
  if (!pieces.length) {
    if (!islands.length) return [];
    // Only islands: the box is sea around them.
    const box: Pt[] = [[b[0], b[3]], [b[2], b[3]], [b[2], b[1]], [b[0], b[1]], [b[0], b[3]]];
    return [box, ...islands];
  }
  const entries = pieces.map((p) => edgeParam(p[0]!, b));
  const used = new Array<boolean>(pieces.length).fill(false);
  const rings: Pt[][] = [];
  for (let start = 0; start < pieces.length; start++) {
    if (used[start]) continue;
    const ring: Pt[] = [];
    let i = start;
    for (let guard = 0; guard <= pieces.length; guard++) {
      used[i] = true;
      ring.push(...pieces[i]!);
      // Walk clockwise along the edge from this exit to the next entry.
      const exit = edgeParam(pieces[i]![pieces[i]!.length - 1]!, b);
      let next = -1;
      let bestGap = Infinity;
      entries.forEach((e, k) => {
        const gap = (e - exit + 4) % 4;
        if (gap < bestGap && (!used[k] || k === start)) {
          bestGap = gap;
          next = k;
        }
      });
      if (next < 0) break;
      for (let c = Math.floor(exit) + 1; c <= exit + bestGap; c++) ring.push(corner(c, b));
      if (next === start) break;
      i = next;
    }
    ring.push(ring[0]!);
    rings.push(ring);
  }
  return [...rings, ...islands];
}

/**
 * Purpose: the water shapes from an Overpass JSON answer for a box: simplified to about 1/1500 of the box,
 * without areas smaller than 1/20000 of it.
 */
export function waterShapes(json: string, b: Bbox): WaterShapes {
  const els = (JSON.parse(json) as { elements?: El[] }).elements ?? [];
  const span = Math.max(b[2] - b[0], b[3] - b[1]);
  const tol = span / 1500;
  const minArea = (b[2] - b[0]) * (b[3] - b[1]) * 5e-5;
  const areas: Pt[][] = [];
  const rivers: WaterShapes["rivers"] = [];
  const coast: Pt[][] = [];
  for (const e of els) {
    const t = e.tags ?? {};
    if (t.natural === "coastline") {
      coast.push(pts(e.geometry));
      continue;
    }
    if (e.type === "way" && (t.waterway === "river" || t.waterway === "canal")) {
      const line = simplify(pts(e.geometry), tol);
      if (line.length >= 2) rivers.push({ line, kind: t.waterway });
      continue;
    }
    const rings =
      e.type === "way"
        ? joinRings([pts(e.geometry)])
        : [
            ...joinRings((e.members ?? []).filter((m) => m.role === "outer").map((m) => pts(m.geometry))),
            ...joinRings((e.members ?? []).filter((m) => m.role === "inner").map((m) => pts(m.geometry))),
          ];
    for (const r of rings) {
      if (Math.abs(ringArea(r)) < minArea) continue;
      const s = simplify(r, tol);
      if (s.length >= 4) areas.push(s);
    }
  }
  const sea = seaRings(joinChains(coast), b).map((r) => simplify(r, tol));
  return { areas, rivers, sea };
}
