import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hashText, inputKey, stableJson } from "../src/projects/inputKey";
import {
  type ResultsApi,
  resultFromJson,
  resultToJson,
  useLiveResult,
  useSavedResult,
} from "../src/projects/results";
import { SavedResultNotice } from "../src/projects/SavedResultNotice";
import { factKeyOf } from "../src/static/shim";

afterEach(cleanup);

/** A project's saved results in memory. */
function memoryResults(start: Record<string, { value: unknown; inputs: string }> = {}) {
  const store = new Map(
    Object.entries(start).map(([k, v]) => [k, { ...v, computedAt: null as string | null }]),
  );
  const api: ResultsApi = {
    load: vi.fn(async (kind) => (store.get(kind) as never) ?? null),
    save: vi.fn(async (kind, value, inputs) => {
      store.set(kind, { value, inputs, computedAt: "2026-11-18T17:00:00.000Z" });
      return "2026-11-18T17:00:00.000Z";
    }),
  };
  return { api, store };
}

describe("input fingerprints", () => {
  it("are the same whatever the order of the keys, and differ when a value does", () => {
    expect(stableJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(inputKey({ b: 1, a: [1, 2] })).toBe(inputKey({ a: [1, 2], b: 1 }));
    expect(inputKey({ a: [1, 2] })).not.toBe(inputKey({ a: [2, 1] }));
    expect(hashText("x")).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("saved result format", () => {
  it("keeps typed arrays and maps through JSON", () => {
    const value = {
      f32: new Float32Array([1.5, Number.NaN]),
      f64: new Float64Array([2.25]),
      u8: new Uint8Array([1, 2, 3]),
      byScenario: new Map([["all", [{ jobs: 3 }]]]),
    };
    const back = resultFromJson<typeof value>(resultToJson(value))!;
    expect(back.f32).toBeInstanceOf(Float32Array);
    expect(back.f32[0]).toBe(1.5);
    expect(Number.isNaN(back.f32[1])).toBe(true);
    expect([...back.f64]).toEqual([2.25]);
    expect([...back.u8]).toEqual([1, 2, 3]);
    expect(back.byScenario.get("all")).toEqual([{ jobs: 3 }]);
    expect(resultFromJson(JSON.stringify({ version: 99, value: 1 }))).toBeUndefined();
  });
});

describe("saved results in a tool", () => {
  it("tells whether the saved result matches the inputs now, and saves only for editors", async () => {
    const { api } = memoryResults({ noise: { value: 1, inputs: "a" } });
    const { result, rerender } = renderHook(
      ({ inputs, canSave }) => useSavedResult<number>(api, "noise", inputs, canSave),
      {
        initialProps: { inputs: "a", canSave: false },
      },
    );
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.state).toBe("current");
    rerender({ inputs: "b", canSave: false });
    expect(result.current.state).toBe("stale");
    act(() => result.current.save(2, "b"));
    expect(api.save).not.toHaveBeenCalled();
    rerender({ inputs: "b", canSave: true });
    act(() => result.current.save(2, "b"));
    expect(api.save).toHaveBeenCalledWith("noise", 2, "b");
    expect(result.current.state).toBe("current");
  });

  it("uses a fast result as saved while it matches, and works it out and saves it when the inputs change", async () => {
    const { api, store } = memoryResults({ "cost-quantities": { value: "saved", inputs: "a" } });
    const compute = vi.fn(async () => "fresh");
    const { result, rerender } = renderHook(
      ({ inputs }) => useLiveResult<string>(api, "cost-quantities", inputs, true, compute),
      { initialProps: { inputs: "a" as string | null } },
    );
    await waitFor(() => expect(result.current.value).toBe("saved"));
    expect(compute).not.toHaveBeenCalled();
    rerender({ inputs: "b" });
    await waitFor(() => expect(result.current.value).toBe("fresh"));
    expect(compute).toHaveBeenCalledTimes(1);
    expect(store.get("cost-quantities")).toMatchObject({ value: "fresh", inputs: "b" });
    rerender({ inputs: null });
    expect(result.current.value).toBeNull();
  });

  it("says when a result is out of date and offers to recalculate it", () => {
    const onRecalculate = vi.fn();
    render(
      <SavedResultNotice state="stale" computedAt="2026-11-18T17:00:00.000Z" onRecalculate={onRecalculate} />,
    );
    expect(screen.getByText(/Out of date/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Recalculate" }));
    expect(onRecalculate).toHaveBeenCalled();
    cleanup();
    render(<SavedResultNotice state="current" />);
    expect(screen.getByText("Saved with the project.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("kept facts in the static viewer", () => {
  it("finds a request's fact under the key the API keeps it", () => {
    const q = (s: string) => new URLSearchParams(s);
    expect(factKeyOf("/api/calendar/holidays", q("country=de&year=2027&project=x"))).toBe("holidays/DE/2027");
    expect(factKeyOf("/api/calendar/climate", q("lat=52.52&lon=13.41"))).toBe("climate/52.5,13.4");
    expect(factKeyOf("/api/economy/indicators", q("code=deu&base=2023"))).toBe("economy/DEU/2023");
    expect(factKeyOf("/api/benefits/indicators", q("code=FRA"))).toBe("benefit-indicators/FRA");
    expect(factKeyOf("/api/economy/countries", q(""))).toBe("economy-countries");
    expect(factKeyOf("/api/places/search", q("q=x"))).toBeNull();
  });
});
