import type { GeoJSONSource, ImageSource, Map as MapLibreMap } from "maplibre-gl";
import type { Bbox, LatticeView } from "./api";

/**
 * The population view's map layers: the project area's outline, and a layer or the difference between two
 * layers as a picture of the lattice (people per cell). People use a light-to-dark purple ramp; a difference
 * uses red where the first layer has fewer people and blue where it has more, white near zero.
 */

export const AREA_SOURCE = "population-area";
export const AREA_LINE = "population-area-line";
export const GRID_SOURCE = "population-grid";
export const GRID_LAYER = "population-grid";

type Rgb = [number, number, number];
/** Sequential ramp, light to dark (people per cell). */
const PEOPLE: Rgb[] = [
  [242, 240, 247],
  [203, 201, 226],
  [158, 154, 200],
  [117, 107, 177],
  [84, 39, 143],
];
/** Diverging ramp: fewer (red) … about the same (white) … more (blue). */
const FEWER: Rgb = [178, 24, 43];
const SAME: Rgb = [247, 247, 247];
const MORE: Rgb = [33, 102, 172];

const mix = (a: Rgb, b: Rgb, t: number): Rgb =>
  [0, 1, 2].map((i) => Math.round(a[i]! + (b[i]! - a[i]!) * t)) as Rgb;

/** Purpose: the colour of `t` in [0, 1] along a ramp. */
function ramp(stops: Rgb[], t: number): Rgb {
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  return mix(stops[i]!, stops[i + 1]!, x - i);
}

/** Purpose: the 98th percentile of the absolute non-zero values, the top of the colour scale (at least 1). */
export function scaleTop(values: number[]): number {
  const a = values.filter((v) => v !== 0).map(Math.abs);
  if (!a.length) return 1;
  a.sort((x, y) => x - y);
  return Math.max(1, a[Math.min(a.length - 1, Math.floor(a.length * 0.98))]!);
}

/** Legend entries: colour and the value it stands for. */
export function legend(diff: boolean, top: number): { color: string; value: number }[] {
  const css = (c: Rgb) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  if (diff)
    return [-1, -0.5, 0, 0.5, 1].map((f) => ({
      color: css(f < 0 ? mix(SAME, FEWER, -f) : mix(SAME, MORE, f)),
      value: f * top,
    }));
  return [0, 0.25, 0.5, 0.75, 1].map((f) => ({ color: css(ramp(PEOPLE, f)), value: f * top }));
}

/**
 * Purpose: RGBA pixels of a lattice view, north row first: transparent where nobody lives (people) or the
 * layers agree (difference). Output: the pixels and the scale's top value.
 */
export function latticePixels(view: LatticeView, diff: boolean): { pixels: Uint8Array; top: number } {
  const { nx, ny, values } = view.grid;
  const top = scaleTop(values);
  const pixels = new Uint8Array(nx * ny * 4);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const v = values[j * nx + i] ?? 0;
      const o = ((ny - 1 - j) * nx + i) * 4;
      if (v === 0 || !Number.isFinite(v)) continue;
      const c = diff
        ? v < 0
          ? mix(SAME, FEWER, Math.min(1, -v / top))
          : mix(SAME, MORE, Math.min(1, v / top))
        : ramp(PEOPLE, v / top);
      pixels[o] = c[0];
      pixels[o + 1] = c[1];
      pixels[o + 2] = c[2];
      pixels[o + 3] = 200;
    }
  return { pixels, top };
}

/** Purpose: RGBA pixels as a PNG data URL, or null where there is no canvas (tests). */
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

/** Purpose: show a lattice view on the map, or remove it when `view` is null. Output: the scale's top. */
export function drawLattice(map: MapLibreMap, view: LatticeView | null, diff: boolean): number | null {
  if (!view) {
    removeLattice(map);
    return null;
  }
  const { pixels, top } = latticePixels(view, diff);
  const { x0, y0, dx, dy, nx, ny } = view.grid;
  const url = toDataUrl(pixels, nx, ny);
  if (!url) return top;
  const [w, s, e, n] = [x0, y0, x0 + nx * dx, y0 + ny * dy];
  const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
    [w, n],
    [e, n],
    [e, s],
    [w, s],
  ];
  const src = map.getSource(GRID_SOURCE) as ImageSource | undefined;
  if (src) src.updateImage({ url, coordinates });
  else {
    map.addSource(GRID_SOURCE, { type: "image", url, coordinates });
    map.addLayer({
      id: GRID_LAYER,
      type: "raster",
      source: GRID_SOURCE,
      paint: { "raster-opacity": 0.75, "raster-resampling": "nearest" },
    });
  }
  return top;
}

/** Purpose: remove the lattice picture. */
export function removeLattice(map: MapLibreMap): void {
  if (map.getLayer(GRID_LAYER)) map.removeLayer(GRID_LAYER);
  if (map.getSource(GRID_SOURCE)) map.removeSource(GRID_SOURCE);
}

/** Purpose: outline the project area (dashed), or remove the outline when `bbox` is null. */
export function drawArea(map: MapLibreMap, bbox: Bbox | null): void {
  if (!bbox) {
    if (map.getLayer(AREA_LINE)) map.removeLayer(AREA_LINE);
    if (map.getSource(AREA_SOURCE)) map.removeSource(AREA_SOURCE);
    return;
  }
  const [w, s, e, n] = bbox;
  const data = {
    type: "Feature" as const,
    properties: {},
    geometry: {
      type: "LineString" as const,
      coordinates: [
        [w, s],
        [e, s],
        [e, n],
        [w, n],
        [w, s],
      ],
    },
  };
  const src = map.getSource(AREA_SOURCE) as GeoJSONSource | undefined;
  if (src) src.setData(data);
  else {
    map.addSource(AREA_SOURCE, { type: "geojson", data });
    map.addLayer({
      id: AREA_LINE,
      type: "line",
      source: AREA_SOURCE,
      paint: { "line-color": "#4c1d95", "line-width": 2, "line-dasharray": [3, 2] },
    });
  }
}
