import {
  AttributionControl,
  type GeoJSONSource,
  type Map as MapLibreMap,
  type MapMouseEvent,
  NavigationControl,
} from "maplibre-gl";
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatInt, useI18n } from "../../i18n/i18n";
import { basemapStyle, rememberedBasemap, themedBasemap } from "../../map/basemaps";
import "../../map/worker";
import { createMap, NoMapNotice } from "../../map/NoMapNotice";
import { type Place, searchPlaces } from "../../map/places";
import { isDark } from "../../shell/theme";
import { CloseIcon } from "../../shell/icons";
import {
  type AreaDetail,
  type AreaEstimate,
  type AreaPolygon,
  type EstimateArea,
  type LonLat,
  megabytes,
  newPolygonId,
  ringAreaKm2,
} from "./api";

/** Colours of the polygons by detail (blue: full, teal: main roads and railways). */
export const DETAIL_COLOUR: Record<AreaDetail, string> = { full: "#1d4ed8", main: "#0f766e" };

const SRC = "aw-polygons";
const FILL = "aw-fill";
const LINE = "aw-line";
const HANDLES = "aw-handles";
const HANDLE_PTS = "aw-handle-points";
const DRAFT = "aw-draft";
const DRAFT_LINE = "aw-draft-line";
const DRAFT_PTS = "aw-draft-points";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export type Tool = "draw" | "edit" | "pan";
const TOOL_KEYS: Record<string, Tool> = { d: "draw", e: "edit", h: "pan" };

type Feature = {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown };
};
const collection = (features: Feature[]) => ({ type: "FeatureCollection" as const, features });

/** Purpose: the polygons as map features, the selected one marked. */
function polygonFeatures(polygons: readonly AreaPolygon[], selected: string | null) {
  return collection(
    polygons.map((p) => ({
      type: "Feature",
      properties: { id: p.id, colour: DETAIL_COLOUR[p.detail], selected: p.id === selected },
      geometry: { type: "Polygon", coordinates: [p.ring] },
    })),
  );
}

/** Purpose: the corners and midpoints of the selected polygon, to drag while editing. */
function handleFeatures(p: AreaPolygon | null) {
  if (!p) return collection([]);
  const out: Feature[] = [];
  const n = p.ring.length - 1;
  for (let i = 0; i < n; i++) {
    const a = p.ring[i]!;
    const b = p.ring[i + 1]!;
    out.push({
      type: "Feature",
      properties: { kind: "corner", i },
      geometry: { type: "Point", coordinates: a },
    });
    out.push({
      type: "Feature",
      properties: { kind: "mid", i },
      geometry: { type: "Point", coordinates: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] },
    });
  }
  return collection(out);
}

/** Purpose: the polygon being drawn, as a line and its corners. */
function draftFeatures(points: readonly LonLat[]) {
  const out: Feature[] = points.map((p, i) => ({
    type: "Feature",
    properties: { first: i === 0 },
    geometry: { type: "Point", coordinates: p },
  }));
  if (points.length > 1)
    out.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: points } });
  return collection(out);
}

/** Purpose: add the window's sources and layers to its map. */
function addLayers(map: MapLibreMap) {
  map.addSource(SRC, { type: "geojson", data: collection([]) });
  map.addSource(HANDLES, { type: "geojson", data: collection([]) });
  map.addSource(DRAFT, { type: "geojson", data: collection([]) });
  map.addLayer({
    id: FILL,
    type: "fill",
    source: SRC,
    paint: {
      "fill-color": ["get", "colour"],
      "fill-opacity": ["case", ["get", "selected"], 0.28, 0.14],
    },
  });
  map.addLayer({
    id: LINE,
    type: "line",
    source: SRC,
    paint: { "line-color": ["get", "colour"], "line-width": ["case", ["get", "selected"], 3.5, 2] },
  });
  map.addLayer({
    id: HANDLE_PTS,
    type: "circle",
    source: HANDLES,
    paint: {
      "circle-radius": ["case", ["==", ["get", "kind"], "corner"], 6, 4],
      "circle-color": ["case", ["==", ["get", "kind"], "corner"], "#ffffff", "#93c5fd"],
      "circle-stroke-color": "#1d4ed8",
      "circle-stroke-width": 2,
    },
  });
  map.addLayer({
    id: DRAFT_LINE,
    type: "line",
    source: DRAFT,
    filter: ["==", ["geometry-type"], "LineString"],
    paint: { "line-color": "#047857", "line-width": 2.5, "line-dasharray": [2, 1.5] },
  });
  map.addLayer({
    id: DRAFT_PTS,
    type: "circle",
    source: DRAFT,
    filter: ["==", ["geometry-type"], "Point"],
    paint: {
      "circle-radius": ["case", ["get", "first"], 7, 5],
      "circle-color": ["case", ["get", "first"], "#047857", "#ffffff"],
      "circle-stroke-color": "#047857",
      "circle-stroke-width": 2,
    },
  });
}

