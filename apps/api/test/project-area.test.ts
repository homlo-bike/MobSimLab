import { describe, expect, it, vi } from "vitest";
import { areasQuery } from "../src/benefits/benefits.service";
import { areaBody, ProjectAreaService } from "../src/projects/area.service";
import { type AreaRegion, joinBoxes, storedRegions } from "../src/projects/project-area";

const square = (x: number, y: number, d: number): [number, number][] => [
  [x, y],
  [x + d, y],
  [x + d, y + d],
  [x, y + d],
  [x, y],
];
const region = (id: string, ring = square(37.1, 36.1, 0.1)): AreaRegion => ({
  id,
  name: `Region ${id}`,
  kind: "administrative",
  adminLevel: 8,
  ring,
  areaKm2: 100,
});

describe("project area from OpenStreetMap regions (#140)", () => {
  it("joins boxes, either of which may be missing", () => {
    expect(joinBoxes(null, null)).toBeNull();
    expect(joinBoxes([0, 0, 1, 1], null)).toEqual([0, 0, 1, 1]);
    expect(joinBoxes([0, 0, 1, 1], [0.5, -1, 2, 0.5])).toEqual([0, -1, 2, 1]);
  });

  it("reads stored regions and skips malformed ones", () => {
    const ok = region("r1");
    expect(storedRegions([ok, { id: "r2", name: "No ring", ring: [] }, "junk", null])).toEqual([ok]);
    expect(storedRegions(null)).toEqual([]);
  });

  it("accepts up to ten distinct regions with closed outlines", () => {
    expect(areaBody.safeParse({ regions: [region("r1"), region("w2")] }).success).toBe(true);
    expect(areaBody.parse({ regions: [] }).import).toBe(true);
    expect(areaBody.safeParse({ regions: [region("r1"), region("r1")] }).success).toBe(false);
    expect(areaBody.safeParse({ regions: [region("n1")] }).success).toBe(false);
    expect(areaBody.safeParse({ regions: [region("r1", [[0, 0]])] }).success).toBe(false);
    expect(
      areaBody.safeParse({ regions: Array.from({ length: 11 }, (_, i) => region(`r${i + 1}`)) }).success,
    ).toBe(false);
  });

  it("asks Overpass for states and provinces only for the area picker", () => {
    expect(areasQuery(13.4, 52.5)).toContain('"^([6-9]|1[01])$"');
    expect(areasQuery(13.4, 52.5, true)).toContain('"^([4-9]|1[01])$"');
  });
});

vi.mock("../src/projects/project-area", async (orig) => ({
  ...(await orig<typeof import("../src/projects/project-area")>()),
  projectArea: vi.fn(async () => ({
    bbox: [37, 36, 37.3, 36.3],
    drawnBbox: [37, 36, 37.3, 36.3],
    bufferKm: 2,
    regions: [],
  })),
}));

describe("queueing the imports when the area is saved", () => {
  const actor = { userId: "u", role: "member", ipHash: null, requestId: null } as never;
  const make = (o: {
    suggested?: "overpass" | "geofabrik";
    osmCovers?: boolean;
    demLatest?: string;
    layers?: unknown[];
    demFails?: boolean;
  }) => {
    const geodata = {
      status: vi.fn(async () => ({
        suggestedMethod: o.suggested ?? "overpass",
        osm: { coversDrawing: !!o.osmCovers, latest: null },
        dem: { coversDrawing: false, latest: o.demLatest ? { status: o.demLatest } : null },
      })),
      startOsm: vi.fn(async () => ({})),
      startDem: vi.fn(async () => {
        if (o.demFails) throw new Error("The project area is too big for an elevation import");
        return {};
      }),
      regions: vi.fn(async () => [{ id: "asia/syria", name: "Syria" }]),
    };
    const population = {
      overview: vi.fn(async () => ({ layers: o.layers ?? [] })),
      startImport: vi.fn(async () => ({})),
    };
    const svc = new ProjectAreaService({} as never, {} as never, geodata as never, population as never);
    return { svc, geodata, population };
  };

  it("queues OSM through Overpass, elevation and WorldPop", async () => {
    const { svc, geodata, population } = make({});
    expect(await svc.queueImports(actor, "p")).toEqual([
      { kind: "osm", status: "queued" },
      { kind: "dem", status: "queued" },
      { kind: "population", status: "queued" },
    ]);
    expect(geodata.startOsm).toHaveBeenCalledWith(actor, "p", { method: "overpass", planned: false });
    expect(population.startImport).toHaveBeenCalledWith(actor, "p", {
      source: "worldpop",
      confidence: "medium",
    });
  });

  it("uses the smallest Geofabrik region for large areas and skips what is already there", async () => {
    const { svc, geodata, population } = make({
      suggested: "geofabrik",
      demLatest: "running",
      layers: [{ status: "ready", kind: "grid", coverage: [36, 35, 38, 37] }],
    });
    const out = await svc.queueImports(actor, "p");
    expect(geodata.startOsm).toHaveBeenCalledWith(actor, "p", {
      method: "geofabrik",
      region: "asia/syria",
      planned: false,
    });
    expect(out.map((x) => x.status)).toEqual(["queued", "current", "current"]);
    expect(geodata.startDem).not.toHaveBeenCalled();
    expect(population.startImport).not.toHaveBeenCalled();
  });

  it("says why an import could not start and still starts the others", async () => {
    const { svc } = make({ osmCovers: true, demFails: true });
    expect(await svc.queueImports(actor, "p")).toEqual([
      { kind: "osm", status: "current" },
      { kind: "dem", status: "failed", reason: "The project area is too big for an elevation import" },
      { kind: "population", status: "queued" },
    ]);
  });
});
