import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { API_MESSAGES } from "../../api/src/i18n/messages";
import { fillEngineMsg } from "../src/i18n/engine";

/** The English engine and API message catalogs and the translations, one file per language. */
const EN = {
  ...(JSON.parse(
    readFileSync(join(__dirname, "../../../crates/engine-msg/messages/en.json"), "utf8"),
  ) as Record<string, string>),
  ...API_MESSAGES,
};
const DIR = join(__dirname, "../src/i18n/engine");
const FILES = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith(".json")) : [];

const placeholders = (s: string) => [...s.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]).sort();

describe("engine messages", () => {
  it("fill in values and parts that are themselves messages", () => {
    const m = { key: "rail.crossing.diamond", args: { angle: "30°", level: { key: "rail.level.street" } } };
    expect(fillEngineMsg(EN, m)).toBe(
      "Diamond crossing at 30° on street level: the two tracks share one piece of trackwork.",
    );
  });

  it("give null when a key, or the key of a part, is not in the catalog", () => {
    expect(fillEngineMsg(EN, { key: "no.such.key" })).toBeNull();
    expect(
      fillEngineMsg(EN, { key: "rail.crossing.diamond", args: { angle: "30°", level: { key: "no.such" } } }),
    ).toBeNull();
  });

  it.each(FILES)("%s has only keys of the English catalog, with the same placeholders", (file) => {
    const texts = JSON.parse(readFileSync(join(DIR, file), "utf8")) as Record<string, string>;
    for (const [key, text] of Object.entries(texts)) {
      if (key.startsWith("_")) continue;
      expect(EN[key], key).toBeTypeOf("string");
      expect(placeholders(text), key).toEqual(placeholders(EN[key] ?? ""));
    }
  });
});
