import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Drawing, DrawingConflict, type DrawingKind, DrawingSaveError } from "../src/projects/drawings";
import { memoryDrafts } from "../src/workspace/localDraft";
import { useDrawings } from "../src/workspace/useDrawings";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const drawing = (kind: DrawingKind, doc: unknown, version: number, by = "Ana Kovač"): Drawing => ({
  kind,
  schemaVersion: 1,
  doc,
  version,
  updatedAt: "2026-11-03T10:00:00Z",
  updatedBy: { id: "u2", displayName: by },
});

/** A fake projects API holding drawings in memory, with the server's version check. */
function fakeApi(start: Partial<Record<DrawingKind, Drawing>> = {}) {
  const store = { ...start };
  const api = {
    drawings: vi.fn(async () => ({ ...store })),
    saveDrawing: vi.fn(async (_id: string, kind: DrawingKind, doc: unknown, base: number | null) => {
      const cur = store[kind];
      if ((cur?.version ?? null) !== base) throw new DrawingConflict(cur ?? null);
      return (store[kind] = drawing(kind, doc, (cur?.version ?? 0) + 1, "Alice"));
    }),
  };
  return { api, store };
}

async function open(api: ReturnType<typeof fakeApi>["api"], editable = true) {
  const h = renderHook(({ e }) => useDrawings(api, "p1", e), { initialProps: { e: editable } });
  await waitFor(() => expect(h.result.current.loaded).toBe(true));
  return h;
}

