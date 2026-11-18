import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { cutPolyline, trackStretches } from "../noise/timetabled";
import type { LonLat } from "../street-lines/types";
import type { Network, RailView, SectionTrains } from "./types";

/** A section of the published topology: on a design track, with its chainages. */
interface TopologySection {
  id: string;
  source: {
    kind: "track" | "station" | "switch";
    ref: number;
    index: number;
    chainage_m: [number, number] | null;
  };
}

type Feature = { type: "Feature"; properties: Record<string, string | number>; geometry: object };
type Collection = { type: "FeatureCollection"; features: Feature[] };

/**
 * Purpose: where each service line runs, for the map: the stretches of the drawn tracks its trains use, from
 * the trains per section of the last publication, so the planner sees which tracks (and which side of a double
 * track) a line takes. Lines of the drawing that are not published have no path.
 * Inputs: the drawing, its build, the publication's trains per section, the topology of the same build.
 */
export function serviceLinePaths(
  doc: Network,
  view: RailView,
  sectionTrains: readonly SectionTrains[],
  topology: unknown,
): Collection {
  const sections = new Map(
    ((topology as { sections?: TopologySection[] } | null)?.sections ?? []).map((s) => [s.id, s]),
  );
  const colors = new Map((doc.lines ?? []).map((l) => [l.id, { color: l.color, name: l.name || l.id }]));
  const per = new Map<
    string,
    { track: number; line: string; parts: Parameters<typeof trackStretches>[0][number][] }
  >();
  for (const st of sectionTrains) {
    const sec = sections.get(st.section);
    if (!sec || sec.source.kind !== "track" || !sec.source.chainage_m) continue;
    const key = `${sec.source.ref}|${st.line}`;
    const entry = per.get(key) ?? { track: sec.source.ref, line: st.line, parts: [] };
    const [a, b] = sec.source.chainage_m;
    entry.parts.push({ index: sec.source.index, from_m: a, to_m: b, hourly: [...st.hours] });
    per.set(key, entry);
  }
  const features: Feature[] = [];
  for (const { track, line, parts } of per.values()) {
    const t = view.tracks.find((x) => x.id === track);
    const l = colors.get(line);
    if (!t || !l) continue;
    for (const s of trackStretches(parts)) {
      const coords = cutPolyline(t.centre, s.from_m, s.to_m, t.length_m);
      if (coords.length >= 2)
        features.push({
          type: "Feature",
          properties: { line, color: l.color, name: l.name },
          geometry: { type: "LineString", coordinates: coords },
        });
    }
  }
  return { type: "FeatureCollection", features };
}

/**
 * Purpose: the stops of every service line, numbered in the order its trains call, at the stations of the build.
 * Shown as soon as a line has stops, before it is published.
 */
export function serviceLineStops(doc: Network, view: RailView): Collection {
  const at = new Map<number, LonLat>(view.stations.map((s) => [s.id, s.lonlat]));
  const features: Feature[] = [];
  for (const l of doc.lines ?? [])
    l.stations.forEach((id, i) => {
      const p = at.get(id);
      if (p)
        features.push({
          type: "Feature",
          properties: { line: l.id, color: l.color, n: i + 1 },
          geometry: { type: "Point", coordinates: p },
        });
    });
  return { type: "FeatureCollection", features };
}

const PATH = "rd-line-paths";
const STOPS = "rd-line-stops";
const EMPTY: Collection = { type: "FeatureCollection", features: [] };

/** Purpose: draw the service lines' paths and numbered stops over the railway (a stale path is drawn faded). */
export function drawServiceLines(
  map: MapLibreMap,
  paths: Collection | null,
  stops: Collection,
  stale: boolean,
): void {
  if (!map.getSource(PATH)) {
    map.addSource(PATH, { type: "geojson", data: EMPTY });
    map.addSource(STOPS, { type: "geojson", data: EMPTY });
    map.addLayer({
      id: PATH,
      type: "line",
      source: PATH,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": ["get", "color"], "line-width": 7, "line-opacity": 0.55 },
    });
    map.addLayer({
      id: `${STOPS}-dot`,
      type: "circle",
      source: STOPS,
      paint: {
        "circle-radius": 9,
        "circle-color": "#ffffff",
        "circle-stroke-color": ["get", "color"],
        "circle-stroke-width": 2.5,
      },
    });
    map.addLayer({
      id: `${STOPS}-n`,
      type: "symbol",
      source: STOPS,
      layout: {
        "text-field": ["to-string", ["get", "n"]],
        "text-font": ["Noto Sans Bold"],
        "text-size": 11,
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: { "text-color": ["get", "color"] },
    });
  }
  (map.getSource(PATH) as GeoJSONSource | undefined)?.setData((paths ?? EMPTY) as never);
  (map.getSource(STOPS) as GeoJSONSource | undefined)?.setData(stops as never);
  map.setPaintProperty?.(PATH, "line-opacity", stale ? 0.25 : 0.55);
}

/** Purpose: remove the service line layers. */
export function removeServiceLines(map: MapLibreMap): void {
  for (const id of [`${STOPS}-n`, `${STOPS}-dot`, PATH]) if (map.getLayer(id)) map.removeLayer(id);
  for (const id of [STOPS, PATH]) if (map.getSource(id)) map.removeSource(id);
}
