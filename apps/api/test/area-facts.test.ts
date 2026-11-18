import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PRICE_BASE_YEAR } from "../src/projects/area-facts";

describe("area facts", () => {
  it("looks up the economy figures for the price base year the cost tables use", () => {
    const defaults = JSON.parse(
      readFileSync(join(__dirname, "../../web/src/features/costs/defaults.generated.json"), "utf8"),
    ) as { params: Record<string, { values: Record<string, number[]> }> };
    expect(defaults.params["cost.price_base_year"]!.values["*"]![1]).toBe(PRICE_BASE_YEAR);
  });
});
