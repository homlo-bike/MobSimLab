import type { Anchor, ConnectionView } from "./types";

/** A connection point under the cursor: how far from it on screen (px) and where it is (local m). */
export interface ConnectionHit {
  c: ConnectionView;
  px: number;
  at: [number, number];
}

/** Connection points of one station end closer together than this on screen (px) are one target. */
const SAME_PX = 6;

const stationOf = (c: ConnectionView) => (c.anchor.type === "station" ? c.anchor : null);
const key = (tracks: number[]) => tracks.join(",");

/**
 * Purpose: the connection a click means among those under the cursor. Zoomed out, a station's two ends
 * and its connection points are all under it, and the first one the map listed was taken: a track drawn
 * from one station to the next often joined the far end of the next (a U-turn), or tracks other than
 * those the track out of the station's other end leaves on, so trains moved over by one track at each
 * station and ran out of track a few stations on (Syria intercity test, bug 12).
 * Inputs: the hits (connection, screen distance, local position), every connection of the drawing,
 * and where the track being drawn comes from (local m; null when a track starts here).
 * Output: the connection: with both ends of a station under the cursor, the end facing where the
 * track comes from (or, starting a track, an end no track joins yet); among a station end's
 * connection points that are one target on screen, one no track joins yet, then the station tracks
 * the track at the station's other end joins, then the middle ones; otherwise the nearest.
 */
export function pickConnection(
  hits: ConnectionHit[],
  all: ConnectionView[],
  from: [number, number] | null,
): ConnectionView | null {
  const sorted = [...hits].sort((a, b) => a.px - b.px);
  const near = sorted[0];
  if (!near) return null;
  const st = stationOf(near.c);
  if (st) {
    const same = sorted.filter((h) => stationOf(h.c)?.station === st.station);
    const ends = [...new Set(same.map((h) => stationOf(h.c)!.end))];
    let end = st.end;
    let pool: ConnectionHit[];
    if (ends.length > 1) {
      if (from) {
        // The end nearer the point the track comes from faces it.
        const d = (e: number) =>
          Math.min(
            ...same
              .filter((h) => stationOf(h.c)!.end === e)
              .map((h) => Math.hypot(h.at[0] - from[0], h.at[1] - from[1])),
          );
        end = ends.reduce((a, b) => (d(b) < d(a) ? b : a));
      } else {
        const free = (e: number) =>
          !all.some((c) => stationOf(c)?.station === st.station && stationOf(c)!.end === e && c.used);
        end = ends.find((e) => e === st.end && free(e)) ?? ends.find(free) ?? st.end;
      }
      pool = same.filter((h) => stationOf(h.c)!.end === end);
    } else {
      pool = same.filter((h) => h.px <= near.px + SAME_PX);
    }
    // Station tracks the track at the other end joins, so a train runs straight through.
    const through = new Set(
      all
        .filter((c) => c.used && stationOf(c)?.station === st.station && stationOf(c)!.end !== end)
        .map((c) => key(stationOf(c)!.tracks)),
    );
    const count =
      Math.max(
        -1,
        ...all.filter((c) => stationOf(c)?.station === st.station).flatMap((c) => stationOf(c)!.tracks),
      ) + 1;
    const off = (h: ConnectionHit) => {
      const t = stationOf(h.c)!.tracks;
      return Math.abs(t.reduce((a, b) => a + b, 0) / t.length - (count - 1) / 2);
    };
    const rank = (h: ConnectionHit): [number, number, number, number] => [
      h.c.used ? 1 : 0,
      through.has(key(stationOf(h.c)!.tracks)) ? 0 : 1,
      off(h),
      h.px,
    ];
    const cmp = (a: ConnectionHit, b: ConnectionHit) => {
      const [x, y] = [rank(a), rank(b)];
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
      return 0;
    };
    return [...pool].sort(cmp)[0]?.c ?? near.c;
  }
  // A switch leg: the nearest one no track joins yet, among those that are one target on screen.
  const pool = sorted.filter((h) => h.px <= near.px + SAME_PX);
  return (pool.find((h) => !h.c.used) ?? near).c;
}

/**
 * Purpose: the station end a track started at a station leaves from, once its next point is known.
 * Zoomed out, a click on a station whose two ends no track joins yet cannot tell the ends apart, and
 * the track sometimes left from the far end and turned back past the station (a curve too sharp; PR 240
 * local check). Inputs: the start, the next point (local m), every connection of the drawing, and the
 * local position of a connection. Output: the same station tracks at the other end when no track joins
 * them there and that end is nearer the next point; otherwise the start as it was.
 */
export function facingStart(
  start: Anchor,
  toward: [number, number],
  all: ConnectionView[],
  pos: (a: Anchor) => [number, number] | null,
): Anchor {
  if (start.type !== "station") return start;
  const other = all.find((c) => {
    const a = stationOf(c);
    return (
      !!a &&
      !c.used &&
      a.station === start.station &&
      a.end !== start.end &&
      key(a.tracks) === key(start.tracks)
    );
  });
  const here = pos(start);
  const there = other && pos(other.anchor);
  if (!other || !here || !there) return start;
  const d = (p: [number, number]) => Math.hypot(p[0] - toward[0], p[1] - toward[1]);
  return d(there) < d(here) ? other.anchor : start;
}
