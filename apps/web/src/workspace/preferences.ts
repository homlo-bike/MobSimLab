import type { DelayShares } from "../features/street-lines/types";
import { MIXED_DELAY, PAINTED_DELAY } from "../features/street-setup/model";

/**
 * The project's preferences document (drawing kind `preferences`): assumption library values the project
 * changes, by assumption id. Values the project leaves alone keep the library's central value.
 */
export interface PreferencesDoc {
  values: Record<string, number>;
}

/** The delays in traffic a project can change, with the library's values. */
export const DELAY_PREFS = [
  {
    id: "street.mixed_traffic_delay_share",
    key: "mixed_traffic",
    library: MIXED_DELAY,
    label: "prefs.delayMixed",
  },
  { id: "street.bus_lane_delay_share", key: "bus_lane", library: PAINTED_DELAY, label: "prefs.delayLane" },
] as const;

/** Largest delay share accepted (three times the free-flow running time). */
export const MAX_DELAY_SHARE = 3;

/** Purpose: the value of an assumption for this project, or `undefined` when the library's applies. */
export function prefValue(doc: PreferencesDoc | null | undefined, id: string): number | undefined {
  const v = doc?.values?.[id];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Purpose: the delays in traffic the tools use: the project's where it set them, else the library's. */
export function delaysFrom(doc: PreferencesDoc | null | undefined): DelayShares {
  const out = { mixed_traffic: MIXED_DELAY, bus_lane: PAINTED_DELAY };
  for (const p of DELAY_PREFS) {
    const v = prefValue(doc, p.id);
    if (v !== undefined) out[p.key] = Math.min(MAX_DELAY_SHARE, Math.max(0, v));
  }
  return out;
}

/** Purpose: the document with one value set, or removed (`null`) so the library's applies again. */
export function withPref(
  doc: PreferencesDoc | null | undefined,
  id: string,
  value: number | null,
): PreferencesDoc {
  const values = { ...(doc?.values ?? {}) };
  if (value === null) delete values[id];
  else values[id] = value;
  return { ...(doc ?? {}), values };
}
