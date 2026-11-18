/**
 * The network diagram (FR-SCH-01, ADR-0041): every visible line, stations to drag and click, names to place
 * and rotate, status and feature symbols, water for orientation and the planner's tariff zones and landmarks.
 */
import { type PointerEvent as ReactPointerEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n/i18n";
import { type StationFeature, type StationStatus, SymbolMark, symbolLabel } from "../stations/features";
import {
  FONT,
  GAP,
  INK,
  LABEL_SIZE,
  legend,
  LINE_W,
  PAD,
  PX,
  type SchematicArea,
  type SchematicDoc,
  sized,
  SYMBOL_SIZE,
  useFooter,
  WATER_FILL,
  WATER_LINE,
} from "./common";
import { defaultOrigin, layout, type Pt, snapToNeighbours } from "./layout";
import type { Layer, SchematicNetwork } from "./lines";
import { bundles, LABEL_DIRS, offsetPolyline, pathD, placeLabels } from "./paths";
import { StationPopup } from "./StationPopup";
import { symbolsAt } from "./StripMap";
import { warp, type WaterShapes } from "./water";

/** An area being drawn: its corners so far, metres from the origin. */
export interface AreaDraft {
  points: Pt[];
}

/** Purpose: the centre of a polygon's corners (for its name). */
function centreOf(pts: readonly Pt[]): Pt {
  const n = Math.max(1, pts.length);
  return [pts.reduce((a, p) => a + p[0], 0) / n, pts.reduce((a, p) => a + p[1], 0) / n];
}

export function NetworkMap({
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
  onLine,
  water,
  draft,
  onDraft,
  selectedArea,
}: {
  svgRef: React.RefObject<SVGSVGElement | null>;
  net: SchematicNetwork;
  doc: SchematicDoc;
  hidden: Set<Layer>;
  /** Screen zoom; null fits the width of the page. */
  zoom: number | null;
  selected: number | null;
  onSelect: (i: number | null) => void;
  /** Opens a line's strip map. */
  onLine: (id: string) => void;
  editable: boolean;
  onDoc: (patch: Partial<SchematicDoc>) => void;
  title: string;
  modeLabel: (m: string) => string;
  /** Water to draw (already fetched); null for none. */
  water: WaterShapes | null;
  /** An area being drawn: clicks on the map add corners. */
  draft: AreaDraft | null;
  onDraft: (d: AreaDraft) => void;
  /** The area whose corners can be dragged. */
  selectedArea: string | null;
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
  const [cornerDrag, setCornerDrag] = useState<{ area: string; k: number; at: Pt } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const lines = net.lines.filter((l) => !hidden.has(l.layer));
  const shown = new Set(lines.flatMap((l) => l.stops));
  const world = pos.map((p, i) => (drag?.i === i ? drag.at : p));
  const s = PX / unit;
  // Keep the frame from the layout (not the drag) so the drawing does not jump while dragging.
  const fxs = [...shown].map((i) => pos[i]![0]);
  const fys = [...shown].map((i) => pos[i]![1]);
  const fMinX = fxs.length ? Math.min(...fxs) : 0;
  const fMaxX = fxs.length ? Math.max(...fxs) : 0;
  const fMinY = fys.length ? Math.min(...fys) : 0;
  const fMaxY = fys.length ? Math.max(...fys) : 0;
  const screen = (p: Pt): Pt => [(p[0] - fMinX) * s + PAD + 60, (fMaxY - p[1]) * s + PAD + 40];
  const sp = world.map(screen);
  const width = Math.max(480, (fMaxX - fMinX) * s + 2 * PAD + 120);
  const drawH = (fMaxY - fMinY) * s + 2 * PAD + 80;

  const showWater = doc.water !== false && !!water;
  const areas = doc.showAreas !== false || draft ? (doc.areas ?? []) : [];

  // Water: ground places bent along with the stations, then onto the screen.
  const waterPaths = useMemo(() => {
    if (!showWater || !water) return null;
    const f = warp(
      [ox, oy],
      net.stations.map((st) => st.lonlat),
      pos,
    );
    const ring = (r: readonly [number, number][]) =>
      r
        .map((p, k) => {
          const [x, y] = screen(f(p));
          return `${k ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
        })
        .join("") + "Z";
    const line = (r: readonly [number, number][]) =>
      r
        .map((p, k) => {
          const [x, y] = screen(f(p));
          return `${k ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
        })
        .join("");
    return {
      fill: [...water.sea, ...water.areas].map(ring).join(""),
      rivers: water.rivers.map((r) => ({ d: line(r.line), kind: r.kind })),
    };
  }, [showWater, water, ox, oy, net, pos, fMinX, fMaxY, s]);

  const used = new Set<StationStatus | StationFeature>();
  for (const i of shown) for (const id of symbolsAt(net, i, doc)) used.add(id);
  const extras = [
    ...(waterPaths
      ? [
          {
            key: "water",
            label: t("schematic.water"),
            node: (x: number, y: number) => (
              <rect x={x} y={y} width={36} height={16} rx={4} fill={WATER_FILL} />
            ),
          },
        ]
      : []),
    ...areas.map((a) => ({
      key: `area-${a.id}`,
      label: `${a.name} · ${t(a.kind === "zone" ? "schematic.area.zone" : "schematic.area.landmark")}`,
      node: (x: number, y: number) => (
        <rect
          x={x}
          y={y}
          width={36}
          height={16}
          rx={4}
          fill={a.color}
          fillOpacity={0.15}
          stroke={a.color}
          strokeDasharray={a.kind === "zone" ? "5 3" : undefined}
          strokeWidth={1.5}
        />
      ),
    })),
    ...[...used].map((id) => ({
      key: id,
      label: t(symbolLabel(id)),
      node: (x: number, y: number) => <SymbolMark id={id} x={x + 18} y={y + 8} size={16} />,
    })),
  ];
  const leg = legend(lines, width, drawH, modeLabel, footer, extras);
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

  const toWorld = (e: { clientX: number; clientY: number }): Pt | null => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM?.();
    if (!svg || !m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return [(p.x - PAD - 60) / s + fMinX, fMaxY - (p.y - PAD - 40) / s];
  };
  const onMove = (e: ReactPointerEvent) => {
    const w = drag || cornerDrag ? toWorld(e) : null;
    if (!w) return;
    if (cornerDrag) {
      setCornerDrag({ ...cornerDrag, at: w });
      return;
    }
    if (!drag) return;
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
    if (cornerDrag) {
      const list = (doc.areas ?? []).map((a) =>
        a.id === cornerDrag.area
          ? { ...a, points: a.points.map((p, k) => (k === cornerDrag.k ? cornerDrag.at : p)) }
          : a,
      );
      onDoc({ origin, areas: list });
      setCornerDrag(null);
      return;
    }
    if (!drag) return;
    const st = net.stations[drag.i]!;
    const moved = Math.hypot(drag.at[0] - pos[drag.i]![0], drag.at[1] - pos[drag.i]![1]) > unit * 0.02;
    if (moved) {
      // The station stays where it was put; the others are laid out around it again.
      onDoc({ origin, pins: { ...doc.pins, [st.key]: drag.at } });
    }
    setDrag(null);
  };
  const onBackground = (e: React.MouseEvent) => {
    if (!draft) return;
    const w = toWorld(e);
    if (w) onDraft({ points: [...draft.points, w] });
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
    // The symbols after a name take room like a few more letters.
    name:
      net.stations[i]!.name +
      " ".repeat(Math.ceil((symbolsAt(net, i, doc).length * (SYMBOL_SIZE + 2) + 4) / (LABEL_SIZE * 0.56))),
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
  // While a station is being moved the pop-up gets out of the way, so the drawing under it stays in view;
  // it comes back next to the station where it is dropped. A plain click still opens it.
  const moving =
    drag !== null && Math.hypot(drag.at[0] - pos[drag.i]![0], drag.at[1] - pos[drag.i]![1]) > unit * 0.02;

  // The pop-up sits next to the station, in screen pixels of the drawing as shown.
  useLayoutEffect(() => {
    const measure = () => {
      const r = svgRef.current?.getBoundingClientRect();
      if (r && r.width > 0) setScale(r.width / width);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [svgRef, width, zoom, sel]);
  const wrapW = wrapRef.current?.clientWidth ?? width * scale;
  const popupStyle = (): React.CSSProperties => {
    const at: Pt = sel !== null ? sp[sel]! : [0, 0];
    const x = at[0] * scale;
    const y = at[1] * scale;
    const left = x + 18 + 320 > wrapW ? Math.max(0, x - 18 - 320) : x + 18;
    // Keep the whole pop-up (its status and name choices at the bottom) inside the drawing: move it up
    // near the bottom edge, and scroll inside it when the drawing is lower than the pop-up.
    const wrapH = wrapRef.current?.clientHeight ?? height * scale;
    const room = Math.max(240, wrapH);
    const top = Math.max(0, Math.min(y - 24, wrapH - Math.min(room, 560)));
    return { left, top, maxHeight: room - top, overflowY: "auto" };
  };

  const areaShown = (a: SchematicArea): Pt[] =>
    a.points.map((p, k) =>
      screen(cornerDrag && cornerDrag.area === a.id && cornerDrag.k === k ? cornerDrag.at : p),
    );

  return (
    <div ref={wrapRef} className="relative w-fit max-w-full">
      <svg
        ref={svgRef}
        role="img"
        aria-label={t("schematic.diagramAria")}
        width={Math.round(width)}
        height={Math.round(height)}
        viewBox={`0 0 ${Math.round(width)} ${Math.round(height)}`}
        style={{
          ...sized(width, height, zoom),
          touchAction: drag || cornerDrag ? "none" : undefined,
          cursor: draft ? "crosshair" : undefined,
        }}
        className="max-w-none rounded-xl bg-white shadow-sm"
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => {
          setDrag(null);
          setCornerDrag(null);
        }}
        onClick={onBackground}
      >
        <rect width={width} height={height} fill="#ffffff" />
        <clipPath id="schematic-drawing">
          <rect y={52} width={width} height={drawH - 52} />
        </clipPath>
        {waterPaths && (
          <g aria-label={t("schematic.water")} clipPath="url(#schematic-drawing)">
            <path d={waterPaths.fill} fill={WATER_FILL} fillRule="evenodd" stroke="none" />
            {waterPaths.rivers.map((r, k) => (
              <path
                key={k}
                d={r.d}
                fill="none"
                stroke={WATER_LINE}
                strokeWidth={r.kind === "river" ? 5 : 3}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          </g>
        )}
        {areas.map((a) => {
          const pts = areaShown(a);
          if (pts.length < 2) return null;
          const [cx, cy] = centreOf(pts);
          return (
            <g key={a.id} clipPath="url(#schematic-drawing)">
              <path
                d={pts.map((p, k) => `${k ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("") + "Z"}
                fill={a.color}
                fillOpacity={0.1}
                stroke={a.color}
                strokeWidth={2}
                strokeDasharray={a.kind === "zone" ? "8 5" : undefined}
              />
              <text
                x={cx}
                y={cy}
                fontFamily={FONT}
                fontSize={13}
                fontWeight={700}
                fontStyle="italic"
                fill={a.color}
                textAnchor="middle"
                dominantBaseline="central"
                opacity={0.8}
              >
                {a.name}
              </text>
              {editable &&
                selectedArea === a.id &&
                pts.map((p, k) => (
                  <circle
                    key={k}
                    data-ui=""
                    cx={p[0]}
                    cy={p[1]}
                    r={7}
                    fill="#ffffff"
                    stroke={a.color}
                    strokeWidth={2.5}
                    style={{ cursor: "move" }}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      (e.currentTarget.ownerSVGElement as SVGSVGElement | null)?.setPointerCapture?.(
                        e.pointerId,
                      );
                      setCornerDrag({ area: a.id, k, at: a.points[k]! });
                    }}
                  />
                ))}
            </g>
          );
        })}
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
        {/* Wide invisible strokes to click a line and open its strip map. */}
        {!draft && (
          <g data-ui="" fill="none" strokeLinecap="round" strokeLinejoin="round">
            {drawn.map(({ line: l, pts: p }) => (
              <path
                key={l.id}
                data-line={l.id}
                d={pathD(p, 0)}
                stroke="transparent"
                strokeWidth={LINE_W + 10}
                style={{ cursor: "pointer", pointerEvents: "stroke" }}
                onClick={(e) => {
                  e.stopPropagation();
                  onLine(l.id);
                }}
              >
                <title>{t("schematic.openStrip", { line: l.name })}</title>
              </path>
            ))}
          </g>
        )}
        {[...shown].map((i) => {
          const st = net.stations[i]!;
          const at = sp[i]!;
          const here = lines.filter((l) => l.stops.includes(i));
          const r = radiusOf(i);
          const dirK = labelDir.get(i) ?? 0;
          const [ux, uy] = LABEL_DIRS[dirK]!;
          const lx = at[0] + ux * (r + 7);
          const ly = at[1] + uy * (r + 7);
          const rot = doc.rotate?.[st.key] ?? 0;
          // A rotated name runs from the station outwards along its angle.
          const anchor = rot
            ? ux < -0.3
              ? "end"
              : "start"
            : ux > 0.3
              ? "start"
              : ux < -0.3
                ? "end"
                : "middle";
          const base = rot ? "central" : uy > 0.3 ? "hanging" : uy < -0.3 ? "auto" : "central";
          const interchange = here.length > 1;
          const syms = symbolsAt(net, i, doc);
          // Symbols follow the name: after it along its line, or under (above) a name below (above) the station.
          const textW = st.name.length * LABEL_SIZE * 0.56;
          const step = SYMBOL_SIZE + 2;
          const symAt = (j: number): Pt => {
            if (anchor === "middle") {
              const y =
                ly + (uy > 0 ? LABEL_SIZE + 4 + SYMBOL_SIZE / 2 : -(LABEL_SIZE + 4 + SYMBOL_SIZE / 2));
              return [lx + (j - (syms.length - 1) / 2) * step, y];
            }
            const sign = anchor === "end" ? -1 : 1;
            const ang = (-rot * Math.PI) / 180;
            const d = textW + 4 + SYMBOL_SIZE / 2 + j * step;
            // Rotated names start at the station and run along their angle.
            return [lx + sign * Math.cos(ang) * d, ly + sign * Math.sin(ang) * d];
          };
          return (
            <g key={st.key}>
              {sel === i && (
                <circle data-ui="" cx={at[0]} cy={at[1]} r={r + 6} fill="#bfdbfe" opacity={0.8} />
              )}
              <circle
                data-station={st.key}
                cx={at[0]}
                cy={at[1]}
                r={r}
                fill="#ffffff"
                stroke={interchange ? INK : (here[0]?.color ?? INK)}
                strokeWidth={interchange ? 2.5 : 3}
                style={editable ? { cursor: drag?.i === i ? "grabbing" : "grab" } : { cursor: "pointer" }}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => {
                  if (draft) return;
                  onSelect(i);
                  if (!editable) return;
                  e.preventDefault();
                  (e.currentTarget.ownerSVGElement as SVGSVGElement | null)?.setPointerCapture?.(e.pointerId);
                  setDrag({ i, at: world[i]! });
                }}
              >
                <title>{st.name}</title>
              </circle>
              {syms.map((id, j) => {
                const [x, y] = symAt(j);
                return (
                  <SymbolMark key={id} id={id} x={x} y={y} size={SYMBOL_SIZE} title={t(symbolLabel(id))} />
                );
              })}
              <text
                data-station={st.key}
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
                transform={rot ? `rotate(${-rot} ${lx} ${ly})` : undefined}
                style={{ cursor: "pointer", userSelect: "none" }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!draft) onSelect(i);
                }}
              >
                {st.name}
              </text>
            </g>
          );
        })}
        {draft && draft.points.length > 0 && (
          <g data-ui="">
            <path
              d={draft.points
                .map(screen)
                .map((p, k) => `${k ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
                .join("")}
              fill="none"
              stroke="#2563eb"
              strokeWidth={2}
              strokeDasharray="6 4"
            />
            {draft.points.map(screen).map((p, k) => (
              <circle key={k} cx={p[0]} cy={p[1]} r={5} fill="#2563eb" />
            ))}
          </g>
        )}
        <g>{leg.node}</g>
      </svg>
      {sel !== null && !draft && !moving && (
        <StationPopup
          net={net}
          station={sel}
          doc={doc}
          onDoc={editable ? onDoc : undefined}
          onClose={() => onSelect(null)}
          onLine={onLine}
          style={popupStyle()}
        />
      )}
    </div>
  );
}
