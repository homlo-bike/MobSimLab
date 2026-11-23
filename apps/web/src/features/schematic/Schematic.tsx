import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n/i18n";
import type { PluginLineInput } from "../journey-planner/network";
import type { Network, RailEngineLoader } from "../railways/types";
import type { StreetLinesDoc } from "../street-lines/saved";
import type { HeightsFetcher } from "../tables/railBuild";
import {
  EMPTY_SCHEMATIC,
  LABEL_SIZE,
  LABEL_SIZE_MAX,
  LABEL_SIZE_MIN,
  LAYER_LABEL,
  labelSizeOf,
  type SchematicArea,
  type SchematicDoc,
  useModeLabel,
} from "./common";
import { useLineProfile, useSchematicDetails } from "./details";
import { download, fileName, MIN_NAME_PT, MIN_NAME_PX, pngImage, printSvg, svgText } from "./export";
import { DEFAULT_LONG_RUN, defaultOrigin, LONG_RUN_CHOICES } from "./layout";
import { LAYERS, schematicNetwork } from "./lines";
import { type AreaDraft, NetworkMap } from "./NetworkMap";
import { StripMap } from "./StripMap";
import { loadWater, waterBox, type WaterLoader, type WaterShapes } from "./water";

export { EMPTY_SCHEMATIC, type SchematicArea, type SchematicDoc };

/** Colours offered for tariff zones and landmarks. */
const AREA_COLORS = ["#dc2626", "#2563eb", "#16a34a", "#9333ea", "#ea580c", "#0891b2", "#78716c"];

/**
 * Purpose: the water around a network, fetched once per box while water is switched on.
 * Output: the shapes, or null while loading, when off, or when OpenStreetMap is unavailable.
 */
function useWater(points: string, on: boolean, load: WaterLoader): WaterShapes | null {
  const [water, setWater] = useState<WaterShapes | null>(null);
  useEffect(() => {
    let live = true;
    const box = on ? waterBox(JSON.parse(points) as [number, number][]) : null;
    if (!box) {
      setWater(null);
      return;
    }
    load(box)
      .then((w) => live && setWater(w))
      .catch(() => live && setWater(null));
    return () => {
      live = false;
    };
  }, [points, on, load]);
  return water;
}

/**
 * The Schematic tab (ADR-0025, ADR-0041; FR-SCH-01..03): the network map with every line drawn schematically
 * (45° sections, lines side by side where they share a section, rounded corners), mode layers to show or hide,
 * stations to drag, click and label, status and feature symbols, water and the planner's tariff zones and
 * landmarks; a strip map per line with its connections, driving times, service, levels and ground heights;
 * and export as SVG, PNG and print or PDF. Edits are saved with the project when `onDoc` is given; without it
 * the diagram is view only.
 */
