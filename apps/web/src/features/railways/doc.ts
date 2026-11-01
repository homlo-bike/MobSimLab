/**
 * Pure edits of the railway design document. Positions are local metres around `doc.origin`;
 * every function returns a new document and leaves its input unchanged.
 */
import type { Anchor, Level, Network, Power, Station, Switch, SwitchKind, Track, TrackUse } from "./types";

const STATION_NAMES = [
  "Riverside",
  "Northgate",
  "Market Hall",
  "Old Town",
  "University",
  "Harbour",
  "Airport",
  "Exhibition Centre",
  "Parkway",
  "Westfield",
];

/** Purpose: the next free id (ids are unique across stations, tracks and switches). */
export function nextId(doc: Network): number {
  const ids = [...doc.stations, ...doc.tracks, ...doc.switches].map((o) => o.id);
  return ids.length ? Math.max(...ids) + 1 : 1;
}

/** Purpose: what kind of element an id belongs to. */
export function kindOf(doc: Network, id: number): "station" | "track" | "switch" | null {
  if (doc.stations.some((s) => s.id === id)) return "station";
  if (doc.tracks.some((s) => s.id === id)) return "track";
  if (doc.switches.some((s) => s.id === id)) return "switch";
  return null;
}

/** Purpose: an empty document for a mode. */
export function emptyNetwork(mode: Network["mode"], origin: [number, number]): Network {
  return { origin, mode, stations: [], tracks: [], switches: [] };
}

/** Purpose: add a station at a local position. Output: the document and the new station's id. */
export function addStation(
  doc: Network,
  at: [number, number],
  opts: { level: Level; sides: number; islands: number; platformLength: number },
): [Network, number] {
  const id = nextId(doc);
  const name =
    STATION_NAMES.find((n) => !doc.stations.some((s) => s.name === n)) ?? `Station ${doc.stations.length + 1}`;
  const st: Station = {
    id,
    name,
    x: at[0],
    y: at[1],
    rotation_deg: 0,
    level: opts.level,
    side_platforms: opts.sides,
    island_platforms: opts.islands,
    platform_length_m: opts.platformLength,
  };
  return [{ ...doc, stations: [...doc.stations, st] }, id];
}

/** Purpose: a new track starting at an anchor (not yet in the document). */
export function newTrack(
  doc: Network,
  start: Anchor,
  opts: { tracks: 1 | 2; level: Level; power: Power; use: TrackUse },
): Track {
  return {
    id: nextId(doc),
    name: "",
    start: start.type === "free" ? { ...start, level: start.level ?? opts.level } : start,
    end: null,
    points: [],
    tracks: opts.tracks,
    level: opts.level,
    power: opts.power,
    use: opts.use,
    bed: "auto",
    lead_start_m: 30,
    lead_end_m: 30,
  };
}

/** A connection point in local metres with the direction a track must leave in. */
export interface LocalConnection {
  p: [number, number];
  dir: [number, number];
}

/**
 * Purpose: straight lead lengths out of anchored ends while drawing (as in the mockup): about a
 * third of the way to the next point, at least enough for the transition and a short straight.
 */
export function autoLeads(
  t: Track,
  start: LocalConnection | null,
  end: LocalConnection | null,
  cursor: [number, number] | null,
  minLead: number,
): Track {
  const along = (c: LocalConnection, q: [number, number]) =>
    (q[0] - c.p[0]) * c.dir[0] + (q[1] - c.p[1]) * c.dir[1];
  const out = { ...t };
  const first: [number, number] | null = t.points[0]
    ? [t.points[0].x, t.points[0].y]
    : end
      ? end.p
      : cursor;
  if (start && first) out.lead_start_m = Math.max(minLead, (t.points.length ? 0.5 : 0.3) * along(start, first));
  const last: [number, number] | null = t.points.length
    ? [t.points[t.points.length - 1]!.x, t.points[t.points.length - 1]!.y]
    : start
      ? start.p
      : null;
  if (end && last) out.lead_end_m = Math.max(minLead, (t.points.length ? 0.5 : 0.3) * along(end, last));
  return out;
}

/** Purpose: place a catalogue switch on a track. Output: the document and the switch id. */
export function addSwitch(
  doc: Network,
  sw: { kind: SwitchKind; track: number; s: number; element: string; side: number },
): [Network, number] {
  const id = nextId(doc);
  const s: Switch = {
    id,
    kind: sw.kind,
    track: sw.track,
    s: Math.max(0, sw.s),
    element: sw.element,
    side: sw.side < 0 ? -1 : 1,
    direction: 1,
    flip: false,
  };
  return [{ ...doc, switches: [...doc.switches, s] }, id];
}

const refersTo = (a: Anchor | null, kind: "station" | "switch", ids: number[]) =>
  !!a && ((kind === "station" && a.type === "station" && ids.includes(a.station)) ||
    (kind === "switch" && a.type === "switch" && ids.includes(a.switch)));

/**
 * Purpose: delete a station, track or switch. Tracks attached to a deleted station or switch
 * keep their shape: their end becomes a free point where the connection was.
 * Inputs: `anchorAt` gives the local position of an anchor from the current view.
 */
export function deleteElement(
  doc: Network,
  id: number,
  anchorAt: (a: Anchor) => [number, number] | null,
): Network {
  const kind = kindOf(doc, id);
  let stations = doc.stations;
  let tracks = doc.tracks;
  let switches = doc.switches;
  let goneSwitches: number[] = [];
  if (kind === "station") stations = stations.filter((s) => s.id !== id);
  if (kind === "switch") goneSwitches = [id];
  if (kind === "track") {
    tracks = tracks.filter((t) => t.id !== id);
    goneSwitches = switches.filter((s) => s.track === id).map((s) => s.id);
  }
  switches = switches.filter((s) => !goneSwitches.includes(s.id));
  const free = (a: Anchor, level: Level): Anchor => {
    const p = anchorAt(a);
    return p ? { type: "free", x: p[0], y: p[1], level } : a;
  };
  const fix = (a: Anchor, t: Track): Anchor => {
    if (kind === "station" && refersTo(a, "station", [id])) return free(a, t.level);
    if (refersTo(a, "switch", goneSwitches)) return free(a, t.level);
    return a;
  };
  tracks = tracks.map((t) => ({ ...t, start: fix(t.start, t), end: t.end ? fix(t.end, t) : null }));
  return { ...doc, stations, tracks, switches };
}

/** Purpose: replace one element by id with an updated copy. */
export function update<K extends "stations" | "tracks" | "switches">(
  doc: Network,
  key: K,
  id: number,
  f: (o: Network[K][number]) => Network[K][number],
): Network {
  const list = doc[key] as Network[K][number][];
  return { ...doc, [key]: list.map((o) => (o.id === id ? f(o) : o)) };
}
