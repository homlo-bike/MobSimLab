import type { ImageSource, Map as MapLibreMap } from "maplibre-gl";
import style from "../../../../../plugins/noise/styles/noise.json";
import type { LonLat } from "./types";

export const NOISE_SOURCE = "noise-band";
export const NOISE_LAYER = "noise-band";

/** Purpose: RGBA pixels (north row first) as a PNG data URL, or null where there is no canvas. */
function toDataUrl(pixels: Uint8Array, width: number, height: number): string | null {
  if (typeof document === "undefined" || width <= 0 || height <= 0) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext?.("2d");
  if (!ctx) return null;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
  return canvas.toDataURL("image/png");
}

/**
 * Purpose: show the noise band picture on the map below `beforeId` (the editor's own layers), or
 * remove it when `picture` is null. Uses the noise plugin's map layer style (plugins/noise/styles).
 * Side effects: adds, updates or removes the `noise-band` image source and raster layer.
 */
export function drawNoise(
  map: MapLibreMap,
  picture: {
    pixels: Uint8Array;
    width: number;
    height: number;
    coordinates: [LonLat, LonLat, LonLat, LonLat];
  } | null,
  beforeId?: string,
): void {
  const url = picture && toDataUrl(picture.pixels, picture.width, picture.height);
  if (!picture || !url) {
    removeNoise(map);
    return;
  }
  const src = map.getSource(NOISE_SOURCE) as ImageSource | undefined;
  if (src) {
    src.updateImage({ url, coordinates: picture.coordinates });
    return;
  }
  map.addSource(NOISE_SOURCE, { type: "image", url, coordinates: picture.coordinates });
  const layer = style.layers[0]!;
  map.addLayer(
    { id: NOISE_LAYER, type: "raster", source: NOISE_SOURCE, paint: layer.paint as Record<string, unknown> },
    beforeId && map.getLayer(beforeId) ? beforeId : undefined,
  );
}

/** Purpose: remove the noise band from the map. */
export function removeNoise(map: MapLibreMap): void {
  if (map.getLayer(NOISE_LAYER)) map.removeLayer(NOISE_LAYER);
  if (map.getSource(NOISE_SOURCE)) map.removeSource(NOISE_SOURCE);
}

/** Legend colours of the 5 dB bands from the plugin's style. */
export const LEGEND: { from_db: number; color: string }[] = style.legend;
