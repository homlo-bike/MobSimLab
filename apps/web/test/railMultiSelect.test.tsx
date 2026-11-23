import { describe, expect, it } from "vitest";
import { toggleInSelection } from "../src/features/railways/editorState";
import { shared, updateAll } from "../src/features/railways/MultiInspector";
import type { Network } from "../src/features/railways/types";

const doc = { tracks: [{ id: 1 }, { id: 2 }, { id: 3 }], stations: [{ id: 10 }, { id: 11 }] };

describe("railway multi-select", () => {
  it("adds and takes out tracks with Shift-click, and never mixes kinds", () => {
    let sel = toggleInSelection(doc, { id: 1 }, 2);
    expect(sel).toEqual({ id: 1, more: [2] });
    sel = toggleInSelection(doc, sel, 3);
    expect(sel).toEqual({ id: 1, more: [2, 3] });
    // Taking out the first leaves the next one first.
    sel = toggleInSelection(doc, sel, 1);
    expect(sel).toEqual({ id: 2, more: [3] });
    sel = toggleInSelection(doc, sel, 3);
    expect(sel).toEqual({ id: 2 });
    // A station Shift-clicked while tracks are picked becomes the selection on its own.
    expect(toggleInSelection(doc, { id: 2, more: [3] }, 10)).toEqual({ id: 10 });
    expect(toggleInSelection(doc, { id: 10 }, 11)).toEqual({ id: 10, more: [11] });
    expect(toggleInSelection(doc, { id: 10 }, 10)).toBeNull();
    expect(toggleInSelection(doc, null, 2)).toEqual({ id: 2 });
  });

  it("shows a setting only when all picked items share it, and changes all of them", () => {
    expect(shared([{ a: 1 }, { a: 1 }], (x) => x.a)).toBe(1);
    expect(shared([{ a: 1 }, { a: 2 }], (x) => x.a)).toBeUndefined();
    const net = {
      tracks: [
        { id: 1, power: "none" },
        { id: 2, power: "none" },
        { id: 3, power: "none" },
      ],
    } as unknown as Network;
    const next = updateAll(net, "tracks", [1, 3], (t) => ({ ...t, power: "overhead" }) as typeof t);
    expect(next.tracks.map((t) => t.power)).toEqual(["overhead", "none", "overhead"]);
  });
});
