/**
 * One line on its own (FR-SCH-02, ADR-0041 §10): a straight band with its stations in order, the estimated
 * driving time between them, the lines to change to and the symbols at each, and under it how the line runs:
 * vehicles, frequency, hours, what each section runs on and the ground height at every station. Everything
 * is drawn in the SVG, so the exports carry it.
 */
import { useI18n } from "../../i18n/i18n";
import { type StationFeature, type StationStatus, SymbolMark, symbolLabel } from "../stations/features";
import {
  bandOf,
  FONT,
  INK,
  LEVEL_BANDS,
  LEVEL_COLOR,
  LAYER_LABEL,
  LEVEL_LABEL,
  type LevelBand,
  MUTED,
  NOTE,
  PAPER,
  RULE,
  type SchematicDoc,
  sized,
  textOn,
  useFooter,
} from "./common";
import { type LineProfile, PROFILE_STEP_M } from "./details";
import {
  isStepFree,
  type Layer,
  layerOf,
  linesAt,
  type SchematicLine,
  type SchematicNetwork,
  transferS,
} from "./lines";

/** Purpose: a text cut into lines of at most `perLine` characters, at spaces. */
function wrap(text: string, perLine: number): string[] {
  const out: string[] = [];
  for (const word of text.split(" ")) {
    const last = out[out.length - 1];
    if (last !== undefined && `${last} ${word}`.length <= perLine) out[out.length - 1] = `${last} ${word}`;
    else out.push(word);
  }
  return out;
}

