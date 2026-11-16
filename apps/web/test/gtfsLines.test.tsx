import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as railWasm from "../src/wasm/rail-design/rail_design_wasm.js";
import { GtfsSection } from "../src/features/gtfs/GtfsSection";
import {
  addTerminalCrossovers,
  convertibleRoutes,
  feedTimetable,
  headways,
  kindOf,
  mainPattern,
  toRailLine,
  toStreetLine,
} from "../src/features/gtfs/toLines";
import type { GtfsFeed } from "../src/features/gtfs/types";
import { JourneyPlanner } from "../src/features/journey-planner/JourneyPlanner";
import type { PlannerEngine, PlannerLoader, Timetable } from "../src/features/journey-planner/types";
import { loadRailEngine } from "../src/features/railways/engine";
import { lineProblem } from "../src/features/railways/serviceLines";
import type { RoutingRules, VehicleProfile } from "../src/features/street-lines/types";

afterEach(cleanup);

beforeAll(async () => {
  // Built by tools/wasm/build-rail-design.sh; load its bytes from disk.
  const file = resolve(__dirname, "../src/wasm/rail-design/rail_design_wasm_bg.wasm");
  await railWasm.default({ module_or_path: readFileSync(file) });
});

const at = (h: number, m = 0) => h * 3600 + m * 60;

/** Bus 7 every 10 min 7–9 and every 20 min after; a short-working on another sequence; tram T1 by pattern. */
function timetable(): Timetable {
  const trips: Timetable["trips"] = [];
  let n = 0;
  const bus = (dep: number, stops = ["q", "m", "s"]) =>
    trips.push({
      trip_id: `b${n++}`,
      route_id: "7",
      stop_times: stops.map((stop_id, i) => ({
        stop_id,
        stop_sequence: i + 1,
        arrival_time: dep + i * 240,
        departure_time: dep + i * 240 + (i > 0 && i < stops.length - 1 ? 20 : 0),
      })),
    });
  for (let t = at(7); t < at(9); t += 600) bus(t);
  for (let t = at(9); t <= at(18); t += 1200) bus(t);
  bus(at(12, 5), ["q", "m"]);
  return {
    stops: [
      { stop_id: "q", stop_name: "Quay", stop_lat: 50, stop_lon: 10 },
      { stop_id: "m", stop_name: "Market", stop_lat: 50.004, stop_lon: 10.006 },
      { stop_id: "s", stop_name: "Station", stop_lat: 50.008, stop_lon: 10.012 },
      { stop_id: "t1", stop_name: "West", stop_lat: 50, stop_lon: 10.02 },
      { stop_id: "t2", stop_name: "Centre", stop_lat: 50, stop_lon: 10.035 },
      { stop_id: "t3", stop_name: "East", stop_lat: 50, stop_lon: 10.05 },
    ],
    routes: [
      { route_id: "7", route_short_name: "7", mode: "bus" },
      { route_id: "T1", route_short_name: "T1", mode: "tram", route_color: "C0392B" },
      { route_id: "F", route_short_name: "F", mode: "ferry" },
    ],
    trips,
    transfers: [],
    frequency_patterns: [
      {
        pattern_id: "p1",
        route_id: "T1",
        stops: [
          { stop_id: "t1", run_time: 0, dwell_time: 0 },
          { stop_id: "t2", run_time: 120, dwell_time: 25 },
          { stop_id: "t3", run_time: 120, dwell_time: 0 },
        ],
        periods: [
          { start_time: at(6), end_time: at(9), headway_secs: 300, kind: "peak" },
          { start_time: at(9), end_time: at(23), headway_secs: 600, kind: "off_peak" },
        ],
      },
    ],
  };
}

const feed = (over: Partial<GtfsFeed> = {}): GtfsFeed => ({
  id: "f1",
  name: "harbour.zip",
  importedAt: "2026-11-15T00:00:00Z",
  summary: {
    agencies: ["Harbour"],
    date: "20261118",
    routes: 3,
    stops: 6,
    trips: 0,
    patterns: 1,
    outside: 0,
    warnings: [],
  },
  timetable: timetable(),
  ...over,
});

const PROFILE = { mode: "bus" } as VehicleProfile;
const RULES = { traffic_side: "right" } as RoutingRules;

