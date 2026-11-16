import type { DelayShares } from "../features/street-lines/types";
import { MIXED_DELAY, PAINTED_DELAY } from "../features/street-setup/model";
import rulesData from "./design-rules.generated.json";

/**
 * The project's preferences document (drawing kind `preferences`): assumption library values the project
 * changes, by assumption id. Values the project leaves alone keep the library's central value.
 */
export interface PreferencesDoc {
  values: Record<string, number>;
  /** ISO 4217 code of the currency all money is shown in; absent: each tool shows the country's own. */
  currency?: string;
  /** Catalogue vehicles the project does not use (ids); the line tools leave them out. Absent: all are used. */
  vehiclesOff?: string[];
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

/** One design rule of the railway design tool, with the library's values per rail mode. */
export interface DesignRule {
  /** Design value name in the rail engine (crates/rail-design ModeParams). */
  field: string;
  label: string;
  unit: string;
  /** A rail engine value (ModeParams); false for the platform accessibility rules the web app checks (the engine ignores those). */
  engine: boolean;
  /** Library key and [low, central, high] per rail mode. */
  modes: Record<string, { key: string; values: [number, number, number] }>;
}

/** Design rules the project can change per rail mode (tools/design-rules/export_defaults.py). */
export const DESIGN_RULES = (rulesData as unknown as { rules: DesignRule[] }).rules;

/** Purpose: the preference id of a design rule's value for a mode, for example `mode.min_curve_radius_m.tram`. */
export function rulePrefId(rule: DesignRule, mode: string): string | null {
  const m = rule.modes[mode];
  return m ? `${m.key}.${mode}` : null;
}

/**
 * Purpose: the design values the project changes, as the rail engine takes them (`<mode>.<field>`, for
 * example `tram.min_radius_m`). Values the project leaves alone are absent, so the library's apply.
 */
export function designValuesFrom(doc: PreferencesDoc | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const rule of DESIGN_RULES) {
    for (const mode of Object.keys(rule.modes)) {
      const id = rulePrefId(rule, mode);
      const v = id ? prefValue(doc, id) : undefined;
      if (v !== undefined && v > 0) out[`${mode}.${rule.field}`] = v;
    }
  }
  return out;
}

/**
 * Purpose: a design rule's value for a mode, from the values `designValuesFrom` gives (`<mode>.<field>`): the
 * project's where it set one, else the library's central value. `undefined` when the rule or mode is unknown.
 */
export function ruleValue(
  values: Readonly<Record<string, number>> | null | undefined,
  field: string,
  mode: string,
): number | undefined {
  const lib = DESIGN_RULES.find((r) => r.field === field)?.modes[mode];
  if (!lib) return undefined;
  const own = values?.[`${mode}.${field}`];
  return typeof own === "number" && Number.isFinite(own) && own > 0 ? own : lib.values[1];
}

/** Purpose: the catalogue vehicles the project does not use. */
export function vehiclesOffFrom(doc: PreferencesDoc | null | undefined): ReadonlySet<string> {
  return new Set(Array.isArray(doc?.vehiclesOff) ? doc.vehiclesOff.filter((x) => typeof x === "string") : []);
}

/** Purpose: the document with catalogue vehicles used (`on`) or not; an empty list is removed. */
export function withVehicles(
  doc: PreferencesDoc | null | undefined,
  ids: readonly string[],
  on: boolean,
): PreferencesDoc {
  const off = new Set(vehiclesOffFrom(doc));
  for (const id of ids) {
    if (on) off.delete(id);
    else off.add(id);
  }
  const next: PreferencesDoc = { ...(doc ?? {}), values: { ...(doc?.values ?? {}) } };
  if (off.size) next.vehiclesOff = [...off].sort();
  else delete next.vehiclesOff;
  return next;
}

/**
 * Purpose: the vehicles a line tool offers: those the project uses, plus `keep` (the vehicle a line already
 * has) so an existing line keeps showing it. When the project uses none of the list, all of it.
 */
export function usedVehicles<T extends { id: string }>(
  list: readonly T[],
  off: ReadonlySet<string>,
  keep?: string | null,
): T[] {
  const used = list.filter((v) => !off.has(v.id) || v.id === keep);
  return used.some((v) => !off.has(v.id)) ? used : [...list];
}
