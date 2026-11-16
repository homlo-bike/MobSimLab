import { afterEach, describe, expect, it, vi } from "vitest";
import { projectRuns } from "../src/features/capacity/server";

describe("projectRuns", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lists only capacity runs, not the settings sweeps agents start", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            runs: [
              { id: "a", kind: "capacity" },
              { id: "b", kind: "sweep" },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    );
    vi.stubGlobal("fetch", fetch);
    const runs = await projectRuns("p1", "csrf").list();
    expect(runs.map((r) => r.id)).toEqual(["a"]);
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe("/api/projects/p1/simulation-runs");
  });
});
