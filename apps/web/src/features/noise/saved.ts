/**
 * The project's noise map saved with the project (GIS tab, Map data; saved result kind "noise",
 * apps/web/src/projects/results.ts): the finished result with the choices it was worked out with, so it shows
 * again on opening without working it out once more.
 */
import type { InputLevel } from "./types";
import type { Done } from "./result";

/** The choices of the Noise map panel a result was worked out with. */
export interface NoiseChoices {
  level: InputLevel;
  mainId: string;
  otherId: string;
  runIds: [string, string];
  withBuildings: boolean;
  withTerrain: boolean;
}

/** A noise map as the project keeps it. */
export interface SavedNoise {
  result: Done;
  choices: NoiseChoices;
}

/** Purpose: the project preferences the noise map reads (`noise.*`), so other preferences do not date it. */
export function noisePreferences(prefs: Record<string, number> | undefined): Record<string, number> {
  return Object.fromEntries(Object.entries(prefs ?? {}).filter(([k]) => k.startsWith("noise.")));
}
