import { afterEach, describe, expect, it, vi } from "vitest";
import { CachedDesigner, type Designer } from "../src/features/railways/designerCache";
import {
  answersReady,
  closeAnswers,
  forgetAnswers,
  keepAnswersFor,
  recallAnswer,
  rememberAnswer,
} from "../src/projects/keptAnswers";
import type { ResultKind, ResultsApi, SavedResult } from "../src/projects/results";

/** A project's saved results in memory, counting the saves. */
function store() {
  const saved = new Map<ResultKind, SavedResult<unknown>>();
  let saves = 0;
  const api: ResultsApi = {
    load: async <T,>(kind: ResultKind) => (saved.get(kind) as SavedResult<T> | undefined) ?? null,
    save: async (kind, value, inputs) => {
      saves++;
      // As the API keeps it: JSON text read back.
      saved.set(kind, { value: JSON.parse(JSON.stringify(value)), inputs, computedAt: null });
      return null;
    },
  };
  return { api, saves: () => saves };
}

/** An engine that counts its builds and publications. */
function engine() {
  let runs = 0;
  const d: Designer = {
    build: (doc) => (runs++, JSON.stringify({ doc })),
    publish_lines: (lines, id) => (runs++, JSON.stringify({ lines, id })),
    publish_lines_with: (lines, id) => (runs++, JSON.stringify({ lines, id })),
    missing_terrain_tiles: () => "[]",
    topology: () => "{}",
  };
  return { d, runs: () => runs };
}

describe("long calculations' answers saved with the project", () => {
  afterEach(() => {
    vi.useRealTimers();
    forgetAnswers();
  });

  it("reads the railway built and its timetables back on the next visit instead of planning again", async () => {
    vi.useFakeTimers();
    const s = store();
    keepAnswersFor("p1", s.api, true);
    await answersReady();
    const one = engine();
    const a = new CachedDesigner(one.d, "v1");
    const view = a.build("railway", 0);
    const pub = a.publishLines("[lines]", "weekday");
    expect(one.runs()).toBe(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s.saves()).toBe(1);

    // The page opened again: nothing kept in memory, the project's saved answers read back.
    forgetAnswers();
    keepAnswersFor("p1", s.api, true);
    await answersReady();
    const two = engine();
    const b = new CachedDesigner(two.d, "v1");
    expect(b.build("railway", 0)).toBe(view);
    expect(b.publishLines("[lines]", "weekday")).toBe(pub);
    expect(two.runs()).toBe(0);
    // Nothing new: not saved again.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s.saves()).toBe(1);

    // Another engine works them out again.
    const three = engine();
    new CachedDesigner(three.d, "v2").build("railway", 0);
    expect(three.runs()).toBe(1);
  });

  it("does not save for a member who may not change the project, and saves pending answers on closing", async () => {
    vi.useFakeTimers();
    const s = store();
    keepAnswersFor("p1", s.api, false);
    rememberAnswer("k1", "v1");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s.saves()).toBe(0);

    keepAnswersFor("p1", s.api, true);
    rememberAnswer("k2", "v2");
    closeAnswers("p1");
    await vi.advanceTimersByTimeAsync(0);
    expect(s.saves()).toBe(1);
    forgetAnswers();
    keepAnswersFor("p1", s.api, true);
    await answersReady();
    // Both answers of the project were saved, and read back.
    expect(recallAnswer("k1")).toBe("v1");
    expect(recallAnswer("k2")).toBe("v2");
  });
});
