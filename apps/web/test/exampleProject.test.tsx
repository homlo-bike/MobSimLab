import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { exampleBusLine, exampleTram, createExampleProject } from "../src/projects/example";
import type { ProjectsApi } from "../src/projects/api";
import { HelpMenu } from "../src/shell/HelpMenu";
import * as rail from "../src/wasm/rail-design/rail_design_wasm.js";

afterEach(cleanup);

beforeAll(async () => {
  // Built by tools/wasm/build-rail-design.sh; load its bytes from disk.
  await rail.default({
    module_or_path: readFileSync(resolve(__dirname, "../src/wasm/rail-design/rail_design_wasm_bg.wasm")),
  });
});

describe("example project", () => {
  it("has a tram the railway engine builds without errors, with four stops on Bahnhofstrasse", () => {
    const doc = exampleTram();
    const d = new rail.RailDesigner();
    const view = JSON.parse(d.build(JSON.stringify(doc), 0)) as {
      issues: { severity: string; text: string }[];
      stations: { lonlat: [number, number] }[];
    };
    expect(view.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(doc.stations.map((s) => s.name)).toEqual([
      "Bahnhofplatz/HB",
      "Rennweg",
      "Paradeplatz",
      "Bürkliplatz",
    ]);
    // Bahnhofplatz, in Zurich.
    const [lon, lat] = view.stations[0]!.lonlat;
    expect(lon).toBeCloseTo(8.5397, 3);
    expect(lat).toBeCloseTo(47.3767, 3);
  });

  it("has a bus line with end stops at both ends", () => {
    const line = exampleBusLine().lines[0]!;
    expect(line.points.map((p) => p.kind)).toEqual(["end_stop", "stop", "stop", "end_stop"]);
    expect(line.profile.mode).toBe("bus");
  });

  it("is made as a new project with its bus line and tram saved", async () => {
    const create = vi.fn(async () => ({ id: "p1" }));
    const saveDrawing = vi.fn(async () => ({}));
    const p = await createExampleProject({ create, saveDrawing } as unknown as ProjectsApi);
    expect(p.id).toBe("p1");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ modes: ["bus", "tram"], areaName: "Zürich" }),
    );
    expect(saveDrawing.mock.calls.map((c) => (c as unknown[])[1])).toEqual(["street-lines", "railway"]);
  });

  it("opens from the Help menu, and says so when it cannot be made", async () => {
    const onExample = vi
      .fn()
      .mockRejectedValueOnce(new Error("no connection"))
      .mockResolvedValueOnce(undefined);
    render(<HelpMenu onTour={() => {}} onExample={onExample} />);
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Open the example project/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("no connection");
    fireEvent.click(screen.getByRole("menuitem", { name: /Open the example project/ }));
    await waitFor(() => expect(screen.queryByRole("menuitem")).toBeNull());
    expect(onExample).toHaveBeenCalledTimes(2);
  });

  it("is not offered to those who may not create projects", () => {
    render(<HelpMenu onTour={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    expect(screen.queryByRole("menuitem", { name: /example/ })).toBeNull();
  });
});
