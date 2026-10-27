import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

vi.mock("maplibre-gl", () => {
  class Map {
    addControl() {}
    on() {}
    remove() {}
  }
  class Control {}
  return {
    Map,
    AttributionControl: Control,
    NavigationControl: Control,
    ScaleControl: Control,
    setWorkerUrl: () => {},
  };
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

  it("opens the street line tool from the toolbar", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Street line" }));
    expect(screen.getByRole("complementary", { name: "Street line editor" })).toBeTruthy();
  });

  it("credits OpenStreetMap on the default basemap", () => {
    expect(DEFAULT_BASEMAP.attribution).toContain("OpenStreetMap contributors");
  });
});
