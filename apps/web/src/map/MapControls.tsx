import { type Map as MapLibreMap, Marker } from "maplibre-gl";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/i18n";
import type { MessageKey } from "../i18n/messages";
import { CameraIcon, CloseIcon, LayersIcon, SearchIcon } from "../shell/icons";
import { availableBasemaps, availableOverlays, type Basemap, newestDay } from "./basemaps";
import { groupsOnMap, OVERLAY_GROUPS, type OverlayGroup } from "./mapLayers";
import { type Place, searchPlaces } from "./places";
import { StreetPhotoPanel } from "./StreetPhotoPanel";
import { onStreetPhotoSources, refreshStreetPhotoSources, streetPhotoSources } from "./streetPhotos";

type Open = "search" | "layers" | "photos" | null;

/**
 * Purpose: the map's own buttons above the zoom buttons: place search, and the layer control (which basemap,
 * and which of the project's layers show). Each opens a panel to the left of the buttons.
 */
export function MapControls({
  map,
  basemap,
  onBasemap,
  hidden,
  onHidden,
  overlays = new Set<string>(),
  onOverlays = () => {},
}: {
  map: MapLibreMap | null;
  basemap: Basemap;
  onBasemap: (b: Basemap) => void;
  hidden: ReadonlySet<OverlayGroup>;
  onHidden: (h: ReadonlySet<OverlayGroup>) => void;
  /** The WMS and WMTS overlays shown, by id. */
  overlays?: ReadonlySet<string>;
  onOverlays?: (ids: ReadonlySet<string>) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState<Open>(null);
  const root = useRef<HTMLDivElement>(null);
  // Street photos (plugins such as Panoramax): offered once the API says it serves the source.
  const [, setSources] = useState(0);
  useEffect(() => {
    const stop = onStreetPhotoSources(() => setSources((n) => n + 1));
    void refreshStreetPhotoSources();
    return stop;
  }, []);
  const photos = streetPhotoSources().length > 0;

  // Close on Escape and on a click elsewhere on the page (not on the map itself, so the planner can pan).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    const onDown = (e: PointerEvent) => {
      const el = e.target as Element | null;
      if (root.current?.contains(el) || el?.closest?.(".maplibregl-map")) return;
      setOpen(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [open]);

  const toggle = (o: Exclude<Open, null>) => setOpen((x) => (x === o ? null : o));
  const button = (o: Exclude<Open, null>, label: string, icon: React.ReactNode, tour: string) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-expanded={open === o}
      data-tour={tour}
      onClick={() => toggle(o)}
      className={`flex! items-center justify-center ${open === o ? "bg-blue-50! text-blue-700" : "text-slate-700"}`}
    >
      {icon}
    </button>
  );

  return (
    <div ref={root} className="relative">
      <div className="maplibregl-ctrl-group">
        {button("search", t("map.search"), <SearchIcon size={17} />, "map-search")}
        {button("layers", t("map.layers"), <LayersIcon size={17} />, "map-layers")}
        {photos && button("photos", t("photos.button"), <CameraIcon size={17} />, "map-photos")}
      </div>
      {open && (
        <div className="absolute top-0 right-full mr-2 max-h-[38vh] w-80 overflow-y-auto md:max-h-[70vh] max-w-[calc(100vw-4.5rem)] rounded-xl border border-slate-200 bg-white text-sm text-slate-900 shadow-xl">
          {open === "search" ? (
            <PlaceSearch map={map} onClose={() => setOpen(null)} />
          ) : open === "photos" ? (
            <StreetPhotoPanel map={map} onClose={() => setOpen(null)} />
          ) : (
            <LayerPanel
              map={map}
              basemap={basemap}
              onBasemap={onBasemap}
              hidden={hidden}
              onHidden={onHidden}
              overlays={overlays}
              onOverlays={onOverlays}
              onClose={() => setOpen(null)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function PanelHead({ title, onClose }: { title: string; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-between gap-2 px-3 pt-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      <button type="button" className="icon-btn h-9! w-9!" aria-label={t("common.close")} onClick={onClose}>
        <CloseIcon size={18} />
      </button>
    </div>
  );
}

/** Wait after typing stops before searching, ms; Enter searches at once. */
const TYPE_DELAY_MS = 450;

/**
 * Purpose: find a town, street, station or address and move the map there, with a pin on it.
 * Side effects: asks the API's place search; moves the map; adds a marker until the next search or close.
 */
function PlaceSearch({ map, onClose }: { map: MapLibreMap | null; onClose: () => void }) {
  const { t, language } = useI18n();
  const [q, setQ] = useState("");
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "searching" }
    | { kind: "found"; q: string; places: Place[] }
    | { kind: "error"; text: string }
  >({ kind: "idle" });
  const request = useRef<AbortController | null>(null);

  const search = (text: string) => {
    request.current?.abort();
    if (text.trim().length < 2) {
      setState({ kind: "idle" });
      return;
    }
    const ctrl = new AbortController();
    request.current = ctrl;
    setState({ kind: "searching" });
    const c = map?.getCenter?.();
    searchPlaces(text, { lang: language, near: c ? [c.lng, c.lat] : undefined, signal: ctrl.signal }).then(
      (places) => !ctrl.signal.aborted && setState({ kind: "found", q: text, places }),
      (err) =>
        !ctrl.signal.aborted &&
        setState({ kind: "error", text: err instanceof Error ? err.message : String(err) }),
    );
  };

  useEffect(() => {
    if (q.trim().length < 3) return;
    const timer = setTimeout(() => search(q), TYPE_DELAY_MS);
    return () => clearTimeout(timer);
    // `search` reads the map centre when it runs.
  }, [q]);
  useEffect(() => () => request.current?.abort(), []);

  const go = (p: Place) => {
    if (!map) return;
    if (p.bbox)
      map.fitBounds(
        [
          [p.bbox[0], p.bbox[1]],
          [p.bbox[2], p.bbox[3]],
        ],
        { padding: 40, maxZoom: 16 },
      );
    else map.flyTo({ center: p.lonLat, zoom: Math.max(map.getZoom(), 16) });
    showPin(map, p.lonLat);
    onClose();
  };

  // Enter goes to the first place found for the text, or searches now.
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (state.kind === "found" && state.q === q && state.places[0]) go(state.places[0]);
    else search(q);
  };

  return (
    <div role="search" aria-label={t("map.search")}>
      <PanelHead title={t("map.search")} onClose={onClose} />
      <form className="px-3 pt-1 pb-2" onSubmit={submit}>
        <label className="field">
          <SearchIcon size={18} />
          <input
            // The panel opens on purpose to type into it.
            autoFocus
            type="search"
            value={q}
            aria-label={t("map.searchPlaceholder")}
            placeholder={t("map.searchPlaceholder")}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
      </form>
      <div className="max-h-72 overflow-y-auto px-1.5 pb-1.5" aria-live="polite">
        {state.kind === "searching" && <p className="px-2 py-2 text-slate-500">{t("map.searching")}</p>}
        {state.kind === "error" && (
          <p className="mx-1.5 mb-1.5 rounded bg-red-50 px-2 py-1.5 text-red-700">
            {t("map.searchFailed", { error: state.text })}
          </p>
        )}
        {state.kind === "found" && !state.places.length && (
          <p className="px-2 py-2 text-slate-500">{t("map.noPlaces")}</p>
        )}
        {state.kind === "found" && state.places.length > 0 && (
          <ul aria-label={t("map.places")}>
            {state.places.map((p, i) => (
              <li key={`${p.lonLat.join()}-${i}`}>
                <button
                  type="button"
                  className="menu-item min-h-0! flex-col items-start! gap-0! py-2"
                  onClick={() => go(p)}
                >
                  <span>{p.name}</span>
                  {p.context && <span className="text-xs font-normal text-slate-500">{p.context}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-500">
        {t("map.searchCredit")}
      </p>
    </div>
  );
}

const pins = new WeakMap<MapLibreMap, Marker>();

/** Purpose: one pin on the map at the place last found. */
function showPin(map: MapLibreMap, at: [number, number]) {
  if (typeof Marker !== "function") return;
  pins.get(map)?.remove();
  const m = new Marker({ color: "#1d4ed8" }).setLngLat(at).addTo(map);
  pins.set(map, m);
}

/**
 * Purpose: pick the basemap (street maps or aerial imagery) and show or hide each kind of project layer
 * that is on the map now.
 */
function LayerPanel({
  map,
  basemap,
  onBasemap,
  hidden,
  onHidden,
  overlays,
  onOverlays,
  onClose,
}: {
  map: MapLibreMap | null;
  basemap: Basemap;
  onBasemap: (b: Basemap) => void;
  hidden: ReadonlySet<OverlayGroup>;
  onHidden: (h: ReadonlySet<OverlayGroup>) => void;
  overlays: ReadonlySet<string>;
  onOverlays: (ids: ReadonlySet<string>) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [present, setPresent] = useState<OverlayGroup[]>(() => (map ? groupsOnMap(map) : []));
  useEffect(() => {
    if (!map) return;
    const update = () => {
      const now = groupsOnMap(map);
      setPresent((p) => (p.join() === now.join() ? p : now));
    };
    update();
    map.on("styledata", update);
    return () => void map.off("styledata", update);
  }, [map]);

  const offered = availableOverlays();
  const flip = (g: OverlayGroup) => {
    const next = new Set(hidden);
    if (next.has(g)) next.delete(g);
    else next.add(g);
    onHidden(next);
  };

  return (
    <div aria-label={t("map.layers")} role="group">
      <PanelHead title={t("map.layers")} onClose={onClose} />
      <fieldset className="px-3 pt-1 pb-2">
        <legend className="caps pb-1">{t("map.basemap")}</legend>
        {availableBasemaps().map((b) => (
          <label key={b.id} className="flex min-h-10 cursor-pointer items-center gap-2.5">
            <input
              type="radio"
              name="basemap"
              checked={basemap.id === b.id}
              onChange={() => onBasemap(b)}
              className="h-4 w-4 accent-blue-700"
            />
            <span className="min-w-0 flex-1">{b.label}</span>
            <span
              className={`tag ${b.tag ? "bg-sky-100 text-sky-900" : b.kind === "aerial" ? "bg-emerald-100 text-emerald-900" : "bg-slate-100 text-slate-700"}`}
            >
              {b.tag ?? t(b.kind === "aerial" ? "map.aerial" : "map.streetMap")}
            </span>
          </label>
        ))}
        {basemap.date && (
          <label className="mt-1 flex min-h-10 items-center gap-2.5 text-sm">
            {t("map.imageryDate")}
            <input
              type="date"
              className="w-auto"
              min={basemap.date.first}
              max={newestDay(basemap) ?? undefined}
              value={basemap.day ?? newestDay(basemap) ?? ""}
              onChange={(e) => {
                const day = e.target.value;
                if (/^\d{4}-\d{2}-\d{2}$/.test(day)) onBasemap({ ...basemap, day });
              }}
            />
          </label>
        )}
        {basemap.kind === "aerial" && basemap.note !== "" && (
          <p className="mt-1 text-xs text-slate-600">{basemap.note ?? t("map.aerialNote")}</p>
        )}
      </fieldset>
      {offered.length > 0 && (
        <fieldset className="border-t border-slate-100 px-3 pt-2 pb-2">
          <legend className="caps float-left w-full pb-1">{t("map.overlays")}</legend>
          {offered.map((l) => (
            <label key={l.id} className="clear-both flex min-h-10 cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                checked={overlays.has(l.id)}
                onChange={() => {
                  const next = new Set(overlays);
                  if (next.has(l.id)) next.delete(l.id);
                  else next.add(l.id);
                  onOverlays(next);
                }}
                className="h-4 w-4 accent-blue-700"
              />
              <span className="min-w-0 flex-1">{l.label}</span>
              <span className="tag bg-sky-100 text-sky-900">{l.kind.toUpperCase()}</span>
            </label>
          ))}
        </fieldset>
      )}
      <fieldset className="border-t border-slate-100 px-3 pt-2 pb-3">
        <legend className="caps float-left w-full pb-1">{t("map.projectLayers")}</legend>
        {present.length === 0 && <p className="clear-both text-xs text-slate-500">{t("map.noLayers")}</p>}
        {OVERLAY_GROUPS.filter((g) => present.includes(g.id)).map((g) => (
          <label key={g.id} className="clear-both flex min-h-10 cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              checked={!hidden.has(g.id)}
              onChange={() => flip(g.id)}
              className="h-4 w-4 accent-blue-700"
            />
            {t(`map.group.${g.id}` as MessageKey)}
          </label>
        ))}
      </fieldset>
    </div>
  );
}
