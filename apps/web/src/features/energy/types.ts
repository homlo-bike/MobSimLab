/** Types of the energy plugin's `energy_emissions` calculation (Rust `energy`, `energy-wasm`). */

/** One line with its yearly service and its mode's `energy.*` values. */
export interface EnergyLineInput {
  id: string;
  name: string;
  mode: string;
  /** Vehicle-km a year (trains counted once). */
  vehicle_km: number;
  /** Places per vehicle or train. */
  places: number;
  params: Record<string, number>;
}

/** Energy and emissions a year. */
export interface EnergyTotals {
  vehicle_km: number;
  electricity_kwh: number;
  diesel_l: number;
  energy_kwh: number;
  co2e_kg: number;
  co2e_electric_kg: number;
  co2e_diesel_kg: number;
  place_km: number;
}

export interface EnergyLine extends EnergyTotals {
  id: string;
  name: string;
  mode: string;
  electric_share: number;
  kwh_per_vkm: number;
  g_per_vkm: number;
  g_per_place_km: number | null;
  per_place: boolean;
  missing: string[];
}

export interface EnergyEstimate {
  lines: EnergyLine[];
  by_mode: Record<string, EnergyTotals>;
  total: EnergyTotals;
}

/** The engine as the Tables tab uses it; tests can inject a fake. */
export interface EnergyEngine {
  estimate(lines: EnergyLineInput[]): EnergyEstimate;
}

export type EnergyEngineLoader = () => Promise<EnergyEngine>;
