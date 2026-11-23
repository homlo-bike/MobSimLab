import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// MapLibre throws this when the computer or browser has no WebGL2 (Damascus bug 24).
vi.mock("maplibre-gl", () => {
  class Map {
    constructor() {
      throw new Error("WebGL2 is required to display this map");
    }
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

import { MapView } from "../src/map/MapView";

afterEach(cleanup);

describe("a map without WebGL2", () => {
  it("shows a message in place of the map instead of a blank page", () => {
    const onReady = vi.fn();
    render(
      <div>
        <p>Side panel</p>
        <MapView onReady={onReady} />
      </div>,
    );
    expect(screen.getByRole("alert").textContent).toContain("no 3D graphics (WebGL2)");
    expect(screen.getByText("Side panel")).toBeTruthy();
    expect(onReady).not.toHaveBeenCalledWith(expect.anything());
  });
});
