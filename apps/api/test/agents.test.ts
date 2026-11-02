import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { periods } from "../src/agents/analysis.service";
import { chainages, railLine, streetDirections } from "../src/agents/network.service";
import { parseScopes, pkceOk, redirectMatches, validRedirectUri } from "../src/agents/oauth";
import {
  applyChanges,
  ChangeError,
  EMPTY_DOC,
  kinematicRunS,
  type Line,
  type ScenarioDoc,
  validate,
} from "../src/agents/scenario";
import { tilesFor } from "../src/street-network/street-network.service";

const stop = (id: string, lon: number, lat: number) => ({ id, name: id, lon, lat });
const line = (over: Partial<Line> = {}): Line => ({
  id: "L1",
  name: "1",
  mode: "bus",
  stop_ids: ["A", "B"],
  headway_min: { peak: 10, off_peak: 20 },
  ...over,
});

describe("agent scenario changes", () => {
  const base = applyChanges(EMPTY_DOC, [
    { op: "add_stop", stop: stop("A", 7, 50) },
    { op: "add_stop", stop: stop("B", 7.01, 50) },
    { op: "add_line", line: line() },
  ]);

  it("applies a batch and leaves the input untouched", () => {
    expect(base.stops).toHaveLength(2);
    expect(base.lines[0]?.stop_ids).toEqual(["A", "B"]);
    expect(EMPTY_DOC.stops).toHaveLength(0);
  });

  it("refuses the whole batch when one change is wrong", () => {
    expect(() =>
      applyChanges(base, [
        { op: "add_stop", stop: stop("C", 7.02, 50) },
        { op: "add_line", line: line({ id: "L2", stop_ids: ["A", "X"] }) },
      ]),
    ).toThrow(ChangeError);
    expect(base.stops).toHaveLength(2);
  });

  it("removes a served stop only when asked, and keeps lines with two stops", () => {
    expect(() => applyChanges(base, [{ op: "remove_stop", stop_id: "A", from_lines: false }])).toThrow(
      /served by L1/,
    );
    expect(() => applyChanges(base, [{ op: "remove_stop", stop_id: "A", from_lines: true }])).toThrow(
      /fewer than two stops/,
    );
  });

  it("updates headways partially", () => {
    const d = applyChanges(base, [{ op: "update_line", line_id: "L1", headway_min: { peak: 5 } }]);
    expect(d.lines[0]?.headway_min).toEqual({ peak: 5, off_peak: 20 });
  });

  it("validates service and spacing", () => {
    const d: ScenarioDoc = {
      ...base,
      lines: [line({ headway_min: { peak: null, off_peak: null } })],
      stops: [...base.stops, stop("U", 7.1, 50)],
    };
    const f = validate(d).map((x) => x.message);
    expect(f).toContain("no service: both headways are null");
    expect(f).toContain("no line calls here");
  });
});

describe("running times and periods", () => {
  it("uses the kinematic profile of the mode", () => {
    // Metro 80 km/h, 1.1 m/s² both ways: 22.2 m/s reached after 224 m each way.
    const t = kinematicRunS(1000, "metro");
    const v = 80 / 3.6;
    expect(t).toBeCloseTo(v / 1.1 + v / 1.1 + (1000 - (v * v) / 1.1) / v, 6);
    // Short hop: triangle profile, slower on average than cruising.
    expect(kinematicRunS(100, "metro")).toBeGreaterThan(100 / v);
  });

  it("splits the service day into peak and off-peak periods", () => {
    const p = periods({ first: "05:00", last: "24:30", peaks: [["07:00", "09:00"]] }, line());
    expect(p.map((x) => [x.kind, x.start_time / 3600, x.headway_secs])).toEqual([
      ["off_peak", 5, 1200],
      ["peak", 7, 600],
      ["off_peak", 9, 1200],
    ]);
  });
});

describe("routing helpers", () => {
  it("splits a street circuit into two directions", () => {
    const leg = (x0: number, x1: number) => ({
      coords: [
        [x0, 50],
        [x1, 50],
      ] as [number, number][],
      length_m: 100,
      time_s: 20,
      status: "ok" as const,
      message: null,
    });
    const r = streetDirections(
      {
        points: [],
        legs: [leg(0, 1), leg(1, 2), leg(2, 1), leg(1, 0)],
        issues: [],
      },
      ["A", "B", "C"],
      "h",
    );
    expect(r.directions.map((d) => d.stop_ids)).toEqual([
      ["A", "B", "C"],
      ["C", "B", "A"],
    ]);
    expect(r.directions[0]?.run_s).toEqual([0, 20, 20]);
    expect(r.directions[0]?.coords).toHaveLength(3);
  });

  it("measures rail stations along the given route", () => {
    const route: [number, number][] = [
      [7, 50],
      [7.02, 50],
    ];
    const ch = chainages(route, [
      [7, 50],
      [7.01, 50.0001],
      [7.02, 50],
    ]);
    expect(ch.at[1]).toBeCloseTo(715, -1);
    expect(ch.offset[1]).toBeCloseTo(11, 0);
    const r = railLine(
      line({ mode: "metro", stop_ids: ["A", "B"], route }),
      [stop("A", 7, 50), stop("B", 7.02, 50)],
      "h",
    );
    expect(r.source).toBe("given-route");
    expect(r.directions[1]?.stop_ids).toEqual(["B", "A"]);
  });

  it("lists the tiles covering an area", () => {
    const t = tilesFor([6.94, 50.93, 6.97, 50.95]);
    expect(t.length).toBeGreaterThanOrEqual(2);
    expect(t.every(([x, y]) => x >= 8500 && y >= 5480)).toBe(true);
  });
});

describe("OAuth helpers", () => {
  it("accepts https, loopback http and private-use redirect URIs only", () => {
    expect(validRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(validRedirectUri("http://127.0.0.1:33418/callback")).toBe(true);
    expect(validRedirectUri("http://example.org/callback")).toBe(false);
    expect(validRedirectUri("https://x.org/cb#frag")).toBe(false);
    expect(validRedirectUri("javascript:alert(1)")).toBe(false);
  });

  it("lets loopback redirect ports differ", () => {
    expect(redirectMatches("http://127.0.0.1/cb", "http://127.0.0.1:5555/cb")).toBe(true);
    expect(redirectMatches("https://a.org/cb", "https://a.org/cb2")).toBe(false);
  });

  it("checks PKCE S256", () => {
    const v = "a".repeat(43);
    expect(pkceOk(v, createHash("sha256").update(v).digest("base64url"))).toBe(true);
    expect(pkceOk(v, "wrong")).toBe(false);
    expect(pkceOk("short", createHash("sha256").update("short").digest("base64url"))).toBe(false);
  });

  it("parses scopes", () => {
    expect(parseScopes("")).toEqual(["project:read", "analysis:run", "scenario:write"]);
    expect(parseScopes("analysis:run analysis:run")).toEqual(["analysis:run"]);
    expect(parseScopes("admin")).toBeNull();
  });
});
