/** Map drawing of road depots: outlines, zones, slots with chargers, aisles, drives, gates and swept paths. */
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { LonLat } from "../street-lines/types";
import { slotRing, ZONE_COLOR } from "./model";
import type { Report, SavedDepot } from "./types";

const SRC = "depots";
const DRAFT = "depots-draft";
const SWEPT = "depots-swept";
export const DEPOT_LAYERS = {
  outline: "depots-outline",
  zones: "depots-zones",
  zoneLines: "depots-zone-lines",
  aisles: "depots-aisles",
  drives: "depots-drives",
  slots: "depots-slots",
  slotLines: "depots-slot-lines",
  gates: "depots-gates",
  gateLabels: "depots-gate-labels",
  swept: "depots-swept-lines",
  draftLine: "depots-draft-line",
  draftPts: "depots-draft-points",
} as const;

/**
 * Zoom from which the depot's details are drawn. Zoomed out only the outline and its zones show, so a large
 * depot does not draw hundreds of parking slots that are too small to see.
 */
export const DETAIL_ZOOM = { aisles: 15, slots: 16, slotLines: 17.5 } as const;

type Feature = {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown };
};
const fc = (features: Feature[]) => ({ type: "FeatureCollection" as const, features });
const closed = (r: LonLat[]) => (r.length ? [...r, r[0]!] : r);

/**
 * Purpose: every depot as GeoJSON: outline, zones, slots (bodies, chargers flagged), aisles and gates; for
 * the selected depot also the drives of its network and the lanes with a problem flagged.
 */
export function depotsGeoJson(
  depots: SavedDepot[],
  selected: string | null,
  report: Report | null,
  lane: string | null,
) {
  const out: Feature[] = [];
  const bad = new Set((report?.lanes ?? []).filter((l) => !l.entry_ok || !l.exit_ok).map((l) => l.lane));
  for (const r of report?.reach ?? []) if (!r.from_entrance || !r.to_exit) bad.add(r.lane);
  for (const d of depots) {
    const sel = d.id === selected;
    if (d.boundary.length >= 3)
      out.push({
        type: "Feature",
        properties: { kind: "outline", selected: sel, depot: d.id, name: d.name },
        geometry: { type: "Polygon", coordinates: [closed(d.boundary)] },
      });
    for (const z of d.zones)
      if (z.ring.length >= 3)
        out.push({
          type: "Feature",
          properties: { kind: "zone", zone: z.kind, color: ZONE_COLOR[z.kind], selected: sel, id: z.id },
          geometry: { type: "Polygon", coordinates: [closed(z.ring)] },
        });
    for (const a of d.layout?.aisles ?? [])
      out.push({
        type: "Feature",
        properties: { kind: "aisle", width: a.width_m, selected: sel },
        geometry: { type: "LineString", coordinates: a.coords },
      });
    for (const l of d.layout?.lanes ?? [])
      for (const s of l.slots)
        out.push({
          type: "Feature",
          properties: {
            kind: "slot",
            lane: l.id,
            depot: d.id,
            charger: s.charger,
            color: ZONE_COLOR[l.kind],
            bad: sel && bad.has(l.id),
            picked: sel && l.id === lane,
          },
          geometry: { type: "Polygon", coordinates: [slotRing(s)] },
        });
    for (const g of d.gates)
      out.push({
        type: "Feature",
        properties: { kind: "gate", gate: g.kind, id: g.id, depot: d.id, label: GATE_LETTER[g.kind] },
        geometry: { type: "Point", coordinates: g.lonlat },
      });
  }
  for (const e of report?.network.edges ?? [])
    if (e.kind === "drive" || e.kind === "gate")
      out.push({
        type: "Feature",
        properties: { kind: "drive" },
        geometry: { type: "LineString", coordinates: e.coords },
      });
  return fc(out);
}

const GATE_LETTER = { entrance: "IN", exit: "OUT", both: "IN/OUT" } as const;

/** Purpose: the corners placed so far while drawing an outline or a zone. */
export function draftGeoJson(points: LonLat[]) {
  return fc([
    ...(points.length >= 2
      ? [{ type: "Feature" as const, properties: {}, geometry: { type: "LineString", coordinates: points } }]
      : []),
    ...points.map((p) => ({
      type: "Feature" as const,
      properties: {},
      geometry: { type: "Point", coordinates: p },
    })),
  ]);
}

/** Purpose: the swept body outlines of the picked lane. */
export function sweptGeoJson(rings: LonLat[][]) {
  return fc(
    rings.map((r) => ({
      type: "Feature" as const,
      properties: {},
      geometry: { type: "LineString", coordinates: r },
    })),
  );
}

