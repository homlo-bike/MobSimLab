import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LIBRARY_PARAMS } from "../src/workspace/preferences";

/** The translated parameter names and units, one file per language. */
const DIR = join(__dirname, "../src/i18n/params");
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".json"));

const IDS = new Set(LIBRARY_PARAMS.map((p) => p.id));
/** Units as the library writes them, and fare units as the Fares table shows them (without the year and PPP). */
const UNITS = new Set(
  LIBRARY_PARAMS.flatMap((p) =>
    !p.unit ? [] : p.id.startsWith("fare.") ? [p.unit, p.unit.replace(/ \(2023, PPP\)/, "")] : [p.unit],
  ),
);
/** Units with words in them: these need a translation; symbols such as km/h or % stay as they are. */
const WORD_UNITS = [...UNITS].filter((u) => /[a-z]{3,}/i.test(u.replace(/US\$|PPP|kWh|km|min/g, "")));

describe("parameter texts", () => {
  it("has files", () => {
    expect(FILES.length).toBeGreaterThan(0);
  });

  for (const file of FILES) {
    describe(file, () => {
      const texts = JSON.parse(readFileSync(join(DIR, file), "utf8")) as {
        labels: Record<string, string>;
        units: Record<string, string>;
      };

      it("names every parameter of the library and nothing else", () => {
        expect(Object.keys(texts.labels).filter((id) => !IDS.has(id))).toEqual([]);
        expect([...IDS].filter((id) => !texts.labels[id]?.trim())).toEqual([]);
      });

      it("translates units of the library only, and every unit with words", () => {
        expect(Object.keys(texts.units).filter((u) => !UNITS.has(u))).toEqual([]);
        expect(WORD_UNITS.filter((u) => !texts.units[u]?.trim())).toEqual([]);
      });
    });
  }
});
