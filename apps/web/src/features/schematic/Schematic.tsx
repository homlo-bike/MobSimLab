import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useMemo,
  useRef,
  useState,
} from "react";
import { useI18n } from "../../i18n/i18n";
import type { MessageKey } from "../../i18n/messages";
import { findMode } from "../../plugins/registry";
import type { PluginLineInput } from "../journey-planner/network";
import { RAIL_MODES } from "../railways/modes";
import type { Network } from "../railways/types";
import { MODES } from "../street-lines/modes";
import type { StreetLinesDoc } from "../street-lines/saved";
import type { LonLat } from "../street-lines/types";
import { download, fileName, pngBlob, printSvg, svgText } from "./export";
import { defaultOrigin, layout, type Pt, snapToNeighbours } from "./layout";
import {
  type Layer,
  LAYERS,
  linesAt,
  type SchematicLine,
  type SchematicNetwork,
  schematicNetwork,
} from "./lines";
import { bundles, LABEL_DIRS, offsetPolyline, pathD, placeLabels } from "./paths";

/** The planner's edits of the diagram, saved with the project (drawing kind "schematic"). */
export interface SchematicDoc {
  /** Origin of the pinned positions; set when the first station is moved. */
  origin?: LonLat;
  /** Stations the planner moved: station key → metres east and north of `origin`. */
  pins: Record<string, Pt>;
  /** Label place per station key (index into the eight directions, clockwise from east). */
  labels: Record<string, number>;
  /** Straighten sections to 45° steps (default on). */
  straighten?: boolean;
  /** Round the corners (default on). */
  curves?: boolean;
  /** Snap to 45° from a neighbour while dragging (default on). */
  snap?: boolean;
  /** Mode layers switched off. */
  hidden?: Layer[];
}

export const EMPTY_SCHEMATIC: SchematicDoc = { pins: {}, labels: {} };

/** Screen pixels per diagram unit (the typical distance between stations). */
const PX = 110;
const PAD = 70;
const LINE_W = 6;
const GAP = 7;
const LABEL_SIZE = 13;
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const INK = "#1e293b";

const LAYER_LABEL: Record<Layer, MessageKey> = {
  bus: "schematic.layer.bus",
  brt: "schematic.layer.brt",
  tram: "schematic.layer.tram",
  metro: "schematic.layer.metro",
  regional: "schematic.layer.regional",
  long_distance: "schematic.layer.long_distance",
  other: "schematic.layer.other",
};

/** Purpose: the label of a mode id (rail, street or plugin mode). */
function useModeLabel(): (mode: string) => string {
  const { t } = useI18n();
  return (mode) => {
    const rail = RAIL_MODES.find((m) => m.id === mode);
    if (rail) return t(rail.label);
    const street = MODES[mode as keyof typeof MODES];
    if (street) return t(street.label);
    return findMode(mode)?.mode.label ?? mode;
  };
}

/** Purpose: black or white, whichever reads better on a colour. */
function textOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#ffffff";
  const n = parseInt(m[1]!, 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? "#0f172a" : "#ffffff";
}

/**
 * The Schematic tab (ADR-0025, ADR-0040; FR-SCH-01..03): the network map with every line drawn schematically
 * (45° sections, lines side by side where they share a section, rounded corners), mode layers to show or hide,
 * stations to drag and labels to place, a strip map per line with its connections, and export as SVG, PNG and
 * print or PDF. Edits are saved with the project when `onDoc` is given; without it the diagram is view only.
 */