/** Purpose: minutes after midnight as hh:mm. */
function clock(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Purpose: a number of minutes for a label: whole minutes, or halves under ten. */
function minutes(v: number): number {
  return v < 10 ? Math.round(v * 2) / 2 : Math.round(v);
}

/** Px of ground drawn under the lowest point of the slice. */
const SOIL_PX = 16;
export const EARTH = "var(--diagram-earth, #dccbab)";
export const EARTH_LINE = "var(--diagram-earth-line, #8a6a3f)";

/**
 * Purpose: how to draw a line's ground as a side view of a slice along the line: length and height to the
 * same scale; the height at each stop; and per section the average gradient (rise over length, in running
 * direction) and the steepest between neighbouring samples, %. Output: null without any height.
 */
export function profileChart(profile: LineProfile, widthPx: number) {
  const known = profile.h.filter((h): h is number => h !== null);
  const total = profile.d[profile.d.length - 1] ?? 0;
  if (!known.length || total <= 0) return null;
  const pxPerM = widthPx / total;
  const lo = Math.min(...known);
  const hi = Math.max(...known);
  const reliefPx = (hi - lo) * pxPerM;
  const at = profile.stationD.map((m) => profile.d.indexOf(m));
  const stationH = at.map((i) => (i >= 0 ? (profile.h[i] ?? null) : null));
  const gradients = profile.stationD.slice(1).map((end, k) => {
    const from = at[k]!;
    const to = at[k + 1]!;
    const a = stationH[k];
    const b = stationH[k + 1];
    const len = end - profile.stationD[k]!;
    if (from < 0 || to < 0 || a === null || a === undefined || b === null || b === undefined || len <= 0)
      return null;
    let steepest = 0;
    for (let i = from + 1; i <= to; i++) {
      const h0 = profile.h[i - 1];
      const h1 = profile.h[i];
      const dd = profile.d[i]! - profile.d[i - 1]!;
      if (h0 === null || h0 === undefined || h1 === null || h1 === undefined || dd < PROFILE_STEP_M / 2)
        continue;
      if (Math.abs(h1 - h0) / dd > Math.abs(steepest)) steepest = (h1 - h0) / dd;
    }
    return { average: ((b - a) / len) * 100, steepest: steepest * 100 };
  });
  return { pxPerM, lo, hi, reliefPx, stationH, gradients };
}

/**
 * Purpose: the SVG paths of the ground: its line, and the area under it down to `baseY`, both broken where
 * heights are unknown.
 */
function groundD(
  profile: LineProfile,
  px: (m: number) => number,
  py: (h: number) => number,
  baseY: number,
): { line: string; area: string } {
  const runs: [number, number][][] = [];
  let cur: [number, number][] = [];
  profile.h.forEach((h, i) => {
    if (h === null) {
      if (cur.length) runs.push(cur);
      cur = [];
    } else cur.push([px(profile.d[i]!), py(h)]);
  });
  if (cur.length) runs.push(cur);
  const lines = runs
    .filter((r) => r.length > 1)
    .map((r) => r.map(([x, y], i) => `${i ? "L" : "M"} ${x.toFixed(1)},${y.toFixed(1)}`).join(" "));
  const areas = runs
    .filter((r) => r.length > 1)
    .map(
      (r, k) =>
        `${lines[k]} L ${r[r.length - 1]![0].toFixed(1)},${baseY} L ${r[0]![0].toFixed(1)},${baseY} Z`,
    );
  return { line: lines.join(" "), area: areas.join(" ") };
}

/** Connections are listed from the longest-reaching mode down. */
const CONN_ORDER: readonly Layer[] = ["long_distance", "regional", "metro", "tram", "brt", "bus", "other"];

/** Px from one row of connections to the next. */
const CONN_ROW = 21;

type ConnItem =
  | { kind: "mode"; layer: Layer; x: number; w: number }
  | { kind: "line"; line: SchematicLine; x: number; w: number }
  | { kind: "walk"; layer: Layer; text: string; x: number; w: number };

/**
 * Purpose: the lines to change to at a station, laid out in rows of at most `widthPx`: one group per mode (in
 * this order), each starting on a new row with the mode's sign, then its lines, then the shortest walk to
 * any of them. Lines that do not fit continue on the next row, under the first line.
 */
export function connectionRows(
  lines: readonly SchematicLine[],
  walk: (l: SchematicLine) => number | null,
  minutes: (n: number) => string,
  widthPx: number,
): ConnItem[][] {
  const rows: ConnItem[][] = [];
  for (const layer of CONN_ORDER) {
    const group = lines.filter((l) => layerOf(l.mode) === layer);
    if (!group.length) continue;
    let row: ConnItem[] = [{ kind: "mode", layer, x: 0, w: 17 }];
    rows.push(row);
    let x = 20;
    const place = (item: ConnItem) => {
      if (x + item.w > widthPx && row.length > 1) {
        row = [];
        rows.push(row);
        x = 20;
      }
      row.push({ ...item, x });
      x += item.w + 3;
    };
    for (const l of group) place({ kind: "line", line: l, x: 0, w: Math.max(22, l.name.length * 6.4 + 12) });
    const ws = group.map(walk).filter((w): w is number => w !== null);
    if (ws.length) {
      const text = minutes(Math.min(...ws));
      place({ kind: "walk", layer, text, x: 0, w: text.length * 5.6 + 4 });
    }
  }
  return rows;
}

/** Purpose: a small sign for a mode: a vehicle drawn in white on a dark square, `x`/`y` its top left. */
function ModeSign({ layer, x, y, title }: { layer: Layer; x: number; y: number; title: string }) {
  const body =
    layer === "bus" || layer === "brt" ? (
      <>
        <rect x={3.5} y={3} width={10} height={9} rx={2} fill="#fff" />
        <rect x={5} y={4.5} width={7} height={3} fill="#334155" />
        <circle cx={6} cy={13} r={1.3} fill="#fff" />
        <circle cx={11} cy={13} r={1.3} fill="#fff" />
      </>
    ) : layer === "tram" ? (
      <>
        <path d="M5 2.5 L8.5 4.5 L12 2.5" stroke="#fff" strokeWidth={1} fill="none" />
        <rect x={4} y={4.5} width={9} height={8.5} rx={1.5} fill="#fff" />
        <rect x={5.5} y={6} width={6} height={2.5} fill="#334155" />
      </>
    ) : layer === "metro" ? (
      <>
        <rect x={4} y={3} width={9} height={9.5} rx={3} fill="#fff" />
        <rect x={5.5} y={5} width={6} height={2.5} fill="#334155" />
        <path d="M5 15 L6.5 12.5 M12 15 L10.5 12.5" stroke="#fff" strokeWidth={1.2} />
      </>
    ) : layer === "other" ? (
      <circle cx={8.5} cy={8.5} r={4} fill="#fff" />
    ) : (
      <>
        <path d="M4 12.5 V5.5 Q4 3 7 3 H10 Q13 3 13 5.5 V12.5 Z" fill="#fff" />
        <rect x={5.5} y={5} width={6} height={2.5} fill="#334155" />
        <path d="M3 15 H14" stroke="#fff" strokeWidth={1.2} />
      </>
    );
  return (
    <g transform={`translate(${x} ${y})`}>
      <title>{title}</title>
      <rect width={17} height={17} rx={4} fill="#334155" />
      {body}
    </g>
  );
}

/** Purpose: the symbols to draw at a station: its statuses, then its features, as the drawing options say. */
export function symbolsAt(
  net: SchematicNetwork,
  station: number,
  doc: SchematicDoc,
): (StationStatus | StationFeature)[] {
  const st = net.stations[station];
  if (!st) return [];
  const out: (StationStatus | StationFeature)[] = [];
  if (doc.symbols !== false) out.push(...(doc.statuses?.[st.key] ?? []));
  if (doc.features !== false)
    for (const p of st.parts) for (const f of p.features) if (!out.includes(f)) out.push(f);
  return out;
}

export function StripMap({
  svgRef,
  net,
  line,
  doc,
  profile,
  zoom,
  modeLabel,
  title,
}: {
  svgRef: React.RefObject<SVGSVGElement | null>;
  net: SchematicNetwork;
  line: SchematicLine;
  doc: SchematicDoc;
  /** The ground along the line; null while loading. */
  profile: LineProfile | null;
  zoom: number | null;
  modeLabel: (m: string) => string;
  title: string;
}) {
  const { t, language } = useI18n();
  const footer = useFooter(title);
  const fmt = (v: number, digits = 0) =>
    new Intl.NumberFormat(language, { maximumFractionDigits: digits }).format(v);
  // The lines to change to at each stop; stations spread out when one of them has many.
  const conn = line.stops.map((st) => linesAt(net, st).filter((l) => l.id !== line.id));
  const step = Math.max(...conn.map((c) => c.length)) > 5 ? 150 : 110;
  const left = 70;
  const n = line.stops.length;
  const s = line.service;
  const none = t("schematic.unknown");
  // Average speed while driving: distance over driving time, on the sections where both are known.
  let runM = 0;
  let runS = 0;
  line.runS.forEach((r, k) => {
    if (r === null) return;
    runM += line.distM[k] ?? 0;
    runS += r;
  });
  const speedKmh = runS > 0 && runM > 0 ? (runM / runS) * 3.6 : null;
  const stopNames = [...new Set(line.stops)];
  const stepFree = stopNames
    .filter((st) => isStepFree(net.stations[st]!))
    .map((st) => net.stations[st]!.name);
  // Driving time per section: the worked-out time, else a rough one from the distance and the mode.
  const run = line.runS.map((r, k) => (r !== null ? r : (line.runEstS[k] ?? null)));
  const estimated = line.runS.some((r, k) => r === null && line.runEstS[k] !== undefined);
  // The walk to change from this line to another at a station, minutes.
  const walkMin = (k: number, other: SchematicLine): number | null => {
    const st = net.stations[line.stops[k]!]!;
    const mine = st.parts.find((p) => p.id === line.partIds[k]);
    const j = other.stops.indexOf(line.stops[k]!);
    const theirs = st.parts.find((p) => p.id === other.partIds[j]);
    return mine && theirs ? Math.max(1, Math.round(transferS(mine, theirs) / 60)) : null;
  };
  const facts: [string, string][] = [
    [t("schematic.fact.vehicles"), s.vehicles !== null ? fmt(s.vehicles) : none],
    [
      t("schematic.fact.headwayPeak"),
      s.peakMin !== null ? t("schematic.minutes", { n: fmt(s.peakMin, 1) }) : none,
    ],
    [
      t("schematic.fact.headwayOffPeak"),
      s.offPeakMin !== null ? t("schematic.minutes", { n: fmt(s.offPeakMin, 1) }) : none,
    ],
    ...(s.firstMin !== null && s.lastMin !== null
      ? ([[t("schematic.fact.hours"), `${clock(s.firstMin)}–${clock(s.lastMin)}`]] as [string, string][])
      : []),
    [
      t("schematic.fact.roundTrip"),
      s.roundTripMin !== null ? t("schematic.minutes", { n: fmt(s.roundTripMin) }) : none,
    ],
    [t("schematic.fact.length"), t("schematic.km", { n: fmt(s.lengthKm, 1) })],
    [t("schematic.fact.speed"), speedKmh !== null ? t("schematic.kmh", { n: fmt(speedKmh) }) : none],
    [t("schematic.fact.stepFree"), t("schematic.ofTotal", { n: stepFree.length, total: stopNames.length })],
  ];
  const width = Math.max(560, left * 2 + (n - 1) * step + 60);
  const factW = 150;
  const factCols = Math.max(1, Math.floor((width - left) / factW));
  const factsTop = 74;
  const factsH = Math.ceil(facts.length / factCols) * 40;
  const bandY = factsTop + factsH + 150;
  const connRows = conn.map((c, k) =>
    connectionRows(
      c,
      (o) => walkMin(k, o),
      (m) => t("schematic.minutes", { n: m }),
      step - 8,
    ),
  );
  const maxConn = Math.max(0, ...connRows.map((r) => r.length));
  const syms = line.stops.map((st) => symbolsAt(net, st, doc));
  const perRow = 5;
  const symRows = Math.max(0, ...syms.map((x) => Math.ceil(x.length / perRow)));
  const symTop = bandY + 26 + maxConn * CONN_ROW;
  const levelTop = symTop + symRows * 20 + (symRows ? 18 : 14);
  const used = LEVEL_BANDS.filter((b) => line.levels.some((sec) => sec.some((x) => bandOf(x.level) === b)));
  const stepTop = levelTop + 62;
  const stepText = stepFree.length
    ? t("schematic.stepFree.list", { stations: stepFree.join(", ") })
    : t("schematic.stepFree.none");
  const stepLines = wrap(stepText, Math.max(30, Math.floor((width - left) / 6.2)));
  // The notes under the drawing, wrapped to its width.
  const notes = [
    conn.some((c) => c.length) ? t("schematic.connections") : t("schematic.noConnections"),
    t("schematic.transferNote"),
    t("schematic.timeNote"),
    ...(estimated ? [t("schematic.estNote")] : []),
  ].flatMap((x) => wrap(x, Math.max(30, Math.floor((width - left) / 5.2))));
  // The ground along the line as if sliced and seen from the side (length and height to the same scale),
  // with the gradient of each section under it.
  const elevTop = stepTop + stepLines.length * 15 + 22;
  const chartLeft = left;
  const chartRight = left + (n - 1) * step; // as long as the band above
  const chart = profile ? profileChart(profile, chartRight - chartLeft) : null;
  const chartTop = elevTop + 30;
  const chartBottom = chartTop + (chart ? chart.reliefPx + SOIL_PX : 0);
  const px = (m: number) => chartLeft + m * (chart?.pxPerM ?? 0);
  const py = (h: number) => chartTop + ((chart?.hi ?? 0) - h) * (chart?.pxPerM ?? 0);
  // Gradient labels at the middle of each section, moved to a second row where they would overlap.
  const gradRow: number[] = [];
  const lastEnd: number[] = [-Infinity, -Infinity];
  chart?.gradients.forEach((g, k) => {
    const mid = px((profile!.stationD[k]! + profile!.stationD[k + 1]!) / 2);
    const row = mid - 30 >= lastEnd[0]! ? 0 : mid - 30 >= lastEnd[1]! ? 1 : 0;
    lastEnd[row] = mid + 30;
    gradRow.push(row);
  });
  const gradTop = chartBottom + 26;
  const height =
    (chart ? gradTop + 18 + (gradRow.includes(1) ? 2 : 1) * 26 : elevTop + 10) + 30 + notes.length * 17 + 20;
  const fg = textOn(line.color);
  const xOf = (k: number) => left + k * step;
  const badgeW = Math.max(56, line.name.length * 11 + 24);
  const ground = chart && profile ? groundD(profile, px, py, chartBottom) : { line: "", area: "" };
  const pct = (v: number) =>
    t("schematic.percent", {
      n: new Intl.NumberFormat(language, { maximumFractionDigits: 1, signDisplay: "exceptZero" }).format(v),
    });

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
      <rect width={width} height={height} fill={PAPER} />
      <rect x={left / 2} y={20} rx={8} width={badgeW} height={32} fill={line.color} />
      <text x={left / 2 + 12} y={42} fontSize={18} fontWeight={700} fill={fg}>
        {line.name}
      </text>
      <text x={left / 2 + badgeW + 12} y={42} fontSize={14} fill={MUTED}>
        {modeLabel(line.mode)} · {net.stations[line.stops[0]!]!.name} –{" "}
        {net.stations[line.stops[n - 1]!]!.name}
      </text>

      {/* How the line runs. */}
      <g aria-label={t("schematic.facts")}>
        {facts.map(([label, value], i) => {
          const x = left / 2 + (i % factCols) * factW;
          const y = factsTop + Math.floor(i / factCols) * 40;
          return (
            <g key={label}>
              <text x={x} y={y} fontSize={10.5} fill={NOTE}>
                {label}
              </text>
              <text x={x} y={y + 18} fontSize={15} fontWeight={700} fill={INK}>
                {value}
              </text>
            </g>
          );
        })}
      </g>

      <line
        x1={left}
        x2={xOf(n - 1)}
        y1={bandY}
        y2={bandY}
        stroke={line.color}
        strokeWidth={10}
        strokeLinecap="round"
      />
      {/* Driving time between stops, over the band; "~" where it is a rough estimate. */}
      {run.map((r, k) =>
        r === null ? null : (
          <text
            key={`run-${k}`}
            x={(xOf(k) + xOf(k + 1)) / 2}
            y={bandY - 10}
            fontSize={11}
            fontWeight={600}
            fill={MUTED}
            textAnchor="middle"
          >
            {(line.runS[k] === null ? "~" : "") + t("schematic.minutes", { n: fmt(minutes(r / 60), 1) })}
          </text>
        ),
      )}
      {line.stops.map((st, k) => {
        const x = xOf(k);
        const station = net.stations[st]!;
        const c = conn[k]!;
        const end = k === 0 || k === n - 1;
        return (
          <g key={`${st}-${k}`}>
            <circle
              cx={x}
              cy={bandY}
              r={c.length ? 9 : 7}
              fill={PAPER}
              stroke={c.length ? INK : line.color}
              strokeWidth={c.length ? 3 : 3.5}
            />
            <text
              x={x}
              y={bandY - 24}
              fontSize={13}
              fontWeight={end || c.length ? 700 : 500}
              fill={INK}
              transform={`rotate(-40 ${x} ${bandY - 24})`}
            >
              {station.name}
            </text>
            {/* The lines to change to, one group per mode: its sign, the lines and the shortest walk. */}
            {connRows[k]!.map((row, r) =>
              row.map((it) => {
                const ix = x - (step - 8) / 2 + it.x;
                const iy = bandY + 22 + r * CONN_ROW;
                if (it.kind === "mode")
                  return (
                    <ModeSign
                      key={`m-${it.layer}`}
                      layer={it.layer}
                      x={ix}
                      y={iy}
                      title={t(LAYER_LABEL[it.layer])}
                    />
                  );
                if (it.kind === "walk")
                  return (
                    <text key={`w-${it.layer}`} x={ix + 2} y={iy + 12.5} fontSize={10} fill={NOTE}>
                      {it.text}
                    </text>
                  );
                return (
                  <g key={it.line.id}>
                    <rect x={ix} y={iy} width={it.w} height={17} rx={8.5} fill={it.line.color} />
                    <text
                      x={ix + it.w / 2}
                      y={iy + 12.5}
                      fontSize={10.5}
                      fontWeight={700}
                      textAnchor="middle"
                      fill={textOn(it.line.color)}
                    >
                      {it.line.name}
                    </text>
                  </g>
                );
              }),
            )}
            {syms[k]!.map((id, j) => {
              const row = Math.floor(j / perRow);
              const inRow = Math.min(perRow, syms[k]!.length - row * perRow);
              const sx = x + ((j % perRow) - (inRow - 1) / 2) * 19;
              return (
                <SymbolMark
                  key={id}
                  id={id}
                  x={sx}
                  y={symTop + 8 + row * 20}
                  size={17}
                  title={t(symbolLabel(id))}
                />
              );
            })}
          </g>
        );
      })}

      {/* What each section runs on. */}
      <text x={left / 2} y={levelTop} fontSize={10.5} fill={NOTE}>
        {t("schematic.row.level")}
      </text>
      {line.levels.map((sec, k) => {
        let x = xOf(k);
        const w = xOf(k + 1) - xOf(k);
        return sec.map((part, j) => {
          const pw = w * part.share;
          const node = (
            <rect
              key={`lv-${k}-${j}`}
              x={x}
              y={levelTop + 8}
              width={pw}
              height={12}
              fill={LEVEL_COLOR[bandOf(part.level)]}
            >
              <title>{t(LEVEL_LABEL[bandOf(part.level)])}</title>
            </rect>
          );
          x += pw;
          return node;
        });
      })}
      {used.map((b: LevelBand, i) => (
        <g key={b}>
          <rect
            x={left / 2 + i * 120}
            y={levelTop + 28}
            width={12}
            height={12}
            rx={2}
            fill={LEVEL_COLOR[b]}
          />
          <text x={left / 2 + i * 120 + 17} y={levelTop + 38} fontSize={11} fill={INK}>
            {t(LEVEL_LABEL[b])}
          </text>
        </g>
      ))}

      {/* Which stations are step-free. */}
      <text x={left / 2} y={stepTop} fontSize={10.5} fill={NOTE}>
        {t("schematic.fact.stepFree")}
      </text>
      {stepLines.map((l, i) => (
        <text key={`sf-${i}`} x={left / 2} y={stepTop + 16 + i * 15} fontSize={12} fill={INK}>
          {l}
        </text>
      ))}

      {/* The ground along the line. */}
      <text x={left / 2} y={elevTop} fontSize={10.5} fill={NOTE}>
        {profile === null
          ? t("schematic.row.elevationLoading")
          : chart
            ? t("schematic.row.profile", { step: PROFILE_STEP_M })
            : t("schematic.row.elevationNone")}
      </text>
      {chart && profile && (
        <g aria-label={t("schematic.row.profile", { step: PROFILE_STEP_M })}>
          {/* Each station: from its place on the band above to its place along the line. */}
          {profile.stationD.map((m, k) => (
            <g key={`guide-${k}`}>
              <line
                x1={xOf(k)}
                y1={elevTop + 20}
                x2={px(m)}
                y2={py(chart.stationH[k] ?? chart.hi) - 5}
                stroke={RULE}
                strokeWidth={1}
                strokeDasharray="2 3"
              />
            </g>
          ))}
          <path d={ground.area} fill={EARTH} stroke="none" />
          <path d={ground.line} fill="none" stroke={EARTH_LINE} strokeWidth={1.5} strokeLinejoin="round" />
          {profile.stationD.map((m, k) => {
            const h = chart.stationH[k];
            return h === null || h === undefined ? null : (
              <circle
                key={`hp-${k}`}
                cx={px(m)}
                cy={py(h)}
                r={4}
                fill={line.color}
                stroke={PAPER}
                strokeWidth={1.5}
              />
            );
          })}
          <text x={left / 2} y={gradTop} fontSize={10.5} fill={NOTE}>
            {t("schematic.row.gradient", { step: PROFILE_STEP_M })}
          </text>
          {chart.gradients.map((g, k) => {
            const x = px((profile.stationD[k]! + profile.stationD[k + 1]!) / 2);
            const y = gradTop + 18 + gradRow[k]! * 26;
            return g === null ? null : (
              <g key={`grad-${k}`}>
                <text x={x} y={y} fontSize={11.5} fontWeight={700} textAnchor="middle" fill={INK}>
                  {pct(g.average)}
                </text>
                <text x={x} y={y + 11} fontSize={9.5} textAnchor="middle" fill={NOTE}>
                  {t("schematic.gradientMax", { n: pct(g.steepest) })}
                </text>
              </g>
            );
          })}
        </g>
      )}

      {notes.map((x, i) => (
        <text
          key={`note-${i}`}
          x={left / 2}
          y={height - 36 - (notes.length - 1 - i) * 17}
          fontSize={10}
          fill={NOTE}
        >
          {x}
        </text>
      ))}
      <text x={left / 2} y={height - 14} fontSize={10} fill={NOTE}>
        {footer}
      </text>
    </svg>
  );
}
