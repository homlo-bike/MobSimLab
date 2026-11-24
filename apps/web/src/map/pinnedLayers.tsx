import { createContext, useContext } from "react";

/** The project layers a person can keep shown on every map tab (API `PINNED_LAYERS`), in the control's order. */
export const PINNED_LAYERS = [
  "serviceLines",
  "tracks",
  "stations",
  "stops",
  "streetSetups",
  "regions",
] as const;
export type PinnedLayer = (typeof PINNED_LAYERS)[number];

/** What the layer control offers to keep shown: the layers the project has something in, and the ones kept. */
export interface PinnedLayersState {
  available: readonly PinnedLayer[];
  pinned: ReadonlySet<PinnedLayer>;
  onChange: (next: ReadonlySet<PinnedLayer>) => void;
}

/** Set by an open project around its map; absent elsewhere (no "Always show" in the layer control). */
export const PinnedLayersContext = createContext<PinnedLayersState | null>(null);

/** Purpose: the project's layers to keep shown, for the layer control; null outside a project. */
export function usePinnedLayers(): PinnedLayersState | null {
  return useContext(PinnedLayersContext);
}
