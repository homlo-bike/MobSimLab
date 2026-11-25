import { describe, expect, it } from "vitest";
import { preferencesBody } from "../src/auth/auth.controller";

describe("account preferences", () => {
  it("keeps the project layers a person keeps shown, per project", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(preferencesBody.parse({ mapLayers: { [id]: ["tracks", "regions"] } })).toEqual({
      mapLayers: { [id]: ["tracks", "regions"] },
    });
    expect(preferencesBody.safeParse({ mapLayers: { [id]: ["buildings"] } }).success).toBe(false);
    expect(preferencesBody.safeParse({ mapLayers: { "not-a-project": [] } }).success).toBe(false);
  });
});
