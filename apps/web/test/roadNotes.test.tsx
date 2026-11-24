import { describe, expect, it } from "vitest";
import { translate } from "../src/i18n/i18n";
import type { MessageKey } from "../src/i18n/messages";
import { roadNoteText, roadProblemText, type RoadNote } from "../src/features/road-sim/notes";
import { roadEn } from "../src/i18n/road/en";
import { roadDe } from "../src/i18n/road/de";
import { roadAr } from "../src/i18n/road/ar";

/** The road messages of a language as a translator (the app's own, with English for missing keys). */
const tOf =
  (table: Record<string, string>) =>
  (key: MessageKey, vars?: Record<string, string | number>): string =>
    (table[key] ?? translate("en", key)).replace(/\{(\w+)\}/g, (m, n: string) =>
      vars && n in vars ? String(vars[n]) : m,
    );

describe("road run notes from the worker", () => {
  it("are shown in the app language, with their values and parts filled in", () => {
    const t = tOf(roadDe);
    const note: RoadNote = {
      text: "Junction setup: 21 junctions given traffic lights, 0 without",
      msg: { key: "road.note.junctionSetup", args: { on: 21, off: 0 } },
    };
    expect(roadNoteText(t, note)).toBe("Knotenpunkte: 21 Knotenpunkte mit Ampel, 0 ohne");
    const slot: RoadNote = {
      text: "vehicle 1 has no slot in the depot: it starts at the depot gate",
      msg: { key: "road.note.noSlot", args: { n: 1 } },
    };
    expect(roadNoteText(tOf(roadAr), slot)).toBe("ليس للمركبة 1 مكان في المرأب: تبدأ عند بوابة المرأب");
    const line = {
      problem: "no way for a bus from Main Street onto …",
      problem_msg: {
        key: "road.problem.noBusLink",
        args: {
          from: { key: "road.part.unnamedStreet", args: { way: "410002334" } },
          to: "Col 2",
          stop: { key: "road.part.stop", args: { n: 3 } },
          m: 40,
        },
      },
    };
    const text = roadProblemText(t, line);
    expect(text).toContain(
      "von eine Straße ohne Namen (OSM-Weg 410002334) auf Col 2, nahe Haltestelle 3 (40 m",
    );
  });

  it("show their English text for runs saved before messages and for unknown keys", () => {
    const t = tOf(roadDe);
    expect(roadNoteText(t, "an old note")).toBe("an old note");
    expect(roadNoteText(t, { text: "English", msg: { key: "road.note.notThere" } })).toBe("English");
    expect(roadProblemText(t, { problem: "it has no departures in the period" })).toBe(
      "it has no departures in the period",
    );
  });

  it("have every key in every language", () => {
    const keys = Object.keys(roadEn).filter((k) => /^road\.(note|problem|part)\./.test(k));
    expect(keys.length).toBeGreaterThan(20);
    for (const k of keys) {
      expect(roadDe[k as keyof typeof roadDe]).toBeTruthy();
      expect(roadAr[k as keyof typeof roadAr]).toBeTruthy();
    }
  });
});
