/**
 * The replay of a road run on the map (FR-SIM-06: play, pause, reset, speed; read-only): where each street
 * line vehicle is at a moment, from the worker's tracks (`pack_replay`), drawn as a dot in its line's colour
 * with a heading tick. Between two frames the position is interpolated; a vehicle not yet out stands at its
 * depot slot, and one back in the depot at the slot it parked in. Background cars are not in the replay.
 */
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { LonLat } from "../street-lines/types";
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
    const base = { id: v.id, line: v.line, number: v.number };
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

/** Purpose: the vehicles as GeoJSON points with their line's colour. */
export function replayGeoJson(r: Replay, t: number) {
  const color = new Map(r.lines.map((l) => [l.index, l.color]));
  const name = new Map(r.lines.map((l) => [l.index, l.name]));
  return {
    type: "FeatureCollection" as const,
    features: vehiclesAt(r, t).map((v) => ({
      type: "Feature" as const,
      properties: {
        id: v.id,
        color: color.get(v.line) ?? "#d2392c",
        heading: v.heading,
        parked: v.parked,
        label: `${name.get(v.line) ?? ""} ${v.number}`.trim(),
      },
      geometry: { type: "Point" as const, coordinates: v.lonlat },
    })),
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
        "circle-opacity": ["case", ["get", "parked"], 0.45, 1],
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
export function setReplayTime(map: MapLibreMap, r: Replay, t: number) {
  (map.getSource(SRC) as GeoJSONSource | undefined)?.setData(replayGeoJson(r, t) as never);
}

/** Purpose: remove the replay from the map. */
export function removeReplayLayers(map: MapLibreMap) {
  for (const l of Object.values(REPLAY_LAYERS)) if (map.getLayer(l)) map.removeLayer(l);
  if (map.getSource(SRC)) map.removeSource(SRC);
}
