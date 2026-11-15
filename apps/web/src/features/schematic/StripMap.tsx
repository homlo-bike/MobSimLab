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
  LEVEL_LABEL,
  type LevelBand,
  MUTED,
  type SchematicDoc,
  sized,
  textOn,
  useFooter,
} from "./common";
import type { StationHeights } from "./details";
import { isStepFree, linesAt, type SchematicLine, type SchematicNetwork, transferS } from "./lines";

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
  heights,
  zoom,
  modeLabel,
  title,
}: {
  svgRef: React.RefObject<SVGSVGElement | null>;
  net: SchematicNetwork;
  line: SchematicLine;
  doc: SchematicDoc;
  /** Ground height per station index; null while loading. */
  heights: StationHeights | null;
  zoom: number | null;
  modeLabel: (m: string) => string;
  title: string;
}) {
  const { t, language } = useI18n();
  const footer = useFooter(title);
  const fmt = (v: number, digits = 0) =>
    new Intl.NumberFormat(language, { maximumFractionDigits: digits }).format(v);
  const step = 110;
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
  const dist = (m: number) =>
    m < 1000
      ? t("schematic.metres", { n: fmt(Math.round(m / 10) * 10) })
      : t("schematic.km", { n: fmt(m / 1000, 1) });
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
  const conn = line.stops.map((st) => linesAt(net, st).filter((l) => l.id !== line.id));
  const maxConn = Math.max(0, ...conn.map((c) => c.length));
  const syms = line.stops.map((st) => symbolsAt(net, st, doc));
  const perRow = 5;
  const symRows = Math.max(0, ...syms.map((x) => Math.ceil(x.length / perRow)));
  const symTop = bandY + 26 + maxConn * 24;
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
    t("schematic.distNote"),
  ].flatMap((x) => wrap(x, Math.max(30, Math.floor((width - left) / 5.2))));
  const elevTop = stepTop + stepLines.length * 15 + 22;
  const elevH = 60;
  const known = line.stops.map((st) => heights?.[st] ?? null);
  const hs = known.filter((h): h is number => h !== null);
  const hMin = hs.length ? Math.min(...hs) : 0;
  const hMax = hs.length ? Math.max(...hs) : 0;
  const yOf = (h: number) =>
    elevTop + 22 + (hMax > hMin ? (1 - (h - hMin) / (hMax - hMin)) * elevH : elevH / 2);
  const height = elevTop + 22 + elevH + 40 + notes.length * 17 + 20;
  const fg = textOn(line.color);
  const xOf = (k: number) => left + k * step;
  const badgeW = Math.max(56, line.name.length * 11 + 24);
  const elevPts = known
    .map((h, k) => (h === null ? null : `${xOf(k)},${yOf(h).toFixed(1)}`))
    .filter((p): p is string => p !== null);

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
              <text x={x} y={y} fontSize={10.5} fill="#64748b">
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
      {/* Estimated driving time between stops, over the band. */}
      {line.runS.map((r, k) =>
        r === null ? null : (
          <text
            key={`run-${k}`}
            x={(xOf(k) + xOf(k + 1)) / 2}
            y={bandY - 10}
            fontSize={10.5}
            fontWeight={600}
            fill={MUTED}
            textAnchor="middle"
          >
            {t("schematic.minutes", { n: fmt(minutes(r / 60), 1) })}
          </text>
        ),
      )}
      {/* Distance between stops, under the band. */}
      {line.distM.map((m, k) => (
        <text
          key={`dist-${k}`}
          x={(xOf(k) + xOf(k + 1)) / 2}
          y={bandY + 18}
          fontSize={10}
          fill="#64748b"
          textAnchor="middle"
        >
          {dist(m)}
        </text>
      ))}
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
              fill="#ffffff"
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
            {c.map((o, j) => {
              const walk = walkMin(k, o);
              const label = walk !== null ? t("schematic.transfer", { line: o.name, n: walk }) : o.name;
              const w = Math.max(30, label.length * 6.8 + 14);
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
                    {label}
                  </text>
                </g>
              );
            })}
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
      <text x={left / 2} y={levelTop} fontSize={10.5} fill="#64748b">
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
      <text x={left / 2} y={stepTop} fontSize={10.5} fill="#64748b">
        {t("schematic.fact.stepFree")}
      </text>
      {stepLines.map((l, i) => (
        <text key={`sf-${i}`} x={left / 2} y={stepTop + 16 + i * 15} fontSize={12} fill={INK}>
          {l}
        </text>
      ))}

      {/* Ground height at each station. */}
      <text x={left / 2} y={elevTop} fontSize={10.5} fill="#64748b">
        {heights === null
          ? t("schematic.row.elevationLoading")
          : hs.length
            ? t("schematic.row.elevation")
            : t("schematic.row.elevationNone")}
      </text>
      {elevPts.length > 1 && (
        <polyline
          points={elevPts.join(" ")}
          fill="none"
          stroke="#94a3b8"
          strokeWidth={2}
          strokeLinejoin="round"
        />
      )}
      {known.map((h, k) =>
        h === null ? null : (
          <g key={`h-${k}`}>
            <circle cx={xOf(k)} cy={yOf(h)} r={3} fill="#64748b" />
            <text x={xOf(k)} y={yOf(h) - 7} fontSize={10.5} textAnchor="middle" fill={INK}>
              {t("schematic.metres", { n: fmt(h) })}
            </text>
          </g>
        ),
      )}

      {notes.map((x, i) => (
        <text
          key={`note-${i}`}
          x={left / 2}
          y={height - 36 - (notes.length - 1 - i) * 17}
          fontSize={10}
          fill="#64748b"
        >
          {x}
        </text>
      ))}
      <text x={left / 2} y={height - 14} fontSize={10} fill="#64748b">
        {footer}
      </text>
    </svg>
  );
}
