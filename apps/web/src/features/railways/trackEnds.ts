import type { Level, LonLat, Network, Pi, RailView, Track } from "./types";

/** A free end of a drawn track: a snap point a new track can start or end at, like a station's connections. */
export interface TrackEnd {
  track: number;
  end: "start" | "end";
  /** Local metres, exactly the end's own position, so a track drawn to it meets it. */
  x: number;
  y: number;
  level: Level;
  tracks: 1 | 2;
  lonlat: LonLat;
}

/** Ends this close (m) are the same point. */
const SAME_M = 0.01;

/**
 * Purpose: the free ends of the drawn tracks, with their map position from the view's edit handles.
 * Inputs: the drawing, its view, and a track to leave out (the one being drawn).
 */
export function freeTrackEnds(
  doc: Network,
  view: RailView | null,
  exclude: number | null = null,
): TrackEnd[] {
  if (!view) return [];
  const out: TrackEnd[] = [];
  for (const t of doc.tracks) {
    if (t.id === exclude) continue;
    for (const end of ["start", "end"] as const) {
      const a = end === "start" ? t.start : t.end;
      if (!a || a.type !== "free") continue;
      const h = view.handles.find((x) => "track" in x && x.track === t.id && x.kind === end);
      if (!h) continue;
      out.push({
        track: t.id,
        end,
        x: a.x,
        y: a.y,
        level: a.level ?? t.level,
        tracks: t.tracks,
        lonlat: h.lonlat,
      });
    }
  }
  return out;
}

/** Purpose: whether other elements refer to positions along a track (so it must keep its start and direction). */
function pinned(doc: Network, t: Track): boolean {
  return (
    doc.switches.some((s) => s.track === t.id) ||
    !!doc.signals?.some((s) => s.at.type === "track" && s.at.track === t.id) ||
    !!t.directions?.length
  );
}

/** Purpose: the same track drawn the other way round. */
export function reverseTrack(t: Track): Track {
  const { end } = t;
  if (!end) return t;
  return {
    ...t,
    start: end,
    end: t.start,
    points: [...t.points].reverse(),
    lead_start_m: t.lead_end_m,
    lead_end_m: t.lead_start_m,
    radius_start_m: t.radius_end_m ?? null,
    radius_end_m: t.radius_start_m ?? null,
  };
}

const freeAt = (t: Track, end: "start" | "end") => {
  const a = end === "start" ? t.start : t.end;
  return a && a.type === "free" ? a : null;
};

/**
 * Purpose: one track out of `first` then `second`, where `first` ends at a free point and `second` starts
 * there. The meeting point becomes a point of the track; `first` keeps its id, settings and chainages.
 */
function chain(first: Track, second: Track): Track {
  const meet = freeAt(first, "end")!;
  const lastLevel = first.points[first.points.length - 1]?.level ?? first.level;
  const joint: Pi = { x: meet.x, y: meet.y, level: meet.level ?? lastLevel };
  return {
    ...first,
    points: [...first.points, joint, ...second.points.map((p) => ({ ...p, level: p.level ?? second.level }))],
    end: second.end,
    lead_end_m: second.lead_end_m,
    radius_end_m: second.radius_end_m ?? null,
  };
}

/**
 * Purpose: join a track to the drawn tracks whose free ends it was snapped to, so they become one
 * connected track. A track that switches or signals refer to keeps its start and direction; two such
 * tracks only meet (they are left as they are).
 * Output: the drawing, and the id the track has afterwards.
 */
export function joinAtFreeEnds(doc: Network, id: number): [Network, number] {
  let d = doc;
  let cur = id;
  const own = d.tracks.find((x) => x.id === id);
  // The track's own free ends; after a join one of them may be at the other end of the joined track.
  const points = own
    ? (["start", "end"] as const).flatMap((e) => {
        const a = freeAt(own, e);
        return a ? [a] : [];
      })
    : [];
  for (const at of points) {
    const t = d.tracks.find((x) => x.id === cur);
    if (!t) break;
    const mine = (["start", "end"] as const).find((e) => {
      const b = freeAt(t, e);
      return b && Math.hypot(b.x - at.x, b.y - at.y) < SAME_M;
    });
    const a = mine && freeAt(t, mine);
    if (!mine || !a) continue;
    const other = d.tracks.find(
      (o) =>
        o.id !== cur &&
        o.tracks === t.tracks &&
        (["start", "end"] as const).some((oe) => {
          const b = freeAt(o, oe);
          return b && Math.hypot(b.x - a.x, b.y - a.y) < SAME_M;
        }),
    );
    if (!other) continue;
    const otherEnd = (() => {
      const b = freeAt(other, "start");
      return b && Math.hypot(b.x - a.x, b.y - a.y) < SAME_M ? "start" : "end";
    })();
    // The track that runs first keeps its id and chainages; the second is turned round if needed and
    // its chainages move, so it must be one nothing refers to.
    const tPinned = pinned(d, t);
    const oPinned = pinned(d, other);
    const otherFirst = !tPinned && (otherEnd === "end" || !oPinned);
    const mineFirst = !oPinned && (mine === "end" || !tPinned);
    const pick =
      otherFirst && otherEnd === "end"
        ? "other"
        : mineFirst && mine === "end"
          ? "mine"
          : otherFirst
            ? "other"
            : mineFirst
              ? "mine"
              : null;
    if (!pick) continue;
    const ending = (x: Track, e: "start" | "end") => (e === "end" ? x : reverseTrack(x));
    const starting = (x: Track, e: "start" | "end") => (e === "start" ? x : reverseTrack(x));
    const [first, second] =
      pick === "other"
        ? [ending(other, otherEnd), starting(t, mine)]
        : [ending(t, mine), starting(other, otherEnd)];
    const joined = chain(first, second);
    const gone = joined.id === t.id ? other.id : t.id;
    d = {
      ...d,
      tracks: d.tracks.filter((x) => x.id !== gone).map((x) => (x.id === joined.id ? joined : x)),
    };
    cur = joined.id;
  }
  return [d, cur];
}
