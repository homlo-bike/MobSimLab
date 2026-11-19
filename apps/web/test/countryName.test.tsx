import { describe, expect, it } from "vitest";
import { countryName } from "../src/features/costs/economy";

describe("countryName", () => {
  it("names the country in the app language", () => {
    expect(countryName({ iso2: "SY", name: "Syrian Arab Republic" }, "ar")).toBe("سوريا");
    expect(countryName({ iso2: "de", name: "Germany" }, "fr")).toBe("Allemagne");
  });

  it("keeps the World Bank name without a code it knows", () => {
    expect(countryName({ iso2: null, name: "Syrian Arab Republic" }, "ar")).toBe("Syrian Arab Republic");
    expect(countryName({ iso2: "XC", name: "Somewhere" }, "ar")).toBe("Somewhere");
    expect(countryName({ iso2: "1A", name: "Arab World" }, "ar")).toBe("Arab World");
  });
});
