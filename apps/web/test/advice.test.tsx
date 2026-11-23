import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Finding, FindingsList, rankFindings } from "../src/features/advice/Findings";
import { capacityFindings, sectionAdvice } from "../src/features/capacity/advice";
import type { LineState } from "../src/features/capacity/CapacityResults";
import { crowdLinks, type StopPlaces } from "../src/features/capacity/crowdMap";
import { lineLoad, type LineLoad, type LoadLine } from "../src/features/capacity/loads";
import { topologyLocator } from "../src/features/capacity/place";
import type { BottleneckSection, Point } from "../src/features/capacity/types";
import { roadFindings } from "../src/features/road-sim/advice";
import type { RoadResult } from "../src/features/road-sim/types";
import { translate, type Translate } from "../src/i18n/i18n";

afterEach(cleanup);

const t: Translate = (key, vars) => translate("en", key, vars);
const H = 3600;

function point(over: Partial<Point> = {}): Point {
  return {
    headway_s: 300,
    per_hour: 12,
    unplaced: 0,
    trips: 60,
    consumption: 0.6,
    terminal: "Westpark",
    terminal_share: 0.5,
    bottleneck: "t4#1",
    bottleneck_share: 0.6,
    theoretical_per_hour: 20,
    limit_per_hour: 15,
    punctuality: 1,
    max_delay_s: 0,
    knock_on_s: 10,
    disturbed_punctuality: 0.98,
    residual_delay_s: 5,
    stable: true,
    problems: [],
    verdict: "works",
    ...over,
  };
}

function section(over: Partial<BottleneckSection> = {}): BottleneckSection {
  return {
    kind: "plain",
    length_m: 2000,
    track: "t4",
    from_m: 1000,
    to_m: 3000,
    speed_kmh: 80,
    block_m: 600,
    protection: "fixed_block",
    ...over,
  };
}

const line = (p: Point, sweep: Point[] = []): LineState => ({
  info: { id: "M1", name: "M1", bands: [] },
  planned: p,
  sweep,
  sweeping: false,
});

describe("findings", () => {
  it("are ranked problems first, then by weight", () => {
    const f = (key: string, severity: Finding["severity"], weight: number): Finding => ({
      key,
      severity,
      weight,
      title: key,
      advice: "",
    });
    expect(
      rankFindings([f("a", "warning", 9), f("b", "problem", 1), f("c", "problem", 5)]).map((x) => x.key),
    ).toEqual(["c", "b", "a"]);
  });

  it("show what to improve with a button to the place, or that nothing needs it", () => {
    const onShow = vi.fn();
    render(
      <FindingsList
        findings={[{ key: "x", severity: "problem", weight: 1, title: "T", advice: "A", at: [36.3, 33.5] }]}
        onShow={onShow}
      />,
    );
    const box = within(screen.getByRole("region", { name: "What to improve" }));
    fireEvent.click(box.getByRole("button", { name: "Show on the map" }));
    expect(onShow).toHaveBeenCalledWith([36.3, 33.5]);
    cleanup();
    render(<FindingsList findings={[]} />);
    expect(screen.getByText("Nothing to improve: this run found no bottleneck or problem.")).toBeTruthy();
  });
});

