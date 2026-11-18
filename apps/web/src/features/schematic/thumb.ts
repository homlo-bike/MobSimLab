import type { Pt } from "./layout";

/** A small picture of the schematic network for the project card: its lines in a `w` × `h` box. */
export interface SchematicThumb {
  w: number;
  h: number;
  lines: { color: string; points: Pt[] }[];
}

/** Size of the project card's picture. */
export const THUMB_W = 280;
export const THUMB_H = 96;
const PAD = 8;
const MAX_LINES = 100;
const MAX_POINTS = 200;

/**
 * Purpose: shrink the drawn lines (drawing pixels, y down) into the project card's box, keeping the shape:
 * scaled to fit with a margin and centred, points closer than 1.5 px dropped, rounded to 0.1 px.
 * Output: null when there are no lines.
 */
export function schematicThumb(
  lines: readonly { color: string; pts: readonly Pt[] }[],
): SchematicThumb | null {
  const used = lines
    .filter((l) => l.pts.length >= 2 && /^#[0-9a-fA-F]{6}$/.test(l.color))
    .slice(0, MAX_LINES);
  if (!used.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const l of used)
    for (const [x, y] of l.pts) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  const s = Math.min(
    (THUMB_W - 2 * PAD) / Math.max(maxX - minX, 1e-9),
    (THUMB_H - 2 * PAD) / Math.max(maxY - minY, 1e-9),
  );
  const ox = (THUMB_W - (maxX - minX) * s) / 2;
  const oy = (THUMB_H - (maxY - minY) * s) / 2;
  const r = (v: number) => Math.round(v * 10) / 10;
  const out: SchematicThumb["lines"] = [];
  for (const l of used) {
    const pts: Pt[] = [];
    l.pts.forEach(([x, y], k) => {
      const p: Pt = [r(ox + (x - minX) * s), r(oy + (y - minY) * s)];
      const last = pts[pts.length - 1];
      if (last && k < l.pts.length - 1 && Math.hypot(p[0] - last[0], p[1] - last[1]) < 1.5) return;
      pts.push(p);
    });
    // Keep the ends and an even share of the rest.
    const kept =
      pts.length <= MAX_POINTS
        ? pts
        : Array.from(
            { length: MAX_POINTS },
            (_, k) => pts[Math.round((k * (pts.length - 1)) / (MAX_POINTS - 1))]!,
          );
    if (kept.length >= 2) out.push({ color: l.color.toLowerCase(), points: kept });
  }
  return out.length ? { w: THUMB_W, h: THUMB_H, lines: out } : null;
}
