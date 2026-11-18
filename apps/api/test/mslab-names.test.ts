import { describe, expect, it } from "vitest";
import { freeName } from "../src/mslab/mslab.service";

describe("name of an opened .mslab project", () => {
  it("keeps a free name and numbers a used one from 2", () => {
    expect(freeName("Damascus", ["Aleppo"])).toBe("Damascus");
    expect(freeName("Damascus", ["Damascus"])).toBe("Damascus (2)");
    expect(freeName("Damascus", ["Damascus", "Damascus (2)", "Damascus (3)"])).toBe("Damascus (4)");
    expect(freeName("Damascus", ["Damascus ", "Damascus (3)"])).toBe("Damascus (2)");
  });

  it("stays within 200 characters", () => {
    const long = "x".repeat(200);
    const n = freeName(long, [long]);
    expect(n).toHaveLength(200);
    expect(n.endsWith(" (2)")).toBe(true);
  });
});