describe("system test advice", () => {
  it("names a terminal bottleneck over the limit and how to free it", () => {
    const p = point({ verdict: "over_limit", terminal_share: 0.9, consumption: 0.5 });
    const [f] = capacityFindings([line(p)], 0.75, {}, [], t);
    expect(f!.severity).toBe("problem");
    expect(f!.title).toBe(
      "M1: Westpark terminal is the bottleneck, in use 90 % of the busiest hour (limit 75 %)",
    );
    expect(f!.advice).toMatch(/Shorten the turnaround/);
  });

  it("gives no finding for a line that works with margin", () => {
    expect(capacityFindings([line(point())], 0.75, {}, [], t)).toEqual([]);
  });

  it("advises a block signal in the middle of a plain-line section two blocks long, on the map", () => {
    const locate = vi.fn(() => [36.31, 33.51] as [number, number]);
    const p = point({ verdict: "near_limit", consumption: 0.7, bottleneck_section: section() });
    const [f] = capacityFindings([line(p)], 0.75, {}, [], t, undefined, locate);
    expect(f!.severity).toBe("warning");
    expect(f!.title).toMatch(/track section t4#1 is the bottleneck/);
    expect(f!.advice).toContain("Add a block signal at about 2,000 m along track t4");
    expect(f!.advice).toContain("little room to add trains");
    expect(locate).toHaveBeenCalledWith("t4", 2000);
    expect(f!.at).toEqual([36.31, 33.51]);
  });

  it("does not advise a signal where the section is shorter than two blocks, or signals do not set the spacing", () => {
    const at = (s: BottleneckSection) => sectionAdvice(point({ bottleneck_section: s }), t, null).advice;
    expect(at(section({ length_m: 1000 }))).toMatch(/cab signalling/);
    expect(at(section({ protection: "cbtc" }))).toMatch(/Under cab signalling/);
    expect(at(section({ kind: "on_sight", protection: "line_of_sight" }))).toMatch(/Trams drive on sight/);
    expect(at(section({ kind: "platform" }))).toMatch(/platform track/);
    expect(at(section({ kind: "switches" }))).toMatch(/switch area/);
    expect(sectionAdvice(point(), t, null).advice).toMatch(/A higher speed through it/);
  });

  it("reports trips that do not fit, delays that pile up, and full vehicles with the frequency the track allows", () => {
    const planned = point({ unplaced: 3, verdict: "not_enough_capacity" });
    const late = point({ stable: false, residual_delay_s: 240, verdict: "delays_pile_up" });
    const load: LineLoad = {
      id: "M1",
      name: "M1",
      daily: 50000,
      busiest: {
        hour_s: 8 * H,
        from: "A",
        to: "B",
        riders: 3000,
        places: 2000,
        occupancy: 1.5,
        left_behind: 1000,
      },
      left_behind: 1500,
      missing: [],
    };
    const places: StopPlaces = {
      "rail:M1": new Map([
        ["A", [36, 33]],
        ["B", [36.02, 33.02]],
      ]),
    };
    const fs = capacityFindings(
      [line(planned), { ...line(late), info: { id: "M2", name: "M2", bands: [] } }],
      0.75,
      { "rail:M1": load },
      [],
      t,
      undefined,
      null,
      places,
    );
    const titles = rankFindings(fs).map((f) => f.title);
    expect(titles[0]).toBe("M1: trips that do not fit on the track: 3");
    expect(titles).toContain("M2: delays pile up and are still 4.0 min on average when the period ends");
    const full = fs.find((f) => f.key === "full:rail:M1")!;
    expect(full.title).toBe("M1: vehicles are 150 % full from A to B, 08:00–09:00");
    expect(full.advice).toMatch(/^1,500 people are left behind/);
    expect(full.at![0]).toBeCloseTo(36.01, 9);
    expect(full.at![1]).toBeCloseTo(33.01, 9);
    // With a sweep that found more trains work, the advice names that frequency.
    const swept = capacityFindings(
      [line(point(), [point({ headway_s: 180, per_hour: 20, verdict: "near_limit" })])],
      0.75,
      { "rail:M1": load },
      [],
      t,
    );
    expect(swept.find((f) => f.key === "full:rail:M1")!.advice).toMatch(/up to 20 trains an hour/);
  });
});

describe("crowding map", () => {
  it("keeps every link of the busiest hour and draws each stop pair once, the fuller way", () => {
    const l: LoadLine = {
      id: "M1",
      name: "M1",
      sequences: [
        ["A", "B", "C"],
        ["C", "B", "A"],
      ],
      loop: false,
      boardings: { A: 10000, B: 2000, C: 10000 },
      capacity: 100,
      perHour: () => 10,
    };
    const load = lineLoad(l, 8 * H, 9 * H, { peakHour: 0.1, peakDirection: 0.6 });
    expect(load.links).toHaveLength(4);
    const places: StopPlaces = {
      "rail:M1": new Map([
        ["A", [0, 0]],
        ["B", [1, 0]],
        ["C", [2, 0]],
      ]),
    };
    const links = crowdLinks({ "rail:M1": load }, places);
    expect(links).toHaveLength(2);
    const ab = load.links!.filter((x) => [x.from, x.to].sort().join() === "A,B");
    expect(links.find((x) => x.to[0] + x.from[0] === 1)!.occupancy).toBe(
      Math.max(...ab.map((x) => x.occupancy)),
    );
  });

  it("places a chainage of a topology section on the map", () => {
    const text = JSON.stringify({
      origin: [36.3, 33.5],
      sections: [
        {
          id: "t4",
          length_m: 200,
          geometry: [
            [0, 0],
            [100, 0],
            [100, 100],
          ],
        },
      ],
    });
    const at = topologyLocator(text)!;
    const [lon0, lat0] = at("t4", 0)!;
    const [lon, lat] = at("t4", 150)!;
    expect(lon0).toBeCloseTo(36.3, 6);
    expect(lat0).toBeCloseTo(33.5, 6);
    // 150 m along: at the corner, then 50 m north.
    expect((lon - 36.3) * 111320 * Math.cos((33.5 * Math.PI) / 180)).toBeCloseTo(100, 0);
    expect((lat - 33.5) * 110950).toBeCloseTo(50, -1);
    expect(at("other", 10)).toBeNull();
    expect(topologyLocator("not json")).toBeNull();
  });
});

describe("road run advice", () => {
  const result = (over: Partial<RoadResult> = {}): RoadResult =>
    ({
      notes: [],
      lines: [
        {
          index: 0,
          name: "Bus 1",
          mode: "bus",
          color: "#000",
          energy: "battery",
          problem: null,
          notes: [],
          vehicles: 3,
          cycle_s: 2000,
          circuit_m: 9000,
          trips: 10,
          trips_run: 10,
          planned_run_s: 1800,
          run_cycle_s: 1800,
          punctuality: 0.95,
          bunched_share: 0.3,
          lost_traffic_s: 200,
          lost_signals_s: 60,
          energy_use: {
            kwh: 100,
            km: 80,
            kwh_per_km: 1.25,
            battery_kwh: 350,
            min_charge_share: 0,
            ran_out: 2,
          },
        },
      ],
      events: [{ kind: "not_back", t: 10 * H, vehicle: "L0v1", line: 0, lonlat: null }],
      hotspots: [
        { kind: "street", name: "Baghdad Street", lonlat: [36.3, 33.51], lost_s: 900, lines: [0] },
        { kind: "signal", name: "", lonlat: [36.31, 33.51], lost_s: 300, lines: [0] },
      ],
      network: null,
      traffic: null,
      run: null,
      ...over,
    }) as RoadResult;

  it("flags bunching, running out of charge, vehicles not back and the places where time is lost", () => {
    const fs = rankFindings(roadFindings(result(), undefined, t));
    expect(fs.map((f) => f.title)).toEqual([
      "Bus 1: vehicles that ran out of charge: 2",
      "Bus 1: vehicles not back in the depot by the end: 1",
      "Bus 1: 30 % of departures come bunched",
      "Traffic on Baghdad Street: 15 min lost in all (Bus 1)",
      "Red light on a street without a name: 5.0 min lost in all (Bus 1)",
    ]);
    expect(fs[3]!.advice).toMatch(/lane of their own on this street/);
    expect(fs[3]!.at).toEqual([36.3, 33.51]);
  });

  it("uses the project's own on-time threshold", () => {
    const strict = roadFindings(result(), { "road.advice_on_time_share": 0.98 }, t);
    const late = strict.find((f) => f.key === "late:0")!;
    expect(late.title).toBe("Bus 1: only 95 % of departures on time (advice below 98 %)");
    expect(late.advice).toMatch(/most of it on the streets listed here/);
  });

  it("works for runs saved before the places were recorded", () => {
    expect(
      roadFindings(result({ hotspots: undefined }), undefined, t).some((f) => f.key.startsWith("spot")),
    ).toBe(false);
  });
});
