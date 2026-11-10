/**
 * The cost unit values of the assumption library (assumptions/parameters/costs.yaml, exported by
 * tools/costs/export_defaults.py), with the project's own values on top (ADR-0039).
 */
import data from "./defaults.generated.json";
import type { PreferencesDoc } from "../../workspace/preferences";

/** Low, central and high value. */
export type Triple = [number, number, number];

export interface CostParam {
  label: string;
  unit: string;
  /** By mode, with "*" for every mode not listed. */
  values: Record<string, Triple>;
}

export const PARAMS = (data as unknown as { params: Record<string, CostParam> }).params;
export type ParamKey = keyof typeof PARAMS & string;

/** Purpose: the library's values of a parameter for a mode (the mode's entry, else the global one). */
export function libraryValue(key: string, mode: string): Triple {
  const p = PARAMS[key];
  if (!p) throw new Error(`unknown cost parameter ${key}`);
  return (p.values[mode] ?? p.values["*"]) as Triple;
}

/**
 * Purpose: the preference id that holds a project's own central value of a parameter for a mode, or for
 * every mode (`mode` "*"). Example: `cost.civil.tbm_per_km.metro`.
 */
export function prefId(key: string, mode: string): string {
  return mode === "*" ? key : `${key}.${mode}`;
}

/**
 * Purpose: the values a project uses. A project value replaces the central value; low and high move with
 * it in the library's proportions. A value for the mode wins over one for every mode.
 */
export function paramValue(key: string, mode: string, prefs: PreferencesDoc["values"] | undefined): Triple {
  const lib = libraryValue(key, mode);
  const own = pick(prefs, prefId(key, mode)) ?? pick(prefs, prefId(key, "*"));
  if (own === undefined) return lib;
  const k = lib[1] !== 0 ? own / lib[1] : 1;
  return lib[1] !== 0 ? [lib[0] * k, own, lib[2] * k] : [own, own, own];
}

function pick(prefs: PreferencesDoc["values"] | undefined, id: string): number | undefined {
  const v = prefs?.[id];
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
}

/** Purpose: the modes a parameter has its own library value for (besides "*"). */
export function paramModes(key: string): string[] {
  return Object.keys(PARAMS[key]?.values ?? {}).filter((m) => m !== "*");
}
