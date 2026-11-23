/**
 * The replay of a road run on the map (FR-SIM-06: play, pause, reset, speed; read-only): where each street
 * line vehicle is at a moment, from the worker's tracks (`pack_replay`), drawn as a dot coloured by what it is
 * doing (Project preferences → Visuals): in service on time, late or very late, out of service on the street,
 * or parked in its depot. Between two frames the position is interpolated; a vehicle not yet out stands at its
 * depot slot, and one back in the depot at the slot it parked in. Background cars are not in the replay.
 * Replays of runs made before the stops were recorded have no service times: their vehicles keep their line's
 * colour.
 */
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { LonLat } from "../street-lines/types";
import type { VehicleState, VehicleVisuals } from "../../workspace/preferences";
import type { Replay } from "./types";

const SRC = "road-replay";
export const REPLAY_LAYERS = { body: "road-replay-body", label: "road-replay-label" } as const;

/** Where one vehicle is at a moment. */
export interface VehicleAt {
  id: string;
  line: number;
  number: number;
  lonlat: LonLat;
  heading: number;
  speed_kmh: number;
  /** Battery charge, %; null without a battery. */
  charge: number | null;
  /** In the depot (before pull-out or after pull-in). */
  parked: boolean;
  /** In service (from its first stop to its last), and how late, s (negative: early); null without stop times. */
  service: { in_service: boolean; delay_s: number } | null;
}

/** Stop kinds in a replay vehicle's `st` (worker `replay_stops`). */
const STOP_LAST = 2;

/**
 * Purpose: whether a vehicle is in service at time `t`, and how late it is, from its stops (`st`): in service
 * from reaching the first stop of its first trip until leaving the first stop after its last trip. The delay is
 * that of its last departure, or, once the planned departure of the stop it is heading to or standing at has
 * passed, the time since then if that is more. Null without stops.
 */
export function serviceAt(st: readonly number[] | undefined, t: number): VehicleAt["service"] {
  const n = st ? Math.floor(st.length / 4) : 0;
  if (!st || n === 0) return null;
  const start = st[1]!;
  if (start < 0 || t < start) return { in_service: false, delay_s: 0 };
  let delay = 0;
  for (let i = 0; i < n; i++) {
    const planned = st[i * 4]!;
    const left = st[i * 4 + 2]!;
    if (left >= 0 && left <= t) {
      if (st[i * 4 + 3] === STOP_LAST) return { in_service: false, delay_s: 0 };
      delay = left - planned;
    } else {
      delay = Math.max(delay, t - planned);
      break;
    }
  }
  return { in_service: true, delay_s: delay };
}

/** Purpose: what a vehicle is doing, for its colour; null when the replay has no stop times for it. */
export function vehicleState(v: VehicleAt, visuals: VehicleVisuals): VehicleState | null {
  if (v.parked) return "parked";
  if (!v.service) return null;
  if (!v.service.in_service) return "out_of_service";
  const d = v.service.delay_s;
  if (d <= visuals.on_time_min * 60) return "on_time";
  return d <= visuals.late_min * 60 ? "late" : "very_late";
}

const lerpAngle = (a: number, b: number, f: number) => {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return (a + d * f + 360) % 360;
};

/** Purpose: the first and last second the replay covers. */
export function replaySpan(r: Replay): [number, number] {
  return [r.begin, r.begin + Math.max(0, r.frames - 1) * r.frame_s];
}

