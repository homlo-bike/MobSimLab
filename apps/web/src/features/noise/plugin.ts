import { pluginCalculation } from "../../plugins/registry";

/**
 * Purpose: whether the noise plugin's `noise_estimate` calculation is installed and offered in
 * `where` (a tool id such as "street-line-tool"). The editors show the Noise section only then.
 */
export function noiseCalculationIn(where: string): boolean {
  const c = pluginCalculation("noise_estimate");
  return !!c && (c.where ?? []).includes(where);
}
