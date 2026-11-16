import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { LonLat } from "../benefits/regions";
import type { Timetable } from "../journey-planner/types";
import type { PreferencesDoc } from "../../workspace/preferences";
import { demandValue } from "./params";
import {
  activeZones,
  type DemandDoc,
  type DemandZone,
  hexZones,
  linePoints,
  zoneCentre,
  zoneKm2,
} from "./zones";

const SRC = "demand-zones";
const FILL = "demand-zones-fill";
const LINE = "demand-zones-line";
const DRAFT_SRC = "demand-zones-draft";
const DRAFT_LINE = "demand-zones-draft-line";
const DRAFT_PTS = "demand-zones-draft-points";

interface FeatureCollection {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    properties: Record<string, unknown>;
    geometry: { type: string; coordinates: unknown };
  }[];
}

/** Drawing a new zone, or a new outline for the zone `id`. */
type Mode = { kind: "idle" } | { kind: "draw"; points: LonLat[]; id: string | null };

function zonesGeoJson(zones: DemandZone[], selected: string | null): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: zones
      .filter((z) => z.ring.length >= 4)
      .map((z) => ({
        type: "Feature" as const,
        properties: { id: z.id, selected: z.id === selected, name: z.name },
        geometry: { type: "Polygon", coordinates: [z.ring] },
      })),
  };
}

function draftGeoJson(points: LonLat[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      ...(points.length >= 2
        ? [
            {
              type: "Feature" as const,
              properties: {},
              geometry: { type: "LineString", coordinates: points },
            },
          ]
        : []),
      ...points.map((p) => ({
        type: "Feature" as const,
        properties: {},
        geometry: { type: "Point", coordinates: p },
      })),
    ],
  };
}

function ensureLayers(map: MapLibreMap) {
  if (!map.getSource(SRC)) map.addSource(SRC, { type: "geojson", data: zonesGeoJson([], null) });
  if (!map.getLayer(FILL))
    map.addLayer({
      id: FILL,
      type: "fill",
      source: SRC,
      paint: {
        "fill-color": ["case", ["get", "selected"], "#f59e0b", "#0d9488"],
        "fill-opacity": ["case", ["get", "selected"], 0.3, 0.08],
      },
    });
  if (!map.getLayer(LINE))
    map.addLayer({
      id: LINE,
      type: "line",
      source: SRC,
      paint: { "line-color": ["case", ["get", "selected"], "#b45309", "#0f766e"], "line-width": 1.2 },
    });
  if (!map.getSource(DRAFT_SRC)) map.addSource(DRAFT_SRC, { type: "geojson", data: draftGeoJson([]) });
  if (!map.getLayer(DRAFT_LINE))
    map.addLayer({
      id: DRAFT_LINE,
      type: "line",
      source: DRAFT_SRC,
      filter: ["==", ["geometry-type"], "LineString"],
      paint: { "line-color": "#b45309", "line-width": 2, "line-dasharray": [2, 1] },
    });
  if (!map.getLayer(DRAFT_PTS))
    map.addLayer({
      id: DRAFT_PTS,
      type: "circle",
      source: DRAFT_SRC,
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": 5,
        "circle-color": "#fff",
        "circle-stroke-color": "#b45309",
        "circle-stroke-width": 2,
      },
    });
}

function removeLayers(map: MapLibreMap) {
  for (const l of [DRAFT_PTS, DRAFT_LINE, LINE, FILL]) if (map.getLayer(l)) map.removeLayer(l);
  for (const s of [DRAFT_SRC, SRC]) if (map.getSource(s)) map.removeSource(s);
}

