import { describe, expect, it } from "vitest";
import type { AreaPolygon } from "../src/projects/area-polygons";
import { coarsenMain, MAIN_CELL_DEG } from "../src/population/coarsen";

const square = (id: string, w: number, s: number, side: number, detail: "full" | "main"): AreaPolygon => ({
  id,
  name: id,
  detail,
  ring: [
    [w, s],
    [w + side, s],
    [w + side, s + side],
    [w, s + side],
    [w, s],
  ],
});

/** 100 m cells (3 arc-seconds) over a box, one person each. */
function cells(w: number, s: number, nx: number, ny: number) {
  const d = 1 / 1200;
  const out = {
    w: [] as number[],
    s: [] as number[],
    e: [] as number[],
    n: [] as number[],
    p: [] as number[],
  };
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      out.w.push(w + i * d);
      out.s.push(s + j * d);
      out.e.push(w + (i + 1) * d);
      out.n.push(s + (j + 1) * d);
      out.p.push(1);
    }
  return out;
}

describe("population of main-roads-only polygons", () => {
  it("keeps cells as they are without main polygons", () => {
    const c = cells(7, 50, 4, 4);
    expect(coarsenMain(c, [square("a", 6.9, 49.9, 0.5, "full")])).toBe(c);
  });

  it("sums cells only in main polygons into 1 km cells and keeps Full ones, with the same total", () => {
    // 20 × 20 cells of 100 m from 7.0 E, 50.0 N: the south-west quarter lies in a Full polygon, the rest only in a
    // main one.
    const c = cells(7, 50, 20, 20);
    const out = coarsenMain(c, [
      square("town", 6.9, 49.9, 0.108, "full"),
      square("m", 6.9, 49.9, 0.5, "main"),
    ]);
    const total = out.p.reduce((a, b) => a + b, 0);
    expect(total).toBe(400);
    const coarse = out.e.map((e, i) => e - out.w[i]!).filter((d) => Math.abs(d - MAIN_CELL_DEG) < 1e-9);
    const fine = out.e.map((e, i) => e - out.w[i]!).filter((d) => Math.abs(d - 1 / 1200) < 1e-9);
    expect(fine.length).toBe(10 * 10);
    expect(coarse.length).toBeGreaterThan(0);
    expect(coarse.length).toBeLessThan(10);
    expect(out.p.length).toBeLessThan(c.p.length);
  });
});