export function Schematic({
  railway,
  streetLines,
  pluginLines = [],
  prefs,
  doc,
  onDoc,
  projectName,
  onCreate,
  loadRail,
  fetchHeights,
  waterLoader = loadWater,
}: {
  railway: Network | null | undefined;
  streetLines: StreetLinesDoc | null | undefined;
  pluginLines?: readonly PluginLineInput[];
  /** The project's preference values: how near stops must be to be one station (library's when absent). */
  prefs?: Record<string, number>;
  doc: SchematicDoc | null | undefined;
  onDoc?: (d: SchematicDoc) => void;
  projectName: string;
  /** Opens the Create tab (shown when there are no lines yet). */
  onCreate?: () => void;
  /** Tests inject the rail engine, the terrain heights and the water. */
  loadRail?: RailEngineLoader;
  fetchHeights?: HeightsFetcher;
  waterLoader?: WaterLoader;
}) {
  const { t, tn } = useI18n();
  const modeLabel = useModeLabel();
  const d = doc ?? EMPTY_SCHEMATIC;
  // The plugin lines arrive as a new list on every render of the workspace: compare their content.
  const pluginJson = JSON.stringify(pluginLines);
  const base = useMemo(
    () => schematicNetwork(railway, streetLines, JSON.parse(pluginJson) as PluginLineInput[], prefs),
    [railway, streetLines, pluginJson, prefs],
  );
  const net = useSchematicDetails(base, railway, loadRail, fetchHeights);
  const [view, setView] = useState<"network" | "line">("network");
  const [lineId, setLineId] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [draft, setDraft] = useState<AreaDraft | null>(null);
  const [areaId, setAreaId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  // Zooming keeps the point under the pointer (or the middle of the view) in place, ctrl/⌘ + wheel zooms, and
  // dragging the empty page pans it.
  const scroller = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ fx: number; fy: number; ax: number; ay: number } | null>(null);
  const zoomBy = (factor: number | null, at?: { x: number; y: number }) => {
    const el = scroller.current;
    if (el) {
      const ax = at?.x ?? el.clientWidth / 2;
      const ay = at?.y ?? el.clientHeight / 2;
      anchor.current = {
        fx: (el.scrollLeft + ax) / Math.max(1, el.scrollWidth),
        fy: (el.scrollTop + ay) / Math.max(1, el.scrollHeight),
        ax,
        ay,
      };
    }
    const scaleNow = () => {
      const svg = svgRef.current;
      const w = Number(svg?.getAttribute("width")) || 0;
      const shown = svg?.getBoundingClientRect().width ?? 0;
      return w && shown ? shown / w : 1;
    };
    setZoom((z) => (factor === null ? null : Math.min(4, Math.max(0.25, (z ?? scaleNow()) * factor))));
  };
  useLayoutEffect(() => {
    const el = scroller.current;
    const a = anchor.current;
    anchor.current = null;
    if (!el || !a) return;
    el.scrollLeft = a.fx * el.scrollWidth - a.ax;
    el.scrollTop = a.fy * el.scrollHeight - a.ay;
  }, [zoom]);
  const zoomNow = useRef(zoomBy);
  zoomNow.current = zoomBy;
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomNow.current(e.deltaY < 0 ? 1.25 : 1 / 1.25, { x: e.clientX - r.left, y: e.clientY - r.top });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  const pan = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const onPanStart = (e: React.PointerEvent<HTMLDivElement>) => {
    const tg = e.target as Element;
    // Only the empty page: stations, labels and areas keep their own drag.
    const empty = tg === e.currentTarget || tg.tagName === "svg" || tg.matches("svg > rect:first-child");
    if (e.button !== 0 || !empty || !scroller.current) return;
    pan.current = {
      x: e.clientX,
      y: e.clientY,
      left: scroller.current.scrollLeft,
      top: scroller.current.scrollTop,
      moved: false,
    };
  };
  const onPanMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = pan.current;
    const el = scroller.current;
    if (!p || !el) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (!p.moved && Math.hypot(dx, dy) < 5) return;
    p.moved = true;
    el.scrollLeft = p.left - dx;
    el.scrollTop = p.top - dy;
  };
  const onPanEnd = () => {
    const p = pan.current;
    pan.current = null;
    // A pan is not a click: it must not deselect a station or add an area corner.
    if (p?.moved) {
      // The click comes right after the pointer is released; drop the guard if none does.
      const swallow = (ev: MouseEvent) => ev.stopPropagation();
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
    }
  };
  const water = useWater(
    JSON.stringify(base.stations.map((s) => s.lonlat)),
    view === "network" && d.water !== false,
    waterLoader,
  );

  const line = net.lines.find((l) => l.id === lineId) ?? net.lines[0] ?? null;
  const profile = useLineProfile(view === "line" ? line : null, fetchHeights);
  const present = LAYERS.filter((l) => net.lines.some((x) => x.layer === l));
  const hidden = new Set(d.hidden ?? []);
  const set = (patch: Partial<SchematicDoc>) => onDoc?.({ ...d, ...patch });
  const areas = d.areas ?? [];
  const area = areas.find((a) => a.id === areaId) ?? null;
  const setArea = (patch: Partial<SchematicArea>) =>
    set({ areas: areas.map((a) => (a.id === areaId ? { ...a, ...patch } : a)) });
  const openLine = (id: string) => {
    setLineId(id);
    setSelected(null);
    setView("line");
  };
  const finishArea = () => {
    if (!draft || draft.points.length < 3) return;
    const id = `a${Date.now().toString(36)}`;
    const next: SchematicArea = {
      id,
      name: t("schematic.area.defaultName", { n: areas.length + 1 }),
      kind: "zone",
      color: AREA_COLORS[areas.length % AREA_COLORS.length]!,
      points: draft.points,
    };
    set({ origin: d.origin ?? defaultOrigin(net), areas: [...areas, next], showAreas: true });
    setDraft(null);
    setAreaId(id);
  };

  const exportAs = async (kind: "svg" | "png" | "print") => {
    const svg = svgRef.current;
    if (!svg) return;
    setError(null);
    setExportNote(null);
    const title = view === "line" && line ? `${projectName} ${line.name}` : projectName;
    // The strip map's station names are drawn at the default size.
    const namePx = view === "network" ? labelSizeOf(d) : LABEL_SIZE;
    try {
      if (kind === "svg")
        download(new Blob([svgText(svg)], { type: "image/svg+xml" }), fileName(title, "svg"));
      else if (kind === "png") {
        // Twice the drawing's size, or more so the names are at least `MIN_NAME_PX` in the image.
        const png = await pngImage(svg, Math.max(2, MIN_NAME_PX / namePx));
        download(png.blob, fileName(title, "png"));
        const px = Math.round(namePx * png.scale * 10) / 10;
        if (px < MIN_NAME_PX) setExportNote(t("schematic.pngSmallNames", { px }));
      } else {
        const paper = printSvg(svg, title, namePx);
        setExportNote(
          t(paper.namePt < MIN_NAME_PT ? "schematic.printSmallNames" : "schematic.printPaper", {
            paper: paper.name,
            pt: paper.namePt,
          }),
        );
      }
    } catch (e) {
      setError(t("schematic.exportFailed", { error: e instanceof Error ? e.message : String(e) }));
    }
  };

  if (!net.lines.length)
    return (
      <div className="h-full overflow-y-auto bg-slate-50">
        <section aria-label={t("schematic.title")} className="mx-auto max-w-3xl px-4 py-8 md:px-8 md:py-12">
          <p className="text-slate-600">{t("schematic.intro")}</p>
          <p className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-5 text-slate-700">
            {t("schematic.empty")}
          </p>
          {onCreate && (
            <button type="button" className="btn btn-pri mt-4" onClick={onCreate}>
              {t("schematic.toCreate")}
            </button>
          )}
        </section>
      </div>
    );

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <div
        ref={scroller}
        className="relative min-h-0 min-w-0 flex-1 overflow-auto bg-slate-100"
        onPointerDown={onPanStart}
        onPointerMove={onPanMove}
        onPointerUp={onPanEnd}
        onPointerCancel={() => (pan.current = null)}
      >
        <div className="sticky top-0 left-0 z-10 flex w-fit gap-1 p-2">
          <button
            type="button"
            className="icon-btn bg-white shadow"
            aria-label={t("schematic.zoomOut")}
            onClick={() => zoomBy(1 / 1.25)}
          >
            −
          </button>
          <button
            type="button"
            className="icon-btn bg-white px-3 shadow"
            aria-label={t("schematic.zoomFit")}
            aria-pressed={zoom === null}
            onClick={() => setZoom(null)}
          >
            {t("schematic.fit")}
          </button>
          <button
            type="button"
            className="icon-btn bg-white shadow"
            aria-label={t("schematic.zoomIn")}
            onClick={() => zoomBy(1.25)}
          >
            +
          </button>
          {zoom !== null && (
            <span className="self-center rounded bg-white/80 px-2 text-sm text-slate-700" aria-live="polite">
              {Math.round(zoom * 100)}%
            </span>
          )}
        </div>
        <div className="px-3 pb-6 md:px-6">
          {view === "network" ? (
            <NetworkMap
              svgRef={svgRef}
              net={net}
              doc={d}
              hidden={hidden}
              zoom={zoom}
              editable={!!onDoc}
              onDoc={set}
              title={projectName}
              modeLabel={modeLabel}
              selected={selected}
              onSelect={setSelected}
              onLine={openLine}
              water={water}
              draft={draft}
              onDraft={setDraft}
              selectedArea={areaId}
            />
          ) : (
            line && (
              <StripMap
                svgRef={svgRef}
                net={net}
                line={line}
                doc={d}
                profile={profile}
                zoom={zoom}
                modeLabel={modeLabel}
                title={projectName}
              />
            )
          )}
        </div>
      </div>
      <aside
        aria-label={t("schematic.title")}
        className="flex max-h-[50%] shrink-0 flex-col gap-4 overflow-y-auto border-t border-slate-200 bg-white p-4 md:max-h-none md:w-80 md:border-t-0 md:border-s md:p-5"
      >
        <div className="seg" role="tablist" aria-label={t("schematic.title")}>
          <button
            type="button"
            role="tab"
            aria-selected={view === "network"}
            onClick={() => setView("network")}
          >
            {t("schematic.view.network")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "line"}
            onClick={() => {
              setDraft(null);
              setView("line");
            }}
          >
            {t("schematic.view.line")}
          </button>
        </div>

        {view === "line" && (
          <label className="flex flex-col gap-1.5">
            <span className="caps">{t("schematic.pickLine")}</span>
            <span className="field">
              <select value={line?.id ?? ""} onChange={(e) => setLineId(e.target.value)}>
                {net.lines.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} · {modeLabel(l.mode)}
                  </option>
                ))}
              </select>
            </span>
          </label>
        )}

        {view === "network" && present.length > 1 && (
          <fieldset>
            <legend className="caps mb-2">{t("schematic.layers")}</legend>
            <div className="flex flex-wrap gap-1.5">
              {present.map((l) => (
                <button
                  key={l}
                  type="button"
                  className="chip"
                  aria-pressed={!hidden.has(l)}
                  onClick={() => {
                    const next = new Set(hidden);
                    if (next.has(l)) next.delete(l);
                    else next.add(l);
                    if (onDoc) set({ hidden: LAYERS.filter((x) => next.has(x)) });
                  }}
                  disabled={!onDoc}
                >
                  {t(LAYER_LABEL[l])}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        <fieldset className="flex flex-col gap-1">
          <legend className="caps mb-2">{t("schematic.drawing")}</legend>
          {(
            [
              ...(view === "network"
                ? ([
                    ["straighten", "schematic.straighten"],
                    ["curves", "schematic.curves"],
                    ["snap", "schematic.snap"],
                  ] as const)
                : []),
              ["symbols", "schematic.showStatuses"],
              ["features", "schematic.showFeatures"],
              ...(view === "network"
                ? ([
                    ["water", "schematic.showWater"],
                    ["straightRivers", "schematic.straightRivers"],
                    ["showAreas", "schematic.showAreas"],
                  ] as const)
                : []),
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex min-h-9 items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={d[k] !== false}
                disabled={!onDoc || (k === "straightRivers" && d.water === false)}
                onChange={(e) => set({ [k]: e.target.checked })}
              />
              {t(label)}
            </label>
          ))}
        </fieldset>

        {view === "network" && (
          <>
            <label className="flex flex-col gap-1.5">
              <span className="caps">{t("schematic.nameSize")}</span>
              <span className="flex items-center gap-3">
                <input
                  type="range"
                  className="min-w-0 flex-1"
                  min={LABEL_SIZE_MIN}
                  max={LABEL_SIZE_MAX}
                  step={1}
                  value={labelSizeOf(d)}
                  disabled={!onDoc}
                  aria-valuetext={`${labelSizeOf(d)} px`}
                  onChange={(e) => set({ labelSize: Number(e.target.value) })}
                />
                <span className="w-12 text-end text-sm tabular-nums">{labelSizeOf(d)} px</span>
              </span>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="caps">{t("schematic.longRuns")}</span>
              <span className="field">
                <select
                  value={d.longRun ?? DEFAULT_LONG_RUN}
                  disabled={!onDoc}
                  onChange={(e) => set({ longRun: Number(e.target.value) })}
                >
                  {LONG_RUN_CHOICES.map((n) => (
                    <option key={n} value={n}>
                      {n ? t("schematic.longRuns.max", { n }) : t("schematic.longRuns.off")}
                    </option>
                  ))}
                </select>
              </span>
            </label>
            <section aria-label={t("schematic.areas")} className="flex flex-col gap-2">
              <h2 className="caps">{t("schematic.areas")}</h2>
              {areas.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {areas.map((a) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        aria-pressed={a.id === areaId}
                        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-sm ${a.id === areaId ? "bg-blue-50 font-semibold" : "hover:bg-slate-50"}`}
                        onClick={() => setAreaId(a.id === areaId ? null : a.id)}
                      >
                        <span
                          className="h-3.5 w-5 shrink-0 rounded-sm border-2"
                          style={{ borderColor: a.color, background: `${a.color}22` }}
                        />
                        {a.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {area && onDoc && (
                <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-slate-500">{t("schematic.area.name")}</span>
                    <span className="field">
                      <input
                        value={area.name}
                        maxLength={80}
                        onChange={(e) => setArea({ name: e.target.value })}
                      />
                    </span>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-slate-500">{t("schematic.area.kind")}</span>
                    <span className="field">
                      <select
                        value={area.kind}
                        onChange={(e) => setArea({ kind: e.target.value as SchematicArea["kind"] })}
                      >
                        <option value="zone">{t("schematic.area.zone")}</option>
                        <option value="landmark">{t("schematic.area.landmark")}</option>
                      </select>
                    </span>
                  </label>
                  <div role="group" aria-label={t("schematic.area.color")} className="flex flex-wrap gap-1.5">
                    {AREA_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        aria-label={c}
                        aria-pressed={area.color === c}
                        className={`h-7 w-7 rounded-full border-2 ${area.color === c ? "border-slate-900" : "border-white"}`}
                        style={{ background: c }}
                        onClick={() => setArea({ color: c })}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-slate-600">{t("schematic.area.dragHint")}</p>
                  <button
                    type="button"
                    className="btn self-start"
                    onClick={() => {
                      set({ areas: areas.filter((a) => a.id !== areaId) });
                      setAreaId(null);
                    }}
                  >
                    {t("schematic.area.remove")}
                  </button>
                </div>
              )}
              {onDoc &&
                (draft ? (
                  <div className="flex flex-col gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3">
                    <p className="text-sm">{t("schematic.area.drawHint")}</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="btn btn-pri"
                        disabled={draft.points.length < 3}
                        onClick={finishArea}
                      >
                        {t("schematic.area.finish")}
                      </button>
                      <button
                        type="button"
                        className="btn"
                        disabled={!draft.points.length}
                        onClick={() => setDraft({ points: draft.points.slice(0, -1) })}
                      >
                        {t("schematic.area.undo")}
                      </button>
                      <button type="button" className="btn" onClick={() => setDraft(null)}>
                        {t("common.cancel")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn self-start"
                    onClick={() => {
                      setSelected(null);
                      setAreaId(null);
                      setDraft({ points: [] });
                    }}
                  >
                    {t("schematic.area.draw")}
                  </button>
                ))}
            </section>
            <p className="text-sm text-slate-600">
              {onDoc ? t("schematic.dragHint") : t("schematic.readOnly")}
            </p>
            {onDoc && Object.keys(d.pins).length > 0 && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  if (window.confirm(t("schematic.resetConfirm"))) set({ pins: {}, labels: {} });
                }}
              >
                {t("schematic.reset")}
              </button>
            )}
          </>
        )}

        <div>
          <h2 className="caps mb-2">{t("schematic.exportTitle")}</h2>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn" onClick={() => void exportAs("svg")}>
              {t("schematic.svg")}
            </button>
            <button type="button" className="btn" onClick={() => void exportAs("png")}>
              {t("schematic.png")}
            </button>
            <button type="button" className="btn" onClick={() => void exportAs("print")}>
              {t("schematic.print")}
            </button>
          </div>
          {error && (
            <p role="alert" className="mt-2 text-sm text-red-700">
              {error}
            </p>
          )}
          {exportNote && (
            <p role="status" className="mt-2 text-sm text-slate-600">
              {exportNote}
            </p>
          )}
        </div>
        <p className="text-xs text-slate-500">
          {tn("schematic.count", net.lines.length)} · {tn("schematic.stationCount", net.stations.length)}
        </p>
      </aside>
    </div>
  );
}
