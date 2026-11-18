import { pluginCalculation } from "../../plugins/registry";

/**
 * Purpose: whether the noise plugin's `noise_estimate` calculation is installed and offered in
 * `where` ("gis": the noise map of GIS, Map data, worked out for the whole project).
 */
export function noiseCalculationIn(where: string): boolean {
  const c = pluginCalculation("noise_estimate");
  return !!c && (c.where ?? []).includes(where);
}
