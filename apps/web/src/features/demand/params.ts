/**
 * The demand model's parameters (ADR-0019, 09 §2) from the assumption library
 * (assumptions/parameters/demand.yaml, exported by tools/demand/export_defaults.py), with the project's own
 * values on top. A project value is kept in the preferences document under the parameter's key.
 */
import data from "./defaults.generated.json";
import { type PreferencesDoc, prefValue } from "../../workspace/preferences";

/** Model step a parameter belongs to, in the order the model runs them. */
export type DemandStep =
  | "zones"
  | "generation"
  | "periods"
  | "distribution"
  | "mode_choice"
  | "catchment"
  | "assignment"
  | "calibration";

export interface DemandParam {
  key: string;
  step: DemandStep;
  label: string;
  unit: string;
  /** Library low, central and high value. */
  values: [number, number, number];
  basis: "cited" | "documented" | "educated-guess";
  sources: string[];
}

const DATA = data as unknown as { steps: DemandStep[]; params: DemandParam[] };

export const DEMAND_STEPS: readonly DemandStep[] = DATA.steps;
export const DEMAND_PARAMS: readonly DemandParam[] = DATA.params;
const BY_KEY = new Map(DEMAND_PARAMS.map((p) => [p.key, p]));

/** Purpose: one parameter by key; throws for a key the library does not have (a programming error). */
export function demandParam(key: string): DemandParam {
  const p = BY_KEY.get(key);
  if (!p) throw new Error(`unknown demand parameter ${key}`);
  return p;
}

/** Purpose: the value the project uses for a parameter: its own, else the library's central value. */
export function demandValue(key: string, prefs: PreferencesDoc | null | undefined): number {
  return prefValue(prefs, key) ?? demandParam(key).values[1];
}

/** Purpose: every parameter's value for this project, by key (what a demand run is given). */
export function demandValues(prefs: PreferencesDoc | null | undefined): Record<string, number> {
  return Object.fromEntries(DEMAND_PARAMS.map((p) => [p.key, demandValue(p.key, prefs)]));
}

/**
 * Purpose: whether a value can be used for a parameter: a finite number, not negative where the library's
 * range is not, and at most 1 for a share.
 */
export function acceptable(p: DemandParam, n: number): boolean {
  if (!Number.isFinite(n)) return false;
  if (p.values[0] >= 0 && n < 0) return false;
  if (p.unit === "share" && n > 1) return false;
  return true;
}
