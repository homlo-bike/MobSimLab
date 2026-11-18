import { describe, expect, it } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import { svgText } from "../src/features/schematic/export";
import { DEFAULT_BASEMAP, themedBasemap } from "../src/map/basemaps";
import { applyMapTheme } from "../src/map/darkLayers";
import { markBasemap } from "../src/map/mapLayers";

type Layer = { id: string; paint: Record<string, unknown> };

/** A map stand-in with paint properties that can be read and set; `base` are the basemap's layers. */
function fakeMap(layers: Layer[], base: Layer[] = []) {
  layers.unshift(...base);
  const map = {
    getStyle: () => ({ layers: layers.map((l) => ({ id: l.id, type: "line", paint: { ...l.paint } })) }),
    getPaintProperty: (id: string, prop: string) => layers.find((l) => l.id === id)!.paint[prop],
    setPaintProperty: (id: string, prop: string, v: unknown) => {
      layers.find((l) => l.id === id)!.paint[prop] = v;
    },
  } as unknown as MapLibreMap;
  const own = layers.splice(base.length);
  markBasemap(map);
  layers.push(...own);
  return map;
}

describe("dark mode", () => {
  it("draws the default basemap's dark design in dark mode, and leaves other basemaps as they are", () => {
    expect(themedBasemap(DEFAULT_BASEMAP, true).styleUrl).toBe("https://tiles.openfreemap.org/styles/dark");
    expect(themedBasemap(DEFAULT_BASEMAP, false).styleUrl).toBe(DEFAULT_BASEMAP.styleUrl);
    const liberty = { ...DEFAULT_BASEMAP, id: "liberty", darkStyleUrl: undefined };
    expect(themedBasemap(liberty, true)).toBe(liberty);
  });

  it("turns the project's white casings and dark ink round on a dark basemap, and back", () => {
    const layers: Layer[] = [
      { id: "sl-casing", paint: { "line-color": "#ffffff", "line-width": 6 } },
      { id: "sl-line", paint: { "line-color": ["case", ["get", "x"], "#1d4ed8", "#0f172a"] } },
      { id: "rd-z0-rails", paint: { "line-color": "#2c3034" } },
    ];
    const road = { id: "road", paint: { "line-color": "#ffffff" } };
    const map = fakeMap(layers, [road]);
    applyMapTheme(map, true);
    const [, casing, line, rails] = layers;
    expect(casing!.paint["line-color"]).toBe("#0f172a");
    expect(line!.paint["line-color"]).toEqual(["case", ["get", "x"], "#1d4ed8", "#f1f5f9"]);
    // Rails on ballast and the basemap's own layers keep their colours.
    expect(rails!.paint["line-color"]).toBe("#2c3034");
    expect(road.paint["line-color"]).toBe("#ffffff");
    applyMapTheme(map, false);
    expect(casing!.paint["line-color"]).toBe("#ffffff");
    expect(line!.paint["line-color"]).toEqual(["case", ["get", "x"], "#1d4ed8", "#0f172a"]);
  });

  it("takes a colour a tool sets later as its own", () => {
    const layers: Layer[] = [{ id: "kit-lines", paint: { "line-color": "#ffffff" } }];
    const map = fakeMap(layers);
    applyMapTheme(map, true);
    map.setPaintProperty("kit-lines", "line-color", "#475569");
    applyMapTheme(map, true);
    expect(layers[0]!.paint["line-color"]).toBe("#94a3b8");
    applyMapTheme(map, false);
    expect(layers[0]!.paint["line-color"]).toBe("#475569");
  });

  it("exports schematics in their light colours", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.innerHTML =
      '<rect fill="var(--diagram-paper, #ffffff)"/><text fill="var(--diagram-ink, #1e293b)">A</text><path stroke="#dc2626"/>';
    const text = svgText(svg);
    expect(text).toContain('fill="#ffffff"');
    expect(text).toContain('fill="#1e293b"');
    expect(text).toContain('stroke="#dc2626"');
    expect(text).not.toContain("var(");
  });
});
