import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { formatInt, tNow, useI18n, withNodes } from "../../i18n/i18n";
import type { MessageKey } from "../../i18n/messages";
import { type Place, searchPlaces } from "../../map/places";
import {
  type AreaDetail,
  type AreaEstimate,
  type AreaImport,
  type AreaPolygon,
  inArea,
  megabytes,
  newPolygonId,
  outsideKm2,
  type ProjectAreaApi,
} from "../area/api";
import { notifyAreaChanged } from "../area/areaLayer";
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
import { engineErrorText } from "../../i18n/engine";

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

type Mode =
  | { kind: "idle" }
  | { kind: "draw"; points: LonLat[] }
  | { kind: "import"; at: LonLat | null }
  /**
   * An imported area that reaches outside the project area: ask before downloading map data for it, which adds
   * it to the project area as a new polygon at the detail picked here.
   */
  | {
      kind: "outside";
      area: OsmArea;
      /** The project area's polygons now. */
      polygons: AreaPolygon[];
      detail: AreaDetail;
      /** About how much of the region lies outside the project area, km². */
      outsideKm2: number;
      /** What adding it would download; null while it is worked out. */
      estimate: AreaEstimate | null;
    };

/** Purpose: whether a ring has a corner outside every polygon of the project area. */
export function reachesOutside(
  ring: readonly LonLat[],
  polygons: readonly { ring: readonly LonLat[] }[],
): boolean {
  return ring.some((p) => !inArea(p, polygons));
}

/** Purpose: the region as a new polygon of the project area. */
function regionPolygon(a: OsmArea, detail: AreaDetail, polygons: readonly AreaPolygon[]): AreaPolygon {
  return { id: newPolygonId(polygons), name: a.name, detail, ring: a.ring };
}

const IMPORT_NAMES: Record<AreaImport["kind"], MessageKey> = {
  osm: "reg.import.osm",
  dem: "reg.import.dem",
  population: "reg.import.population",
};

