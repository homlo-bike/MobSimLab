import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CapacityRun, explain, practicalMaximum } from "../src/features/capacity/CapacityRun";
import type { CapacityEngine, CapacityRun as Run, EngineLoader, Point } from "../src/features/capacity/types";

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

describe("capacity run panel", () => {
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
    fireEvent.click(screen.getByRole("radio", { name: "My railway" }));
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