function newId(): string {
  return `z-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * The GIS tab's demand zones (ADR-0019): the zones of the demand model on the map. Automatic hexagons can be
 * made the planner's own; own zones can be drawn, redrawn, renamed and deleted. Their values are entered in
 * the Tables tab's Demand model section.
 * Side effects: draws the zones on the map.
 */
export function DemandZoneEditor({
  map,
  panel,
  timetable,
  preferences,
  doc,
  onDoc,
}: {
  map: MapLibreMap | null;
  panel: HTMLElement | null;
  timetable: Timetable | null;
  preferences: PreferencesDoc | null;
  doc: DemandDoc | null;
  /** Absent for people who may not edit the project. */
  onDoc?: (doc: DemandDoc) => void;
}) {
  const editable = !!onDoc;
  const buffer = demandValue("demand.area_buffer_m", preferences);
  const maxZones = demandValue("demand.zone_max_count", preferences);
  const points = useMemo(() => linePoints(timetable), [timetable]);
  const auto = useMemo(() => hexZones(points, buffer, maxZones), [points, buffer, maxZones]);
  const zones = useMemo(() => activeZones(doc, auto.zones), [doc, auto.zones]);
  const own = doc?.source === "own";
  const [mode, setMode] = useState<Mode>({ kind: "idle" });
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!map) return;
    const add = () => ensureLayers(map);
    if (map.isStyleLoaded()) add();
    else map.once("load", add);
    return () => {
      map.off("load", add);
      if (map.getStyle()) removeLayers(map);
    };
  }, [map]);

  useEffect(() => {
    if (!map) return;
    (map.getSource(SRC) as GeoJSONSource | undefined)?.setData(zonesGeoJson(zones, selected));
  }, [map, zones, selected]);

  const draft = mode.kind === "draw" ? mode.points : [];
  useEffect(() => {
    if (!map) return;
    (map.getSource(DRAFT_SRC) as GeoJSONSource | undefined)?.setData(draftGeoJson(draft));
  }, [map, draft]);

  useEffect(() => {
    if (!map) return;
    const onClick = (ev: MapMouseEvent) => {
      const at: LonLat = [ev.lngLat.lng, ev.lngLat.lat];
      if (mode.kind === "draw") {
        setMode({ ...mode, points: [...mode.points, at] });
        return;
      }
      const hits = map.getLayer(FILL) ? map.queryRenderedFeatures(ev.point, { layers: [FILL] }) : [];
      const id = hits[hits.length - 1]?.properties?.id;
      setSelected(typeof id === "string" ? id : null);
    };
    map.on("click", onClick);
    const canvas = map.getCanvas?.();
    if (canvas) canvas.style.cursor = mode.kind === "idle" ? "" : "crosshair";
    return () => {
      map.off("click", onClick);
      if (canvas) canvas.style.cursor = "";
    };
  }, [map, mode]);

  const ownZones = own ? (doc?.zones ?? []) : [];
  const setOwn = (next: DemandZone[]) =>
    onDoc?.({ ...(doc ?? { source: "own" }), source: "own", zones: next });
  const zone = zones.find((z) => z.id === selected) ?? null;
  const finishDraw = () => {
    if (mode.kind !== "draw" || mode.points.length < 3) return;
    const ring = [...mode.points, mode.points[0]!];
    if (mode.id) setOwn(ownZones.map((z) => (z.id === mode.id ? { ...z, ring } : z)));
    else {
      const id = newId();
      setOwn([...ownZones, { id, name: `Zone ${ownZones.length + 1}`, ring, values: {} }]);
      setSelected(id);
    }
    setMode({ kind: "idle" });
  };

  const body = (
    <div className="flex flex-col gap-4 px-4 pt-1 pb-6 md:px-5">
      <div>
        <h2 className="text-lg font-semibold">Demand zones</h2>
        <p className="mt-1 text-sm text-slate-600">
          The zones of the demand model. Enter people, jobs and places of a zone in the Tables tab (Demand
          model).
        </p>
      </div>
      <p className="text-sm text-slate-600" data-testid="zone-count">
        {own
          ? `${zones.length} zones of your own.`
          : zones.length
            ? `${zones.length} automatic hexagons within ${Math.round(buffer)} m of the lines.`
            : "No zones yet: publish a line, or upload zones in the Tables tab."}
      </p>
      {editable && mode.kind === "idle" && (
        <div className="flex flex-wrap gap-2">
          {own ? (
            <button
              type="button"
              className="btn btn-pri min-h-10"
              onClick={() => setMode({ kind: "draw", points: [], id: null })}
            >
              Draw a zone
            </button>
          ) : (
            zones.length > 0 && (
              <button
                type="button"
                className="btn btn-pri min-h-10"
                onClick={() => onDoc?.({ ...(doc ?? {}), source: "own", zones })}
              >
                Make these zones my own
              </button>
            )
          )}
          {own && (
            <button
              type="button"
              className="btn min-h-10"
              onClick={() => onDoc?.({ ...doc!, source: "auto" })}
            >
              Use automatic hexagons
            </button>
          )}
        </div>
      )}
      {mode.kind === "draw" && (
        <section
          aria-label="Drawing a zone"
          className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm"
        >
          <p>
            Tap the map to place the corners of the {mode.id ? "new outline" : "zone"} ({mode.points.length}{" "}
            so far, at least 3).
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-pri min-h-10"
              disabled={mode.points.length < 3}
              onClick={finishDraw}
            >
              Finish
            </button>
            <button
              type="button"
              className="btn min-h-10"
              disabled={!mode.points.length}
              onClick={() => setMode({ ...mode, points: mode.points.slice(0, -1) })}
            >
              Undo last corner
            </button>
            <button type="button" className="btn min-h-10" onClick={() => setMode({ kind: "idle" })}>
              Cancel
            </button>
          </div>
        </section>
      )}
      {zone && mode.kind === "idle" && (
        <section aria-label={`Zone ${zone.name}`} className="rounded-xl border border-slate-200 p-3 text-sm">
          <div className="flex items-start gap-2">
            {own && editable ? (
              <label className="min-w-0 flex-1">
                <span className="font-medium">Name</span>
                <input
                  key={zone.id}
                  className="input mt-1 w-full"
                  defaultValue={zone.name}
                  onBlur={(e) =>
                    e.target.value.trim() &&
                    e.target.value !== zone.name &&
                    setOwn(
                      ownZones.map((z) => (z.id === zone.id ? { ...z, name: e.target.value.trim() } : z)),
                    )
                  }
                />
              </label>
            ) : (
              <p className="min-w-0 flex-1 font-medium">{zone.name}</p>
            )}
            <button type="button" className="btn min-h-10" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {zoneKm2(zone) < 10 ? zoneKm2(zone).toFixed(2) : Math.round(zoneKm2(zone))} km² ·{" "}
            {Object.keys(zone.values).length} values of your own
          </p>
          {own && editable && (
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn min-h-10"
                onClick={() => setMode({ kind: "draw", points: [], id: zone.id })}
              >
                Redraw the outline
              </button>
              <button
                type="button"
                className="btn min-h-10 text-red-700"
                onClick={() => {
                  setOwn(ownZones.filter((z) => z.id !== zone.id));
                  setSelected(null);
                }}
              >
                Delete zone
              </button>
            </div>
          )}
          {map && (
            <button
              type="button"
              className="mt-2 text-sm underline"
              onClick={() => map.easeTo({ center: zoneCentre(zone), zoom: Math.max(map.getZoom(), 13) })}
            >
              Show on the map
            </button>
          )}
        </section>
      )}
      <p className="text-xs text-slate-500">Saved with the project, for everyone who opens it.</p>
    </div>
  );
  return panel ? createPortal(body, panel) : body;
}
