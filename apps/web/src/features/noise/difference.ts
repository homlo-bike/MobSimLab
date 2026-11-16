/**
 * The difference map between two scenarios (ADR-0038 §1.2, step N3): both are computed on one grid with the
 * same buildings, terrain and population, and each cell shows how many dB the scenario is louder or quieter
 * than the one it is compared to. The colour classes come from the noise plugin's style (`difference`).
 */
import { pluginMapLayers } from "../../plugins/registry";
import type { NoiseExposure } from "./types";

/** One class of the difference map: its lower edge in dB (null: none) and colour (null: not drawn). */
export interface DifferenceClass {
  from_db: number | null;
  color: string | null;
}

const style = (pluginMapLayers("noise_estimate")[0]?.style ?? {}) as { difference?: DifferenceClass[] };

/** The classes of the difference map, lowest first. */
export const DIFFERENCE: DifferenceClass[] = style.difference ?? [];

/**
 * Purpose: the change at each cell of two levels on the same grid, `a` minus `b`, where the map shows it.
 * A cell shows when both are computed (not beyond the reach, not inside a building) and either scenario
 * reaches `fromDb` there. A cell no line of one scenario reaches counts as a change of ±infinity.
 * Output: dB per cell in the grids' order, NaN where nothing is shown.
 */
export function differenceLevels(a: ArrayLike<number>, b: ArrayLike<number>, fromDb: number): Float32Array {
  const out = new Float32Array(a.length).fill(Number.NaN);
  for (let k = 0; k < a.length; k++) {
    const x = a[k]!;
    const y = b[k]!;
    if (Number.isNaN(x) || Number.isNaN(y)) continue;
    if (Math.max(x, y) < fromDb) continue;
    out[k] = x === y ? 0 : x - y;
  }
  return out;
}

/** Purpose: the class a change falls in, or -1. */
export function differenceClass(d: number, classes: readonly DifferenceClass[] = DIFFERENCE): number {
  if (Number.isNaN(d)) return -1;
  for (let i = classes.length - 1; i >= 0; i--) {
    const from = classes[i]!.from_db;
    if (from === null || d >= from) return i;
  }
  return -1;
}

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Purpose: the difference map as RGBA pixels, north row first, for the map's image source.
 * Inputs: the change per cell with rows from the south (`differenceLevels`), the grid size and the opacity.
 */
export function differencePixels(
  d: ArrayLike<number>,
  width: number,
  height: number,
  alpha = 255,
  classes: readonly DifferenceClass[] = DIFFERENCE,
): Uint8Array {
  const colours = classes.map((c) => (c.color ? rgb(c.color) : null));
  const out = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    const j = height - 1 - row;
    for (let i = 0; i < width; i++) {
      const c = colours[differenceClass(d[j * width + i]!, classes)];
      if (!c) continue;
      const k = (row * width + i) * 4;
      out[k] = c[0];
      out[k + 1] = c[1];
      out[k + 2] = c[2];
      out[k + 3] = alpha;
    }
  }
  return out;
}

/** One reporting band of the exposure table in both scenarios. */
export interface ExposureRow {
  from_db: number;
  buildings: [number, number];
  people: [number, number] | null;
}

/**
 * Purpose: buildings and residents per reporting band in the scenario and the one it is compared to, which
 * share buildings and population, so the change per band is the scenario's effect.
 */
export function exposureRows(
  a: NoiseExposure,
  b: NoiseExposure,
  indicator: "lden" | "lnight",
): ExposureRow[] {
  const ra = a[indicator];
  const rb = b[indicator];
  const people = !!a.people && !!b.people;
  return ra.from_db.map((from, i) => ({
    from_db: from,
    buildings: [ra.buildings[i] ?? 0, rb.buildings[i] ?? 0],
    people: people ? [ra.people[i] ?? 0, rb.people[i] ?? 0] : null,
  }));
}
