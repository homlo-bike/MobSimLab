import { describe, expect, it } from "vitest";
import {
  nextLineColor,
  type SavedStreetLine,
  STREET_LINE_COLORS,
  streetLineColor,
  withLineColors,
} from "../src/features/street-lines/saved";
import { MODES } from "../src/features/street-lines/modes";

const line = (color?: string) =>
  ({ name: "B", profile: { mode: "bus" }, color }) as unknown as SavedStreetLine;

describe("street line colours", () => {
  it("uses the line's own colour, else its mode's", () => {
    expect(streetLineColor(line("#123456"))).toBe("#123456");
    expect(streetLineColor(line())).toBe(MODES.bus.color);
    expect(streetLineColor(line("red"))).toBe(MODES.bus.color);
  });

  it("gives each line without a colour the next unused one, keeping the colours lines have", () => {
    const got = withLineColors([line(), line(STREET_LINE_COLORS[0]), line(), line("#000000")]);
    expect(got.map((l) => l.color)).toEqual([
      STREET_LINE_COLORS[1],
      STREET_LINE_COLORS[0],
      STREET_LINE_COLORS[2],
      "#000000",
    ]);
    expect(new Set(withLineColors(Array.from({ length: 8 }, () => line())).map((l) => l.color)).size).toBe(8);
  });

  it("picks the first colour no line uses for a new line", () => {
    expect(nextLineColor([])).toBe(STREET_LINE_COLORS[0]);
    expect(nextLineColor([STREET_LINE_COLORS[0].toUpperCase(), null])).toBe(STREET_LINE_COLORS[1]);
  });
});
