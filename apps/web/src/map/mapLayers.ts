import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import { type Basemap, basemapStyle } from "./basemaps";

/**
 * The project's layers in the layer control, by the id prefix their tools give them. Ids that match no
 * group (the basemap's own) are never hidden by the control.
 */
export const OVERLAY_GROUPS = [
  { id: "streetLines", prefixes: ["sl-"] },
  { id: "railways", prefixes: ["rd-"] },
  { id: "cableFerry", prefixes: ["spans-", "water-"] },
  { id: "streetSetups", prefixes: ["ss-"] },
  { id: "noise", prefixes: ["noise-"] },
  { id: "journey", prefixes: ["jp-"] },
  { id: "agents", prefixes: ["ag-"] },
] as const;
export type OverlayGroup = (typeof OVERLAY_GROUPS)[number]["id"];

/** Purpose: the overlay group a layer id belongs to, or null for basemap layers. */
export function groupOf(layerId: string): OverlayGroup | null {
  return OVERLAY_GROUPS.find((g) => g.prefixes.some((p) => layerId.startsWith(p)))?.id ?? null;
}

/** Purpose: the overlay groups that have at least one layer on the map now, in control order. */
export function groupsOnMap(map: MapLibreMap): OverlayGroup[] {
  const present = new Set((map.getStyle()?.layers ?? []).map((l) => groupOf(l.id)));
  return OVERLAY_GROUPS.map((g) => g.id).filter((g) => present.has(g));
}

/** The visibility a tool gave each layer the control hid, so showing the group again gives it back. */
const hiddenBy = new WeakMap<MapLibreMap, Map<string, "visible" | "none">>();

/**
 * Purpose: hide the layers of the `hidden` groups and give the others back the visibility they had.
 * Call it again whenever layers are added (tools add theirs as they open), which hides the new ones too.
 * Side effects: changes layout visibility of the project's layers only.
 */
export function applyHidden(map: MapLibreMap, hidden: ReadonlySet<OverlayGroup>): void {
  let saved = hiddenBy.get(map);
  if (!saved) hiddenBy.set(map, (saved = new Map()));
  const ids = new Set<string>();
  for (const l of map.getStyle()?.layers ?? []) {
    ids.add(l.id);
    const g = groupOf(l.id);
    if (!g) continue;
    const now = (map.getLayoutProperty(l.id, "visibility") as "visible" | "none" | undefined) ?? "visible";
    if (hidden.has(g)) {
      if (!saved.has(l.id)) saved.set(l.id, now);
      if (now !== "none") map.setLayoutProperty(l.id, "visibility", "none");
    } else if (saved.has(l.id)) {
      const before = saved.get(l.id)!;
      saved.delete(l.id);
      if (now !== before) map.setLayoutProperty(l.id, "visibility", before);
    }
  }
  for (const id of [...saved.keys()]) if (!ids.has(id)) saved.delete(id);
}

/** The basemap's own sources and layers, so a switch keeps everything else (the project's drawings). */
const baseOf = new WeakMap<MapLibreMap, { sources: Set<string>; layers: Set<string> }>();

/** Purpose: note what belongs to the basemap once its style has loaded. Call on the map's first `load`. */
export function markBasemap(map: MapLibreMap): void {
  const s = map.getStyle();
  baseOf.set(map, {
    sources: new Set(Object.keys(s?.sources ?? {})),
    layers: new Set((s?.layers ?? []).map((l) => l.id)),
  });
}

/** Purpose: the ids of the basemap's own layers (not those tools added); undefined before `markBasemap`. */
export function basemapLayers(map: MapLibreMap): ReadonlySet<string> | undefined {
  return baseOf.get(map)?.layers;
}

/**
 * Purpose: draw another basemap under the project's layers.
 * Inputs: the map (style loaded, `markBasemap` called), the basemap, and a callback once it has loaded.
 * Side effects: replaces the basemap's sources and layers; the project's sources, layers and images (those
 * named like its layers) stay.
 */
export function switchBasemap(map: MapLibreMap, basemap: Basemap, onLoaded?: () => void): void {
  const base = baseOf.get(map) ?? { sources: new Set<string>(), layers: new Set<string>() };
  // A style still loading (another switch a moment ago) has no images to list yet; MapLibre throws then.
  let listed: string[];
  try {
    listed = typeof map.listImages === "function" ? map.listImages() : [];
  } catch {
    listed = [];
  }
  const images = listed
    .filter((id) => groupOf(id) !== null)
    .map((id) => [id, map.getImage(id)] as const)
    .filter(([, img]) => !!img);
  map.setStyle(basemap.styleUrl, {
    diff: false,
    transformStyle: (prev, next) => {
      const style: StyleSpecification = basemapStyle(basemap, next);
      const ownSources = Object.fromEntries(
        Object.entries(prev?.sources ?? {}).filter(([id]) => !base.sources.has(id) && !(id in style.sources)),
      );
      const ownLayers = (prev?.layers ?? []).filter((l) => !base.layers.has(l.id));
      baseOf.set(map, {
        sources: new Set(Object.keys(style.sources)),
        layers: new Set(style.layers.map((l) => l.id)),
      });
      return {
        ...style,
        sources: { ...style.sources, ...ownSources },
        layers: [...style.layers, ...ownLayers],
      };
    },
  });
  map.once("style.load", () => {
    for (const [id, img] of images)
      if (!map.hasImage(id)) map.addImage(id, img!.data, { pixelRatio: img!.pixelRatio, sdf: img!.sdf });
    onLoaded?.();
  });
}
