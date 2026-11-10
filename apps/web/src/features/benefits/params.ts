/**
 * The benefit parameters of the assumption library (assumptions/parameters/benefits.yaml and
 * mode.catchment_m, exported by tools/benefits/export_defaults.py), with the project's own values on top
 * (ADR-0040). Same rule as the cost tables: a project value replaces the central value and low and high
 * move with it.
 */
import data from "./defaults.generated.json";
import type { PreferencesDoc } from "../../workspace/preferences";

/** Low, central and high value. */
export type Triple = [number, number, number];

export interface BenefitParam {
  label: string;
  unit: string;
  /** By mode, with "*" for every mode not listed. */
  values: Record<string, Triple>;
}

export const PARAMS = (data as unknown as { params: Record<string, BenefitParam> }).params;

/** Purpose: the library's values of a parameter for a mode (the mode's entry, else the global one). */
export function libraryValue(key: string, mode = "*"): Triple {
  const p = PARAMS[key];
  if (!p) throw new Error(`unknown benefit parameter ${key}`);
  return (p.values[mode] ?? p.values["*"]) as Triple;
}

/** Purpose: the preference id of a project's own central value for a mode, or for every mode ("*"). */
export function prefId(key: string, mode = "*"): string {
  return mode === "*" ? key : `${key}.${mode}`;
}

/** Purpose: the values a project uses for a parameter and mode. */
export function paramValue(key: string, mode: string, prefs: PreferencesDoc["values"] | undefined): Triple {
  const lib = libraryValue(key, mode);
  const own = pick(prefs, prefId(key, mode)) ?? pick(prefs, prefId(key, "*"));
  if (own === undefined) return lib;
  if (lib[1] === 0) return [own, own, own];
  const k = own / lib[1];
  return [lib[0] * k, own, lib[2] * k];
}

function pick(prefs: PreferencesDoc["values"] | undefined, id: string): number | undefined {
  const v = prefs?.[id];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Purpose: the modes a parameter has its own library value for (besides "*"). */
export function paramModes(key: string): string[] {
  return Object.keys(PARAMS[key]?.values ?? {}).filter((m) => m !== "*");
}

/**
 * Purpose: one draw from a triangular distribution over [low, high] with its mode at central, from a
 * uniform number `u` in [0, 1).
 */
export function triangular([a, c, b]: Triple, u: number): number {
  if (!(b > a)) return c;
  const f = (c - a) / (b - a);
  return u < f ? a + Math.sqrt(u * (b - a) * (c - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - c));
}

/** Purpose: a seeded random number generator (mulberry32), so a run gives the same numbers again. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Purpose: the 10th, 50th and 90th percentiles of a list (low, medium, high). */
export function p10p50p90(xs: number[]): Triple {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return [0, 0, 0];
  const q = (p: number) => {
    const i = p * (s.length - 1);
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    return s[lo]! + (s[hi]! - s[lo]!) * (i - lo);
  };
  return [q(0.1), q(0.5), q(0.9)];
}
