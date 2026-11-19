import { useI18n } from "../i18n/i18n";
import type { LonLat } from "./types";

/** What a plugin editor needs for its line list (ferry, cable car, people mover: several lines per project). */
export interface LineList {
  /** Id of this line for the journey planner and the other tabs (default: the tool id). */
  lineId?: string;
  /** The project's lines of this tool, for the line picker; absent: no picker (one line). */
  lines?: { id: string; name: string }[];
  onPickLine?: (id: string) => void;
  onNewLine?: () => void;
  /** Absent while the open line is not saved yet. */
  onDeleteLine?: () => void;
  /** Stops (piers, stations) of the tool's other lines: one placed on them is the same stop (place and name). */
  otherStops?: { name: string; lonlat: LonLat }[];
}

/** A new stop closer than this to a stop of another line is that stop, metres. */
export const SHARED_STOP_M = 60;

/** Purpose: the stop of another line within SHARED_STOP_M of a point, or null. */
export function sharedStop<T extends { lonlat: LonLat }>(p: LonLat, others: readonly T[]): T | null {
  let best: T | null = null;
  let bestD = SHARED_STOP_M;
  for (const o of others) {
    const dx = (o.lonlat[0] - p[0]) * 111_320 * Math.cos((p[1] * Math.PI) / 180);
    const dy = (o.lonlat[1] - p[1]) * 110_574;
    const d = Math.hypot(dx, dy);
    if (d <= bestD) {
      best = o;
      bestD = d;
    }
  }
  return best;
}

/**
 * Purpose: the line picker of a plugin editor: which of the tool's lines is open, New line and Delete line
 * (asks first). Renders nothing without `lines`.
 */
export function LinePicker({
  label,
  current,
  name,
  list,
}: {
  label: string;
  current: string;
  /** Name of the open line, for the delete question. */
  name: string;
  list: LineList;
}) {
  const { t } = useI18n();
  if (!list.lines) return null;
  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-slate-50 p-2">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-slate-600">{label}</span>
        <select
          className="rounded-lg border border-slate-300 px-2 py-1.5"
          value={current}
          onChange={(e) => list.onPickLine?.(e.target.value)}
        >
          {list.lines.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <div className="flex gap-2">
        <button type="button" className="btn min-h-8 px-2 text-xs" onClick={() => list.onNewLine?.()}>
          {t("street.newLine")}
        </button>
        <button
          type="button"
          className="btn min-h-8 px-2 text-xs text-red-700"
          disabled={!list.onDeleteLine}
          onClick={() => {
            if (window.confirm(t("street.deleteConfirm", { name }))) list.onDeleteLine?.();
          }}
        >
          {t("street.deleteLine")}
        </button>
      </div>
    </div>
  );
}
