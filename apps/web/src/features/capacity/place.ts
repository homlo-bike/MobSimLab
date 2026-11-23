/**
 * Where a point of the track topology lies on the map: a chainage along a topology section
 * (contracts/rail-topology.schema.json: `sections[].geometry` in metres east and north of `origin`), for the
 * advice's "Show on the map".
 */
import { railLonLat } from "../area/outside";
import type { LonLat } from "../street-lines/types";

type Section = { id: string; length_m: number; geometry: [number, number][] };

/** Finds the map position of a chainage on a track. */
export type Locate = (track: string, atM: number) => LonLat | null;

/**
 * Purpose: a locator for a topology export, or null when the text is not a topology with an origin.
 * Inputs: the topology JSON text. The chainage is scaled to the drawn centre line (it may differ slightly
 * from the section length).
 */
export function topologyLocator(text: string | null): Locate | null {
  if (!text) return null;
  let doc: { origin?: LonLat; sections?: Section[] };
  try {
    doc = JSON.parse(text) as typeof doc;
  } catch {
    return null;
  }
  const origin = doc.origin;
  if (!origin || !Array.isArray(doc.sections)) return null;
  const byId = new Map(doc.sections.map((s) => [s.id, s]));
  return (track, atM) => {
    const s = byId.get(track);
    const g = s?.geometry;
    if (!s || !g || g.length === 0) return null;
    const seg = g.slice(1).map((p, i) => Math.hypot(p[0] - g[i]![0], p[1] - g[i]![1]));
    const drawn = seg.reduce((a, b) => a + b, 0);
    let left = s.length_m > 0 ? (Math.max(0, Math.min(atM, s.length_m)) / s.length_m) * drawn : 0;
    for (let i = 0; i < seg.length; i++) {
      const d = seg[i]!;
      if (left <= d && d > 0) {
        const k = left / d;
        const [a, b] = [g[i]!, g[i + 1]!];
        return railLonLat(origin, a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k);
      }
      left -= d;
    }
    const last = g[g.length - 1]!;
    return railLonLat(origin, last[0], last[1]);
  };
}
