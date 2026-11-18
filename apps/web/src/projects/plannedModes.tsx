import { createContext, useContext } from "react";
import { RAIL_MODES, STREET_MODES } from "./api";

/**
 * The modes the project plans to use (Project preferences → Modes you plan to use, or the new-project dialog).
 * Editors list only these; an empty list means the planner has not narrowed it down, so every mode shows.
 */
const PlannedModes = createContext<readonly string[]>([]);

export const PlannedModesProvider = PlannedModes.Provider;

/** The project's names that the editors spell differently: the railway editor calls intercity rail long distance. */
const SAME_AS: Record<string, string> = { intercity_rail: "long_distance_rail" };

/** Purpose: the project's planned modes, in the editors' own names. */
export function usePlannedModes(): readonly string[] {
  return useContext(PlannedModes);
}

/**
 * Purpose: the modes an editor offers: those the project plans to use, in the editor's order, plus the one in use
 * now (a line or track drawn before the plan changed keeps its mode visible and editable).
 * Inputs: every mode the editor knows (by id), the planned modes, the mode currently chosen.
 */
export function offeredModes<T>(
  all: readonly T[],
  id: (m: T) => string,
  planned: readonly string[],
  current?: string,
) {
  if (!planned.length) return [...all];
  const want = new Set(planned.map((m) => SAME_AS[m] ?? m));
  const shown = all.filter((m) => want.has(id(m)) || id(m) === current);
  // A plan that names none of this editor's modes would leave it empty: show them all rather than nothing.
  return shown.length ? shown : [...all];
}

/** Purpose: whether the plan includes a street mode, a rail mode (empty plan: both). */
export function plansStreet(planned: readonly string[]): boolean {
  return !planned.length || planned.some((m) => (STREET_MODES as readonly string[]).includes(m));
}
export function plansRail(planned: readonly string[]): boolean {
  return !planned.length || planned.some((m) => (RAIL_MODES as readonly string[]).includes(m));
}
