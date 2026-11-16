import { describe, expect, it } from "vitest";
import data from "../src/workspace/assumptions-report.generated.json";
import {
  lastChanges,
  otherChoices,
  type ReportSources,
  reportModes,
  reportRows,
  toCsv,
} from "../src/workspace/assumptionsReport";
import { CATALOGUE_SWITCHES, LIBRARY_DEFAULT_TURNOUT, LIBRARY_PARAMS } from "../src/workspace/preferences";

const SOURCES = data as unknown as ReportSources;

describe("assumptions report", () => {
  it("has where every library value comes from, and every source it cites", () => {
    for (const p of LIBRARY_PARAMS) {
      const s = SOURCES.params[p.id];
      expect(s, p.id).toBeTruthy();
      expect(s!.entries[s!.modes["*"]!], p.id).toBeTruthy();
      for (const e of s!.entries) {
        expect(["cited", "documented", "educated-guess"]).toContain(e.basis);
        for (const id of e.sources) expect(SOURCES.sources[id], `${p.id} cites ${id}`).toBeTruthy();
      }
    }
  });

  it("lists each value for every mode, each mode the project uses, and each traction", () => {
    expect(reportModes(["tram", "intercity_rail", "cable_car"])).toEqual(["tram", "long_distance_rail"]);
    const rows = reportRows(SOURCES, null, ["bus", "tram"]);
    const dwell = rows.filter((r) => r.param.id === "mode.dwell_s");
    expect(dwell.map((r) => r.mode)).toEqual(["*", "bus", "tram"]);
    expect(dwell.every((r) => !r.changed && r.source !== null)).toBe(true);
    expect(dwell[0]!.value).toBe((dwell[0]!.library as number[])[1]);
    expect(new Set(rows.filter((r) => r.mode === "*" && !r.traction).map((r) => r.param.id)).size).toBe(
      LIBRARY_PARAMS.length,
    );
    const withTraction = LIBRARY_PARAMS.find((p) => p.traction);
    if (withTraction) expect(rows.some((r) => r.param === withTraction && r.traction)).toBe(true);
  });

  it("marks the values the project changed, for every mode or one mode", () => {
    const rows = reportRows(SOURCES, { values: { "mode.dwell_s": 40, "mode.dwell_s.bus": 20 } }, [
      "bus",
      "tram",
    ]);
    const dwell = Object.fromEntries(
      rows.filter((r) => r.param.id === "mode.dwell_s").map((r) => [r.mode, r]),
    );
    expect([dwell["*"]!.value, dwell["*"]!.changed, dwell["*"]!.fromAll]).toEqual([40, true, false]);
    expect([dwell.bus!.value, dwell.bus!.changed, dwell.bus!.fromAll]).toEqual([20, true, false]);
    expect([dwell.tram!.value, dwell.tram!.changed, dwell.tram!.fromAll]).toEqual([40, true, true]);
    const enumParam = LIBRARY_PARAMS.find((p) => p.kind === "enum" && p.options && p.options.length > 1)!;
    const other = enumParam.options!.find((o) => o !== enumParam.values["*"])!;
    const er = reportRows(SOURCES, { values: {}, choices: { [enumParam.id]: other } }, []).find(
      (r) => r.param === enumParam,
    )!;
    expect([er.value, er.changed]).toEqual([other, true]);
  });

  it("gives the reason and who last changed each value", () => {
    const doc = { values: { "mode.dwell_s": 40 }, reasons: { "mode.dwell_s": "Busy stops" } };
    const dwell = reportRows(SOURCES, doc, ["tram"]).filter((r) => r.param.id === "mode.dwell_s");
    expect(dwell.map((r) => [r.mode, r.prefId, r.reason])).toEqual([
      ["*", "mode.dwell_s", "Busy stops"],
      ["tram", "mode.dwell_s", "Busy stops"],
    ]);
    const last = lastChanges([
      { id: "mode.dwell_s", kind: "reason", at: "2026-11-16T12:00:00Z", by: { displayName: "Bo" } },
      { id: "mode.dwell_s", kind: "changed", at: "2026-11-16T11:00:00Z", by: { displayName: "Ann" } },
      { id: "mode.dwell_s", kind: "changed", at: "2026-11-15T11:00:00Z", by: { displayName: "Cy" } },
      { id: "fare.base", kind: "changed", at: "2026-11-14T11:00:00Z", by: null },
    ]);
    expect(last.get("mode.dwell_s")).toEqual({ at: "2026-11-16T11:00:00Z", by: "Ann" });
    expect(last.get("fare.base")).toEqual({ at: "2026-11-14T11:00:00Z", by: null });
  });

  it("lists the project's other choices", () => {
    const mode = Object.keys(LIBRARY_DEFAULT_TURNOUT)[0]!;
    const own = CATALOGUE_SWITCHES.find(
      (s) => s.typical_modes.includes(mode) && s.id !== LIBRARY_DEFAULT_TURNOUT[mode],
    )!;
    const o = otherChoices(
      {
        values: { "currency.per_usd": 0.9 },
        currency: "EUR",
        vehiclesOff: ["v2", "v1"],
        switches: { off: [own.id], default_turnout: { [mode]: own.id } },
      },
      [mode],
      new Map([
        ["v1", "Zeta"],
        ["v2", "Alpha"],
      ]),
      "EUR",
      "currency.per_usd",
    );
    expect(o.currency).toBe("EUR");
    expect(o.perUsd).toBe(0.9);
    expect(o.vehiclesOff).toEqual(["Alpha", "Zeta"]);
    expect(o.switchesOff).toEqual([own.label]);
    expect(o.turnouts).toEqual([{ mode, turnout: own.label, changed: true }]);
    expect(otherChoices(null, [], new Map(), null, "currency.per_usd")).toEqual({
      currency: null,
      perUsd: null,
      vehiclesOff: [],
      switchesOff: [],
      turnouts: [],
    });
  });

  it("writes CSV with quoted fields where needed", () => {
    expect(toCsv([["a", 'say "hi"', "x,y", 0.1 + 0.2], ["line\nbreak"]])).toBe(
      'a,"say ""hi""","x,y",0.3\r\n"line\nbreak"\r\n',
    );
  });
});
