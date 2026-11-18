import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pointAlong, SwitchesSection } from "../src/features/railways/RailNetworkSections";
import type { RailPanelActions } from "../src/features/railways/railPanelTypes";
import type { Network, RailView } from "../src/features/railways/types";

afterEach(cleanup);

describe("switch list", () => {
  it("finds the point at a chainage along a centre line", () => {
    // 0.001° of longitude at the equator is about 111 m.
    const p = pointAlong(
      [
        [0, 0],
        [0.001, 0],
      ],
      55.6,
    )!;
    expect(p[0]).toBeCloseTo(0.0005, 5);
    expect(pointAlong([], 10)).toBeNull();
  });

  it("lists every switch with its track and position, and selects one on click", () => {
    const doc = {
      tracks: [{ id: 1, name: "Main line" }],
      switches: [
        { id: 7, kind: "crossover", track: 1, s: 120, element: "x", side: 1, direction: 1, flip: false },
        { id: 5, kind: "turnout", track: 1, s: 40, element: "x", side: 1, direction: 1, flip: false },
      ],
    } as unknown as Network;
    const view = {
      tracks: [
        {
          id: 1,
          centre: [
            [36.3, 33.5],
            [36.31, 33.5],
          ],
        },
      ],
      switches: [],
    } as unknown as RailView;
    const showIssue = vi.fn();
    render(
      <SwitchesSection
        doc={doc}
        view={view}
        selected={7}
        actions={{ showIssue } as unknown as RailPanelActions}
      />,
    );
    const items = screen.getAllByRole("button");
    expect(items.map((b) => b.textContent)).toEqual([
      "5Turnout on Main line at 40 m",
      "7Crossover on Main line at 120 m",
    ]);
    expect(items[1]!.getAttribute("aria-current")).toBe("true");
    fireEvent.click(items[0]!);
    expect(showIssue).toHaveBeenCalledWith(expect.any(Array), 5);
  });

  it("says how to add a switch when there is none", () => {
    render(
      <SwitchesSection
        doc={{ tracks: [], switches: [] } as unknown as Network}
        view={{ tracks: [], switches: [] } as unknown as RailView}
        selected={null}
        actions={{} as RailPanelActions}
      />,
    );
    expect(screen.getByText(/No switches yet/)).toBeTruthy();
  });
});
