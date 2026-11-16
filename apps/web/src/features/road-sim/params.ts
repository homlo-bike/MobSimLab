/**
 * The road simulation's values from the assumption library (`road.*`, `street.peak_cars_*`,
 * `energy.hvac_power_kw`; exported by tools/assumptions/check.py), with the project's own values on top.
 */
import data from "./defaults.generated.json";
import type { PreferencesDoc } from "../../workspace/preferences";

type Triple = [number, number, number];

const LIB = (
  data as unknown as {
    params: Record<string, { label: string; unit: string; values: Record<string, Triple> }>;
  }
).params;

/**
 * Purpose: the low, central and high value of a parameter for a street mode ("*" for every mode). A project
 * value for the mode (`<key>.<mode>`), else for every mode (`<key>`), replaces the central value; low and high
 * move with it in the library's proportions.
 */
export function roadValue(key: string, mode: string, prefs: PreferencesDoc["values"] | undefined): Triple {
  const p = LIB[key];
  if (!p) throw new Error(`unknown road simulation parameter ${key}`);
  const lib = (p.values[mode] ?? p.values["*"])!;
  const pick = (id: string) => {
    const v = prefs?.[id];
    return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
  };
  const own = (mode !== "*" ? pick(`${key}.${mode}`) : undefined) ?? pick(key);
  if (own === undefined) return lib;
  const k = lib[1] !== 0 ? own / lib[1] : 1;
  return lib[1] !== 0 ? [lib[0] * k, own, lib[2] * k] : [own, own, own];
}

/** Purpose: the central value a road run uses. */
export const central = (key: string, mode: string, prefs: PreferencesDoc["values"] | undefined) =>
  roadValue(key, mode, prefs)[1];
