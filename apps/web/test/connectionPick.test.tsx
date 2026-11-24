import { describe, expect, it } from "vitest";
import { type ConnectionHit, facingStart, pickConnection } from "../src/features/railways/connectionPick";
import type { Anchor, ConnectionView } from "../src/features/railways/types";

/** A 4-track station 400 m long along x, centred at `x0`: single and paired connection points at both ends. */
function station(id: number, x0: number, used: number[][] = [], start = 0): ConnectionView[] {
  const out: ConnectionView[] = [];
  for (const end of [0, 1]) {
    const x = x0 + (end ? 250 : -250);
    const sets = [[0], [1], [2], [3], [0, 1], [1, 2], [2, 3]];
    for (const tracks of sets) {
      out.push({
        index: start + out.length,
        anchor: { type: "station", station: id, end, tracks },
        lonlat: [x, 0],
        tracks: tracks.length,
        used: used.some((u) => u[0] === end && u.slice(1).join() === tracks.join()),
        level: "street",
        bearing_deg: end ? 90 : 270,
        mode: "long_distance_rail",
      });
    }
  }
  return out;
}

/** Hits for the double-track connections of a station, all under the cursor (zoomed out). */
const hits = (cs: ConnectionView[], px: (c: ConnectionView) => number): ConnectionHit[] =>
  cs
    .filter((c) => c.tracks === 2)
    .map((c) => ({ c, px: px(c), at: [c.lonlat[0], c.lonlat[1]] as [number, number] }));

const picked = (c: ConnectionView | null) =>
  c && c.anchor.type === "station" ? { end: c.anchor.end, tracks: c.anchor.tracks } : null;

describe("picking a station connection (Syria intercity test, bug 12)", () => {
  it("joins a track arriving from the west to the west end, zoomed out, whichever point the map lists first", () => {
    const cs = station(2, 35000);
    // The far (east) end listed first and a pixel nearer the cursor.
    const h = hits(cs, (c) => (c.anchor.type === "station" && c.anchor.end === 1 ? 2 : 3));
    expect(picked(pickConnection(h, cs, [10000, 0]))).toEqual({ end: 0, tracks: [1, 2] });
  });

  it("leaves on the station tracks the track at the other end joins, so trains run straight through", () => {
    const cs = station(2, 35000, [[0, 2, 3]]);
    const h = hits(cs, () => 3);
    expect(picked(pickConnection(h, cs, null))).toEqual({ end: 1, tracks: [2, 3] });
    // Arriving at the other end later: lined up with the track already leaving.
    const cs2 = station(2, 35000, [[1, 1, 2]]);
    expect(
      picked(
        pickConnection(
          hits(cs2, () => 3),
          cs2,
          [0, 0],
        ),
      ),
    ).toEqual({ end: 0, tracks: [1, 2] });
  });

  it("starting a track, takes the end no track joins yet", () => {
    const cs = station(2, 35000, [[0, 1, 2]]);
    const h = hits(cs, (c) => (c.anchor.type === "station" && c.anchor.end === 0 ? 1 : 4));
    expect(picked(pickConnection(h, cs, null))).toEqual({ end: 1, tracks: [1, 2] });
  });

  it("zoomed in, takes the point clicked", () => {
    const cs = station(2, 35000);
    // Only one end's points are under the cursor, and those of other tracks are well apart.
    const h = hits(cs, (c) =>
      c.anchor.type === "station" && c.anchor.end === 1 ? (c.anchor.tracks[0] === 2 ? 1 : 12) : 400,
    ).filter((x) => x.px <= 13);
    expect(picked(pickConnection(h, cs, [0, 0]))).toEqual({ end: 1, tracks: [2, 3] });
  });
});

describe("the end a track started at a station leaves from", () => {
  const pos = (cs: ConnectionView[]) => (a: Anchor) => {
    const c = cs.find((x) => JSON.stringify(x.anchor) === JSON.stringify(a));
    return c ? ([c.lonlat[0], c.lonlat[1]] as [number, number]) : null;
  };
  const west: Anchor = { type: "station", station: 2, end: 0, tracks: [1, 2] };

  it("turns round to the end facing the next point when no track joins it", () => {
    const cs = station(2, 35000);
    expect(facingStart(west, [70000, 0], cs, pos(cs))).toEqual({ ...west, end: 1 });
    expect(facingStart(west, [0, 0], cs, pos(cs))).toBe(west);
  });

  it("keeps the start when a track already joins those tracks at the other end", () => {
    const cs = station(2, 35000, [[1, 1, 2]]);
    expect(facingStart(west, [70000, 0], cs, pos(cs))).toBe(west);
  });
});
