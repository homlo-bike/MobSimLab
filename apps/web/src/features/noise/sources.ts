import { tNow } from "../../i18n/i18n";
import type { LineView, VehicleProfile } from "../street-lines/types";
import type { Network, RailView, TrackView } from "../railways/types";
import type { Flows, NoiseCheck, NoiseLine, NoiseRange } from "./types";

/**
 * Purpose: a street line as noise sources, one per routed leg (both directions of the circuit, so a
 * street driven both ways carries both). Speed is the leg's mean routed speed; a leg that starts or
 * ends at a stop gets the acceleration zone there.
 */
export function streetLineSources(
  view: LineView,
  profile: VehicleProfile,
  flows: Flows,
  electric: boolean,
): NoiseLine[] {
  const n = view.points.length;
  return view.legs
    .filter((l) => l.status !== "error" && l.coords.length >= 2 && l.length_m > 0)
    .map((l) => {
      const from = view.points[l.index];
      const to = view.points[(l.index + 1) % n];
      const stops: number[] = [];
      if (from && from.kind !== "via") stops.push(0);
      if (to && to.kind !== "via") stops.push(l.length_m);
      const speed = l.time_s > 0 ? (l.length_m / l.time_s) * 3.6 : 30;
      return {
        id: `leg-${l.index}`,
        label: tNow("noise.afterPoint", { n: l.index + 1 }),
        mode: profile.mode,
        electric: electric || profile.mode === "trolleybus",
        vehicle_length_m: profile.length_m,
        flows,
        points: l.coords,
        speed_kmh: Math.min(Math.max(speed, 5), profile.max_speed_kmh || 100),
        stops_m: stops,
      };
    });
}

function trackRanges(t: TrackView, view: RailView, embedded: boolean): NoiseRange[] {
  const out: NoiseRange[] = [];
  const p = view.modes[t.mode]?.params ?? view.params;
  const deck = Number(p.elevated_level_height_m) || 6;
  for (const z of t.levels) {
    if (z.level === "underground" || z.level === "underground2")
      out.push({ from_m: z.from_m, to_m: z.to_m, kind: "underground" });
    else if (z.level === "elevated" || z.level === "elevated2")
      out.push({
        from_m: z.from_m,
        to_m: z.to_m,
        kind: "bridge",
        height_m: z.level === "elevated2" ? 2 * deck : deck,
      });
    else if (z.level === "street" && embedded) out.push({ from_m: z.from_m, to_m: z.to_m, kind: "embedded" });
  }
  for (const s of view.switches) if (s.track === t.id) out.push({ from_m: s.s0, to_m: s.s1, kind: "switch" });
  return out;
}

/**
 * Purpose: the running tracks of a railway design as noise sources. Speeds come from the track's
 * speed profile (or the design speed), levels give tunnels and viaducts, placed switches add impact
 * noise. Each track carries `flows` trains per hour of the network's train length.
 */
export function railSources(doc: Network, view: RailView, flows: Flows): NoiseLine[] {
  return view.tracks
    .filter((t) => t.centre.length >= 2 && doc.tracks.find((d) => d.id === t.id)?.use !== "storage")
    .map((t) => {
      const p = view.modes[t.mode]?.params ?? view.params;
      return {
        id: `track-${t.id}`,
        label: view.tracks.length > 1 ? tNow("noise.track", { id: t.id }) : "",
        mode: t.mode,
        vehicle_length_m: view.train_length_m || 100,
        flows: {
          day: flows.day * t.tracks,
          evening: flows.evening * t.tracks,
          night: flows.night * t.tracks,
        },
        points: t.centre,
        speed: t.speed?.profile.map(([s, , v]) => [s, Math.max(v, 5)] as [number, number]),
        speed_kmh: p.design_speed_kmh,
        ranges: trackRanges(t, view, !!t.embedded),
      };
    });
}

/** Default trains per hour per track until rail service lines exist (sample values, editable). */
export const RAIL_FLOWS: Record<string, Flows> = {
  tram: { day: 8, evening: 5, night: 1 },
  light_rail: { day: 8, evening: 5, night: 1 },
  metro: { day: 12, evening: 8, night: 2 },
  commuter_rail: { day: 4, evening: 3, night: 0.5 },
  regional_rail: { day: 2, evening: 2, night: 0.5 },
  long_distance_rail: { day: 1, evening: 1, night: 0.25 },
  high_speed_rail: { day: 2, evening: 1, night: 0 },
};

/** Purpose: noise checks with "Noise: " in front, for an editor's Checks list. */
export function noiseCheckText(c: NoiseCheck): string {
  return tNow("noise.check", { text: c.text });
}