const setData = (map: MapLibreMap, id: string, data: ReturnType<typeof collection>) =>
  (map.getSource(id) as GeoJSONSource | undefined)?.setData(data as never);

/** Purpose: whether two areas hold the same polygons (names aside), so an unchanged area saves without asking. */
const sameShape = (a: AreaPolygon, b: AreaPolygon) =>
  a.detail === b.detail && JSON.stringify(a.ring) === JSON.stringify(b.ring);

/** Purpose: one figure box of the totals. */
function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="flex-1 rounded-xl bg-slate-100 px-3 py-2">
      <div className="font-mono text-lg">{value}</div>
      <div className="text-xs text-slate-600">{label}</div>
    </div>
  );
}

/**
 * The area window (large-area projects): a floating window over the app where the planner draws one or more
 * polygons round the expected edges of the project, each with a detail setting, while the totals and the
 * estimated download update. Search only moves the map. Used from New project (Select area) and from Project
 * preferences (Edit area); when editing a saved area, saving asks before downloading what the new area adds.
 */
export function AreaWindow({
  initial,
  saved,
  projectName,
  estimate,
  onSave,
  onClose,
  search = searchPlaces,
}: {
  /** The polygons to start from. */
  initial: readonly AreaPolygon[];
  /** The saved area while editing one: saving then asks before downloading what the new area adds. */
  saved?: readonly AreaPolygon[];
  /** The project's name, while editing its area. */
  projectName?: string;
  estimate: EstimateArea;
  /** Called with the new polygons; a thrown error is shown and the window stays open. */
  onSave: (polygons: AreaPolygon[]) => Promise<void> | void;
  onClose: () => void;
  /** Place search (tests pass their own). */
  search?: typeof searchPlaces;
}) {
  const { t, tn, language } = useI18n();
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [polygons, setPolygons] = useState<AreaPolygon[]>(() => initial.map((p) => ({ ...p })));
  const [selected, setSelected] = useState<string | null>(initial[0]?.id ?? null);
  const [tool, setTool] = useState<Tool>(initial.length ? "pan" : "draw");
  const [draft, setDraft] = useState<LonLat[]>([]);
  const [est, setEst] = useState<AreaEstimate | null>(null);
  const [estError, setEstError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The map could not be made (no WebGL2): a notice shows in its place. */
  const [noMap, setNoMap] = useState(false);
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<Place[] | null>(null);

  // The handlers read the latest state through this, so they are bound once per map.
  const now = useRef({ polygons, selected, tool, draft });
  now.current = { polygons, selected, tool, draft };
  const close = useRef(onClose);
  close.current = onClose;

  // The map: the basemap last picked in this browser, put on the area when there is one.
  useEffect(() => {
    if (!container.current) return;
    const basemap = themedBasemap(rememberedBasemap(), isDark());
    const m = createMap({
      container: container.current,
      style: basemap.styleUrl,
      center: [20, 30],
      zoom: 3,
      attributionControl: false,
      transformStyle: (_, next) => basemapStyle(basemap, next),
    });
    if (!m) {
      setNoMap(true);
      return;
    }
    m.addControl(new AttributionControl({ compact: true, customAttribution: basemap.attribution }));
    m.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
    m.on("load", () => {
      addLayers(m);
      const pts = now.current.polygons.flatMap((p) => p.ring);
      if (pts.length) {
        const xs = pts.map((p) => p[0]);
        const ys = pts.map((p) => p[1]);
        m.fitBounds(
          [
            [Math.min(...xs), Math.min(...ys)],
            [Math.max(...xs), Math.max(...ys)],
          ],
          { padding: 40, duration: 0 },
        );
      }
      setMap(m);
    });
    return () => {
      setMap(null);
      m.remove();
    };
  }, []);

  // What the map shows.
  const chosen = polygons.find((p) => p.id === selected) ?? null;
  useEffect(() => {
    if (map) setData(map, SRC, polygonFeatures(polygons, selected));
  }, [map, polygons, selected]);
  useEffect(() => {
    if (map) setData(map, HANDLES, handleFeatures(tool === "edit" ? chosen : null));
  }, [map, chosen, tool]);
  useEffect(() => {
    if (map) setData(map, DRAFT, draftFeatures(draft));
  }, [map, draft]);
  useEffect(() => {
    if (!map) return;
    const canvas = map.getCanvas?.();
    if (canvas) canvas.style.cursor = tool === "draw" ? "crosshair" : "";
    if (tool === "edit") map.doubleClickZoom?.disable();
    else map.doubleClickZoom?.enable();
  }, [map, tool]);

  // The totals, a moment after the last change.
  const shapes = useMemo(() => JSON.stringify(polygons.map((p) => [p.detail, p.ring])), [polygons]);
  useEffect(() => {
    if (!polygons.length) {
      setEst(null);
      setEstError(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      estimate(polygons, saved ? [...saved] : undefined)
        .then((e) => {
          if (!live) return;
          setEst(e);
          setEstError(null);
        })
        .catch((e: unknown) => live && setEstError(e instanceof Error ? e.message : String(e)));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // Names do not change the totals.
  }, [shapes, estimate, saved]);

  const closeDraft = () => {
    const pts = now.current.draft;
    if (pts.length < 3) return;
    const all = now.current.polygons;
    const p: AreaPolygon = {
      id: newPolygonId(all),
      name: t("aw.newName", { n: all.length + 1 }),
      detail: "full",
      ring: [...pts, pts[0]!],
    };
    setPolygons([...all, p]);
    setSelected(p.id);
    setDraft([]);
  };
  const closeDraftNow = useRef(closeDraft);
  closeDraftNow.current = closeDraft;

  // Map clicks and drags.
  useEffect(() => {
    if (!map) return;
    const pick = (ev: MapMouseEvent) => {
      const hits = map.queryRenderedFeatures(ev.point, { layers: [FILL] });
      const hit = hits[hits.length - 1]?.properties?.id;
      // A click on the selected polygon keeps it; else the topmost hit.
      const ids = hits.map((h) => h.properties?.id);
      if (ids.includes(now.current.selected)) return;
      setSelected(typeof hit === "string" ? hit : null);
    };
    const onClick = (ev: MapMouseEvent) => {
      const s = now.current;
      if (s.tool !== "draw") return pick(ev);
      const at: LonLat = [ev.lngLat.lng, ev.lngLat.lat];
      const first = s.draft[0];
      if (first && s.draft.length >= 3) {
        const p = map.project(first);
        if (Math.hypot(p.x - ev.point.x, p.y - ev.point.y) < 12) return closeDraftNow.current();
      }
      setDraft([...s.draft, at]);
    };
    // Editing: drag a corner, or a midpoint to add a corner there.
    let drag: { id: string; i: number } | null = null;
    const onDown = (ev: MapMouseEvent) => {
      const s = now.current;
      if (s.tool !== "edit" || !s.selected) return;
      const hit = map.queryRenderedFeatures(ev.point, { layers: [HANDLE_PTS] })[0];
      if (!hit) return;
      ev.preventDefault();
      const i = Number(hit.properties?.i);
      if (hit.properties?.kind === "mid") {
        const at: LonLat = [ev.lngLat.lng, ev.lngLat.lat];
        setPolygons(
          s.polygons.map((p) =>
            p.id === s.selected ? { ...p, ring: [...p.ring.slice(0, i + 1), at, ...p.ring.slice(i + 1)] } : p,
          ),
        );
        drag = { id: s.selected, i: i + 1 };
      } else drag = { id: s.selected, i };
      map.dragPan.disable();
    };
    const onMove = (ev: MapMouseEvent) => {
      if (!drag) return;
      const d = drag;
      const at: LonLat = [ev.lngLat.lng, ev.lngLat.lat];
      setPolygons((ps) =>
        ps.map((p) => {
          if (p.id !== d.id) return p;
          const ring = p.ring.map((q, k) => (k === d.i ? at : q));
          // The first corner is also the last.
          if (d.i === 0) ring[ring.length - 1] = at;
          return { ...p, ring };
        }),
      );
    };
    const onUp = () => {
      if (!drag) return;
      drag = null;
      map.dragPan.enable();
    };
    const onDouble = (ev: MapMouseEvent) => {
      const s = now.current;
      if (s.tool !== "edit" || !s.selected) return;
      const hit = map.queryRenderedFeatures(ev.point, { layers: [HANDLE_PTS] })[0];
      if (hit?.properties?.kind !== "corner") return;
      ev.preventDefault();
      const i = Number(hit.properties.i);
      setPolygons(
        s.polygons.map((p) => {
          // Three corners at least.
          if (p.id !== s.selected || p.ring.length <= 4) return p;
          const corners = p.ring.slice(0, -1).filter((_, k) => k !== i);
          return { ...p, ring: [...corners, corners[0]!] };
        }),
      );
    };
    map.on("click", onClick);
    map.on("mousedown", onDown);
    map.on("mousemove", onMove);
    map.on("mouseup", onUp);
    map.on("dblclick", onDouble);
    return () => {
      map.off("click", onClick);
      map.off("mousedown", onDown);
      map.off("mousemove", onMove);
      map.off("mouseup", onUp);
      map.off("dblclick", onDouble);
    };
  }, [map]);

  // Keys: D, E and H pick a tool; Enter closes the polygon being drawn, Backspace takes back its last corner;
  // Escape drops it, or else closes the window. Focus stays inside the window.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest?.("input,textarea,select");
      if (e.key === "Escape") {
        e.stopPropagation();
        if (now.current.draft.length) setDraft([]);
        else close.current();
        return;
      }
      if (e.key === "Tab" && box.current) {
        // Keep focus inside the window (also over a dialog that opened it).
        e.stopPropagation();
        const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
        const [a, z] = [items[0], items[items.length - 1]];
        if (!a || !z) return;
        const at = document.activeElement;
        if (!box.current.contains(at) || (e.shiftKey && at === a) || (!e.shiftKey && at === z)) {
          e.preventDefault();
          (e.shiftKey ? z : a).focus();
        }
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      const tool = TOOL_KEYS[e.key.toLowerCase()];
      if (tool) {
        setTool(tool);
        if (tool !== "draw") setDraft([]);
      } else if (e.key === "Enter" && now.current.draft.length) {
        e.preventDefault();
        closeDraftNow.current();
      } else if (e.key === "Backspace" && now.current.draft.length) {
        e.preventDefault();
        setDraft((d) => d.slice(0, -1));
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      before?.focus?.();
    };
  }, []);

  // Search only moves the map.
  useEffect(() => {
    if (query.trim().length < 2) {
      setPlaces(null);
      return;
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      const c = map?.getCenter?.();
      search(query, { lang: language, near: c ? [c.lng, c.lat] : undefined, signal: ctl.signal })
        .then(setPlaces)
        .catch(() => {});
    }, 300);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [query, search, language, map]);
  const goTo = (p: Place) => {
    setPlaces(null);
    setQuery("");
    if (!map) return;
    if (p.bbox) map.fitBounds([p.bbox[0], p.bbox[1], p.bbox[2], p.bbox[3]], { padding: 40, maxZoom: 13 });
    else map.easeTo({ center: p.lonLat, zoom: Math.max(map.getZoom(), 11) });
  };

  const update = (pid: string, patch: Partial<AreaPolygon>) =>
    setPolygons((ps) => ps.map((p) => (p.id === pid ? { ...p, ...patch } : p)));
  const remove = (pid: string) => {
    setPolygons((ps) => ps.filter((p) => p.id !== pid));
    setSelected(null);
  };
  const show = (p: AreaPolygon) => {
    setSelected(p.id);
    if (!map) return;
    const xs = p.ring.map((q) => q[0]);
    const ys = p.ring.map((q) => q[1]);
    map.fitBounds(
      [
        [Math.min(...xs), Math.min(...ys)],
        [Math.max(...xs), Math.max(...ys)],
      ],
      { padding: 60, maxZoom: 13 },
    );
  };

  // Polygons that are new or changed since the saved area (names aside).
  const changed = saved ? polygons.filter((p) => !saved.some((q) => q.id === p.id && sameShape(p, q))) : [];
  const addedMb = megabytes(est?.added?.bytes ?? 0);
  const valid = polygons.every((p) => p.name.trim());
  const save = async () => {
    // A polygon still being drawn is closed when it has three corners, else dropped.
    if (draft.length) {
      if (draft.length >= 3) closeDraft();
      else setDraft([]);
      if (draft.length >= 3) return;
    }
    if (saved && !confirm && (est?.added?.bytes ?? (changed.length ? 1 : 0)) > 0) {
      setConfirm(true);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(polygons.map((p) => ({ ...p, name: p.name.trim() })));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  const detailName = (d: AreaDetail) => t(d === "full" ? "aw.detail.full" : "aw.detail.main");
  const km2 = (v: number) => formatInt(v < 10 ? Math.round(v * 10) / 10 : v);
  const limitMb = est ? Math.round(est.limitBytes / 1024 / 1024) : null;
  const share = est ? Math.min(1, est.bytes / est.limitBytes) : 0;
  const toolButton = (k: Tool, label: string, key: string, icon: string) => (
    <button
      key={k}
      type="button"
      aria-pressed={tool === k}
      className={`flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-start text-sm ${tool === k ? "bg-emerald-800 text-white" : "hover:bg-slate-100"}`}
      onClick={() => {
        setTool(k);
        if (k !== "draw") setDraft([]);
      }}
    >
      <span aria-hidden="true">{icon}</span>
      <span className="flex-1">{label}</span>
      <kbd className={`text-xs ${tool === k ? "text-emerald-100" : "text-slate-400"}`}>{key}</kbd>
    </button>
  );

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-stretch justify-center md:p-6">
      <div className="absolute inset-0 bg-scrim/45" onClick={onClose} aria-hidden="true" />
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        className="relative flex h-full w-full max-w-6xl flex-col overflow-hidden bg-white shadow-2xl md:rounded-2xl"
      >
        <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <h2 id={`${id}-title`} className="m-0 text-lg font-semibold">
            {t("aw.title")}
          </h2>
          {projectName && (
            <span className="truncate rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
              {t("aw.editing", { name: projectName })}
            </span>
          )}
          <button
            type="button"
            className="ms-auto flex h-10 w-10 items-center justify-center rounded-full hover:bg-slate-100"
            aria-label={t("common.close")}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
          <div className="relative min-h-[45vh] shrink-0 md:min-h-0 md:flex-1">
            <div className="absolute inset-0">
              {/* MapLibre makes its container position: relative, so it fills a positioned wrapper. */}
              <div ref={container} className="h-full w-full" data-testid="area-map" />
              {noMap && <NoMapNotice />}
            </div>
            <div className="absolute start-3 top-3 z-10 flex w-[min(20rem,calc(100%-1.5rem))] flex-col gap-2">
              <div className="relative">
                <input
                  type="search"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm"
                  placeholder={t("aw.search")}
                  aria-label={t("aw.search")}
                  maxLength={200}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && places?.[0]) goTo(places[0]);
                  }}
                />
                {places && places.length > 0 && (
                  <ul className="absolute inset-x-0 top-full m-0 mt-1 list-none rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                    {places.slice(0, 6).map((p, i) => (
                      <li key={`${p.lonLat.join()}-${i}`}>
                        <button
                          type="button"
                          className="flex min-h-10 w-full flex-col items-start justify-center rounded-md px-2 text-start hover:bg-slate-50"
                          onClick={() => goTo(p)}
                        >
                          <span className="text-sm font-medium">{p.name}</span>
                          {p.context && <span className="text-xs text-slate-500">{p.context}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div
                role="group"
                aria-label={t("aw.tools")}
                className="w-44 rounded-xl border border-slate-200 bg-white p-1 shadow-md"
              >
                {toolButton("draw", t("aw.draw"), "D", "✎")}
                {toolButton("edit", t("aw.edit"), "E", "⬚")}
                {toolButton("pan", t("aw.pan"), "H", "✥")}
              </div>
            </div>
            <p
              role="status"
              className="absolute start-3 hidden sm:block bottom-12 z-10 m-0 max-w-sm rounded-lg bg-white/95 px-3 py-2 text-sm shadow"
            >
              {t(tool === "draw" ? "aw.hint.draw" : tool === "edit" ? "aw.hint.edit" : "aw.hint.pan")}
            </p>
          </div>
          <aside className="flex flex-col border-slate-200 md:w-80 md:min-h-0 md:border-s">
            <div className="border-b border-slate-200 p-4">
              <div className="flex gap-2">
                <Stat value={`${est ? formatInt(est.areaKm2) : "0"} km²`} label={t("aw.statArea")} />
                <Stat
                  value={t("aw.mb", { mb: formatInt(megabytes(est?.bytes ?? 0)) })}
                  label={t("aw.statDownload")}
                />
              </div>
              <div
                className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200"
                role="meter"
                aria-label={t("aw.statDownload")}
                aria-valuemin={0}
                aria-valuemax={est?.limitBytes ?? 1}
                aria-valuenow={est?.bytes ?? 0}
              >
                <div
                  className={`h-full ${est?.overLimit ? "bg-red-600" : "bg-emerald-600"}`}
                  style={{ width: `${Math.max(share * 100, est?.bytes ? 1 : 0)}%` }}
                />
              </div>
              <div className="mt-1 flex justify-between text-xs text-slate-600">
                <span>{tn("aw.tiles", (est?.tiles.full ?? 0) + (est?.tiles.main ?? 0))}</span>
                {limitMb !== null && <span>{t("aw.limit", { mb: formatInt(limitMb) })}</span>}
              </div>
              {est?.overLimit && limitMb !== null && (
                <p role="alert" className="mt-2 text-sm text-red-800">
                  {t("aw.overLimit", { mb: formatInt(limitMb) })}
                </p>
              )}
              {estError && (
                <p role="alert" className="mt-2 text-sm text-red-800">
                  {estError}
                </p>
              )}
            </div>
            <div className="min-h-0 flex-1 md:overflow-y-auto">
              <h3 className="caps m-0 px-4 pt-3 text-xs text-slate-500">{t("aw.polygons")}</h3>
              {polygons.length === 0 ? (
                <p className="m-0 px-4 py-2 text-sm text-slate-600">{t("aw.empty")}</p>
              ) : (
                <ul className="m-0 list-none p-2">
                  {polygons.map((p) => {
                    const e = est?.polygons.find((x) => x.id === p.id);
                    return (
                      <li key={p.id}>
                        <button
                          type="button"
                          aria-current={p.id === selected}
                          className={`flex min-h-12 w-full items-center gap-3 rounded-lg px-2 py-1.5 text-start ${p.id === selected ? "bg-blue-50" : "hover:bg-slate-50"}`}
                          onClick={() => show(p)}
                        >
                          <span
                            aria-hidden="true"
                            className="h-3 w-3 shrink-0 rounded-sm"
                            style={{ background: DETAIL_COLOUR[p.detail] }}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{p.name || "—"}</span>
                            <span className="block text-xs text-slate-500">
                              {t("aw.polyLine", {
                                detail: detailName(p.detail),
                                area: km2(ringAreaKm2(p.ring)),
                              })}
                            </span>
                          </span>
                          {e && (
                            <span className="shrink-0 font-mono text-xs text-slate-600">
                              {t("aw.mb", { mb: formatInt(megabytes(e.bytes)) })}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            {chosen && !confirm && (
              <div className="border-t border-slate-200 p-4">
                <label className="block text-xs font-semibold" htmlFor={`${id}-name`}>
                  {t("aw.name")}
                </label>
                <div className="field mt-1">
                  <input
                    id={`${id}-name`}
                    maxLength={200}
                    value={chosen.name}
                    onChange={(e) => update(chosen.id, { name: e.target.value })}
                  />
                </div>
                <div className="mt-3 text-xs font-semibold" id={`${id}-detail`}>
                  {t("aw.detail")}
                </div>
                <div
                  role="radiogroup"
                  aria-labelledby={`${id}-detail`}
                  className="mt-1 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1"
                >
                  {(["full", "main"] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      role="radio"
                      aria-checked={chosen.detail === d}
                      className={`min-h-11 rounded-lg px-2 text-sm ${chosen.detail === d ? "bg-white font-semibold shadow-sm" : "text-slate-700"}`}
                      onClick={() => update(chosen.id, { detail: d })}
                    >
                      {detailName(d)}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-slate-600">
                  {t(chosen.detail === "full" ? "aw.fullHelp" : "aw.mainHelp")}
                </p>
                <button
                  type="button"
                  className="mt-1 min-h-10 text-sm text-red-700 underline"
                  onClick={() => remove(chosen.id)}
                >
                  {t("aw.delete")}
                </button>
              </div>
            )}
            {confirm ? (
              <div
                className="border-t border-amber-200 bg-amber-50 p-4"
                role="alertdialog"
                aria-labelledby={`${id}-confirm`}
              >
                <h3 id={`${id}-confirm`} className="m-0 text-sm font-semibold">
                  {t("aw.confirm.title")}
                </h3>
                <p className="mt-1 text-sm">
                  {t("aw.confirm.body", {
                    list: changed
                      .map((p) =>
                        t("aw.confirm.item", {
                          name: p.name,
                          detail: detailName(p.detail),
                          area: km2(ringAreaKm2(p.ring)),
                        }),
                      )
                      .join(", "),
                    mb: formatInt(addedMb),
                  })}
                </p>
                {error && (
                  <p role="alert" className="mt-2 text-sm text-red-800">
                    {error}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <button type="button" className="btn" disabled={saving} onClick={() => setConfirm(false)}>
                    {t("aw.confirm.back")}
                  </button>
                  <button type="button" className="btn btn-pri" disabled={saving} onClick={() => void save()}>
                    {t("aw.confirm.save", { mb: formatInt(addedMb) })}
                  </button>
                </div>
              </div>
            ) : (
              <div className="border-t border-slate-200 p-4">
                {error && (
                  <p role="alert" className="mb-2 text-sm text-red-800">
                    {error}
                  </p>
                )}
                <div className="flex justify-end gap-2">
                  <button type="button" className="btn" onClick={onClose}>
                    {t("common.cancel")}
                  </button>
                  <button
                    type="button"
                    className="btn btn-pri"
                    data-autofocus
                    disabled={saving || (!polygons.length && draft.length < 3) || !valid || !!est?.overLimit}
                    onClick={() => void save()}
                  >
                    {t("aw.save")}
                  </button>
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Purpose: a small outline drawing of the polygons (equirectangular, north up), coloured by detail, so the
 * planner sees the area without opening the window.
 */
export function AreaOutline({ polygons, label }: { polygons: readonly AreaPolygon[]; label: string }) {
  const pts = polygons.flatMap((r) => r.ring);
  if (!pts.length) return null;
  const lat0 = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const kx = Math.cos((lat0 * Math.PI) / 180);
  const xs = pts.map((p) => p[0] * kx);
  const ys = pts.map((p) => -p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const w = Math.max(x1 - x0, 1e-6);
  const h = Math.max(y1 - y0, 1e-6);
  const pad = Math.max(w, h) * 0.06;
  return (
    <svg
      role="img"
      aria-label={label}
      className="h-32 w-32 shrink-0 rounded-lg border border-slate-200 bg-slate-50"
      viewBox={`${x0 - pad} ${y0 - pad} ${w + 2 * pad} ${h + 2 * pad}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {polygons.map((r) => (
        <polygon
          key={r.id}
          points={r.ring.map(([lon, lat]) => `${lon * kx},${-lat}`).join(" ")}
          fill={DETAIL_COLOUR[r.detail]}
          fillOpacity={0.18}
          stroke={DETAIL_COLOUR[r.detail]}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
