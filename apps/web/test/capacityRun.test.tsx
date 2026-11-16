import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CapacityRun, explain, practicalMaximum } from "../src/features/capacity/CapacityRun";
import { buildDrawnNetwork } from "../src/features/capacity/drawn";
import type { CapacityEngine, CapacityRun as Run, EngineLoader, Point } from "../src/features/capacity/types";
import type { Network, RailEngine, RailView } from "../src/features/railways/types";

afterEach(cleanup);

const H = 3600;

function point(over: Partial<Point> = {}): Point {
  return {
    headway_s: 300,
    per_hour: 12,
    unplaced: 0,
    consumption: 0.72,
    terminal: "Westpark",
    terminal_share: 0.85,
    bottleneck: "wp1#0",
    bottleneck_share: 0.85,
    theoretical_per_hour: 14.1,
    limit_per_hour: 12,
    punctuality: 1,
    max_delay_s: 0,
    knock_on_s: 4,
    disturbed_punctuality: 0.98,
    residual_delay_s: 0,
    stable: true,
    problems: [],
    verdict: "near_limit",
    ...over,
  };
}

function run(p: Point): Run {
  return {
    params: {
      from_s: 7 * H,
      to_s: 9 * H,
      warmup_s: 1800,
      recovery_s: 1800,
      min_buffer_s: 20,
      occupancy_limit_share: 0.85,
      spare_share: 0.15,
      late_threshold_s: 120,
      stability_runs: 8,
      delayed_share: 0.2,
      primary_delay_mean_s: 45,
      primary_delay_max_s: 180,
      residual_delay_s: 30,
      seed: 1,
    },
    verdict: p.verdict,
    lines: [{ line: "M1", name: "M1", planned: p }],
    fleet: { trips: 66, vehicles: 4, peak_out: 4, reserve: 1, routes_locked: 602 },
    issues: [],
  };
}

function fakeLoader(): { loader: EngineLoader; engine: CapacityEngine } {
  const engine: CapacityEngine = {
    lines: vi.fn(async () => [
      { id: "M1", name: "M1", bands: [{ from_s: 6.5 * H, to_s: 9 * H, headway_s: 300 }] },
    ]),
    notes: vi.fn(async () => []),
    run: vi.fn(async () => run(point())),
    sweepHeadways: vi.fn(async () => [240, 180]),
    sweepPoint: vi.fn(async (_p, _l, h: number) =>
      point({ headway_s: h, per_hour: 3600 / h, unplaced: 1, verdict: "not_enough_capacity" }),
    ),
    dispose: vi.fn(),
  };
  return { loader: vi.fn(async () => engine), engine };
}

describe("capacity run helpers", () => {
  it("takes the highest frequency that works as the practical maximum", () => {
    expect(
      practicalMaximum([
        point(),
        point({ per_hour: 15, verdict: "not_enough_capacity" }),
        point({ per_hour: 10, verdict: "works" }),
      ]),
    ).toBe(12);
    expect(practicalMaximum([point({ verdict: "delays_pile_up" })])).toBeNull();
  });

  it("explains a verdict in a sentence", () => {
    expect(explain(point(), 0.85)).toContain("Westpark terminal platforms, in use 85 %");
    expect(explain(point({ unplaced: 2 }), 0.85)).toBe("2 trips could not be given a conflict-free path.");
    expect(explain(point({ stable: false, residual_delay_s: 75 }), 0.85)).toContain("75 s late on average");
  });
});

const METRO_TRAIN = "alstom_metropolis-amsterdam-m5-6-car";

/** A two-station metro drawn in the railway tool, with line M1 (and M2, which has one stop only). */
function drawn(): Network {
  const station = (id: number, x: number) => ({
    id,
    name: `S${id}`,
    x,
    y: 0,
    rotation_deg: 0,
    level: "street" as const,
    side_platforms: 2,
    island_platforms: 0,
    platform_length_m: 120,
  });
  const line = (id: string, stations: number[]) => ({
    id,
    name: id,
    color: "#0055aa",
    stations,
    vehicle: METRO_TRAIN,
    units: 1,
    first_min: 300,
    last_min: 1440,
    peak_headway_min: 5,
    offpeak_headway_min: 10,
  });
  return {
    origin: [4.9, 52.37],
    mode: "metro",
    stations: [station(1, 0), station(2, 2000)],
    tracks: [
      {
        id: 10,
        name: "Main",
        start: { type: "station", station: 1, end: 1, tracks: [0, 1] },
        end: { type: "station", station: 2, end: 0, tracks: [0, 1] },
        points: [],
        tracks: 2,
        level: "street",
        power: "auto",
        use: "running",
        bed: "auto",
        lead_start_m: 30,
        lead_end_m: 30,
      },
    ],
    switches: [],
    lines: [line("M1", [1, 2]), line("M2", [1])],
  } as Network;
}

function fakeRail(errors = 0): { loadRail: () => Promise<RailEngine>; engine: RailEngine } {
  const view = { counts: { errors, warnings: 0, track_km: 2, route_km: 2 } } as RailView;
  const engine = {
    build: vi.fn(() => view),
    topology: vi.fn(() => ({ version: 1, parts: [] })),
    dispose: vi.fn(),
  } as unknown as RailEngine;
  return { loadRail: vi.fn(async () => engine), engine };
}

