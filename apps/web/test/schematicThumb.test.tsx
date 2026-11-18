import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { schematicThumb } from "../src/features/schematic/thumb";
import { Thumb } from "../src/projects/ProjectsHome";

describe("project card picture of the schematic", () => {
  it("fits the drawn lines into the card, keeping their shape", () => {
    const t = schematicThumb([
      {
        color: "#C81E1E",
        pts: [
          [100, 100],
          [1100, 100],
          [1100, 300],
        ],
      },
      {
        color: "#1d4ed8",
        pts: [
          [600, 0],
          [600, 300],
        ],
      },
    ])!;
    expect(t.w).toBe(280);
    expect(t.h).toBe(96);
    expect(t.lines.map((l) => l.color)).toEqual(["#c81e1e", "#1d4ed8"]);
    // 1000 × 300 px scaled by 0.264 into the 264 px wide box, centred upright.
    const all = t.lines.flatMap((l) => l.points);
    const xs = all.map((p) => p[0]);
    const ys = all.map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(8, 1);
    expect(Math.max(...xs)).toBeCloseTo(272, 1);
    expect(Math.min(...ys)).toBeCloseTo(8.4, 1);
    expect(Math.max(...ys)).toBeCloseTo(87.6, 1);
  });

  it("is null without lines", () => {
    expect(schematicThumb([])).toBeNull();
    expect(schematicThumb([{ color: "#c81e1e", pts: [[1, 1]] }])).toBeNull();
  });

  it("draws the schematic on the card when there is one, else the stand-in picture", () => {
    const { container, rerender } = render(
      <Thumb
        id="p1"
        className=""
        thumb={{
          w: 280,
          h: 96,
          lines: [
            {
              color: "#c81e1e",
              points: [
                [8, 8],
                [272, 88],
              ],
            },
          ],
        }}
      />,
    );
    expect(container.querySelector('svg[data-thumb="schematic"] polyline')?.getAttribute("points")).toBe(
      "8,8 272,88",
    );
    rerender(<Thumb id="p1" className="" thumb={null} />);
    expect(container.querySelector('svg[data-thumb="schematic"]')).toBeNull();
    expect(container.querySelector("svg path")).not.toBeNull();
  });
});
