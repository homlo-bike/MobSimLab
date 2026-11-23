/** What the network map and the strip map share: the saved edits, sizes, colours and the legend. */
import type { CSSProperties, ReactNode } from "react";
import { useI18n } from "../../i18n/i18n";
import type { MessageKey } from "../../i18n/messages";
import { findMode } from "../../plugins/registry";
import { RAIL_MODES } from "../railways/modes";
import type { StationStatus } from "../stations/features";
import { MODES } from "../street-lines/modes";
import type { LonLat } from "../street-lines/types";
import type { Pt } from "./layout";
import type { Layer, SchematicLine, SectionLevel } from "./lines";
import type { SchematicThumb } from "./thumb";

/** A shape the planner drew on the network map: a tariff zone or a landmark such as the old town. */
export interface SchematicArea {
  id: string;
  name: string;
  kind: "zone" | "landmark";
  /** "#rrggbb". */
  color: string;
  /** Corners, metres east and north of the diagram's origin (like moved stations). */
  points: Pt[];
}

/** The planner's edits of the diagram, saved with the project (drawing kind "schematic"). */
export interface SchematicDoc {
  /** Origin of the pinned positions and areas; set when the first station is moved or area drawn. */
  origin?: LonLat;
  /** Stations the planner moved: station key → metres east and north of `origin`. */
  pins: Record<string, Pt>;
  /** Label place per station key (index into the eight directions, clockwise from east). */
  labels: Record<string, number>;
  /** Name rotation per station key, degrees (−90 to 90; 0 when absent). */
  rotate?: Record<string, number>;
  /** Special statuses per station key (central station, airport and so on). */
  statuses?: Record<string, StationStatus[]>;
  /** Tariff zones and landmarks. */
  areas?: SchematicArea[];
  /** Straighten sections to 45° steps (default on). */
  straighten?: boolean;
  /** Round the corners (default on). */
  curves?: boolean;
  /** Snap to 45° from a neighbour while dragging (default on). */
  snap?: boolean;
  /** Show the status symbols (default on). */
  symbols?: boolean;
  /** Show the station feature symbols recorded in the Create tab (default on). */
  features?: boolean;
  /** Show sea, lakes and rivers (default on). */
  water?: boolean;
  /** Draw rivers at 45° steps like the lines (default on); off: as on the ground, bent with the stations. */
  straightRivers?: boolean;
  /** Size of the station names on the network map, px of the drawing (`LABEL_SIZE` when absent). */
  labelSize?: number;
  /** Longest section without stops, in typical sections (`DEFAULT_LONG_RUN` when absent; 0 keeps ground lengths). */
  longRun?: number;
  /** Show the tariff zones and landmarks (default on). */
  showAreas?: boolean;
  /** Mode layers switched off. */
  hidden?: Layer[];
  /** The network as last drawn, small, for the project card (written by the network map). */
  thumb?: SchematicThumb;
}

export const EMPTY_SCHEMATIC: SchematicDoc = { pins: {}, labels: {} };

/** Name rotations offered for long station names, degrees. */
export const ROTATIONS = [-90, -45, -30, 0, 30, 45, 90] as const;

/** Screen pixels per diagram unit (the typical distance between stations). */
export const PX = 110;
export const PAD = 70;
export const LINE_W = 6;
export const GAP = 7;
export const LABEL_SIZE = 13;
/** Smallest and largest station name size offered, px of the drawing: below 10 px names are hard to read. */
export const LABEL_SIZE_MIN = 10;
export const LABEL_SIZE_MAX = 32;

/** Purpose: the station name size of a diagram, within the offered range. */
export function labelSizeOf(doc: Pick<SchematicDoc, "labelSize">): number {
  const v = doc.labelSize;
  if (typeof v !== "number" || !Number.isFinite(v)) return LABEL_SIZE;
  return Math.min(LABEL_SIZE_MAX, Math.max(LABEL_SIZE_MIN, Math.round(v)));
}
export const SYMBOL_SIZE = 15;
export const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
/*
 * The diagrams' own colours are CSS variables with the light colour as the fallback: on screen they follow dark
 * mode (index.css), and exported files (export.ts) keep the light colours.
 */