/** Purpose: add the depot sources and layers once. */
export function ensureDepotLayers(map: MapLibreMap) {
  const L = DEPOT_LAYERS;
  if (!map.getSource(SRC)) map.addSource(SRC, { type: "geojson", data: fc([]) });
  if (!map.getSource(DRAFT)) map.addSource(DRAFT, { type: "geojson", data: fc([]) });
  if (!map.getSource(SWEPT)) map.addSource(SWEPT, { type: "geojson", data: fc([]) });
  const add = (spec: Parameters<MapLibreMap["addLayer"]>[0]) => {
    if (!map.getLayer(spec.id)) map.addLayer(spec);
  };
  add({
    id: L.outline,
    type: "fill",
    source: SRC,
    filter: ["==", ["get", "kind"], "outline"],
    paint: {
      "fill-color": ["case", ["get", "selected"], "#f1f5f9", "#e2e8f0"],
      "fill-opacity": 0.55,
      "fill-outline-color": "#334155",
    },
  });
  add({
    id: L.zones,
    type: "fill",
    source: SRC,
    filter: ["==", ["get", "kind"], "zone"],
    paint: { "fill-color": ["get", "color"], "fill-opacity": 0.1 },
  });
  add({
    id: L.zoneLines,
    type: "line",
    source: SRC,
    filter: ["any", ["==", ["get", "kind"], "zone"], ["==", ["get", "kind"], "outline"]],
    paint: {
      "line-color": ["case", ["==", ["get", "kind"], "outline"], "#334155", ["get", "color"]],
      "line-width": ["case", ["==", ["get", "kind"], "outline"], 2, 1.2],
      "line-dasharray": ["literal", [3, 2]],
    },
  });
  add({
    id: L.aisles,
    minzoom: DETAIL_ZOOM.aisles,
    type: "line",
    source: SRC,
    filter: ["==", ["get", "kind"], "aisle"],
    paint: {
      "line-color": "#cbd5e1",
      "line-opacity": 0.7,
      // Roughly the aisle width at street zooms.
      "line-width": [
        "interpolate",
        ["exponential", 2],
        ["zoom"],
        15,
        ["*", ["get", "width"], 0.25],
        20,
        ["*", ["get", "width"], 8],
      ],
    },
  });
  add({
    id: L.drives,
    type: "line",
    source: SRC,
    filter: ["==", ["get", "kind"], "drive"],
    paint: { "line-color": "#64748b", "line-width": 1.5, "line-dasharray": ["literal", [2, 2]] },
  });
  add({
    id: L.slots,
    minzoom: DETAIL_ZOOM.slots,
    type: "fill",
    source: SRC,
    filter: ["==", ["get", "kind"], "slot"],
    paint: {
      "fill-color": ["case", ["get", "bad"], "#dc2626", ["get", "picked"], "#f59e0b", ["get", "color"]],
      "fill-opacity": ["case", ["get", "picked"], 0.75, 0.45],
    },
  });
  add({
    id: L.slotLines,
    minzoom: DETAIL_ZOOM.slotLines,
    type: "line",
    source: SRC,
    filter: ["==", ["get", "kind"], "slot"],
    paint: {
      "line-color": ["case", ["get", "charger"], "#15803d", "#1e293b"],
      "line-width": ["case", ["get", "charger"], 2, 0.6],
    },
  });
  add({
    id: L.swept,
    minzoom: DETAIL_ZOOM.slots,
    type: "line",
    source: SWEPT,
    paint: { "line-color": "#a855f7", "line-width": 0.6, "line-opacity": 0.8 },
  });
  add({
    id: L.gates,
    type: "circle",
    source: SRC,
    filter: ["==", ["get", "kind"], "gate"],
    paint: {
      "circle-radius": 7,
      "circle-color": ["match", ["get", "gate"], "entrance", "#16a34a", "exit", "#dc2626", "#0f172a"],
      "circle-stroke-color": "#fff",
      "circle-stroke-width": 2,
    },
  });
  add({
    id: L.gateLabels,
    minzoom: DETAIL_ZOOM.slots,
    type: "symbol",
    source: SRC,
    filter: ["==", ["get", "kind"], "gate"],
    layout: {
      "text-field": ["get", "label"],
      "text-size": 11,
      "text-offset": [0, 1.4],
    },
    paint: { "text-color": "#0f172a", "text-halo-color": "#fff", "text-halo-width": 1.5 },
  });
  add({
    id: L.draftLine,
    type: "line",
    source: DRAFT,
    filter: ["==", ["geometry-type"], "LineString"],
    paint: { "line-color": "#b45309", "line-width": 2, "line-dasharray": ["literal", [2, 1]] },
  });
  add({
    id: L.draftPts,
    type: "circle",
    source: DRAFT,
    filter: ["==", ["geometry-type"], "Point"],
    paint: {
      "circle-radius": 5,
      "circle-color": "#fff",
      "circle-stroke-color": "#b45309",
      "circle-stroke-width": 2,
    },
  });
}

/** Purpose: remove the depot layers and sources. */
export function removeDepotLayers(map: MapLibreMap) {
  for (const l of Object.values(DEPOT_LAYERS).reverse()) if (map.getLayer(l)) map.removeLayer(l);
  for (const s of [SWEPT, DRAFT, SRC]) if (map.getSource(s)) map.removeSource(s);
}

/** Purpose: replace the data of one of the depot sources. */
export function setDepotData(map: MapLibreMap, which: "depots" | "draft" | "swept", data: object) {
  const id = which === "depots" ? SRC : which === "draft" ? DRAFT : SWEPT;
  (map.getSource(id) as GeoJSONSource | undefined)?.setData(data as never);
}
