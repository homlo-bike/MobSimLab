import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("maplibre-gl", () => {
  class Map {
    addControl() {}
    remove() {}
  }
  class Control {}
  return { Map, AttributionControl: Control, NavigationControl: Control, ScaleControl: Control };
});

import { App } from "../src/App";
import { DEFAULT_BASEMAP } from "../src/map/basemaps";

describe("App shell", () => {
  it("renders the menu and the map container", () => {
    render(<App />);
    expect(screen.getByText("MobSimLab")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Main menu" })).toBeTruthy();
    expect(screen.getByTestId("map")).toBeTruthy();
  });

  it("credits OpenStreetMap on the default basemap", () => {
    expect(DEFAULT_BASEMAP.attribution).toContain("OpenStreetMap contributors");
  });
});
