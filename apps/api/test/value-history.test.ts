import { describe, expect, it } from "vitest";
import { VALUE_CHANGED, VALUE_REASON, valueChanges } from "../src/projects/value-history";

describe("valueChanges", () => {
  it("records set, changed and reset values with the new reason", () => {
    const before = { values: { "a.x": 1, "a.y": 2 }, reasons: { "a.y": "old" } };
    const after = { values: { "a.y": 3, "a.z": 4 }, reasons: { "a.y": "new", "a.z": " " } };
    expect(valueChanges(before, after)).toEqual([
      {
        action: VALUE_CHANGED,
        id: "a.x",
        before: { value: 1, reason: null },
        after: { value: null, reason: null },
      },
      {
        action: VALUE_CHANGED,
        id: "a.y",
        before: { value: 2, reason: "old" },
        after: { value: 3, reason: "new" },
      },
      {
        action: VALUE_CHANGED,
        id: "a.z",
        before: { value: null, reason: null },
        after: { value: 4, reason: null },
      },
    ]);
  });

  it("records a new reason for an unchanged number, and nothing when nothing changed", () => {
    const doc = { values: { "a.x": 1 } };
    expect(valueChanges(doc, doc)).toEqual([]);
    expect(valueChanges(null, null)).toEqual([]);
    expect(valueChanges(doc, { ...doc, reasons: { "a.x": "why" } })).toEqual([
      {
        action: VALUE_REASON,
        id: "a.x",
        before: { value: 1, reason: null },
        after: { value: 1, reason: "why" },
      },
    ]);
    // Removing a reason alone is not a change worth recording.
    expect(valueChanges({ ...doc, reasons: { "a.x": "why" } }, doc)).toEqual([]);
  });

  it("starts from nothing when no preferences were saved", () => {
    expect(valueChanges(null, { values: { "a.x": 0.5 } })).toEqual([
      {
        action: VALUE_CHANGED,
        id: "a.x",
        before: { value: null, reason: null },
        after: { value: 0.5, reason: null },
      },
    ]);
  });
});