describe("drawn railway for the test", () => {
  it("gives the topology and the service lines ready to publish", async () => {
    const { loadRail, engine } = fakeRail();
    const net = await buildDrawnNetwork(drawn(), loadRail);
    if (typeof net === "string") throw new Error(net);
    expect(JSON.parse(net.topology)).toEqual({ version: 1, parts: [] });
    const lines = JSON.parse(net.lines).service_lines;
    expect(lines.map((l: { id: string }) => l.id)).toEqual(["M1"]);
    expect(lines[0].stations).toEqual(["st1", "st2"]);
    expect(lines[0].peak_headway_s).toBe(300);
    expect(engine.dispose).toHaveBeenCalled();
  });

  it("says what is missing", async () => {
    expect(await buildDrawnNetwork(null)).toBe("noTrack");
    expect(await buildDrawnNetwork({ ...drawn(), lines: [] })).toBe("noLines");
    expect(await buildDrawnNetwork(drawn(), fakeRail(2).loadRail)).toBe("errors");
  });
});

describe("capacity run panel", () => {
  it("tests the railway drawn in the project by default", async () => {
    const { loader, engine } = fakeLoader();
    const buildDrawn = vi.fn(async () => ({ topology: "{}", lines: '{"service_lines":[]}' }));
    render(<CapacityRun loadEngine={loader} railway={drawn()} buildDrawn={buildDrawn} />);
    expect(screen.getByRole("radio", { name: "Drawn in this project" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.getByText(/Lines M1 on the railway drawn/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Run the test" }));
    await screen.findByTestId("capacity-result");
    expect(loader).toHaveBeenCalledWith({ kind: "files", topology: "{}", lines: '{"service_lines":[]}' });
    expect(engine.run).toHaveBeenCalled();
    // The same drawing is not built again.
    fireEvent.click(screen.getByRole("button", { name: "Run again" }));
    await waitFor(() => expect(engine.run).toHaveBeenCalledTimes(2));
    expect(buildDrawn).toHaveBeenCalledTimes(1);
  });

  it("explains why the drawn railway cannot be tested", async () => {
    const { loader } = fakeLoader();
    render(<CapacityRun loadEngine={loader} railway={{ ...drawn(), lines: [] }} />);
    expect(screen.getByRole("radio", { name: "Example metro" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Drawn in this project" }));
    expect(screen.getByText(/No service line is ready to test/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Run the test" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("reports errors in the drawn railway", async () => {
    const { loader } = fakeLoader();
    render(<CapacityRun loadEngine={loader} railway={drawn()} buildDrawn={async () => "errors"} />);
    fireEvent.click(screen.getByRole("button", { name: "Run the test" }));
    expect((await screen.findByRole("alert")).textContent).toContain("The drawn railway has errors");
    expect(loader).not.toHaveBeenCalled();
  });

  it("runs the example metro in the morning peak and sweeps other frequencies", async () => {
    const { loader, engine } = fakeLoader();
    render(<CapacityRun loadEngine={loader} />);
    fireEvent.click(screen.getByRole("button", { name: "Run the test" }));
    const result = await screen.findByTestId("capacity-result");
    expect(loader).toHaveBeenCalledWith({ kind: "example" });
    expect(engine.run).toHaveBeenCalledWith({ from_s: 7 * H, to_s: 9 * H });
    expect(within(result).getAllByText("Works, close to the limit").length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByText("Works up to 12 trains an hour each way")).toBeTruthy());
    expect(engine.sweepPoint).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText("1 trip does not fit").length).toBe(2);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("asks for both files before running a railway of one's own", () => {
    const { loader } = fakeLoader();
    render(<CapacityRun loadEngine={loader} />);
    fireEvent.click(screen.getByRole("radio", { name: "From files" }));
    expect((screen.getByRole("button", { name: "Run the test" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Choose both files to run your railway.")).toBeTruthy();
  });

  it("runs another period and refuses an end before the start", async () => {
    const { loader, engine } = fakeLoader();
    render(<CapacityRun loadEngine={loader} />);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("radio", { name: /Midday/ }));
    fireEvent.click(screen.getByRole("button", { name: "Run the test" }));
    await screen.findByTestId("capacity-result");
    expect(engine.run).toHaveBeenCalledWith({ from_s: 11 * H, to_s: 13 * H });
    expect(engine.sweepPoint).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: "Other" }));
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "10:00" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "09:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Run again" }));
    expect((await screen.findByRole("alert")).textContent).toContain("the end after the start");
  });

  it("shows an engine error", async () => {
    const loader: EngineLoader = async () => {
      throw new Error("not a lines file: expected value");
    };
    render(<CapacityRun loadEngine={loader} />);
    fireEvent.click(screen.getByRole("button", { name: "Run the test" }));
    expect((await screen.findByRole("alert")).textContent).toContain("not a lines file");
  });
});
