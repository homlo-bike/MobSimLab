import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { activeLanguage, formatInt, useI18n } from "../i18n/i18n";
import { CloseIcon } from "../shell/icons";
import {
  hideCoverage,
  markPicked,
  photosNear,
  photoUrl,
  showCoverage,
  type StreetPhoto,
  type StreetPhotoSource,
  streetPhotoSources,
} from "./streetPhotos";
import { engineErrorText } from "../i18n/engine";

/** How far the pointer may move between press and release for a press to count as a click, px. */
const CLICK_TOLERANCE_PX = 5;
/** The search radius the API uses unless asked, metres (shown in the "none found" text). */
const RADIUS_M = 30;

type State =
  | { kind: "idle" }
  | { kind: "searching"; at: [number, number] }
  | { kind: "found"; at: [number, number]; photos: StreetPhoto[]; index: number }
  | { kind: "error"; at: [number, number]; text: string };

/** Purpose: a photo's date in the page's language, without the time. */
function dayOf(iso: string): string {
  return new Date(iso).toLocaleDateString(activeLanguage(), { dateStyle: "medium", numberingSystem: "latn" });
}

/**
 * Purpose: the map's Street photos panel. While it is open the map shows where the source has photos, and a click
 * on the map shows the photos taken near that point (it does not reach the open tool). The photos come through
 * the API and are not saved with the project.
 * Side effects: adds the coverage layers and a crosshair cursor while open; captures clicks on the map.
 */
