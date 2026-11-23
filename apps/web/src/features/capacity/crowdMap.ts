/**
 * Crowding by link on the map (Simulator → Test the system): each link between two stops of a line in its
 * busiest hour, coloured by how full the vehicles are (riders over places), green up to 80 %, amber up to
 * 100 %, red above (the same tones as the line card's passengers). Links are drawn straight between the
 * stops; both directions of a link show the fuller one.
 */
import type { GeoJSONSource, GeoJSONSourceSpecification, Map as MapLibreMap } from "maplibre-gl";
import { railLonLat } from "../area/outside";
import type { Network } from "../railways/types";
import type { SavedStreetLine } from "../street-lines/saved";
import type { LonLat } from "../street-lines/types";
import type { LineLoad } from "./loads";
import { stopName } from "./streetRun";

const SOURCE = "capacity-crowding";
const LAYERS = [`${SOURCE}-line`, `${SOURCE}-label`] as const;

/** One link to draw. */
export interface CrowdLink {
  line: string;
  from: LonLat;
  to: LonLat;
  /** riders / places in the line's busiest hour (Infinity: riders but no vehicle). */
  occupancy: number;
}

/** Stop positions by stop name, for each line key (`rail:<id>` / `street:<index>`). */
export type StopPlaces = Record<string, Map<string, LonLat>>;

/**
 * Purpose: where each line's stops are: rail stations from the drawing (local metres round its origin),
 * street stops from their points. Keys as the loads' (`rail:<id>` for every rail line shares the stations).
 */
export function stopPlaces(
  railway: Network | null | undefined,
  railKeys: readonly string[],
  streets: readonly { line: SavedStreetLine; index: number }[],
): StopPlaces {
  const out: StopPlaces = {};
  if (railway) {
    const st = new Map(railway.stations.map((s) => [s.name, railLonLat(railway.origin, s.x, s.y)]));
    for (const k of railKeys) out[k] = st;
  }
  for (const { line, index } of streets) {
    const m = new Map<string, LonLat>();
    for (const p of line.view.points) if (p.kind !== "via") m.set(stopName(p), p.lonlat);
    out[`street:${index}`] = m;
  }
  return out;
}

/**
 * Purpose: the links to draw from the loads: each stop pair once per line, the fuller direction.
 * Links whose stops have no place are left out.
 */
export function crowdLinks(loads: Record<string, LineLoad>, places: StopPlaces): CrowdLink[] {
  const out: CrowdLink[] = [];
  for (const [key, load] of Object.entries(loads)) {
    const at = places[key];
    if (!at || !load.links) continue;
    const best = new Map<string, CrowdLink>();
    for (const l of load.links) {
      const a = at.get(l.from);
      const b = at.get(l.to);
      if (!a || !b || l.riders <= 0) continue;
      const pair = [l.from, l.to].sort().join("\u0000");
      const was = best.get(pair);
      if (!was || l.occupancy > was.occupancy)
        best.set(pair, { line: load.name, from: a, to: b, occupancy: l.occupancy });
    }
    out.push(...best.values());
  }
  return out;
}

type Data = GeoJSONSourceSpecification["data"];

/** Purpose: draw (or redraw) the links. Side effects: adds or updates the `capacity-crowding` layers. */
export function drawCrowding(map: MapLibreMap, links: readonly CrowdLink[]): void {
  const data = {
    type: "FeatureCollection",
    features: links.map((l) => {
      const full = Number.isFinite(l.occupancy) ? l.occupancy : 9.99;
      return {
        type: "Feature",
        properties: { full, label: `${Math.round(full * 100)} %` },
        geometry: { type: "LineString", coordinates: [l.from, l.to] },
      };
    }),
  } as Data;
  const src = map.getSource(SOURCE) as GeoJSONSource | undefined;
  if (src) {
    src.setData(data as never);
    return;
  }
  map.addSource(SOURCE, { type: "geojson", data });
  map.addLayer({
    id: LAYERS[0],
    type: "line",
    source: SOURCE,
    layout: { "line-cap": "round", "line-sort-key": ["get", "full"] as never },
    paint: {
      "line-width": ["interpolate", ["linear"], ["get", "full"], 0, 3, 1, 7, 2, 11] as never,
      "line-opacity": 0.85,
      "line-color": ["step", ["get", "full"], "#059669", 0.8, "#d97706", 1.0, "#dc2626"] as never,
    },
  });
  map.addLayer({
    id: LAYERS[1],
    type: "symbol",
    source: SOURCE,
    layout: {
      "symbol-placement": "line-center",
      "text-field": ["get", "label"],
      "text-size": 12,
    },
    paint: { "text-color": "#0f172a", "text-halo-color": "#ffffff", "text-halo-width": 2 },
  });
}

/** Purpose: take the crowding off the map. */
export function removeCrowding(map: MapLibreMap): void {
  for (const l of LAYERS) if (map.getLayer(l)) map.removeLayer(l);
  if (map.getSource(SOURCE)) map.removeSource(SOURCE);
}
