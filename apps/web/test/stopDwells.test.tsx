import { describe, expect, it } from "vitest";
import {
  type DwellModel,
  stopDwells,
  trainDwell,
  trainsPerHour,
  withStopDwells,
} from "../src/features/capacity/dwells";
import type { LoadLine } from "../src/features/capacity/loads";
import type { ServiceDay } from "../src/features/journey-planner/network";

const H = 3600;
const MODEL: DwellModel = { door_s: 5, board_s: 1.5, alight_s: 1.2, channels_per_100m: 40, peaking: 1.3 };
const DAY: ServiceDay = {
  firstS: 5 * H,
  lastS: 24 * H,
  peaks: [
    [7 * H, 9 * H],
    [16 * H, 19 * H],
  ],
};
const SHARES = { peakHour: 0.1, peakDirection: 0.6 };

/** A metro A – B – C, 12 trains an hour each way. */
function line(boardings: Record<string, number>): LoadLine {
  return {
    id: "M1",
    name: "M1",
    sequences: [
      ["A", "B", "C"],
      ["C", "B", "A"],
    ],
    loop: false,
    boardings,
    capacity: 1000,
    perHour: () => 12,
  };
}

describe("dwell at busy stops", () => {
  it("lets the busiest door channel's share off and on", () => {
    // 5 + 1.3 × (20 × 1.5 + 10 × 1.2) / 10 = 10.46.
    expect(trainDwell(20, 10, 10, MODEL)).toBe(11);
    expect(trainDwell(0, 0, 10, MODEL)).toBe(5);
  });

  it("makes a busy stop longer than the usual dwell and leaves quiet ones alone", () => {
    // B's riders all alight at A and C, so those stand longer too, but less than B.
    const busy = stopDwells(line({ A: 2000, B: 200000, C: 1000 }), 120, 20, MODEL, 7 * H, 9 * H, SHARES, DAY);
    const [a, b] = busy.dwells as number[];
    expect(b).toBeGreaterThan(20);
    expect(b).toBeGreaterThan(a!);
    expect(busy.longest).toEqual({ station: "B", dwell_s: b, usual_s: 20 });
    const quiet = stopDwells(line({ A: 100, B: 100, C: 100 }), 120, 20, MODEL, 7 * H, 9 * H, SHARES, DAY);
    expect(quiet.dwells).toEqual([null, null, null]);
    expect(quiet.longest).toBeNull();
  });

  it("gives a shorter train fewer doors and so a longer dwell", () => {
    const b = { A: 2000, B: 200000, C: 2000 };
    const long = stopDwells(line(b), 120, 20, MODEL, 7 * H, 9 * H, SHARES, DAY).dwells[1]!;
    const short = stopDwells(line(b), 60, 20, MODEL, 7 * H, 9 * H, SHARES, DAY).dwells[1]!;
    expect(short).toBeGreaterThan(long);
  });

  it("counts trains from the peak and off-peak headways", () => {
    const l = { first_s: 5 * H, last_s: 24 * H, peak_headway_s: 300, offpeak_headway_s: 600 };
    expect(trainsPerHour(l, 7 * H)).toBe(12);
    expect(trainsPerHour(l, 11 * H)).toBe(6);
    expect(trainsPerHour(l, 2 * H)).toBe(0);
    expect(trainsPerHour({ ...l, peaks: [[11 * H, 12 * H]] }, 11 * H)).toBe(12);
  });

  it("puts the dwells into the lines that have any", () => {
    const text = JSON.stringify({ service_lines: [{ id: "M1" }, { id: "M2" }] });
    const out = JSON.parse(withStopDwells(text, { M1: [null, 45, null], M2: [null, null] }));
    expect(out.service_lines[0].stop_dwells_s).toEqual([null, 45, null]);
    expect(out.service_lines[1].stop_dwells_s).toBeUndefined();
    expect(withStopDwells(text, { M1: [null] })).toBe(text);
  });
});