/** Purpose: every vehicle's place at time `t` (s after midnight); vehicles with nowhere to be are left out. */
export function vehiclesAt(r: Replay, t: number): VehicleAt[] {
  const out: VehicleAt[] = [];
  const f = (t - r.begin) / r.frame_s;
  for (const v of r.vehicles) {
    const n = Math.floor(v.s.length / 5);
    const base = { id: v.id, line: v.line, number: v.number, service: serviceAt(v.st, t) };
    if (v.f0 < 0 || n === 0 || f < v.f0) {
      if (v.slot_out)
        out.push({ ...base, lonlat: v.slot_out, heading: 0, speed_kmh: 0, charge: null, parked: true });
      continue;
    }
    const k = f - v.f0;
    if (k > n - 1) {
      const at = v.slot_in ?? null;
      if (at) out.push({ ...base, lonlat: at, heading: 0, speed_kmh: 0, charge: null, parked: true });
      else if (v.slot_in === null && f - v.f0 <= n) {
        const i = (n - 1) * 5;
        out.push({
          ...base,
          lonlat: [v.s[i]! / 1e5, v.s[i + 1]! / 1e5],
          heading: v.s[i + 2]!,
          speed_kmh: 0,
          charge: v.s[i + 4]! >= 0 ? v.s[i + 4]! : null,
          parked: false,
        });
      }
      continue;
    }
    const i = Math.floor(k);
    const w = k - i;
    const a = i * 5;
    const b = Math.min(n - 1, i + 1) * 5;
    const s = v.s;
    out.push({
      ...base,
      lonlat: [(s[a]! + (s[b]! - s[a]!) * w) / 1e5, (s[a + 1]! + (s[b + 1]! - s[a + 1]!) * w) / 1e5],
      heading: lerpAngle(s[a + 2]!, s[b + 2]!, w),
      speed_kmh: s[a + 3]! + (s[b + 3]! - s[a + 3]!) * w,
      charge: s[a + 4]! >= 0 ? s[a + 4]! : null,
      parked: false,
    });
  }
  return out;
}

/** Purpose: whether the replay has the vehicles' stop times, so it can colour them by service and delay. */
export function hasServiceTimes(r: Replay): boolean {
  return r.vehicles.some((v) => Array.isArray(v.st) && v.st.length > 0);
}

/**
 * Purpose: the vehicles as GeoJSON points, coloured by what they are doing (`visuals`); a vehicle without stop
 * times on the street keeps its line's colour.
 */
export function replayGeoJson(r: Replay, t: number, visuals: VehicleVisuals) {
  const color = new Map(r.lines.map((l) => [l.index, l.color]));
  const name = new Map(r.lines.map((l) => [l.index, l.name]));
  return {
    type: "FeatureCollection" as const,
    features: vehiclesAt(r, t).map((v) => {
      const state = vehicleState(v, visuals);
      return {
        type: "Feature" as const,
        properties: {
          id: v.id,
          color: state ? visuals.colors[state] : (color.get(v.line) ?? "#d2392c"),
          state: state ?? "line",
          heading: v.heading,
          parked: v.parked,
          label: `${name.get(v.line) ?? ""} ${v.number}`.trim(),
        },
        geometry: { type: "Point" as const, coordinates: v.lonlat },
      };
    }),
  };
}

/** Purpose: add the replay's source and layers to the map once. */
export function ensureReplayLayers(map: MapLibreMap) {
  if (!map.getSource(SRC))
    map.addSource(SRC, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  if (!map.getLayer(REPLAY_LAYERS.body))
    map.addLayer({
      id: REPLAY_LAYERS.body,
      type: "circle",
      source: SRC,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 3, 16, 7, 19, 12],
        "circle-color": ["get", "color"],
        "circle-opacity": ["match", ["get", "state"], "line", ["case", ["get", "parked"], 0.45, 1], 1],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1.5,
      },
    });
  if (!map.getLayer(REPLAY_LAYERS.label))
    map.addLayer({
      id: REPLAY_LAYERS.label,
      type: "symbol",
      source: SRC,
      minzoom: 15,
      filter: ["!", ["get", "parked"]],
      layout: {
        "text-field": ["get", "label"],
        "text-size": 11,
        "text-offset": [0, 1.2],
        "text-anchor": "top",
        "text-allow-overlap": false,
      },
      paint: { "text-color": "#0f172a", "text-halo-color": "#ffffff", "text-halo-width": 1.5 },
    });
}

/** Purpose: show the vehicles at time `t`. */
export function setReplayTime(map: MapLibreMap, r: Replay, t: number, visuals: VehicleVisuals) {
  (map.getSource(SRC) as GeoJSONSource | undefined)?.setData(replayGeoJson(r, t, visuals) as never);
}

/** Purpose: remove the replay from the map. */
export function removeReplayLayers(map: MapLibreMap) {
  for (const l of Object.values(REPLAY_LAYERS)) if (map.getLayer(l)) map.removeLayer(l);
  if (map.getSource(SRC)) map.removeSource(SRC);
}
