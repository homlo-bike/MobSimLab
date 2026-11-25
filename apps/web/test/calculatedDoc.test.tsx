import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { calculatedKey, useCalculatedDoc } from "../src/projects/calculatedDoc";
import { answersReady, forgetAnswers, keepAnswersFor, recallAnswer } from "../src/projects/keptAnswers";
import type { ResultKind, ResultsApi, SavedResult } from "../src/projects/results";

interface Doc {
  tracks: number[];
}
const empty = (d: Doc | null) => !d || !d.tracks.length;

/** A project's saved results in memory. */
function store(): ResultsApi {
  const saved = new Map<ResultKind, SavedResult<unknown>>();
  return {
    load: async <T,>(kind: ResultKind) => (saved.get(kind) as SavedResult<T> | undefined) ?? null,
    save: async (kind, value, inputs) => {
      saved.set(kind, { value: JSON.parse(JSON.stringify(value)), inputs, computedAt: null });
      return null;
    },
  };
}

const use = (live: Doc | null, wanted = true) =>
  renderHook(({ doc, on }) => useCalculatedDoc("p1", "railway", doc, true, empty, on), {
    initialProps: { doc: live, on: wanted },
  });

describe("the drawing the tabs calculate from", () => {
  afterEach(() => forgetAnswers());

  it("is the drawing as it is the first time, and is kept with the project's answers", async () => {
    keepAnswersFor("p1", store(), true);
    const h = use({ tracks: [1] });
    expect(h.result.current.ready).toBe(false);
    await waitFor(() => expect(h.result.current.ready).toBe(true));
    expect(h.result.current.doc).toEqual({ tracks: [1] });
    expect(h.result.current.stale).toBe(false);
    expect(recallAnswer(calculatedKey("p1", "railway"))).toBe('{"tracks":[1]}');
  });

  it("stays as last calculated after a change, marked out of date, until recalculated", async () => {
    keepAnswersFor("p1", store(), true);
    const h = use({ tracks: [1] });
    await waitFor(() => expect(h.result.current.ready).toBe(true));
    h.rerender({ doc: { tracks: [1, 2] }, on: true });
    expect(h.result.current.doc).toEqual({ tracks: [1] });
    expect(h.result.current.stale).toBe(true);
    // The change undone: the results are those of the drawing again.
    h.rerender({ doc: { tracks: [1] }, on: true });
    expect(h.result.current.stale).toBe(false);
    h.rerender({ doc: { tracks: [1, 2] }, on: true });
    act(() => h.result.current.recalculate());
    expect(h.result.current.doc).toEqual({ tracks: [1, 2] });
    expect(h.result.current.stale).toBe(false);
    expect(recallAnswer(calculatedKey("p1", "railway"))).toBe('{"tracks":[1,2]}');
  });

  it("opens a project changed since its last calculation with the kept drawing, out of date", async () => {
    const api = store();
    keepAnswersFor("p1", api, true);
    await answersReady();
    const first = use({ tracks: [1] });
    await waitFor(() => expect(first.result.current.ready).toBe(true));
    first.unmount();
    const h = use({ tracks: [1, 2, 3] });
    await waitFor(() => expect(h.result.current.ready).toBe(true));
    expect(h.result.current.doc).toEqual({ tracks: [1] });
    expect(h.result.current.stale).toBe(true);
  });

  it("follows the drawing while nothing was calculated from it", async () => {
    keepAnswersFor("p1", store(), true);
    const h = use({ tracks: [] });
    await waitFor(() => expect(h.result.current.ready).toBe(true));
    h.rerender({ doc: { tracks: [7] }, on: true });
    await waitFor(() => expect(h.result.current.doc).toEqual({ tracks: [7] }));
    expect(h.result.current.stale).toBe(false);
    h.rerender({ doc: { tracks: [7, 8] }, on: true });
    expect(h.result.current.stale).toBe(true);
  });

  it("does not read the project's answers before a tab that calculates shows", async () => {
    keepAnswersFor("p1", store(), true);
    const h = use({ tracks: [1] }, false);
    await act(async () => {
      await Promise.resolve();
    });
    expect(h.result.current.ready).toBe(false);
    h.rerender({ doc: { tracks: [1] }, on: true });
    await waitFor(() => expect(h.result.current.ready).toBe(true));
  });
});
