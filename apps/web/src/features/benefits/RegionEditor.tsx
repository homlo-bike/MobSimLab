import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { type BenefitsApi, benefitsApi, type OsmArea } from "./data";
import {
  LAND_USES,
  type LandUse,
  type LonLat,
  REGION_FIELDS,
  type Region,
  type RegionValues,
  ringAreaM2,
  ringCentre,
} from "./regions";

const SRC = "regions";
const FILL = "regions-fill";
const LINE = "regions-line";
const DRAFT_SRC = "regions-draft";
const DRAFT_LINE = "regions-draft-line";
const DRAFT_PTS = "regions-draft-points";

interface FeatureCollection {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    properties: Record<string, unknown>;
    geometry: { type: string; coordinates: unknown };
  }[];
}

type Mode = { kind: "idle" } | { kind: "draw"; points: LonLat[] } | { kind: "import"; at: LonLat | null };

const DEFAULT_API = benefitsApi();

/** Purpose: a new id for a region. */
function newId(): string {
  return `rg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Purpose: the regions as GeoJSON polygons, the selected one flagged. */
function regionsGeoJson(regions: Region[], selected: string | null): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: regions
      .filter((r) => r.ring.length >= 4)
      .map((r) => ({
        type: "Feature" as const,
        properties: { id: r.id, selected: r.id === selected, name: r.name },
        geometry: { type: "Polygon", coordinates: [r.ring] },
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
  if (!map.getSource(SRC)) map.addSource(SRC, { type: "geojson", data: regionsGeoJson([], null) });
  if (!map.getLayer(FILL))
    map.addLayer({
      id: FILL,
      type: "fill",
      source: SRC,
      paint: {
        "fill-color": ["case", ["get", "selected"], "#f59e0b", "#6366f1"],
        "fill-opacity": ["case", ["get", "selected"], 0.25, 0.12],
      },
    });
  if (!map.getLayer(LINE))
    map.addLayer({
      id: LINE,
      type: "line",
      source: SRC,
      paint: { "line-color": ["case", ["get", "selected"], "#b45309", "#4338ca"], "line-width": 2 },
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

/**
 * The GIS tab's regions (ADR-0040): draw an area or import a neighbourhood, district or other area from
 * OpenStreetMap, then enter its values (primary land use, land value, tax revenue, population density, jobs,
 * GDP per person, employment). The benefit tables use a region's values in place of the sourced data.
 * Side effects: draws the regions on the map; asks the API for the OpenStreetMap areas at a point.
 */
export function RegionEditor({
  map,
  panel,
  regions,
  onChange,
  editable,
  currency,
  api = DEFAULT_API,
}: {
  map: MapLibreMap | null;
  panel: HTMLElement | null;
  regions: Region[];
  onChange: (next: Region[]) => void;
  editable: boolean;
  currency?: string | null;
  api?: BenefitsApi;
}) {
  const [mode, setMode] = useState<Mode>({ kind: "idle" });
  const [selected, setSelected] = useState<string | null>(null);
  const [areas, setAreas] = useState<OsmArea[] | null>(null);
  const [areaError, setAreaError] = useState<string | null>(null);

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
    (map.getSource(SRC) as GeoJSONSource | undefined)?.setData(regionsGeoJson(regions, selected));
  }, [map, regions, selected]);

  const draft = mode.kind === "draw" ? mode.points : [];
  useEffect(() => {
    if (!map) return;
    (map.getSource(DRAFT_SRC) as GeoJSONSource | undefined)?.setData(draftGeoJson(draft));
  }, [map, draft]);

  // Map clicks: add a point while drawing, pick a place while importing, else select a region.
  useEffect(() => {
    if (!map) return;
    const onClick = (ev: MapMouseEvent) => {
      const at: LonLat = [ev.lngLat.lng, ev.lngLat.lat];
      if (mode.kind === "draw") {
        setMode({ kind: "draw", points: [...mode.points, at] });
        return;
      }
      if (mode.kind === "import") {
        setMode({ kind: "import", at });
        setAreas(null);
        setAreaError(null);
        api
          .osmAreas(at)
          .then(setAreas)
          .catch((e: unknown) => setAreaError(e instanceof Error ? e.message : String(e)));
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
  }, [map, mode, api]);

  const region = regions.find((r) => r.id === selected) ?? null;
  const update = (id: string, patch: Partial<Region>) =>
    onChange(regions.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const add = (r: Region) => {
    onChange([...regions, r]);
    setSelected(r.id);
    setMode({ kind: "idle" });
  };
  const finishDraw = () => {
    if (mode.kind !== "draw" || mode.points.length < 3) return;
    const ring = [...mode.points, mode.points[0]!];
    add({ id: newId(), name: `Region ${regions.length + 1}`, ring, source: "drawn", values: {} });
  };
  const importArea = (a: OsmArea) => {
    const existing = regions.find((r) => r.osmId === a.id);
    if (existing) {
      setSelected(existing.id);
      setMode({ kind: "idle" });
      return;
    }
    add({ id: newId(), name: a.name, ring: a.ring, source: "osm", osmId: a.id, values: {} });
  };
  const show = (r: Region) => {
    setSelected(r.id);
    if (map) map.easeTo({ center: ringCentre(r.ring), zoom: Math.max(map.getZoom(), 13) });
  };
  const listed = useMemo(() => [...regions].sort((a, b) => a.name.localeCompare(b.name)), [regions]);

  const body = (
    <div className="flex flex-col gap-4 px-4 pt-1 pb-6 md:px-5">
      <div>
        <h2 className="text-lg font-semibold">Regions</h2>
        <p className="mt-1 text-sm text-slate-600">
          Draw an area or import a neighbourhood from OpenStreetMap, then enter what you know about it. Your
          values take priority over WorldPop, OpenStreetMap and the World Bank in the benefit tables.
        </p>
      </div>
      {editable && mode.kind === "idle" && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-pri min-h-10"
            onClick={() => setMode({ kind: "draw", points: [] })}
          >
            Draw a region
          </button>
          <button
            type="button"
            className="btn min-h-10"
            onClick={() => {
              setAreas(null);
              setAreaError(null);
              setMode({ kind: "import", at: null });
            }}
          >
            Import from OpenStreetMap
          </button>
        </div>
      )}
      {mode.kind === "draw" && (
        <section
          aria-label="Drawing a region"
          className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm"
        >
          <p>Tap the map to place the corners of the region ({mode.points.length} so far, at least 3).</p>
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
              onClick={() => setMode({ kind: "draw", points: mode.points.slice(0, -1) })}
            >
              Undo last corner
            </button>
            <button type="button" className="btn min-h-10" onClick={() => setMode({ kind: "idle" })}>
              Cancel
            </button>
          </div>
        </section>
      )}
      {mode.kind === "import" && (
        <section
          aria-label="Importing a region"
          className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm"
        >
          <p>Tap a place on the map to list the neighbourhoods, districts and other areas around it.</p>
          {mode.at && !areas && !areaError && (
            <p role="status" className="mt-2 text-slate-600">
              Looking up areas…
            </p>
          )}
          {areaError && (
            <p role="alert" className="mt-2 text-red-700">
              {areaError}
            </p>
          )}
          {areas && areas.length === 0 && (
            <p className="mt-2 text-slate-600">No named areas here. Try another place, or draw one.</p>
          )}
          {areas && areas.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {areas.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-center gap-2 rounded-lg bg-white px-2 text-left hover:bg-indigo-100"
                    onClick={() => importArea(a)}
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{a.name}</span>
                    <span className="shrink-0 text-xs text-slate-500">
                      {a.kind}
                      {a.adminLevel ? ` ${a.adminLevel}` : ""} ·{" "}
                      {a.areaKm2 < 10 ? a.areaKm2.toFixed(1) : Math.round(a.areaKm2)} km²
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="btn mt-2 min-h-10" onClick={() => setMode({ kind: "idle" })}>
            Cancel
          </button>
        </section>
      )}
      {region && mode.kind === "idle" && (
        <RegionForm
          key={region.id}
          region={region}
          editable={editable}
          currency={currency ?? null}
          onPatch={(p) => update(region.id, p)}
          onDelete={() => {
            onChange(regions.filter((r) => r.id !== region.id));
            setSelected(null);
          }}
          onClose={() => setSelected(null)}
        />
      )}
      <section aria-label="Regions in this project">
        <h3 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
          Regions · {regions.length}
        </h3>
        {listed.length === 0 ? (
          <p className="mt-1 text-sm text-slate-600">
            None yet: the benefit tables use the sourced data everywhere.
          </p>
        ) : (
          <ul className="mt-1 flex flex-col">
            {listed.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => show(r)}
                  aria-current={r.id === selected ? "true" : undefined}
                  className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left hover:bg-slate-100 aria-[current=true]:bg-amber-50"
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                  <span className="shrink-0 text-xs text-slate-500">
                    {Object.values(r.values).filter((v) => v !== undefined && v !== null && v !== "").length}{" "}
                    values
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-slate-500">Saved with the project, for everyone who opens it.</p>
      </section>
    </div>
  );
  return panel ? createPortal(body, panel) : body;
}

function RegionForm({
  region,
  editable,
  currency,
  onPatch,
  onDelete,
  onClose,
}: {
  region: Region;
  editable: boolean;
  currency: string | null;
  onPatch: (p: Partial<Region>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const setValue = (k: keyof RegionValues, v: RegionValues[keyof RegionValues] | undefined) => {
    const values = { ...region.values } as Record<string, unknown>;
    if (v === undefined) delete values[k];
    else values[k] = v;
    onPatch({ values: values as RegionValues });
  };
  const km2 = ringAreaM2(region.ring) / 1e6;
  return (
    <section aria-label={`Region ${region.name}`} className="rounded-xl border border-slate-200 p-3">
      <div className="flex items-start gap-2">
        <label className="min-w-0 flex-1 text-sm">
          <span className="font-medium">Name</span>
          <input
            className="input mt-1 w-full"
            defaultValue={region.name}
            readOnly={!editable}
            onBlur={(e) =>
              e.target.value.trim() &&
              e.target.value !== region.name &&
              onPatch({ name: e.target.value.trim() })
            }
          />
        </label>
        <button type="button" className="btn min-h-10" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {region.source === "osm" ? `Imported from OpenStreetMap (${region.osmId})` : "Drawn"} ·{" "}
        {km2 < 10 ? km2.toFixed(2) : Math.round(km2)} km². Leave a value empty to keep the sourced data.
      </p>
      <label className="mt-3 block text-sm">
        <span className="font-medium">Primary land use</span>
        <span className="block text-xs text-slate-500">
          Used for buildings OpenStreetMap does not describe.
        </span>
        <select
          className="input mt-1 w-full"
          value={region.values.landUse ?? ""}
          disabled={!editable}
          onChange={(e) => setValue("landUse", (e.target.value || undefined) as LandUse | undefined)}
        >
          <option value="">From OpenStreetMap</option>
          {LAND_USES.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}
            </option>
          ))}
        </select>
      </label>
      {REGION_FIELDS.map((f) => {
        const v = region.values[f.key];
        const shown = v === undefined ? "" : f.percent ? String(Math.round(v * 1000) / 10) : String(v);
        const money = ["landValuePerM2", "taxRevenuePerYear", "gdpPerCapita"].includes(f.key);
        return (
          <label key={f.key} className="mt-3 block text-sm">
            <span className="font-medium">{f.label}</span>
            <span className="block text-xs text-slate-500">
              {money && currency ? `${currency} ` : ""}
              {f.unit}
            </span>
            <input
              type="number"
              min={0}
              step="any"
              className="input mt-1 w-full"
              defaultValue={shown}
              readOnly={!editable}
              onBlur={(e) => {
                const t = e.target.value.trim();
                if (t === "") {
                  if (v !== undefined) setValue(f.key, undefined);
                  return;
                }
                const n = Number(t);
                if (!Number.isFinite(n) || n < 0) return;
                const next = f.percent ? n / 100 : n;
                if (next !== v) setValue(f.key, next);
              }}
            />
          </label>
        );
      })}
      {editable && (
        <button type="button" className="btn mt-4 min-h-10 text-red-700" onClick={onDelete}>
          Delete region
        </button>
      )}
    </section>
  );
}
