import type { DelayShares } from "../features/street-lines/types";
import { MIXED_DELAY, PAINTED_DELAY } from "../features/street-setup/model";
import rulesData from "./design-rules.generated.json";
import paramsData from "./parameters.generated.json";

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
  /** Switches and crossings the project does not use, and its default turnout per rail mode; absent: all, library's. */
  switches?: { off?: string[]; default_turnout?: Record<string, string> };
  /** Values of enum and text assumptions the project changes, by assumption id (as `values` for numbers). */
  choices?: Record<string, string>;
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

/** A switch or crossing of the catalogue the railway editor places (turnouts and slips). */
export interface CatalogueSwitch {
  id: string;
  label: string;
  element: "turnout" | "single_slip" | "double_slip";
  typical_modes: string[];
  crossing_ratio_n: number | null;
  radius_m: number | null;
  diverging_speed_kmh: number | null;
}

/** Turnouts and slips of the switches and crossings catalogue (tools/design-rules/export_defaults.py). */
export const CATALOGUE_SWITCHES = (rulesData as unknown as { switches: CatalogueSwitch[] }).switches;
/** The library's default turnout per rail mode. */
export const LIBRARY_DEFAULT_TURNOUT = (rulesData as unknown as { default_turnout: Record<string, string> })
  .default_turnout;

/** Purpose: the project's choice from the switches and crossings catalogue, as the rail engine takes it. */
export function switchChoiceFrom(doc: PreferencesDoc | null | undefined): {
  off: string[];
  default_turnout: Record<string, string>;
} {
  const s = doc?.switches;
  const off = Array.isArray(s?.off) ? s.off.filter((x) => typeof x === "string") : [];
  const dt: Record<string, string> = {};
  for (const [m, id] of Object.entries(s?.default_turnout ?? {})) if (typeof id === "string") dt[m] = id;
  return { off: [...new Set(off)].sort(), default_turnout: dt };
}

/** Purpose: the document with the switch choice replaced; an empty choice is removed. */
function withSwitchChoice(
  doc: PreferencesDoc | null | undefined,
  c: { off: string[]; default_turnout: Record<string, string> },
): PreferencesDoc {
  const next: PreferencesDoc = { ...(doc ?? {}), values: { ...(doc?.values ?? {}) } };
  const sw: NonNullable<PreferencesDoc["switches"]> = {};
  if (c.off.length) sw.off = [...c.off].sort();
  if (Object.keys(c.default_turnout).length) sw.default_turnout = c.default_turnout;
  if (sw.off || sw.default_turnout) next.switches = sw;
  else delete next.switches;
  return next;
}

/** Purpose: the document with catalogue switches used (`on`) or not. */
export function withSwitches(
  doc: PreferencesDoc | null | undefined,
  ids: readonly string[],
  on: boolean,
): PreferencesDoc {
  const c = switchChoiceFrom(doc);
  const off = new Set(c.off);
  for (const id of ids) {
    if (on) off.delete(id);
    else off.add(id);
  }
  return withSwitchChoice(doc, { ...c, off: [...off] });
}

/** Purpose: the document with a mode's default turnout set, or back to the library's (`null`). */
export function withDefaultTurnout(
  doc: PreferencesDoc | null | undefined,
  mode: string,
  id: string | null,
): PreferencesDoc {
  const c = switchChoiceFrom(doc);
  const dt = { ...c.default_turnout };
  if (id === null || id === LIBRARY_DEFAULT_TURNOUT[mode]) delete dt[mode];
  else dt[mode] = id;
  return withSwitchChoice(doc, { ...c, default_turnout: dt });
}

/** One parameter of the assumption library, as Project Preferences → Parameters lists it. */
export interface LibraryParam {
  key: string;
  label: string;
  /** Library group (assumptions/parameters/*.yaml), in English. */
  group: string;
  unit: string;
  kind: "number" | "enum" | "string";
  options?: string[];
  /** [low, central, high] for numbers, the value for enum and text; by mode, "*" for every mode not listed. */
  values: Record<string, [number, number, number] | string>;
  /** Values for a traction (battery, diesel…) that has its own entry. */
  traction?: Record<string, [number, number, number] | string>;
}

const PARAMS_DATA = paramsData as unknown as { groups: string[]; params: LibraryParam[] };
/** Every parameter of the assumption library (tools/parameters/export_defaults.py), in group order. */
export const LIBRARY_PARAMS = PARAMS_DATA.params;
/** The library's groups in their order. */
export const PARAM_GROUPS = PARAMS_DATA.groups;

/** Purpose: the library's value of a parameter for a mode ("*": every mode) or, given, a traction. */
export function paramLibrary(
  p: LibraryParam,
  mode: string,
  traction?: string,
): [number, number, number] | string {
  return (traction ? p.traction?.[traction] : undefined) ?? p.values[mode] ?? (p.values["*"] as never);
}

/**
 * Purpose: the preference id of a parameter's project value for a mode or a traction, `key` for every mode.
 * The same ids the tools read, for example `mode.dwell_s.tram`.
 */
export function paramPrefId(key: string, mode: string, traction?: string): string {
  if (traction) return `${key}.${traction}`;
  return mode === "*" ? key : `${key}.${mode}`;
}

/** Purpose: the project's value of an enum or text assumption, or `undefined` when the library's applies. */
export function choiceValue(doc: PreferencesDoc | null | undefined, id: string): string | undefined {
  const v = doc?.choices?.[id];
  return typeof v === "string" ? v : undefined;
}

/** Purpose: the document with one enum or text value set, or removed (`null`) so the library's applies. */
export function withChoice(
  doc: PreferencesDoc | null | undefined,
  id: string,
  value: string | null,
): PreferencesDoc {
  const choices = { ...(doc?.choices ?? {}) };
  if (value === null) delete choices[id];
  else choices[id] = value;
  const next: PreferencesDoc = { ...(doc ?? {}), values: { ...(doc?.values ?? {}) } };
  if (Object.keys(choices).length) next.choices = choices;
  else delete next.choices;
  return next;
}
