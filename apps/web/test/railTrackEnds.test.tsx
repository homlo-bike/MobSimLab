import { describe, expect, it } from "vitest";
import { emptyNetwork, newTrack, pickElement } from "../src/features/railways/doc";
import { freeTrackEnds, joinAtFreeEnds, reverseTrack } from "../src/features/railways/trackEnds";
import type { Network, RailView, Track } from "../src/features/railways/types";

const OPTS = {
  tracks: 2 as const,
  level: "street" as const,
  power: "auto" as const,
  use: "running" as const,
};

/** A track between two free points through the given points. */
function track(
  d: Network,
  id: number,
  from: [number, number],
  to: [number, number],
  pts: [number, number][] = [],
) {
  const t = newTrack(d, { type: "free", x: from[0], y: from[1] }, OPTS);
  return {
    ...t,
    id,
    points: pts.map(([x, y]) => ({ x, y })),
    end: { type: "free", x: to[0], y: to[1], level: "street" },
  } as Track;
}

describe("snap points on drawn tracks", () => {
  const base = emptyNetwork("metro", [7, 50.9]);

  it("lists the free ends of drawn tracks, with their map position, leaving out the draft", () => {
    const a = track(base, 1, [0, 0], [100, 0]);
    const b = track(base, 2, [0, 50], [100, 50]);
    const view = {
      handles: [
        { track: 1, kind: "start", index: null, lonlat: [7, 50.9], level: "street" },
        { track: 1, kind: "end", index: null, lonlat: [7.001, 50.9], level: "street" },
        { track: 2, kind: "end", index: null, lonlat: [7.001, 50.901], level: "street" },
      ],
    } as unknown as RailView;
    const ends = freeTrackEnds({ ...base, tracks: [a, b] }, view, 2);
    expect(ends.map((e) => [e.track, e.end, e.x, e.y])).toEqual([
      [1, "start", 0, 0],
      [1, "end", 100, 0],
    ]);
  });

  it("continues a track drawn from another's free end into one track that keeps the old id", () => {
    const a = track(base, 1, [0, 0], [100, 0], [[50, 0]]);
    const b = track(base, 2, [100, 0], [200, 80], [[150, 0]]);
    const [d, id] = joinAtFreeEnds({ ...base, tracks: [a, b] }, 2);
    expect(id).toBe(1);
    expect(d.tracks).toHaveLength(1);
    const t = d.tracks[0]!;
    expect(t.start).toEqual(a.start);
    expect(t.points.map((p) => [p.x, p.y])).toEqual([
      [50, 0],
      [100, 0],
      [150, 0],
    ]);
    expect(t.end).toMatchObject({ x: 200, y: 80 });
  });

  it("turns a new track round to join an end-to-end snap, and joins both ends across a gap", () => {
    const a = track(base, 1, [0, 0], [100, 0]);
    const c = track(base, 3, [300, 0], [400, 0]);
    // Drawn from c's start back to a's end.
    const b = track(base, 2, [300, 0], [100, 0], [[200, 10]]);
    const [d, id] = joinAtFreeEnds({ ...base, tracks: [a, c, b] }, 2);
    expect(d.tracks).toHaveLength(1);
    expect(id).toBe(1);
    const t = d.tracks[0]!;
    expect(t.start).toMatchObject({ x: 0, y: 0 });
    expect(t.end).toMatchObject({ x: 400, y: 0 });
    expect(t.points.map((p) => [p.x, p.y])).toEqual([
      [100, 0],
      [200, 10],
      [300, 0],
    ]);
  });

  it("keeps a track with switches as it is: the new one goes after it, or the two only meet", () => {
    const a = track(base, 1, [100, 0], [0, 0]);
    const withSwitch = {
      ...base,
      switches: [
        { id: 9, kind: "crossover", track: 1, s: 20, element: "x", side: 1, direction: 1, flip: false },
      ],
    } as Network;
    // At a's end: the new track goes after it and a keeps its id and chainages.
    const after = track(base, 2, [0, 0], [-100, 0]);
    const [d1, id1] = joinAtFreeEnds({ ...withSwitch, tracks: [a, after] }, 2);
    expect(id1).toBe(1);
    expect(d1.tracks).toHaveLength(1);
    expect(d1.tracks[0]!.start).toEqual(a.start);
    // At a's start: joining would move the switch's chainage, so the two tracks only meet.
    const before = track(base, 3, [100, 0], [200, 0]);
    const [d2] = joinAtFreeEnds({ ...withSwitch, tracks: [a, before] }, 3);
    expect(d2.tracks.map((t) => t.id)).toEqual([1, 3]);
  });

  it("turns a track round with its leads and curve radii", () => {
    const t = {
      ...track(base, 1, [0, 0], [10, 0], [[5, 1]]),
      lead_start_m: 12,
      lead_end_m: 30,
      radius_start_m: 300,
    };
    const r = reverseTrack(t);
    expect(r.start).toEqual(t.end);
    expect(r.end).toEqual(t.start);
    expect([r.lead_start_m, r.lead_end_m, r.radius_end_m]).toEqual([30, 12, 300]);
  });
});

describe("picking an element", () => {
  it("picks a switch lying over its track before the track", () => {
    const d = {
      ...emptyNetwork("metro", [7, 50.9]),
      tracks: [{ id: 1 } as Track],
      switches: [{ id: 2 } as Network["switches"][number]],
    } as Network;
    expect(pickElement(d, [1, 2])).toBe(2);
    expect(pickElement(d, [1])).toBe(1);
    expect(pickElement(d, [5])).toBeNull();
  });
});
