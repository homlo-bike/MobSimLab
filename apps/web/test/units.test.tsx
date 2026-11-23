import { describe, expect, it } from "vitest";
import { fillEngineMsg } from "../src/i18n/engine";
import { localizeUnits, unitIn } from "../src/i18n/units";

describe("unit symbols in the app language", () => {
  it("keeps the international symbols in English and other Latin-script languages", () => {
    expect(unitIn("en", 12, "min")).toBe("12 min");
    expect(unitIn("de", "240", "s")).toBe("240 s");
    expect(localizeUnits("fr", "within 240 s")).toBe("within 240 s");
  });

  it("uses the language's own symbols in other scripts, with the number as written", () => {
    expect(unitIn("ar", 12, "min")).toBe("12 د");
    expect(unitIn("ar", "1.5", "m")).toBe("1.5 م");
    expect(unitIn("ru", 80, "km/h")).toBe("80 км/ч");
    expect(localizeUnits("ar", "240 s")).toBe("240 ث");
    expect(localizeUnits("ru", "12.5 m by 3 m, 1:30 min")).toBe("12.5 м by 3 м, 1:30 мин");
  });

  it("leaves words and other units alone", () => {
    expect(localizeUnits("ar", "line2-1-003")).toBe("line2-1-003");
    expect(localizeUnits("ru", "3 ms, 4 m²")).toBe("3 ms, 4 m²");
  });

  it("localizes units in engine message values", () => {
    const catalog = { "rail.plan.no_slot": "لا توجد فترة خالية من التعارض ضمن {shift}" };
    expect(fillEngineMsg(catalog, { key: "rail.plan.no_slot", args: { shift: "240 s" } }, "ar")).toBe(
      "لا توجد فترة خالية من التعارض ضمن 240 ث",
    );
  });
});