export function Schematic({
  railway,
  streetLines,
  pluginLines = [],
  doc,
  onDoc,
  projectName,
  onCreate,
}: {
  railway: Network | null | undefined;
  streetLines: StreetLinesDoc | null | undefined;
  pluginLines?: readonly PluginLineInput[];
  doc: SchematicDoc | null | undefined;
  onDoc?: (d: SchematicDoc) => void;
  projectName: string;
  /** Opens the Create tab (shown when there are no lines yet). */
  onCreate?: () => void;
}) {
  const { t, tn } = useI18n();
  const modeLabel = useModeLabel();
  const d = doc ?? EMPTY_SCHEMATIC;
  // The plugin lines arrive as a new list on every render of the workspace: compare their content.
  const pluginJson = JSON.stringify(pluginLines);
  const net = useMemo(
    () => schematicNetwork(railway, streetLines, JSON.parse(pluginJson) as PluginLineInput[]),
    [railway, streetLines, pluginJson],
  );
  const [view, setView] = useState<"network" | "line">("network");
  const [lineId, setLineId] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const selStation = view === "network" && selected !== null ? (net.stations[selected] ?? null) : null;
  const line = net.lines.find((l) => l.id === lineId) ?? net.lines[0] ?? null;
  const present = LAYERS.filter((l) => net.lines.some((x) => x.layer === l));
  const hidden = new Set(d.hidden ?? []);
  const set = (patch: Partial<SchematicDoc>) => onDoc?.({ ...d, ...patch });

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
            />
          ) : (
            line && (
              <StripMap
                svgRef={svgRef}
                net={net}
                line={line}
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
          <button type="button" role="tab" aria-selected={view === "line"} onClick={() => setView("line")}>
            {t("schematic.view.line")}
          </button>
        </div>

        {view === "network" ? (
          <>
            {selStation && (
              <section
                aria-label={t("schematic.station")}
                className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="caps">{t("schematic.station")}</p>
                    <h2 className="text-lg font-semibold">{selStation.name}</h2>
                    <p className="text-sm text-slate-600">
                      {t("schematic.linesHere", {
                        lines: linesAt(net, selected!)
                          .map((l) => l.name)
                          .join(", "),
                      })}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={t("common.close")}
                    onClick={() => setSelected(null)}
                  >
                    ×
                  </button>
                </div>
                {onDoc && (
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="flex min-w-48 flex-1 flex-col gap-1.5">
                      <span className="caps">{t("schematic.label")}</span>
                      <span className="field">
                        <select
                          value={d.labels[selStation.key] ?? "auto"}
                          onChange={(e) => {
                            const labels = { ...d.labels };
                            if (e.target.value === "auto") delete labels[selStation.key];
                            else labels[selStation.key] = Number(e.target.value);
                            set({ labels });
                          }}
                        >
                          <option value="auto">{t("schematic.label.auto")}</option>
                          {LABEL_DIRS.map((_, k) => (
                            <option key={k} value={k}>
                              {t(`schematic.label.${k}` as MessageKey)}
                            </option>
                          ))}
                        </select>
                      </span>
                    </label>
                    {selStation.key in d.pins && (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => {
                          const pins = { ...d.pins };
                          delete pins[selStation.key];
                          set({ pins });
                        }}
                      >
                        {t("schematic.unpin")}
                      </button>
                    )}
                  </div>
                )}
              </section>
            )}
            {present.length > 1 && (
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
            <fieldset className="flex flex-col gap-2">
              <legend className="caps mb-2">{t("schematic.drawing")}</legend>
              {(
                [
                  ["straighten", "schematic.straighten"],
                  ["curves", "schematic.curves"],
                  ["snap", "schematic.snap"],
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
            <p className="text-sm text-slate-600">
              {onDoc ? t("schematic.dragHint") : t("schematic.readOnly")}
            </p>
            {onDoc && Object.keys(d.pins).length > 0 && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  if (window.confirm(t("schematic.resetConfirm")))
                    set({ pins: {}, labels: {}, origin: undefined });
                }}
              >
                {t("schematic.reset")}
              </button>
            )}
          </>
        ) : (
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

/** Purpose: the on-screen size of a diagram: fitted to the page width (zoom null), or at a zoom. */
function sized(width: number, height: number, zoom: number | null): CSSProperties {
  return zoom === null
    ? { width: "100%", maxWidth: width, height: "auto" }
    : { width: width * zoom, height: height * zoom };
}

/** Purpose: the diagram's title, legend and footer, under the drawing. Output: SVG elements and their height. */
function legend(
  lines: readonly SchematicLine[],
  width: number,
  top: number,
  modeLabel: (m: string) => string,
  footer: string,
): { node: ReactNode; height: number } {
  const colW = 230;
  const cols = Math.max(1, Math.floor((width - PAD) / colW));
  const rows = Math.ceil(lines.length / cols);
  const height = 30 + rows * 26 + 34;
  return {
    height,
    node: (
      <g fontFamily={FONT}>
        {lines.map((l, i) => {
          const x = PAD / 2 + (i % cols) * colW;
          const y = top + 20 + Math.floor(i / cols) * 26;
          return (
            <g key={l.id}>
              <rect x={x} y={y} width={36} height={16} rx={4} fill={l.color} />
              <text
                x={x + 18}
                y={y + 12}
                fontSize={10}
                fontWeight={700}
                textAnchor="middle"
                fill={textOn(l.color)}
              >
                {l.name.length > 5 ? "" : l.name}
              </text>
              <text x={x + 44} y={y + 12.5} fontSize={12} fill={INK}>
                {l.name} · {modeLabel(l.mode)}
              </text>
            </g>
          );
        })}
        <text x={PAD / 2} y={top + height - 10} fontSize={10} fill="#64748b">
          {footer}
        </text>
      </g>
    ),
  };
}

function useFooter(title: string): string {
  const { t, language } = useI18n();
  const date = new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(new Date());
  return t("schematic.footer", { project: title, date });
}

/** The network diagram: every visible line, stations to drag, labels to place. */
function NetworkMap({
  svgRef,
  net,
  doc,
  hidden,
  zoom,
  editable,
  onDoc,
  title,
  modeLabel,
  selected,
  onSelect,
}: {
  svgRef: React.RefObject<SVGSVGElement | null>;
  net: SchematicNetwork;
  doc: SchematicDoc;
  hidden: Set<Layer>;
  /** Screen zoom; null fits the width of the page. */
  zoom: number | null;
  selected: number | null;
  onSelect: (i: number | null) => void;
  editable: boolean;
  onDoc: (patch: Partial<SchematicDoc>) => void;
  title: string;
  modeLabel: (m: string) => string;
}) {
  const { t } = useI18n();
  const footer = useFooter(title);
  const origin = doc.origin ?? defaultOrigin(net);
  const straighten = doc.straighten !== false;
  const curves = doc.curves !== false;
  const snap = doc.snap !== false;
  const [ox, oy] = origin;
  const { pos, unit } = useMemo(
    () => layout(net, [ox, oy], doc.pins, straighten),
    [net, ox, oy, doc.pins, straighten],
  );
  const [drag, setDrag] = useState<{ i: number; at: Pt } | null>(null);

  const lines = net.lines.filter((l) => !hidden.has(l.layer));
  const shown = new Set(lines.flatMap((l) => l.stops));
  const world = pos.map((p, i) => (drag?.i === i ? drag.at : p));
  const pts = [...shown].map((i) => world[i]!);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs, 0);
  const maxY = Math.max(...ys, 0);
  const s = PX / unit;
  // Keep the frame from the layout (not the drag) so the drawing does not jump while dragging.
  const fxs = [...shown].map((i) => pos[i]![0]);
  const fys = [...shown].map((i) => pos[i]![1]);
  const fMinX = fxs.length ? Math.min(...fxs) : minX;
  const fMaxX = fxs.length ? Math.max(...fxs) : minX;
  const fMinY = fys.length ? Math.min(...fys) : maxY;
  const fMaxY = fys.length ? Math.max(...fys) : maxY;
  const screen = (p: Pt): Pt => [(p[0] - fMinX) * s + PAD + 60, (fMaxY - p[1]) * s + PAD + 40];
  const sp = world.map(screen);
  const width = Math.max(480, (fMaxX - fMinX) * s + 2 * PAD + 120);
  const drawH = (fMaxY - fMinY) * s + 2 * PAD + 80;
  const leg = legend(lines, width, drawH, modeLabel, footer);
  const height = drawH + leg.height;

  const bundle = bundles(lines);
  const neighbours = (i: number): number[] => {
    const out = new Set<number>();
    for (const l of lines)
      l.stops.forEach((x, k) => {
        if (x !== i) return;
        if (k > 0) out.add(l.stops[k - 1]!);
        if (k < l.stops.length - 1) out.add(l.stops[k + 1]!);
      });
    out.delete(i);
    return [...out];
  };

  const toWorld = (e: ReactPointerEvent): Pt | null => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return [(p.x - PAD - 60) / s + fMinX, fMaxY - (p.y - PAD - 40) / s];
  };
  const onMove = (e: ReactPointerEvent) => {
    if (!drag) return;
    const w = toWorld(e);
    if (!w) return;
    const at = snap
      ? snapToNeighbours(
          w,
          neighbours(drag.i).map((n) => world[n]!),
          unit * 0.35,
        )
      : w;
    setDrag({ i: drag.i, at });
  };
  const onUp = () => {
    if (!drag) return;
    const st = net.stations[drag.i]!;
    const moved = Math.hypot(drag.at[0] - pos[drag.i]![0], drag.at[1] - pos[drag.i]![1]) > unit * 0.02;
    if (moved) {
      // The station stays where it was put; the others are laid out around it again.
      onDoc({ origin, pins: { ...doc.pins, [st.key]: drag.at } });
    }
    setDrag(null);
  };

  const drawn = lines.map((l) => ({ line: l, ...offsetPolyline(l, sp, bundle, GAP, straighten) }));
  const radiusOf = (i: number): number => {
    const nb = neighbours(i);
    const most = Math.max(
      1,
      ...nb.map((n) => bundle.get(`${Math.min(i, n)}-${Math.max(i, n)}`)?.length ?? 1),
    );
    return Math.max(5, ((most - 1) * GAP) / 2 + 5);
  };
  const stationList = [...shown].map((i) => ({
    i,
    at: sp[i]!,
    name: net.stations[i]!.name,
    r: radiusOf(i),
    neighbours: neighbours(i).map((n) => sp[n]!),
  }));
  const fixedLabels = new Map<number, number>();
  for (const st of stationList) {
    const k = doc.labels[net.stations[st.i]!.key];
    if (k !== undefined) fixedLabels.set(st.i, k);
  }
  const labelDir = placeLabels(
    stationList,
    drawn.map((x) => x.pts),
    fixedLabels,
    LABEL_SIZE,
  );
  const sel = selected !== null && shown.has(selected) ? selected : null;

  return (
    <div className="flex flex-col gap-3">
      <svg
        ref={svgRef}
        role="img"
        aria-label={t("schematic.diagramAria")}
        width={Math.round(width)}
        height={Math.round(height)}
        viewBox={`0 0 ${Math.round(width)} ${Math.round(height)}`}
        style={{ ...sized(width, height, zoom), touchAction: drag ? "none" : undefined }}
        className="max-w-none rounded-xl bg-white shadow-sm"
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => setDrag(null)}
      >
        <rect width={width} height={height} fill="#ffffff" />
        <text x={PAD / 2} y={36} fontFamily={FONT} fontSize={20} fontWeight={700} fill={INK}>
          {title}
        </text>
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          {drawn.map(({ line: l, pts: p, station }) => (
            <path
              key={l.id}
              d={pathD(p, (k) => (!curves ? 0 : station[k] ? GAP * 1.5 : PX * 0.4))}
              stroke={l.color}
              strokeWidth={LINE_W}
            >
              <title>{l.name}</title>
            </path>
          ))}
        </g>
        {[...shown].map((i) => {
          const st = net.stations[i]!;
          const at = sp[i]!;
          const here = lines.filter((l) => l.stops.includes(i));
          const r = radiusOf(i);
          const dirK = labelDir.get(i) ?? 0;
          const [ux, uy] = LABEL_DIRS[dirK]!;
          const lx = at[0] + ux * (r + 7);
          const ly = at[1] + uy * (r + 7);
          const anchor = ux > 0.3 ? "start" : ux < -0.3 ? "end" : "middle";
          const base = uy > 0.3 ? "hanging" : uy < -0.3 ? "auto" : "central";
          const interchange = here.length > 1;
          return (
            <g key={st.key}>
              {sel === i && (
                <circle data-ui="" cx={at[0]} cy={at[1]} r={r + 6} fill="#bfdbfe" opacity={0.8} />
              )}
              <circle
                cx={at[0]}
                cy={at[1]}
                r={r}
                fill="#ffffff"
                stroke={interchange ? INK : (here[0]?.color ?? INK)}
                strokeWidth={interchange ? 2.5 : 3}
                style={editable ? { cursor: drag?.i === i ? "grabbing" : "grab" } : { cursor: "pointer" }}
                onPointerDown={(e) => {
                  onSelect(i);
                  if (!editable) return;
                  e.preventDefault();
                  (e.currentTarget.ownerSVGElement as SVGSVGElement | null)?.setPointerCapture(e.pointerId);
                  setDrag({ i, at: world[i]! });
                }}
              >
                <title>{st.name}</title>
              </circle>
              <text
                x={lx}
                y={ly}
                fontFamily={FONT}
                fontSize={LABEL_SIZE}
                fontWeight={interchange ? 700 : 500}
                fill={INK}
                textAnchor={anchor}
                dominantBaseline={base}
                stroke="#ffffff"
                strokeWidth={3}
                paintOrder="stroke"
                style={{ cursor: "pointer", userSelect: "none" }}
                onClick={() => onSelect(i)}
              >
                {st.name}
              </text>
            </g>
          );
        })}
        <g transform="translate(0 0)">{leg.node}</g>
      </svg>
    </div>
  );
}

/** One line on its own: a straight band with its stations in order and the lines to change to at each. */
function StripMap({
  svgRef,
  net,
  line,
  zoom,
  modeLabel,
  title,
}: {
  svgRef: React.RefObject<SVGSVGElement | null>;
  net: SchematicNetwork;
  line: SchematicLine;
  zoom: number | null;
  modeLabel: (m: string) => string;
  title: string;
}) {
  const { t } = useI18n();
  const footer = useFooter(title);
  const step = 110;
  const left = 70;
  const bandY = 190;
  const conn = line.stops.map((s) => linesAt(net, s).filter((l) => l.id !== line.id));
  const maxConn = Math.max(0, ...conn.map((c) => c.length));
  const width = Math.max(520, left * 2 + (line.stops.length - 1) * step + 60);
  const height = bandY + 50 + maxConn * 24 + 70;
  const fg = textOn(line.color);
  return (
    <svg
      ref={svgRef}
      role="img"
      aria-label={t("schematic.stripAria", { line: line.name })}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={sized(width, height, zoom)}
      className="max-w-none rounded-xl bg-white shadow-sm"
      fontFamily={FONT}
    >
      <rect width={width} height={height} fill="#ffffff" />
      <rect
        x={left / 2}
        y={20}
        rx={8}
        width={Math.max(56, line.name.length * 11 + 24)}
        height={32}
        fill={line.color}
      />
      <text x={left / 2 + 12} y={42} fontSize={18} fontWeight={700} fill={fg}>
        {line.name}
      </text>
      <text x={left / 2 + Math.max(56, line.name.length * 11 + 24) + 12} y={42} fontSize={14} fill="#475569">
        {modeLabel(line.mode)} · {net.stations[line.stops[0]!]!.name} –{" "}
        {net.stations[line.stops[line.stops.length - 1]!]!.name}
      </text>
      <line
        x1={left}
        x2={left + (line.stops.length - 1) * step}
        y1={bandY}
        y2={bandY}
        stroke={line.color}
        strokeWidth={10}
        strokeLinecap="round"
      />
      {line.stops.map((s, k) => {
        const x = left + k * step;
        const st = net.stations[s]!;
        const c = conn[k]!;
        const end = k === 0 || k === line.stops.length - 1;
        return (
          <g key={`${s}-${k}`}>
            <circle
              cx={x}
              cy={bandY}
              r={c.length ? 9 : 7}
              fill="#ffffff"
              stroke={c.length ? INK : line.color}
              strokeWidth={c.length ? 3 : 3.5}
            />
            <text
              x={x}
              y={bandY - 20}
              fontSize={13}
              fontWeight={end || c.length ? 700 : 500}
              fill={INK}
              transform={`rotate(-40 ${x} ${bandY - 20})`}
            >
              {st.name}
            </text>
            {c.map((o, j) => {
              const w = Math.max(30, o.name.length * 7.5 + 14);
              return (
                <g key={o.id}>
                  <rect x={x - w / 2} y={bandY + 22 + j * 24} width={w} height={19} rx={9.5} fill={o.color} />
                  <text
                    x={x}
                    y={bandY + 35.5 + j * 24}
                    fontSize={11}
                    fontWeight={700}
                    textAnchor="middle"
                    fill={textOn(o.color)}
                  >
                    {o.name}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}
      <text x={left / 2} y={height - 34} fontSize={11} fill="#475569">
        {conn.some((c) => c.length) ? t("schematic.connections") : t("schematic.noConnections")}
      </text>
      <text x={left / 2} y={height - 14} fontSize={10} fill="#64748b">
        {footer}
      </text>
    </svg>
  );
}