describe("imported routes as lines", () => {
  it("finds each route's busiest stop sequence and its headways", () => {
    const p = mainPattern(timetable(), "7")!;
    expect(p.stops.map((s) => s.stop_id)).toEqual(["q", "m", "s"]);
    expect(p.departures[0]).toBe(at(7));
    expect(p.dwellS).toBe(20);
    expect(headways(p.departures)).toEqual({
      peakMin: 10,
      offPeakMin: 20,
      firstMin: 7 * 60,
      lastMin: 18 * 60,
    });
    const tram = mainPattern(timetable(), "T1")!;
    expect(tram.stops.map((s) => s.stop_name)).toEqual(["West", "Centre", "East"]);
    expect(headways(tram.departures).peakMin).toBe(5);
    expect(mainPattern(timetable(), "nope")).toBeNull();
    expect([kindOf("trolleybus"), kindOf("metro"), kindOf("ferry")]).toEqual(["street", "rail", null]);
  });

  it("lists the routes that can become lines, busiest first, without the ones already turned", () => {
    expect(convertibleRoutes(feed()).map((r) => [r.route.route_id, r.kind])).toEqual([
      ["T1", "rail"],
      ["7", "street"],
    ]);
    const done = feed({ converted: ["T1"] });
    expect(convertibleRoutes(done).map((r) => r.route.route_id)).toEqual(["7"]);
    const left = feedTimetable(done);
    expect(left.routes.map((r) => r.route_id)).toEqual(["7", "F"]);
    expect(left.frequency_patterns).toEqual([]);
    const plain = feed();
    expect(feedTimetable(plain)).toBe(plain.timetable);
  });

  it("makes a bus route a street line with its stops, names and headway, to route in the tool", () => {
    const line = toStreetLine(mainPattern(timetable(), "7")!, PROFILE, RULES);
    expect(line.name).toBe("7");
    expect(line.points.map((p) => [p.kind, p.name])).toEqual([
      ["end_stop", "Quay"],
      ["stop", "Market"],
      ["end_stop", "Station"],
    ]);
    expect(line.points[1]!.lonlat).toEqual([10.006, 50.004]);
    expect(line.timing).toEqual({
      headwayMin: 10,
      offPeakHeadwayMin: 20,
      dwellS: 20,
      layoverMin: 5,
      firstMin: 7 * 60,
      lastMin: 18 * 60,
    });
    expect(line.view.points).toEqual([]);
  });

  it("makes a tram route a service line on new stations and tracks the railway engine builds", async () => {
    const engine = await loadRailEngine();
    const p = mainPattern(timetable(), "T1")!;
    const platformLengthM = Number(engine.defaultParams("tram").platform_length_m);
    const [made, id] = toRailLine(null, p, "tram", engine.toLocal, { platformLengthM });
    const doc = addTerminalCrossovers(made, id, (d) => engine.build(d, null));
    expect(doc.switches.map((s) => s.kind)).toEqual(["crossover", "crossover"]);
    expect(doc.mode).toBe("tram");
    expect(doc.stations.map((s) => s.name)).toEqual(["West", "Centre", "East"]);
    // The stations face along the route (west to east).
    expect(doc.stations.map((s) => Math.round(s.rotation_deg))).toEqual([0, 0, 0]);
    expect(doc.tracks).toHaveLength(2);
    const line = doc.lines!.find((l) => l.id === id)!;
    expect(line).toMatchObject({
      name: "T1",
      color: "#c0392b",
      first_min: 6 * 60,
      peak_headway_min: 5,
      offpeak_headway_min: 10,
      dwell_s: 25,
    });
    expect(line.stations).toEqual(doc.stations.map((s) => s.id));
    expect(lineProblem(doc, line)).toBeNull();
    const view = engine.build(doc, null);
    expect(view.issues.filter((i) => i.severity === "error")).toEqual([]);
    // A second route through the same stations uses them and their tracks again.
    const [again] = toRailLine(doc, p, "tram", engine.toLocal, { platformLengthM });
    expect(again.stations).toHaveLength(3);
    expect(again.tracks).toHaveLength(2);
    expect(again.lines).toHaveLength(2);
    engine.dispose();
  });

  it("offers each route in the journey planner's GTFS section", () => {
    const onEdit = vi.fn();
    render(
      <GtfsSection
        map={null}
        feeds={[feed()]}
        skipped={new Set()}
        onToggle={() => {}}
        onChange={() => {}}
        ownLines={null}
        projectName="Harbour"
        onEditRoute={onEdit}
      />,
    );
    fireEvent.click(screen.getByText("Edit imported routes as lines (2)"));
    expect(screen.getByText(/^T1 · railway · \d+ departures$/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Edit as a line" })[1]!);
    expect(onEdit).toHaveBeenCalledWith("f1", "7");
  });
});

describe("the journey planner after a route became a line", () => {
  it("leaves the route out of the feed and offers the others", async () => {
    const calls: Timetable[] = [];
    const loader: PlannerLoader = async (tt) => {
      calls.push(tt);
      return {
        summary: () => ({ stops: 0, routes: tt.routes.length, trips: 0, warnings: [] }),
        plan: () => ({ journeys: [] }),
        profile: () => [],
        dispose: () => {},
      } as unknown as PlannerEngine;
    };
    const onEdit = vi.fn();
    render(
      <JourneyPlanner
        map={null}
        loadPlanner={loader}
        gtfsFeeds={[feed({ converted: ["T1"] })]}
        onGtfsFeeds={() => {}}
        onEditGtfsRoute={onEdit}
      />,
    );
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls.at(-1)!.routes.map((r) => r.route_id)).toEqual(["gtfs:f1:7", "gtfs:f1:F"]);
    fireEvent.click(screen.getByText("Edit imported routes as lines (1)"));
    expect(screen.getByText("Routes now edited as lines: 1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit as a line" }));
    expect(onEdit).toHaveBeenCalledWith("f1", "7");
  });
});
