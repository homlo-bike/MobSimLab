import registry from "../../plugins/bundled.generated.json";

const NOISE_PLUGIN = "org.mobsimlab.noise";

interface RegistryPlugin {
  id: string;
  calculations?: { id: string; where?: string[] }[];
}

/**
 * Purpose: whether the noise plugin's `noise_estimate` calculation is installed and offered in
 * `where` (a tool id such as "street-line-tool"). The editors show the Noise toggle only then.
 */
export function noiseCalculationIn(where: string): boolean {
  const plugins = (registry as { plugins: RegistryPlugin[] }).plugins;
  const p = plugins.find((q) => q.id === NOISE_PLUGIN);
  return !!p?.calculations?.some((c) => c.id === "noise_estimate" && (c.where ?? []).includes(where));
}
