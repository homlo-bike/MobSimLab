import { describe, expect, it } from "vitest";
import { loadMessages } from "../src/i18n/messages";
import { localizePlugin, PLUGINS, type Plugin, pluginTools } from "../src/plugins/registry";
import { localizeSummary, pluginText } from "../src/plugins/texts";
import { LANGUAGES } from "../src/i18n/i18n";

const ferry = PLUGINS.find((p) => p.id === "org.mobsimlab.ferry")!;
const aerial = PLUGINS.find((p) => p.id === "org.mobsimlab.aerial-lift")!;

describe("plugin texts in the app's languages (bug 22)", () => {
  it("shows the Create tabs and plugin names in Arabic once the language is loaded", async () => {
    await loadMessages("ar");
    const tools = pluginTools([localizePlugin(aerial, "ar"), localizePlugin(ferry, "ar")]);
    expect(tools.map((t) => t.label)).toEqual(["التلفريك", "العبّارة"]);
    const f = localizePlugin(ferry, "ar");
    expect(f.name).toBe("العبّارات");
    expect(f.contexts[0]!.label).toBe("نوع السفينة");
    // Ids stay as they are: only the texts change.
    expect(f.modes.map((m) => m.id)).toEqual(ferry.modes.map((m) => m.id));
    expect(localizePlugin(ferry, "en")).toBe(ferry);
  });

  it("loads the bundled plugins' texts with every language (tools/plugins/check.py checks they are complete)", async () => {
    for (const { tag } of LANGUAGES) {
      if (tag === "en") continue;
      await loadMessages(tag);
      expect(localizePlugin(aerial, tag).name, tag).not.toBe("Cable cars");
      expect(localizePlugin(aerial, tag).contexts[0]!.label, tag).not.toBe("Ropeway system");
    }
  });

  it("uses an installed plugin's own translations, and English where it has none", () => {
    const own: Plugin = {
      ...ferry,
      id: "org.example.water-taxi",
      name: "Water taxis",
      translations: { de: { "Water taxis": "Wassertaxis" } },
    };
    expect(localizePlugin(own, "de").name).toBe("Wassertaxis");
    expect(localizePlugin(own, "fr").name).toBe("Water taxis");
    expect(pluginText(own, "Nothing like this", "de")).toBe("Nothing like this");
  });

  it("translates the list rows of Project preferences and Administration", async () => {
    await loadMessages("de");
    const row = localizeSummary(
      {
        id: "org.mobsimlab.ferry",
        name: "Ferries",
        description: ferry.description,
        contributes: { modes: ["Ferry"], tools: ["Ferry"], calculations: [], mapLayers: [] },
      },
      "de",
    );
    expect(row.name).toBe("Fähren");
    expect(row.contributes.modes).toEqual(["Fähre"]);
    expect(row.description.startsWith("Personenfähren")).toBe(true);
  });
});
