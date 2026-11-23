import { engineTextNow } from "../../i18n/engine";
import { tNow } from "../../i18n/i18n";
import type { LineView, VehicleProfile } from "../street-lines/types";
import type { Network, RailView, TrackView } from "../railways/types";
import type { SavedPluginLine, SpanNoiseShape, WaterNoiseShape } from "../../kits/saved";
import type { Flows, LonLat, NoiseCheck, NoiseLine, NoisePointSource, NoiseRange } from "./types";

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

/** Plugin modes the noise map has sound powers for (`noise.cable_car_*`, `noise.ferry_*`). */
const CABLE_MODES = new Set(["cable_car", "aerial_tramway"]);
const FERRY_MODES = new Set(["ferry"]);
/** Ferry routes become a point source about every this many metres. */
const FERRY_STEP_M = 25;
/** At most this many point sources per ferry line (the step grows on long routes). */
const FERRY_MAX_POINTS = 2000;

/**
 * Service the cable car and ferry tools assume for noise: the drawn headway in the day (07–19) and the evening
 * (19–23), none at night (23–07). The tools have one headway for the whole day; urban cable cars and most
 * city ferries stop at about 22:00 to 23:00.
 */
const PLUGIN_SERVICE: Flows = { day: 1, evening: 1, night: 0 };

const scale = (f: Flows, k: number): Flows => ({
  day: f.day * k,
  evening: f.evening * k,
  night: f.night * k,
});

function metres(a: LonLat, b: LonLat): number {
  const ky = 111_320;
  const kx = ky * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * ky);
}

/**
 * Purpose: a cable car as point sources, as in the Burnaby Mountain Gondola study (ADR-0038 §2): one at the
 * top of every tower (cabins and rope over the sheaves) and one at every station at rope height (drive,
 * bullwheel, cabin handling). A gondola's rope runs all through the service; an aerial tramway's only while the
 * cabins travel, the share of the headway the trip takes.
 */
function cableSources(id: string, name: string, x: SpanNoiseShape): NoisePointSource[] {
  const share =
    x.operation === "continuous" || x.headway_s <= 0 ? 1 : Math.min(1, x.trip_time_s / x.headway_s);
  const active = scale(PLUGIN_SERVICE, share);
  const context = [`${x.mode}/${x.system}`, x.mode];
  return [
    ...x.towers.map((t, i) => ({
      id: `${id}-tower-${i + 1}`,
      label: name,
      p: t.lonlat,
      height_m: t.height_m,
      lw_key: "noise.cable_car_tower_lw_db",
      context,
      active,
    })),
    ...x.stations.map((s, i) => ({
      id: `${id}-station-${i + 1}`,
      label: name,
      p: s.lonlat,
      height_m: x.station_height_m,
      lw_key: "noise.cable_car_station_lw_db",
      context,
      active,
    })),
  ];
}

/**
 * Purpose: a ferry line as point sources (ADR-0038 §2). Along the route, one source about every 25 m, with the
 * vessels' time on that stretch spread over the hour: a vessel each way every headway, at the leg's mean speed.
 * At each pier, the vessels lying there: the berth time of a round trip over the headway.
 */
function ferrySources(id: string, name: string, x: WaterNoiseShape): NoisePointSource[] {
  const out: NoisePointSource[] = [];
  const context = [`${x.mode}/${x.vessel}`, x.mode];
  const total = x.legs.reduce((n, l) => n + l.length_m, 0);
  const step = Math.max(FERRY_STEP_M, total / FERRY_MAX_POINTS);
  x.legs.forEach((leg, li) => {
    if (leg.length_m <= 0 || leg.time_s <= 0) return;
    const sPerM = leg.time_s / leg.length_m;
    for (let k = 1; k < leg.path.length; k++) {
      const a = leg.path[k - 1]!;
      const b = leg.path[k]!;
      const d = metres(a, b);
      const n = Math.max(1, Math.round(d / step));
      for (let j = 0; j < n; j++) {
        const f = (j + 0.5) / n;
        // Two passes per headway (one each way), each `d / n` metres long.
        out.push({
          id: `${id}-leg-${li + 1}-${k}-${j}`,
          label: name,
          p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f],
          height_m: 0,
          height_key: "noise.ferry_source_height_m",
          lw_key: "noise.ferry_cruise_lw_db",
          context,
          active: scale(PLUGIN_SERVICE, (2 * (d / n) * sPerM) / x.headway_s),
        });
      }
    }
  });
  x.berths.forEach((b, i) => {
    if (b.docked_s <= 0) return;
    out.push({
      id: `${id}-berth-${i + 1}`,
      label: name,
      p: b.lonlat,
      height_m: 0,
      height_key: "noise.ferry_source_height_m",
      lw_key: "noise.ferry_berth_lw_db",
      context,
      active: scale(PLUGIN_SERVICE, b.docked_s / x.headway_s),
    });
  });
  return out;
}

/**
 * Purpose: the cable car and ferry lines saved with the project as noise point sources. Modes without sound
 * powers are left out.
 * Inputs: the saved lines by tool id.
 */
export function pluginSources(tools: Record<string, SavedPluginLine>): NoisePointSource[] {
  const out: NoisePointSource[] = [];
  for (const [id, t] of Object.entries(tools)) {
    const x = t.noise;
    if (!x || x.headway_s <= 0) continue;
    const name = t.line?.name || (t.doc as { name?: string } | null)?.name || id;
    if (x.kit === "straight-spans" && CABLE_MODES.has(x.mode))
      out.push(...cableSources(`plugin-${id}`, name, x));
    else if (x.kit === "water-route" && FERRY_MODES.has(x.mode))
      out.push(...ferrySources(`plugin-${id}`, name, x));
  }
  return out;
}

/** Purpose: noise checks with "Noise: " in front, for an editor's Checks list. */
export function noiseCheckText(c: NoiseCheck): string {
  return tNow("noise.check", { text: engineTextNow({ text: c.text, msg: c.msg }) });
}