/** Purpose: one line on the downloads queued for the larger project area. */
function importsNote(imports: readonly AreaImport[]): string {
  const queued = imports.filter((i) => i.status === "queued").map((i) => tNow(IMPORT_NAMES[i.kind]));
  const failed = imports.filter((i) => i.status === "failed");
  const parts: string[] = [];
  parts.push(
    queued.length ? tNow("reg.areaDownloading", { what: queued.join(", ") }) : tNow("reg.areaReady"),
  );
  for (const f of failed)
    parts.push(
      tNow("reg.importFailed", {
        what: tNow(IMPORT_NAMES[f.kind]),
        reason: f.reason ?? tNow("reg.unknownReason"),
      }),
    );
  return parts.join(" ");
}

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
  search = searchPlaces,
  area = null,
}: {
  map: MapLibreMap | null;
  panel: HTMLElement | null;
  regions: Region[];
  onChange: (next: Region[]) => void;
  editable: boolean;
  currency?: string | null;
  api?: BenefitsApi;
  /** Place search for importing by name (the map's geocoder); replaced in tests. */
  search?: typeof searchPlaces;
  /**
   * The project area, to ask before importing a region that reaches outside it and then add the region to it
   * (which downloads the map data the larger area needs). Null: regions are imported without asking.
   */
  area?: ProjectAreaApi | null;
}) {
  const { t, tn } = useI18n();
  const [mode, setMode] = useState<Mode>({ kind: "idle" });
  // Importing by name: the text, the places found, and any error.
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [areas, setAreas] = useState<OsmArea[] | null>(null);
  const [areaError, setAreaError] = useState<string | null>(null);
  // Adding a region to the project area: running, and what came of it.
  const [extending, setExtending] = useState(false);
  const [extendNote, setExtendNote] = useState<{ ok: boolean; text: string } | null>(null);

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

  // The OpenStreetMap areas containing a point (smallest first), for a tapped or a searched place.
  const lookUp = useCallback(
    (at: LonLat) => {
      setMode({ kind: "import", at });
      setAreas(null);
      setAreaError(null);
      api
        .osmAreas(at)
        .then(setAreas)
        .catch((e: unknown) => setAreaError(engineErrorText(e)));
    },
    [api],
  );

  // Searching by name: places matching the text after a short pause, nearer the map centre first.
  useEffect(() => {
    if (mode.kind !== "import" || query.trim().length < 2) {
      setPlaces(null);
      setPlaceError(null);
      return;
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      const c = map?.getCenter?.();
      search(query, {
        lang: typeof navigator !== "undefined" ? navigator.language : undefined,
        near: c ? [c.lng, c.lat] : undefined,
        signal: ctl.signal,
      })
        .then((p) => {
          setPlaces(p);
          setPlaceError(null);
        })
        .catch((e: unknown) => {
          if (!ctl.signal.aborted) setPlaceError(engineErrorText(e));
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [query, mode.kind, map, search]);

  // A place chosen from the search: show it on the map and list the areas it lies in.
  const choosePlace = (p: Place) => {
    setPlaces(null);
    setQuery(p.name);
    if (map) {
      if (p.bbox) map.fitBounds?.([p.bbox[0], p.bbox[1], p.bbox[2], p.bbox[3]], { padding: 40, maxZoom: 15 });
      else map.easeTo?.({ center: p.lonLat, zoom: Math.max(map.getZoom(), 12) });
    }
    lookUp(p.lonLat);
  };

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
        lookUp(at);
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
  }, [map, mode, lookUp]);

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
    add({
      id: newId(),
      name: t("reg.defaultName", { n: regions.length + 1 }),
      ring,
      source: "drawn",
      values: {},
    });
  };
  const addImported = (a: OsmArea) =>
    add({ id: newId(), name: a.name, ring: a.ring, source: "osm", osmId: a.id, values: {} });
  const importArea = async (a: OsmArea) => {
    const existing = regions.find((r) => r.osmId === a.id);
    if (existing) {
      setSelected(existing.id);
      setMode({ kind: "idle" });
      return;
    }
    setExtendNote(null);
    if (area) {
      // A region reaching outside the project area has no map data there yet: ask before downloading it.
      const view = await area.get().catch(() => null);
      if (view?.polygons.length && reachesOutside(a.ring, view.polygons)) {
        const polygons = view.polygons;
        setMode({
          kind: "outside",
          area: a,
          polygons,
          detail: "full",
          outsideKm2: outsideKm2(a.ring, polygons),
          estimate: null,
        });
        void estimateOutside(a, polygons, "full");
        return;
      }
    }
    addImported(a);
  };
  // What adding the region to the project area at a detail would download.
  const estimateOutside = async (a: OsmArea, polygons: AreaPolygon[], detail: AreaDetail) => {
    if (!area) return;
    const e = await area
      .estimate([...polygons, regionPolygon(a, detail, polygons)], polygons)
      .catch(() => null);
    setMode((m) =>
      m.kind === "outside" && m.area.id === a.id && m.detail === detail ? { ...m, estimate: e } : m,
    );
  };
  // Add the region to the project area as a new polygon, which queues the downloads the larger area needs.
  const extendArea = async (a: OsmArea, polygons: AreaPolygon[], detail: AreaDetail) => {
    if (!area) return;
    setExtending(true);
    try {
      addImported(a);
      const r = await area.set([...polygons, regionPolygon(a, detail, polygons)], true);
      notifyAreaChanged();
      setExtendNote({ ok: !r.imports.some((i) => i.status === "failed"), text: importsNote(r.imports) });
    } catch (e) {
      setExtendNote({
        ok: false,
        text: t("reg.areaFailed", { error: engineErrorText(e) }),
      });
    } finally {
      setExtending(false);
    }
  };
  const show = (r: Region) => {
    setSelected(r.id);
    if (map) map.easeTo({ center: ringCentre(r.ring), zoom: Math.max(map.getZoom(), 13) });
  };
  const listed = useMemo(() => [...regions].sort((a, b) => a.name.localeCompare(b.name)), [regions]);

  const body = (
    <div className="flex flex-col gap-4 px-4 pt-1 pb-6 md:px-5">
      <div>
        <h2 className="text-lg font-semibold">{t("reg.title")}</h2>
        <p className="mt-1 text-sm text-slate-600">{t("reg.intro")}</p>
      </div>
      {editable && mode.kind === "idle" && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-pri min-h-10"
            onClick={() => setMode({ kind: "draw", points: [] })}
          >
            {t("reg.draw")}{" "}
          </button>
          <button
            type="button"
            className="btn min-h-10"
            onClick={() => {
              setAreas(null);
              setAreaError(null);
              setQuery("");
              setPlaces(null);
              setMode({ kind: "import", at: null });
            }}
          >
            {t("reg.importOsm")}
          </button>
        </div>
      )}
      {mode.kind === "draw" && (
        <section
          aria-label={t("reg.drawing")}
          className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm"
        >
          <p>{t("reg.drawHint", { count: mode.points.length })}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-pri min-h-10"
              disabled={mode.points.length < 3}
              onClick={finishDraw}
            >
              {t("reg.finish")}
            </button>
            <button
              type="button"
              className="btn min-h-10"
              disabled={!mode.points.length}
              onClick={() => setMode({ kind: "draw", points: mode.points.slice(0, -1) })}
            >
              {t("reg.undo")}
            </button>
            <button type="button" className="btn min-h-10" onClick={() => setMode({ kind: "idle" })}>
              {t("reg.cancel")}
            </button>
          </div>
        </section>
      )}
      {mode.kind === "import" && (
        <section
          aria-label={t("reg.importing")}
          className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm"
        >
          <label className="flex flex-col gap-1">
            <span className="font-medium">{t("reg.search")}</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("reg.searchExample")}
              autoFocus
              className="min-h-10 rounded border border-slate-300 bg-white px-2"
            />
          </label>
          {placeError && (
            <p role="alert" className="mt-2 text-red-700">
              {placeError}
            </p>
          )}
          {places && places.length === 0 && <p className="mt-2 text-slate-600">{t("reg.noPlaces")}</p>}
          {places && places.length > 0 && (
            <ul aria-label={t("reg.placesFound")} className="mt-2 flex flex-col gap-1">
              {places.map((p, i) => (
                <li key={`${p.name}-${i}`}>
                  <button
                    type="button"
                    className="flex min-h-11 w-full flex-col justify-center rounded-lg bg-white px-2 text-left hover:bg-indigo-100"
                    onClick={() => choosePlace(p)}
                  >
                    <span className="truncate font-medium">{p.name}</span>
                    <span className="truncate text-xs text-slate-500">
                      {[p.kind, p.context].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-slate-600">{t("reg.pickHint")}</p>
          {mode.at && !areas && !areaError && (
            <p role="status" className="mt-2 text-slate-600">
              {t("reg.lookingUp")}
            </p>
          )}
          {areaError && (
            <p role="alert" className="mt-2 text-red-700">
              {areaError}
            </p>
          )}
          {areas && areas.length === 0 && <p className="mt-2 text-slate-600">{t("reg.noAreas")}</p>}
          {areas && areas.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {areas.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-center gap-2 rounded-lg bg-white px-2 text-left hover:bg-indigo-100"
                    onClick={() => void importArea(a)}
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{a.name}</span>
                    <span className="shrink-0 text-xs text-slate-500">
                      {a.kind}
                      {a.adminLevel ? ` ${a.adminLevel}` : ""} ·{" "}
                      {t("reg.km2", { v: a.areaKm2 < 10 ? a.areaKm2.toFixed(1) : Math.round(a.areaKm2) })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="btn mt-2 min-h-10" onClick={() => setMode({ kind: "idle" })}>
            {t("reg.cancel")}
          </button>
        </section>
      )}
      {mode.kind === "outside" && (
        <section
          aria-label={t("reg.outside")}
          className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm"
        >
          <h3 className="m-0 font-semibold">{t("aw.out.title")}</h3>
          <p className="mt-1">
            {withNodes(t("aw.out.note"), {
              name: <span className="font-medium">{mode.area.name}</span>,
            })}
          </p>
          <dl className="mt-2 grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-white px-3 py-2">
              <dt className="text-xs text-slate-600">{t("aw.out.part")}</dt>
              <dd className="m-0 font-mono">{t("aw.out.km2", { km2: formatInt(mode.outsideKm2) })}</dd>
            </div>
            <div className="rounded-lg bg-white px-3 py-2">
              <dt className="text-xs text-slate-600">{t("aw.statDownload")}</dt>
              <dd className="m-0 font-mono">
                {mode.estimate?.added
                  ? t("aw.mb", { mb: formatInt(megabytes(mode.estimate.added.bytes)) })
                  : "…"}
              </dd>
            </div>
          </dl>
          <div className="mt-2 text-xs font-semibold" id="outside-detail">
            {t("aw.out.detail")}
          </div>
          <div
            role="radiogroup"
            aria-labelledby="outside-detail"
            className="mt-1 grid grid-cols-2 gap-1 rounded-xl bg-amber-100 p-1"
          >
            {(["full", "main"] as const).map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={mode.detail === d}
                className={`min-h-10 rounded-lg px-2 ${mode.detail === d ? "bg-white font-semibold shadow-sm" : ""}`}
                onClick={() => {
                  setMode({ ...mode, detail: d, estimate: null });
                  void estimateOutside(mode.area, mode.polygons, d);
                }}
              >
                {t(d === "full" ? "aw.detail.full" : "aw.detail.main")}
              </button>
            ))}
          </div>
          {mode.estimate?.overLimit ? (
            <p role="alert" className="mt-2 text-red-800">
              {t("aw.out.overLimit", { mb: formatInt(mode.estimate.limitBytes / 1024 / 1024) })}
            </p>
          ) : (
            <p className="mt-2 text-xs text-slate-700">{t("aw.out.adds")}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn min-h-10"
              disabled={extending}
              onClick={() => addImported(mode.area)}
            >
              {t("aw.out.keep")}
            </button>
            <button
              type="button"
              className="btn btn-pri min-h-10"
              disabled={extending || !mode.estimate || mode.estimate.overLimit}
              onClick={() => void extendArea(mode.area, mode.polygons, mode.detail)}
            >
              {extending
                ? t("aw.out.downloading")
                : t("aw.out.download", {
                    mb: mode.estimate?.added ? formatInt(megabytes(mode.estimate.added.bytes)) : "…",
                  })}
            </button>
            <button
              type="button"
              className="btn min-h-10"
              disabled={extending}
              onClick={() => setMode({ kind: "idle" })}
            >
              {t("reg.cancel")}
            </button>
          </div>
        </section>
      )}
      {extendNote && (
        <p
          role={extendNote.ok ? "status" : "alert"}
          className={extendNote.ok ? "text-sm" : "text-sm text-red-700"}
        >
          {extendNote.text}
        </p>
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
      <section aria-label={t("reg.inProject")}>
        <h3 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
          {t("reg.count", { count: regions.length })}
        </h3>
        {listed.length === 0 ? (
          <p className="mt-1 text-sm text-slate-600">{t("reg.none")}</p>
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
                    {tn(
                      "reg.values",
                      Object.values(r.values).filter((v) => v !== undefined && v !== null && v !== "").length,
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-slate-500">{t("reg.saved")}</p>
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
  const { t } = useI18n();
  const km2 = ringAreaM2(region.ring) / 1e6;
  return (
    <section
      aria-label={t("reg.named", { name: region.name })}
      className="rounded-xl border border-slate-200 p-3"
    >
      <div className="flex items-start gap-2">
        <label className="min-w-0 flex-1 text-sm">
          <span className="font-medium">{t("reg.name")}</span>
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
          {t("reg.close")}
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {region.source === "osm" ? t("reg.fromOsm", { id: region.osmId ?? "" }) : t("reg.drawn")} ·{" "}
        {t("reg.km2", { v: km2 < 10 ? km2.toFixed(2) : Math.round(km2) })} {t("reg.keepSourced")}
      </p>
      <label className="mt-3 block text-sm">
        <span className="font-medium">{t("reg.landUse")}</span>
        <span className="block text-xs text-slate-500">{t("reg.landUseHint")}</span>
        <select
          className="input mt-1 w-full"
          value={region.values.landUse ?? ""}
          disabled={!editable}
          onChange={(e) => setValue("landUse", (e.target.value || undefined) as LandUse | undefined)}
        >
          <option value="">{t("reg.fromOsmData")}</option>
          {LAND_USES.map((u) => (
            <option key={u.id} value={u.id}>
              {t(`reg.use.${u.id}`)}
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
            <span className="font-medium">{t(`reg.f.${f.key}`)}</span>
            <span className="block text-xs text-slate-500">
              {money && currency ? `${currency} ` : ""}
              {t(`reg.fu.${f.key}`)}
            </span>
            <input
              type="number"
              min={0}
              step="any"
              className="input mt-1 w-full"
              defaultValue={shown}
              readOnly={!editable}
              onBlur={(e) => {
                const text = e.target.value.trim();
                if (text === "") {
                  if (v !== undefined) setValue(f.key, undefined);
                  return;
                }
                const n = Number(text);
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
          {t("reg.delete")}
        </button>
      )}
    </section>
  );
}