export function StreetPhotoPanel({ map, onClose }: { map: MapLibreMap | null; onClose: () => void }) {
  const { t } = useI18n();
  const sources = streetPhotoSources();
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const source: StreetPhotoSource | undefined = sources.find((s) => s.id === sourceId) ?? sources[0];
  const [state, setState] = useState<State>({ kind: "idle" });
  const [zoom, setZoom] = useState(() => map?.getZoom?.() ?? 0);
  const request = useRef<AbortController | null>(null);
  const stateNow = useRef(state);
  stateNow.current = state;

  const search = (at: [number, number]) => {
    if (!source) return;
    request.current?.abort();
    const ctrl = new AbortController();
    request.current = ctrl;
    setState({ kind: "searching", at });
    photosNear(source.provider, at, ctrl.signal).then(
      (photos) => !ctrl.signal.aborted && setState({ kind: "found", at, photos, index: 0 }),
      (err) => !ctrl.signal.aborted && setState({ kind: "error", at, text: engineErrorText(err) }),
    );
  };
  const searchNow = useRef(search);
  searchNow.current = search;

  // Coverage of the picked source, drawn again after a style switch (theme or basemap).
  useEffect(() => {
    if (!map || !source) return;
    const draw = () => {
      try {
        showCoverage(map, source);
        const s = stateNow.current;
        if (s.kind !== "idle") markPicked(map, s.kind === "found" ? (s.photos[s.index] ?? null) : null, s.at);
      } catch {
        // The style is still loading; style.load draws it.
      }
    };
    draw();
    map.on("style.load", draw);
    return () => {
      map.off("style.load", draw);
      try {
        hideCoverage(map);
      } catch {
        // The map is gone.
      }
    };
  }, [map, source?.id]);

  useEffect(() => {
    if (!map) return;
    const s = state;
    try {
      if (s.kind === "idle") markPicked(map, null, null);
      else markPicked(map, s.kind === "found" ? (s.photos[s.index] ?? null) : null, s.at);
    } catch {
      // Drawn again on style.load.
    }
  }, [map, state]);

  // A click on the map looks for photos there, and does not reach the tool that is open.
  useEffect(() => {
    if (!map) return;
    const el = map.getContainer();
    const canvas = map.getCanvasContainer();
    let down: [number, number] | null = null;
    const onDown = (e: PointerEvent) => {
      down = canvas.contains(e.target as Node) ? [e.clientX, e.clientY] : null;
    };
    const onClick = (e: MouseEvent) => {
      if (!canvas.contains(e.target as Node)) return;
      e.stopPropagation();
      e.preventDefault();
      const start = down;
      down = null;
      if (start && Math.hypot(e.clientX - start[0], e.clientY - start[1]) > CLICK_TOLERANCE_PX) return;
      const r = el.getBoundingClientRect();
      const p = map.unproject([e.clientX - r.left, e.clientY - r.top]);
      searchNow.current([p.lng, p.lat]);
    };
    const onZoom = () => setZoom(map.getZoom());
    el.addEventListener("pointerdown", onDown, true);
    el.addEventListener("click", onClick, true);
    map.on("zoomend", onZoom);
    const cursor = map.getCanvas().style.cursor;
    map.getCanvas().style.cursor = "crosshair";
    return () => {
      el.removeEventListener("pointerdown", onDown, true);
      el.removeEventListener("click", onClick, true);
      map.off("zoomend", onZoom);
      map.getCanvas().style.cursor = cursor;
    };
  }, [map]);
  useEffect(() => () => request.current?.abort(), []);

  const pick = (index: number) => setState((s) => (s.kind === "found" ? { ...s, index } : s));

  return (
    <div role="region" aria-label={t("photos.title")}>
      <div className="flex items-center justify-between gap-2 px-3 pt-2">
        <h2 className="text-sm font-semibold">{t("photos.title")}</h2>
        <button type="button" className="icon-btn h-9! w-9!" aria-label={t("common.close")} onClick={onClose}>
          <CloseIcon size={18} />
        </button>
      </div>
      {sources.length > 1 && (
        <fieldset className="px-3 pt-1">
          <legend className="caps pb-1">{t("photos.source")}</legend>
          {sources.map((s) => (
            <label key={s.id} className="flex min-h-10 cursor-pointer items-center gap-2.5">
              <input
                type="radio"
                name="street-photo-source"
                checked={source?.id === s.id}
                onChange={() => {
                  setSourceId(s.id);
                  setState({ kind: "idle" });
                }}
                className="h-4 w-4 accent-blue-700"
              />
              {s.label}
            </label>
          ))}
        </fieldset>
      )}
      <div className="px-3 pt-1 pb-2" aria-live="polite">
        {state.kind === "idle" && (
          <p className="m-0 text-slate-600">
            {source && zoom < source.coverage.lines.minzoom ? t("photos.zoomIn") : t("photos.hint")}
          </p>
        )}
        {state.kind === "searching" && <p className="m-0 text-slate-500">{t("photos.searching")}</p>}
        {state.kind === "error" && (
          <p className="m-0 rounded bg-red-50 px-2 py-1.5 text-red-700">
            {t("photos.failed", { error: state.text })}
          </p>
        )}
        {state.kind === "found" && state.photos.length === 0 && (
          <p className="m-0 text-slate-600">{t("photos.none", { radius: RADIUS_M })}</p>
        )}
        {state.kind === "found" && state.photos[state.index] && source && (
          <PhotoView
            photo={state.photos[state.index]!}
            index={state.index}
            count={state.photos.length}
            pageName={source.pageName}
            onPick={pick}
          />
        )}
        {state.kind === "found" && state.photos.length > 1 && (
          <ul aria-label={t("photos.thumbs")} className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
            {state.photos.map((p, i) => (
              <li key={p.ref} className="shrink-0">
                <button
                  type="button"
                  aria-label={t("photos.count", { n: i + 1, count: state.photos.length })}
                  aria-pressed={i === state.index}
                  onClick={() => pick(i)}
                  className={`block overflow-hidden rounded border-2 ${i === state.index ? "border-blue-700" : "border-transparent"}`}
                >
                  <img src={photoUrl(p, "thumb")} alt="" loading="lazy" className="h-12 w-16 object-cover" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {source && (
        <div className="border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-500">
          {source.note && <p className="m-0">{source.note}</p>}
          <p className="m-0">
            {t("photos.notSaved", { name: source.label })}{" "}
            {source.attribution.url ? (
              <a
                href={source.attribution.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                {source.attribution.text}
              </a>
            ) : (
              source.attribution.text
            )}
          </p>
        </div>
      )}
    </div>
  );
}

/** Purpose: one photo, large, with its date, author, distance and licence, and a link to the source's viewer. */
function PhotoView({
  photo,
  index,
  count,
  pageName,
  onPick,
}: {
  photo: StreetPhoto;
  index: number;
  count: number;
  pageName: string;
  onPick: (i: number) => void;
}) {
  const { t } = useI18n();
  const [failed, setFailed] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  return (
    <figure className="m-0 flex flex-col gap-1.5">
      <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded bg-slate-100">
        {failed === photo.ref ? (
          <p className="m-0 px-3 text-center text-xs text-slate-600">{t("photos.imageFailed")}</p>
        ) : (
          <img
            key={photo.ref}
            src={photoUrl(photo, "sd")}
            alt={t("photos.alt", { n: index + 1 })}
            className={`h-full w-full object-cover ${loaded === photo.ref ? "" : "opacity-60"}`}
            onLoad={() => setLoaded(photo.ref)}
            onError={() => setFailed(photo.ref)}
          />
        )}
        {photo.panorama && (
          <span className="tag absolute top-1.5 left-1.5 bg-slate-900/75 text-white">
            {t("photos.panorama")}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="rounded border border-slate-300 px-2 disabled:opacity-40"
          disabled={index === 0}
          onClick={() => onPick(index - 1)}
        >
          {t("photos.previous")}
        </button>
        <span className="flex-1 text-center text-xs text-slate-600">
          {t("photos.count", { n: index + 1, count })}
        </span>
        <button
          type="button"
          className="rounded border border-slate-300 px-2 disabled:opacity-40"
          disabled={index >= count - 1}
          onClick={() => onPick(index + 1)}
        >
          {t("photos.next")}
        </button>
      </div>
      <figcaption className="flex flex-col gap-0.5 text-xs text-slate-700">
        <span>
          {t("photos.distance", { m: formatInt(photo.distanceM) })}
          {photo.takenAt && <> · {t("photos.taken", { date: dayOf(photo.takenAt) })}</>}
        </span>
        {photo.author && <span>{t("photos.by", { author: photo.author })}</span>}
        {photo.licence && (
          <span>
            {photo.licence.url ? (
              <a href={photo.licence.url} target="_blank" rel="noopener noreferrer" className="underline">
                {t("photos.licence", { licence: photo.licence.name })}
              </a>
            ) : (
              t("photos.licence", { licence: photo.licence.name })
            )}
          </span>
        )}
        <a
          href={photo.pageUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-blue-700 underline"
        >
          {t("photos.open", { name: pageName })}
        </a>
      </figcaption>
    </figure>
  );
}
