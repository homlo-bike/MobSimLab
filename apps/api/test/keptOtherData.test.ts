import { describe, expect, it } from "vitest";
import type { MslRequest } from "../src/auth/session.service";
import { GbfsError } from "../src/gateway/gbfs.client";
import { factGroup } from "../src/mslab/fetched";
import { factKey, type ProjectDataCache } from "../src/projects/data-cache";
import { RunsService } from "../src/simulation/runs.service";
import { TerrainController } from "../src/terrain/terrain.controller";

/** Projects' kept facts in memory, as `ProjectDataCache` keeps them in the database. */
function keptInMemory() {
  const rows = new Map<string, string>();
  const kept = {
    get: async (p: string, _k: string, key: string) => rows.get(`${p}/${key}`) ?? null,
    getMany: async (p: string, _k: string, keys: readonly string[]) =>
      new Map(keys.filter((k) => rows.has(`${p}/${k}`)).map((k) => [k, rows.get(`${p}/${k}`)!])),
    put: async (p: string, _k: string, key: string, body: string) => void rows.set(`${p}/${key}`, body),
    putMany: async (p: string, _k: string, entries: readonly [string, string][]) => {
      for (const [k, v] of entries) rows.set(`${p}/${k}`, v);
    },
  } as unknown as ProjectDataCache;
  return { rows, kept };
}

/**
 * Shared-bike stations and water depths kept with the project (project file as a complete capsule, stage 3), so
 * a saved file carries them with the other location facts and the tools work without the outside service.
 */
describe("shared-bike stations and water depths kept with the project", () => {
  it("saves both with the other fetched data", () => {
    expect(factGroup(factKey.gbfs("https://g.example/gbfs.json"))).toBe("otherFetched");
    expect(factGroup(factKey.depth(4.9, 52.4))).toBe("otherFetched");
    // A feed is kept under its own key; a point to four decimals.
    expect(factKey.gbfs("https://a.example/gbfs.json")).not.toBe(factKey.gbfs("https://b.example/gbfs.json"));
    expect(factKey.depth(4.90004, 52.4)).toBe("depth/4.9000,52.4000");
  });

  it("asks GEBCO only for depths the project does not hold, and answers without it afterwards", async () => {
    const { rows, kept } = keptInMemory();
    const asked: [number, number][][] = [];
    const gebco = {
      depths: async (points: [number, number][]) => {
        asked.push(points);
        return points.map(([lon]) => (lon > 5 ? null : 12));
      },
    };
    const gate = { readable: async (_req: unknown, id: unknown) => (id === "p1" ? "p1" : undefined) };
    const req = {} as MslRequest;
    const points = [
      [4.9, 52.4],
      [6, 53],
    ];
    const live = new TerrainController(null as never, gate as never, gebco as never, kept);
    expect((await live.depths({ points, projectId: "p1" }, req)).depthsM).toEqual([12, null]);
    expect(rows.get("p1/depth/4.9000,52.4000")).toBe("12");
    expect(rows.get("p1/depth/6.0000,53.0000")).toBe("null");
    // One more point: only that one is asked.
    await live.depths({ points: [...points, [4.5, 52]], projectId: "p1" }, req);
    expect(asked).toEqual([points, [[4.5, 52]]]);

    // An instance without the depth service (or a project opened from a file there) still answers what is kept.
    const off = new TerrainController(null as never, gate as never, undefined, kept);
    expect((await off.depths({ points, projectId: "p1" }, req)).depthsM).toEqual([12, null]);
    await expect(off.depths({ points: [[1, 1]], projectId: "p1" }, req)).rejects.toThrow(/turned off/);
    // Without a project nothing is kept or read.
    await expect(off.depths({ points }, req)).rejects.toThrow(/turned off/);
  });

  it("keeps the stations of a GBFS feed and uses them when the feed cannot be read", async () => {
    const { rows, kept } = keptInMemory();
    const url = "https://g.example/gbfs.json";
    let up = true;
    const gbfs = {
      stations: async () => {
        if (!up) throw new GbfsError("the feed answered 503");
        return [
          [8, 47],
          [8.1, 47.1],
        ];
      },
    };
    const runs = new RunsService(
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      gbfs as never,
      kept,
    );
    const bikes = (
      runs as unknown as {
        demandBikes(
          tiles: [number, number][],
          gbfsUrl?: string,
          projectId?: string,
        ): Promise<{ rental: [number, number][]; notes: string[] }>;
      }
    ).demandBikes.bind(runs);

    const first = await bikes([], url, "p1");
    expect(first).toMatchObject({
      rental: [
        [8, 47],
        [8.1, 47.1],
      ],
      notes: [],
    });
    const stored = JSON.parse(rows.get(`p1/${factKey.gbfs(url)}`)!) as { url: string; readAt: string };
    expect(stored.url).toBe(url);

    up = false;
    const later = await bikes([], url, "p1");
    expect(later.rental).toEqual(first.rental);
    expect(later.notes).toEqual([
      `the feed answered 503; the 2 shared-bike stations kept with the project on ${stored.readAt.slice(0, 10)} were used`,
    ]);
    // Another project has no kept stations: the run goes on without them and says why.
    expect(await bikes([], url, "p2")).toMatchObject({ rental: [], notes: ["the feed answered 503"] });
  });
});
