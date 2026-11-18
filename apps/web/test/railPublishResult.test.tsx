import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceLinesPanel } from "../src/features/railways/ServiceLinesPanel";
import type { Network, RailView, ServicePublication } from "../src/features/railways/types";

afterEach(cleanup);

const doc = {
  stations: [],
  lines: [{ id: "T1", name: "T1", color: "#c00000", stations: [], vehicle: "", units: 1 }],
} as unknown as Network;
const view = (errors: number) => ({ counts: { errors, warnings: 0, track_km: 0, route_km: 0 } }) as RailView;

/** A publication of T1 with one trip that could not run and one moved, the moved one leaving at 07:12. */
const result = {
  timetable: {
    trips: [
      {
        trip_id: "T1-0-0712",
        route_id: "T1",
        stop_times: [
          { stop_id: "a", stop_sequence: 0, arrival_time: 7 * 3600 + 720, departure_time: 7 * 3600 + 720 },
          { stop_id: "b", stop_sequence: 1, arrival_time: 7 * 3600 + 900, departure_time: 7 * 3600 + 900 },
        ],
      },
    ],
    stops: [],
    routes: [],
  },
  lines: [
    {
      id: "T1",
      trips: 1,
      outbound_s: null,
      return_s: null,
      trains: 1,
      issues: [],
      stations: [],
      shifted: [{ trip: "T1-0-0712", by_s: 120 }],
      unplaced: [{ trip: "T1-1-0800", reason: "no free path at the terminal", blocked_by: "T2-0-0758" }],
    },
  ],
  notes: [],
} as unknown as ServicePublication;

function panel(errors: number, checksInMenu: boolean) {
  render(
    <ServiceLinesPanel
      doc={doc}
      view={view(errors)}
      setDoc={vi.fn()}
      publication={{ result, error: null, stale: false }}
      publish={vi.fn()}
      picking={null}
      setPicking={vi.fn()}
      show={vi.fn()}
      checksInMenu={checksInMenu}
    />,
  );
}

describe("publish result of the service lines", () => {
  it("opens the conflicts line to list each conflict by line", () => {
    panel(0, true);
    const box = screen.getByTestId("publish-conflicts");
    const summary = box.querySelector("summary")!;
    expect(summary.textContent).toBe("Conflicts · 2");
    expect(box.hasAttribute("open")).toBe(false);
    fireEvent.click(summary);
    expect(box.hasAttribute("open")).toBe(true);
    const line = within(box).getByRole("region", { name: "T1" });
    expect(line.textContent).toContain("T1 · 2");
    expect(line.textContent).toContain(
      "T1-1-0800 could not run: no free path at the terminal (T2-0-0758 is in the way).",
    );
    expect(line.textContent).toContain("T1-0-0712 (07:12) moved +2 min to keep clear of other trains.");
  });

  it("points to where the drawing's checks are when there are errors", () => {
    panel(2, true);
    expect(screen.getByText(/listed under Checks, the bell button at the top/)).toBeTruthy();
    cleanup();
    // On its own (no project around it), the checks are listed in the panel.
    panel(2, false);
    expect(screen.getByText("Fix the errors under Checks before publishing.")).toBeTruthy();
  });
});
