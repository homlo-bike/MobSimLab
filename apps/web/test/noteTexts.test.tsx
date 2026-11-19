import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { noteKey } from "../src/i18n/notes";
import report from "../src/workspace/assumptions-report.generated.json";

/** The translated notes (reasoning and "Used by"), one file per language. */
const DIR = join(__dirname, "../src/i18n/notes");
const FILES = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith(".json")) : [];

const params = Object.values(
  (report as unknown as { params: Record<string, { used_by?: string[]; entries: { rationale: string }[] }> })
    .params,
);
const USED_BY = new Set(params.flatMap((p) => (p.used_by ?? []).map(noteKey)));
const RATIONALE = new Set(
  params.flatMap((p) =>
    p.entries
      .map((e) => e.rationale)
      .filter(Boolean)
      .map(noteKey),
  ),
);

describe("note keys", () => {
  it("are 8 hex digits and tell the library's notes apart", () => {
    expect(noteKey("level-access check per door")).toMatch(/^[0-9a-f]{8}$/);
    const all = params.flatMap((p) => [...(p.used_by ?? []), ...p.entries.map((e) => e.rationale)]);
    const distinct = new Set(all.filter(Boolean));
    expect(new Set([...distinct].map(noteKey)).size).toBe(distinct.size);
  });
});

for (const file of FILES) {
  describe(file, () => {
    const texts = JSON.parse(readFileSync(join(DIR, file), "utf8")) as {
      usedBy: Record<string, string>;
      rationale: Record<string, string>;
    };

    it('translates every "Used by" entry of the library and nothing else', () => {
      expect(Object.keys(texts.usedBy).filter((k) => !USED_BY.has(k))).toEqual([]);
      expect([...USED_BY].filter((k) => !texts.usedBy[k]?.trim())).toEqual([]);
    });

    it("translates every reasoning of the library and nothing else", () => {
      expect(Object.keys(texts.rationale).filter((k) => !RATIONALE.has(k))).toEqual([]);
      expect([...RATIONALE].filter((k) => !texts.rationale[k]?.trim())).toEqual([]);
    });
  });
}