export const PAPER = "var(--diagram-paper, #ffffff)";
export const INK = "var(--diagram-ink, #1e293b)";
export const MUTED = "var(--diagram-muted, #475569)";
/** Small notes and axis labels. */
export const NOTE = "var(--diagram-note, #64748b)";
/** Rules and guide lines. */
export const RULE = "var(--diagram-rule, #cbd5e1)";
export const WATER_FILL = "var(--diagram-water, #cfe8f7)";
export const WATER_LINE = "var(--diagram-water-line, #9fd0ee)";

export const LAYER_LABEL: Record<Layer, MessageKey> = {
  bus: "schematic.layer.bus",
  brt: "schematic.layer.brt",
  tram: "schematic.layer.tram",
  metro: "schematic.layer.metro",
  regional: "schematic.layer.regional",
  long_distance: "schematic.layer.long_distance",
  other: "schematic.layer.other",
};

/** How the strip map groups what a line runs on, with its colour and name. */
export type LevelBand = "underground" | "cutting" | "street" | "elevated" | "ramp" | "aerial" | "water";
export const LEVEL_BANDS: readonly LevelBand[] = [
  "underground",
  "cutting",
  "street",
  "elevated",
  "ramp",
  "aerial",
  "water",
];
export const LEVEL_COLOR: Record<LevelBand, string> = {
  underground: "var(--diagram-underground, #334155)",
  cutting: "#8a6a45",
  street: "#a8a29e",
  elevated: "#7c3aed",
  ramp: "#cbd5e1",
  aerial: "#0284c7",
  water: "#38bdf8",
};
export const LEVEL_LABEL: Record<LevelBand, MessageKey> = {
  underground: "schematic.level.underground",
  cutting: "schematic.level.cutting",
  street: "schematic.level.street",
  elevated: "schematic.level.elevated",
  ramp: "schematic.level.ramp",
  aerial: "schematic.level.aerial",
  water: "schematic.level.water",
};

/** Purpose: the strip map's group of a section level. */
export function bandOf(level: SectionLevel): LevelBand {
  if (level === "underground" || level === "underground2") return "underground";
  if (level === "elevated" || level === "elevated2") return "elevated";
  return level;
}

/** Purpose: the label of a mode id (rail, street or plugin mode). */
export function useModeLabel(): (mode: string) => string {
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
export function textOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#ffffff";
  const n = parseInt(m[1]!, 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? "#0f172a" : "#ffffff";
}

/** Purpose: the on-screen size of a diagram: fitted to the page width (zoom null), or at a zoom. */
export function sized(width: number, height: number, zoom: number | null): CSSProperties {
  return zoom === null
    ? { width: "100%", maxWidth: width, height: "auto" }
    : { width: width * zoom, height: height * zoom };
}

/** Purpose: the diagram's legend and footer, under the drawing. Output: SVG elements and their height. */
export function legend(
  lines: readonly SchematicLine[],
  width: number,
  top: number,
  modeLabel: (m: string) => string,
  footer: string,
  extra: { key: string; node: (x: number, y: number) => ReactNode; label: string }[] = [],
): { node: ReactNode; height: number } {
  const colW = 230;
  const cols = Math.max(1, Math.floor((width - PAD) / colW));
  const items = lines.length + extra.length;
  const rows = Math.ceil(items / cols);
  const height = 30 + rows * 26 + 34;
  const at = (i: number): Pt => [PAD / 2 + (i % cols) * colW, top + 20 + Math.floor(i / cols) * 26];
  return {
    height,
    node: (
      <g fontFamily={FONT}>
        {lines.map((l, i) => {
          const [x, y] = at(i);
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
        {extra.map((e, j) => {
          const [x, y] = at(lines.length + j);
          return (
            <g key={e.key}>
              {e.node(x, y)}
              <text x={x + 44} y={y + 12.5} fontSize={12} fill={INK}>
                {e.label}
              </text>
            </g>
          );
        })}
        <text x={PAD / 2} y={top + height - 10} fontSize={10} fill={NOTE}>
          {footer}
        </text>
      </g>
    ),
  };
}

/** Purpose: the line under a diagram naming the project and the date. */
export function useFooter(title: string): string {
  const { t, language } = useI18n();
  const date = new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(new Date());
  return t("schematic.footer", { project: title, date });
}
