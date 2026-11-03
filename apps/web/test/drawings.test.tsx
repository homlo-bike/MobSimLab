import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Drawing, DrawingConflict, type DrawingKind, DrawingSaveError } from "../src/projects/drawings";
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
  });

  it("sends a waiting change when the project closes", async () => {
    const { api } = fakeApi();
    const h = await open(api);
    act(() => h.result.current.set("railway", { stations: [1] }));
    h.unmount();
    expect(api.saveDrawing).toHaveBeenCalledWith("p1", "railway", { stations: [1] }, null);
  });
});
