/**
 * How long trains stand at each stop in the system test, from the passengers boarding and alighting there.
 *
 * A train stands for its doors to open and close, plus the time its busiest door channel takes to let its
 * share of the people off and on (`dwell.*` in the assumption library, the planner's dwell model in
 * `crates/rail-plan/src/demand.rs`): ceil(door + peaking × (boarders × board + alighters × alight) / channels),
 * where the channels are `dwell.door_channels_per_100m` over the train's length. Boarders and alighters per
 * train come from the passenger loads (`loads.ts`) divided by the trains of the hour. A stop never gets less
 * than the line's usual dwell; the busiest hour of the period, in either direction, sets it.
 */
import { paramNumber } from "../../workspace/preferences";
import { projectServiceDay, type ServiceDay } from "../journey-planner/network";
import { hourBoardings, hourFlows, type LoadLine, type LoadShares, peakDirection } from "./loads";

/** The dwell model's values. */
export interface DwellModel {
  door_s: number;
  board_s: number;
  alight_s: number;
  channels_per_100m: number;
  peaking: number;
}

/** Purpose: the dwell model's values for a mode from the project's values (else the library's). */
export function dwellModel(prefs: Record<string, number> | undefined, mode: string): DwellModel {
  return {
    door_s: paramNumber("dwell.door_open_close_s", prefs, mode),
    board_s: paramNumber("dwell.board_s_per_pax", prefs, mode),
    alight_s: paramNumber("dwell.alight_s_per_pax", prefs, mode),
    channels_per_100m: paramNumber("dwell.door_channels_per_100m", prefs, mode),
    peaking: paramNumber("dwell.door_peaking", prefs, mode),
  };
}

/** Purpose: one train's dwell, s, for the people boarding and alighting it. */
export function trainDwell(boarders: number, alighters: number, channels: number, m: DwellModel): number {
  const work = boarders * m.board_s + alighters * m.alight_s;
  return Math.ceil(m.door_s + (m.peaking * work) / Math.max(1, channels));
}

/** A train line's stops' dwells. */
export interface StopDwells {
  /** Per station of the line (in its order), the dwell where it is longer than the usual one, else null. */
  dwells: (number | null)[];
  /** The longest of them, or null when no stop is busy enough. */
  longest: { station: string; dwell_s: number; usual_s: number } | null;
}

/**
 * Purpose: the dwell at each station of a train line in a period.
 * Inputs: the line as the loads see it (`sequences[0]` the stations in order, `[1]` the way back), the train's
 * length (m), the line's usual dwell (s), the dwell model, the period (s after midnight), the load shares and
 * the service day for the peak windows.
 */
export function stopDwells(
  line: LoadLine,
  trainLengthM: number,
  usualS: number,
  model: DwellModel,
  fromS: number,
  toS: number,
  shares: LoadShares,
  day: ServiceDay = projectServiceDay(),
): StopDwells {
  const stations = line.sequences[0] ?? [];
  const n = stations.length;
  const best = new Array<number>(n).fill(usualS);
  const channels = (model.channels_per_100m * trainLengthM) / 100;
  for (let h = Math.floor(fromS / 3600) * 3600; h < toS; h += 3600) {
    const trains = line.perHour(h);
    if (!(trains > 0)) continue;
    const f = hourFlows(line, hourBoardings(line, h, shares, day));
    peakDirection(line, f, h, shares, day);
    f.on.forEach((on, d) =>
      on.forEach((b, i) => {
        // The way back runs the stations in reverse.
        const s = d === 0 ? i : n - 1 - i;
        if (s < 0 || s >= n) return;
        const dwell = trainDwell(b / trains, f.off[d]![i]! / trains, channels, model);
        if (dwell > best[s]!) best[s] = dwell;
      }),
    );
  }
  const dwells = best.map((d) => (d > usualS ? d : null));
  let longest: StopDwells["longest"] = null;
  dwells.forEach((d, s) => {
    if (d !== null && (!longest || d > longest.dwell_s))
      longest = { station: stations[s]!, dwell_s: d, usual_s: usualS };
  });
  return { dwells, longest };
}

/** Purpose: trains per hour of an engine line in the hour starting at `hourS` (peak or off-peak headway). */
export function trainsPerHour(
  l: {
    first_s: number;
    last_s: number;
    peak_headway_s: number;
    offpeak_headway_s: number;
    peaks?: [number, number][];
  },
  hourS: number,
): number {
  const mid = hourS + 1800;
  if (mid < l.first_s || mid >= l.last_s) return 0;
  const peaks = l.peaks ?? [
    [7 * 3600, 9 * 3600],
    [16 * 3600, 19 * 3600],
  ];
  const h = peaks.some(([a, b]) => mid >= a && mid < b) ? l.peak_headway_s : l.offpeak_headway_s;
  return h > 0 ? 3600 / h : 0;
}

/**
 * Purpose: put the stops' dwells into the service lines of a built network (`{"service_lines": [...]}`, JSON
 * text), as `stop_dwells_s` of each line that has any.
 */
export function withStopDwells(linesJson: string, dwells: Record<string, (number | null)[]>): string {
  if (!Object.values(dwells).some((d) => d.some((x) => x !== null))) return linesJson;
  const doc = JSON.parse(linesJson) as { service_lines: { id: string; stop_dwells_s?: (number | null)[] }[] };
  for (const l of doc.service_lines) {
    const d = dwells[l.id];
    if (d && d.some((x) => x !== null)) l.stop_dwells_s = d;
  }
  return JSON.stringify(doc);
}
