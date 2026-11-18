import type { AllPaintProperties, Map as MapLibreMap } from "maplibre-gl";
import { basemapLayers } from "./mapLayers";

/**
 * The neutral colours the tools draw their layers with, and what they become on a dark basemap: white casings,
 * halos and stop fills turn dark, and dark ink turns light. Line, mode and warning colours stay as they are.
 */
const ON_DARK: Record<string, string> = {
  "#fff": "#0f172a",
  "#ffffff": "#0f172a",
  white: "#0f172a",
  "#f1f5f9": "#334155",
  "#e2e8f0": "#1e293b",
  "#0f172a": "#f1f5f9",
  "#1e293b": "#e2e8f0",
  "#1f2937": "#e5e7eb",
  "#334155": "#cbd5e1",
  "#475569": "#94a3b8",
  // Railway track below the zoom where rails and sleepers are drawn.
  "#2c3034": "#aab3bd",
};

/** Layers drawn as things look on the ground (rails on ballast, white road markings): never changed. */
const AS_ON_GROUND = /-(rails|stop-lines|tram-lanes)$/;

function swap(value: unknown): unknown {
  if (typeof value === "string") return ON_DARK[value.toLowerCase()] ?? value;
  if (Array.isArray(value)) return value.map(swap);
  return value;
}

/** Per map: each overlay paint property the theme changed, with the tool's own value and the one drawn. */
const changed = new WeakMap<MapLibreMap, Map<string, { own: unknown; drawn: unknown }>>();

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Purpose: draw the project's layers (not the basemap's) for a dark or a light basemap. Call it again whenever
 * layers are added or the basemap changes; a value a tool sets later is taken as its own.
 * Side effects: changes paint properties of the project's layers only.
 */
export function applyMapTheme(map: MapLibreMap, dark: boolean): void {
  // Until the basemap has loaded, its layers cannot be told from the project's.
  const base = basemapLayers(map);
  if (!base) return;
  let done = changed.get(map);
  if (!done) changed.set(map, (done = new Map()));
  const seen = new Set<string>();
  for (const layer of map.getStyle()?.layers ?? []) {
    if (base.has(layer.id) || AS_ON_GROUND.test(layer.id) || !("paint" in layer) || !layer.paint) continue;
    for (const prop of Object.keys(layer.paint) as (keyof AllPaintProperties)[]) {
      const key = `${layer.id}\u0000${prop}`;
      seen.add(key);
      const now = map.getPaintProperty(layer.id, prop);
      const before = done.get(key);
      // The tool's own value: what it set, unless what is drawn now is what the theme set.
      const own = before && same(now, before.drawn) ? before.own : now;
      const want = dark ? swap(own) : own;
      if (!same(want, now)) map.setPaintProperty(layer.id, prop, want as never);
      if (same(want, own)) done.delete(key);
      else done.set(key, { own, drawn: want });
    }
  }
  for (const key of [...done.keys()]) if (!seen.has(key)) done.delete(key);
}
