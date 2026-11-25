import { renderHook, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import * as wasm from "../src/wasm/rail-design/rail_design_wasm.js";
import { buildDrawnNetwork } from "../src/features/capacity/drawn";
import { designSources } from "../src/features/noise/inputs";
import { loadRailEngine } from "../src/features/railways/engine";
import { addLine, engineLines } from "../src/features/railways/serviceLines";
import { buildWithTerrain, type HeightsFetcher } from "../src/features/railways/terrainTiles";
import type { Network } from "../src/features/railways/types";
import { buildRailway, useRailBuild } from "../src/features/tables/railBuild";
import { projectFeed } from "../src/features/timetables/feed";
import { useRailPublications } from "../src/features/timetables/railPublish";
import { calendarFrom } from "../src/workspace/calendar";

beforeAll(async () => {
  // The engine module is built by tools/wasm/build-rail-design.sh; load its bytes from disk.
  const file = resolve(__dirname, "../src/wasm/rail-design/rail_design_wasm_bg.wasm");
  await wasm.default({ module_or_path: readFileSync(file) });
});

const ORIGIN: [number, number] = [7, 50.9];
/** The engine's metro sample with one service line between its end stations. */
const metro = (): Network =>
  addLine(JSON.parse(wasm.RailDesigner.sample("metro", ORIGIN[0], ORIGIN[1])) as Network, 115)[0];
/** Ground rising 10 % to the east (1° of longitude is about 70 km at 50.9° N): too steep for the metro. */
const steep: HeightsFetcher = async (pts) => pts.map(([lon]) => 100 + 0.1 * (lon - ORIGIN[0]) * 70_200);
const offline: HeightsFetcher = () => Promise.reject(new Error("offline"));
const REFUSED =
  "Ground heights did not load: offline. Without them the trains would run as if the line were flat, so no service was planned.";

describe("building a railway with its terrain heights", () => {
  it("loads every tile before trains are planned, so they stall where the ground is too steep", async () => {
    const net = metro();
    const flat = await loadRailEngine();
    flat.build(net, null);
    expect(flat.publishLines(engineLines(net), "weekday").lines[0]!.trips).toBeGreaterThan(50);
    flat.dispose();

    const e = await loadRailEngine();
    const heights = vi.fn(steep);
    await buildWithTerrain(e, net, heights);
    expect(heights).toHaveBeenCalled();
    expect(e.missingTerrainTiles!()).toEqual([]);
    const [line] = e.publishLines(engineLines(net), "weekday").lines;
    expect(line!.trips).toBe(0);
    expect(line!.issues.join(" ")).toMatch(/stalls on a gradient too steep/);
    e.dispose();
  });

  it("names the stall in the capacity run and on the noise map", async () => {
    const net = metro();
    const drawn = await buildDrawnNetwork(net, loadRailEngine, steep);
    if (typeof drawn === "string") throw new Error(drawn);
    expect(drawn.cannotRun).toHaveLength(1);
    expect(drawn.cannotRun[0]).toMatch(/^M1 has no trains: .*stalls on a gradient too steep/);
    const noise = await designSources(
      { streetLines: null, railway: net },
      "timetabled",
      loadRailEngine,
      null,
      steep,
    );
    expect(noise.lines).toEqual([]);
    expect(noise.notes).toEqual(drawn.cannotRun);
  });

  it("refuses, with the reason, when the heights do not load", async () => {
    const e = await loadRailEngine();
    await expect(buildWithTerrain(e, metro(), offline)).rejects.toThrow(REFUSED);
    e.dispose();
  });

  it("is how the scenarios, capacity run, noise map and GTFS feed plan the railway", async () => {
    const net = metro();
    const built = await buildRailway(net, loadRailEngine, steep);
    expect(Object.values(built.reports)[0]!.trips).toBe(0);
    await expect(buildRailway(net, loadRailEngine, offline)).rejects.toThrow(REFUSED);
    await expect(buildDrawnNetwork(net, loadRailEngine, offline)).rejects.toThrow(REFUSED);
    await expect(
      designSources({ streetLines: null, railway: net }, "timetabled", loadRailEngine, null, offline),
    ).rejects.toThrow(REFUSED);
    await expect(
      projectFeed({
        railway: net,
        streetLines: [],
        cal: calendarFrom(null),
        loadRail: loadRailEngine,
        fetchHeights: offline,
      }),
    ).rejects.toThrow(REFUSED);
  });

  it("gives the Timetables tab no trips and the reason when the heights do not load", async () => {
    const cal = calendarFrom(null);
    const { result } = renderHook(() => useRailPublications(metro(), cal, {}, null, loadRailEngine, offline));
    await waitFor(() => expect(result.current.error).toContain(REFUSED));
    expect(result.current.publications).toEqual({});
  });

  it("gives the network tables no service and the reason when the heights do not load", async () => {
    const net = metro();
    const { result } = renderHook(() => useRailBuild(net, loadRailEngine, offline));
    await waitFor(() => expect(result.current.build?.terrain).toBe("failed"));
    expect(result.current.build!.terrainError).toBe("offline");
    expect(result.current.build!.reports).toEqual({});
    expect(result.current.build!.timetable).toBeUndefined();
  });
});
