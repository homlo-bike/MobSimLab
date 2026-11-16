import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n/i18n";
import type { PluginLineInput } from "../journey-planner/network";
import type { Network, RailEngineLoader } from "../railways/types";
import type { StreetLinesDoc } from "../street-lines/saved";
import type { HeightsFetcher } from "../tables/railBuild";
import { EMPTY_SCHEMATIC, LAYER_LABEL, type SchematicArea, type SchematicDoc, useModeLabel } from "./common";
import { useLineProfile, useSchematicDetails } from "./details";
import { download, fileName, pngBlob, printSvg, svgText } from "./export";
import { defaultOrigin } from "./layout";
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
  const svgRef = useRef<SVGSVGElement>(null);
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
    const title = view === "line" && line ? `${projectName} ${line.name}` : projectName;
    try {
      if (kind === "svg")
        download(new Blob([svgText(svg)], { type: "image/svg+xml" }), fileName(title, "svg"));
      else if (kind === "png") download(await pngBlob(svg, 2), fileName(title, "png"));
      else printSvg(svg, title);
    } catch (e) {
      setError(t("schematic.exportFailed", { error: e instanceof Error ? e.message : String(e) }));
    }
  };

  if (!net.lines.length)
    return (
      <div className="h-full overflow-y-auto bg-slate-50">
        <section aria-label={t("schematic.title")} className="mx-auto max-w-3xl px-4 py-8 md:px-8 md:py-12">
          <h1 className="text-2xl font-semibold tracking-tight">{t("schematic.title")}</h1>
          <p className="mt-1 text-slate-600">{t("schematic.intro")}</p>
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
      <div className="relative min-h-0 min-w-0 flex-1 overflow-auto bg-slate-100">
        <div className="sticky top-0 left-0 z-10 flex w-fit gap-1 p-2">
          <button
            type="button"
            className="icon-btn bg-white shadow"
            aria-label={t("schematic.zoomOut")}
            onClick={() => setZoom((z) => Math.max(0.25, (z ?? 1) / 1.25))}
          >
            −
          </button>
          <button
            type="button"
            className="icon-btn bg-white px-3 shadow"
            aria-label={t("schematic.zoomFit")}
            onClick={() => setZoom((z) => (z === null ? 1 : null))}
          >
            {zoom === null ? t("schematic.fit") : `${Math.round(zoom * 100)}%`}
          </button>
          <button
            type="button"
            className="icon-btn bg-white shadow"
            aria-label={t("schematic.zoomIn")}
            onClick={() => setZoom((z) => Math.min(4, (z ?? 1) * 1.25))}
          >
            +
          </button>
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
                disabled={!onDoc}
                onChange={(e) => set({ [k]: e.target.checked })}
              />
              {t(label)}
            </label>
          ))}
        </fieldset>

        {view === "network" && (
          <>
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
        </div>
        <p className="text-xs text-slate-500">
          {tn("schematic.count", net.lines.length)} · {tn("schematic.stationCount", net.stations.length)}
        </p>
      </aside>
    </div>
  );
}
