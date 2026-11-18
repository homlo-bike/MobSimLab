/**
 * Station features and special statuses (ADR-0041 §7): what planners record about a station or stop in the
 * Create tab (step-free access, ramps, elevators, escalators and so on) and the special role they can give it
 * in the Schematic tab (central station, central bus station, airport, seaport and so on). Each has a symbol
 * drawn the same way on the maps, in exports and in the panels.
 */
import type { MessageKey } from "../../i18n/messages";

/** Facilities a station or stop has, recorded in the railway tool and the street line tool. */
export const STATION_FEATURES = [
  "step_free",
  "ramp",
  "elevator",
  "escalator",
  "tactile_paving",
  "toilets",
  "bike_parking",
] as const;
export type StationFeature = (typeof STATION_FEATURES)[number];

/** Special roles a station can be given in the Schematic tab. */
export const STATION_STATUSES = [
  "central_station",
  "bus_station",
  "airport",
  "seaport",
  "park_and_ride",
  "hospital",
  "university",
  "stadium",
] as const;
export type StationStatus = (typeof STATION_STATUSES)[number];

/** Purpose: the message key naming a feature or status. */
export function symbolLabel(id: StationFeature | StationStatus): MessageKey {
  return `station.symbol.${id}` as MessageKey;
}

/** Purpose: the valid features of a stored list (unknown ids and repeats dropped, in the list's order). */
export function cleanFeatures(list: unknown): StationFeature[] {
  if (!Array.isArray(list)) return [];
  return STATION_FEATURES.filter((f) => list.includes(f));
}

/** A symbol: strokes (and fills) in a 24 × 24 box, drawn white on a coloured disc. */
interface Glyph {
  d: string;
  fill?: boolean;
  text?: string;
}

const GLYPHS: Record<StationFeature | StationStatus, Glyph> = {
  central_station: {
    d: "M7 4h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM5 11h14M9 17l-2 4M15 17l2 4",
  },
  bus_station: { d: "M6 4h12a2 2 0 0 1 2 2v11H4V6a2 2 0 0 1 2-2zM4 12h16M7 17v3M17 17v3" },
  airport: {
    d: "M21 14v-2l-8-5V3.5a1 1 0 0 0-2 0V7l-8 5v2l8-2.5V17l-2 1.5V20l3-1 3 1v-1.5L13 17v-5.5z",
    fill: true,
  },
  seaport: { d: "M12 7v14M8 10h8M5 14a7 7 0 0 0 14 0M12 3a2 2 0 1 0 0 4a2 2 0 1 0 0-4" },
  park_and_ride: { d: "M8 20V4h5a4 4 0 0 1 0 8H8" },
  hospital: { d: "M12 5v14M5 12h14" },
  university: { d: "M2 9l10-5 10 5-10 5zM6 11v5c3 2 9 2 12 0v-5" },
  stadium: { d: "M3 10a9 4 0 1 0 18 0a9 4 0 1 0-18 0M3 10v4a9 4 0 0 0 18 0v-4" },
  step_free: { d: "M12 3.5a1.5 1.5 0 1 0 0 .1M11 7v6h5l2 5M11 10h5M8.5 11a5 5 0 1 0 7 6.5" },
  ramp: { d: "M3 19h18L3 10z" },
  elevator: { d: "M5 3h14v18H5zM9 9l3-3 3 3M9 15l3 3 3-3" },
  escalator: { d: "M3 19h5l8-12h5M8 13v6" },
  tactile_paving: {
    d: "M7 7h.01M12 7h.01M17 7h.01M7 12h.01M12 12h.01M17 12h.01M7 17h.01M12 17h.01M17 17h.01",
  },
  toilets: { d: "", text: "WC" },
  bike_parking: { d: "M6 17a3 3 0 1 0 0 .1M18 17a3 3 0 1 0 0 .1M6 17l4-7h5l3 7M10 10l3 7M9 7h3" },
};

/** Disc colour: statuses in ink, features in blue (the usual colour of accessibility signs). */
/** Dark mode draws it lighter, so it shows on the dark diagram (schematic/common.tsx). */
export const STATUS_COLOR = "var(--diagram-status, #0f172a)";
export const FEATURE_COLOR = "#1d4ed8";

/** Purpose: whether an id is a status (else a feature). */
export function isStatus(id: string): id is StationStatus {
  return (STATION_STATUSES as readonly string[]).includes(id);
}

/**
 * A symbol as SVG elements, centred on (x, y) with diameter `size`, for the diagrams and their exports
 * (presentation attributes only, so it stands alone in an exported SVG).
 */
export function SymbolMark({
  id,
  x,
  y,
  size,
  title,
}: {
  id: StationFeature | StationStatus;
  x: number;
  y: number;
  size: number;
  title?: string;
}) {
  const g = GLYPHS[id];
  const k = (size * 0.62) / 24;
  return (
    <g>
      {title && <title>{title}</title>}
      <circle cx={x} cy={y} r={size / 2} fill={isStatus(id) ? STATUS_COLOR : FEATURE_COLOR} />
      {g.text ? (
        <text
          x={x}
          y={y}
          fontSize={size * 0.42}
          fontWeight={700}
          fill="#ffffff"
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="system-ui, sans-serif"
        >
          {g.text}
        </text>
      ) : (
        <path
          d={g.d}
          transform={`translate(${x - 12 * k} ${y - 12 * k}) scale(${k})`}
          fill={g.fill ? "#ffffff" : "none"}
          stroke={g.fill ? "none" : "#ffffff"}
          strokeWidth={g.fill ? 0 : 2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </g>
  );
}

/** A symbol as a small inline SVG for buttons and lists. */
export function SymbolIcon({ id, size = 20 }: { id: StationFeature | StationStatus; size?: number }) {
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="shrink-0">
      <SymbolMark id={id} x={size / 2} y={size / 2} size={size} />
    </svg>
  );
}

/**
 * Chips to switch symbols on and off (features in the Create tab, statuses in the Schematic tab).
 * Inputs: the ids to offer, the chosen ones, a label for the group, and the change handler.
 */
export function SymbolPicker<T extends StationFeature | StationStatus>({
  options,
  value,
  label,
  onChange,
  t,
}: {
  options: readonly T[];
  value: readonly T[];
  label: string;
  onChange: (next: T[]) => void;
  t: (key: MessageKey) => string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((id) => {
        const on = value.includes(id);
        return (
          <button
            key={id}
            type="button"
            aria-pressed={on}
            onClick={() =>
              onChange(
                on ? value.filter((x) => x !== id) : options.filter((x) => x === id || value.includes(x)),
              )
            }
            className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${on ? "border-blue-300 bg-blue-50 text-blue-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
          >
            <SymbolIcon id={id} size={18} />
            {t(symbolLabel(id))}
          </button>
        );
      })}
    </div>
  );
}
