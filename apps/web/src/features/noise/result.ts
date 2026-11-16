/** The noise map's result (ADR-0038 steps N2 and N3), shared by the panel and its result view. */
import type { NoiseImages, NoiseLevels } from "./engine";
import type { PopulationSource } from "./population";
import type { Indicator, InputLevel, NoiseBuilding, NoiseView } from "./types";

/** Colours start at the Directive's lowest reporting band. */
export const FROM_DB: Record<Indicator, number> = { lden: 55, lnight: 50 };

/** One computed design: its estimate, pictures and grid levels. */
export interface Computed {
  name: string;
  view: NoiseView;
  images: NoiseImages | null;
  levels: NoiseLevels | null;
}

/** The difference map: the change per cell and its picture per indicator. */
export interface Difference {
  levels: Record<Indicator, Float32Array>;
  pixels: Record<Indicator, Uint8Array>;
}

/** A finished noise map. */
export type Done = {
  kind: "done";
  level: InputLevel;
  main: Computed;
  /** The scenario compared to, and the difference, when one was chosen. */
  other: Computed | null;
  difference: Difference | null;
  buildings: NoiseBuilding[] | null;
  notes: string[];
  people: PopulationSource | null;
};