describe("project drawings", () => {
  it("loads the saved drawings and saves a change a moment later, based on the last version", async () => {
    const { api, store } = fakeApi({ railway: drawing("railway", { stations: [] }, 4) });
    const h = await open(api);
    expect(h.result.current.doc("railway")).toEqual({ stations: [] });
    expect(h.result.current.doc("street-lines")).toBeNull();
    expect(h.result.current.status).toBe("saved");

    vi.useFakeTimers();
    act(() => h.result.current.set("railway", { stations: [1] }));
    act(() => h.result.current.set("railway", { stations: [1, 2] }));
    expect(h.result.current.status).toBe("saving");
    expect(api.saveDrawing).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(api.saveDrawing).toHaveBeenCalledTimes(1);
    expect(api.saveDrawing).toHaveBeenLastCalledWith("p1", "railway", { stations: [1, 2] }, 4);
    expect(h.result.current.status).toBe("saved");

    act(() => h.result.current.set("railway", { stations: [3] }));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(api.saveDrawing).toHaveBeenLastCalledWith("p1", "railway", { stations: [3] }, 5);
    expect(store.railway?.version).toBe(6);
  });

  it("does not save a document that did not change, or anything for a viewer", async () => {
    const { api } = fakeApi({ railway: drawing("railway", { stations: [] }, 1) });
    const h = await open(api);
    vi.useFakeTimers();
    act(() => h.result.current.set("railway", { stations: [] }));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(api.saveDrawing).not.toHaveBeenCalled();

    h.rerender({ e: false });
    act(() => h.result.current.set("railway", { stations: [9] }));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(api.saveDrawing).not.toHaveBeenCalled();
    expect(h.result.current.doc("railway")).toEqual({ stations: [9] });
  });

  it("stops at a clash until the person keeps their drawing or takes the other one", async () => {
    const { api, store } = fakeApi({ "street-setups": drawing("street-setups", [{ way: 1 }], 1) });
    const h = await open(api);
    // Someone else saves in between.
    store["street-setups"] = drawing("street-setups", [{ way: 2 }], 2);
    vi.useFakeTimers();
    act(() => h.result.current.set("street-setups", [{ way: 3 }]));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(h.result.current.status).toBe("conflict");
    expect(h.result.current.clash).toMatchObject({ kind: "street-setups", by: "Ana Kovač" });

    // Further changes wait while the clash is open.
    act(() => h.result.current.set("street-setups", [{ way: 4 }]));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(api.saveDrawing).toHaveBeenCalledTimes(1);

    const gen = h.result.current.generation("street-setups");
    act(() => h.result.current.takeTheirs());
    expect(h.result.current.doc("street-setups")).toEqual([{ way: 2 }]);
    expect(h.result.current.generation("street-setups")).toBe(gen + 1);
    expect(h.result.current.status).toBe("saved");

    store["street-setups"] = drawing("street-setups", [{ way: 5 }], 3);
    act(() => h.result.current.set("street-setups", [{ way: 6 }]));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(h.result.current.clash).not.toBeNull();
    await act(async () => h.result.current.keepMine());
    expect(store["street-setups"]).toMatchObject({ version: 4, doc: [{ way: 6 }] });
    expect(h.result.current.status).toBe("saved");
  });

  it("tries again after a lost connection and shows a refused save", async () => {
    const { api } = fakeApi();
    const h = await open(api);
    vi.useFakeTimers();
    api.saveDrawing.mockRejectedValueOnce(new DrawingSaveError("no connection to the server", true));
    act(() => h.result.current.set("railway", { stations: [1] }));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(h.result.current.status).toBe("offline");
    await act(() => vi.advanceTimersByTimeAsync(2500));
    expect(api.saveDrawing).toHaveBeenCalledTimes(2);
    expect(h.result.current.status).toBe("saved");

    api.saveDrawing.mockRejectedValueOnce(new DrawingSaveError("the drawing is too large to save", false));
    act(() => h.result.current.set("railway", { stations: [2] }));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(h.result.current.status).toBe("failed");
    expect(h.result.current.error).toBe("the drawing is too large to save");
    // It stays "not saved" until Try again sends it, and only then reads as saved.
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(h.result.current.status).toBe("failed");
    await act(async () => h.result.current.retry());
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(api.saveDrawing).toHaveBeenCalledTimes(4);
    expect(h.result.current.status).toBe("saved");
  });

  it("sends a waiting change when the project closes", async () => {
    const { api } = fakeApi();
    const h = await open(api);
    act(() => h.result.current.set("railway", { stations: [1] }));
    h.unmount();
    expect(api.saveDrawing).toHaveBeenCalledWith("p1", "railway", { stations: [1] }, null);
  });

  it("undoes and redoes changes to the drawings, joining quick changes into one step", async () => {
    const { api } = fakeApi({ railway: drawing("railway", { stations: [] }, 1) });
    const h = await open(api);
    vi.useFakeTimers();
    expect(h.result.current.canUndo).toBe(false);
    // A drag: many changes close together are one step.
    act(() => h.result.current.set("railway", { stations: [1] }));
    act(() => h.result.current.set("railway", { stations: [1, 2] }));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    act(() => h.result.current.set("street-lines", { lines: [{ name: "A" }] }));
    expect(h.result.current.canUndo).toBe(true);
    const generation = h.result.current.generation("railway");

    act(() => h.result.current.undo());
    expect(h.result.current.doc("street-lines")).toBeNull();
    act(() => h.result.current.undo());
    expect(h.result.current.doc("railway")).toEqual({ stations: [] });
    // The railway editor opens again from the drawing undone.
    expect(h.result.current.generation("railway")).toBe(generation + 1);
    expect(h.result.current.canUndo).toBe(false);
    expect(h.result.current.canRedo).toBe(true);

    // What the editor sends back as it opens again is not a new step.
    act(() => h.result.current.set("railway", { stations: [] }));
    act(() => h.result.current.redo());
    expect(h.result.current.doc("railway")).toEqual({ stations: [1, 2] });
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(api.saveDrawing).toHaveBeenLastCalledWith(
      "p1",
      "railway",
      { stations: [1, 2] },
      expect.any(Number),
    );

    // A new change after an undo drops the steps that could be redone.
    act(() => h.result.current.undo());
    await act(() => vi.advanceTimersByTimeAsync(2000));
    act(() => h.result.current.set("railway", { stations: [7] }));
    expect(h.result.current.canRedo).toBe(false);
    // Settings and worked-out results are not undone.
    act(() => h.result.current.set("preferences", { values: { a: 1 } }));
    act(() => h.result.current.undo());
    expect(h.result.current.doc("railway")).toEqual({ stations: [] });
    expect(h.result.current.doc("preferences")).toEqual({ values: { a: 1 } });
  });

  it("undoes the first change of a saved drawing by saving it empty, never as nothing", async () => {
    const { api, store } = fakeApi();
    const h = await open(api);
    vi.useFakeTimers();
    act(() => h.result.current.set("street-setups", [{ way: 410002334, lanes: 2 }]));
    act(() =>
      h.result.current.set("railway", {
        origin: [36.3, 33.5],
        mode: "tram",
        stations: [{ id: 1 }],
        tracks: [],
        switches: [],
      }),
    );
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(store["street-setups"]?.version).toBe(1);

    act(() => h.result.current.undo());
    act(() => h.result.current.undo());
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(api.saveDrawing).toHaveBeenCalledWith("p1", "street-setups", [], 1);
    expect(api.saveDrawing).toHaveBeenCalledWith(
      "p1",
      "railway",
      { origin: [36.3, 33.5], mode: "tram", stations: [], tracks: [], switches: [] },
      1,
    );
    expect(api.saveDrawing.mock.calls.some((c) => c[2] === null)).toBe(false);
    expect(h.result.current.doc("street-setups")).toEqual([]);
    expect(h.result.current.status).toBe("saved");

    // Redo brings the change back.
    act(() => h.result.current.redo());
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(store["street-setups"]?.doc).toEqual([{ way: 410002334, lanes: 2 }]);
  });

  it("does not undo for a viewer", async () => {
    const { api } = fakeApi({ railway: drawing("railway", { stations: [] }, 1) });
    const h = await open(api, false);
    act(() => h.result.current.set("railway", { stations: [9] }));
    expect(h.result.current.canUndo).toBe(false);
    act(() => h.result.current.undo());
    expect(h.result.current.doc("railway")).toEqual({ stations: [9] });
  });
});

describe("unsaved changes kept on this device (#136.2)", () => {
  const openWith = async (
    api: ReturnType<typeof fakeApi>["api"],
    drafts: ReturnType<typeof memoryDrafts>,
  ) => {
    const h = renderHook(() => useDrawings(api, "p1", true, drafts));
    await waitFor(() => expect(h.result.current.loaded).toBe(true));
    return h;
  };

  it("keeps a change on the device until the server has it", async () => {
    const { api } = fakeApi({ railway: drawing("railway", { stations: [] }, 4) });
    api.saveDrawing.mockRejectedValueOnce(new DrawingSaveError("Session expired", false));
    const drafts = memoryDrafts();
    const h = await openWith(api, drafts);
    vi.useFakeTimers();
    act(() => h.result.current.set("railway", { stations: [1] }));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(h.result.current.status).toBe("failed");
    expect(drafts.all.get("p1/railway")).toMatchObject({ doc: { stations: [1] }, baseVersion: 4 });
    act(() => h.result.current.retry());
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(h.result.current.status).toBe("saved");
    expect(drafts.all.has("p1/railway")).toBe(false);
  });

  it("brings an unsaved change back after a reload and saves it", async () => {
    const { api, store } = fakeApi({ railway: drawing("railway", { stations: [] }, 4) });
    const drafts = memoryDrafts();
    await drafts.put("p1", { kind: "railway", doc: { stations: [7] }, baseVersion: 4, at: Date.now() });
    const h = await openWith(api, drafts);
    expect(h.result.current.doc("railway")).toEqual({ stations: [7] });
    expect(h.result.current.restored).toBe(1);
    await waitFor(() => expect(store.railway?.doc).toEqual({ stations: [7] }));
  });

  it("asks which to keep when someone saved since the change was made", async () => {
    const { api } = fakeApi({ railway: drawing("railway", { stations: ["theirs"] }, 6) });
    const drafts = memoryDrafts();
    await drafts.put("p1", { kind: "railway", doc: { stations: ["mine"] }, baseVersion: 4, at: Date.now() });
    const h = await openWith(api, drafts);
    expect(h.result.current.status).toBe("conflict");
    expect(h.result.current.doc("railway")).toEqual({ stations: ["mine"] });
    act(() => h.result.current.takeTheirs());
    expect(h.result.current.doc("railway")).toEqual({ stations: ["theirs"] });
    await waitFor(() => expect(drafts.all.has("p1/railway")).toBe(false));
  });
});
