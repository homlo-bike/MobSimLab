import type { StreetSetup } from "./types";

/** The side traffic drives on (Project preferences, `street.driving_side`). */
export type TrafficSide = "right" | "left";

/** Lanes and junctions are drawn from this map zoom; below it they are too small to read. */
export const LANE_MIN_ZOOM = 16;

/** What a lane is (Rust `street_geometry::LaneKind`). */
export type LaneKind =
  | "traffic"
  | "bus"
  | "bike"
  | "tram"
  /** A tram lane from the planner's setup on a street without tram rails in OSM: an empty strip (lane shapes only). */
  | "tram_space"
  | "pavement"
  | "footway"
  | "shared_use"
  | "parking"
  | "kerb"
  | "buffer"
  | "construction"
  | "island"
  | "green";

/** A line on the street (Rust `street_geometry::LineKind`). */
export type LineKind = "lane" | "centre" | "rails";

/** One lane across a street (Rust `street_geometry::LaneProfile`): which way it runs along the OSM way, its
 * width in metres, and whether tram rails run along it. */
export interface LaneProfile {
  kind: LaneKind;
  dir: "forward" | "backward";
  width: number;
  rails: boolean;
}

/** Lane and junction shapes (Rust `street_geometry::Geometry`); rings and paths are flat `[lon, lat, …]`. */
export interface LaneGeometry {
  lanes: { kind: LaneKind; way: number; layer: number; ring: number[] }[];
  /**
   * Junction shapes with their OSM nodes and ways; `crossing` where at least three roads meet (the ones
   * that may have traffic lights), `signals` where OSM maps traffic lights.
   */
  junctions: { ring: number[]; nodes: number[]; ways: number[]; crossing: boolean; signals: boolean }[];
  lines: { kind: LineKind; layer: number; path: number[] }[];
  /** The lanes of each street way, left to right looking along the way. */
  roads: { way: number; lanes: LaneProfile[] }[];
  driving_side: "right" | "left";
}

/** Builds lane shapes for the street tiles it was given. */
export interface LaneEngine {
  /** Hands over one street tile (OSM XML), once. */
  addTile(key: string, xml: string): void;
  /**
   * The shapes of the given tiles with the setups applied, traffic keeping to `side` (Project preferences);
   * `null` when none of them has streets.
   */
  build(
    keys: readonly string[],
    setups: readonly StreetSetup[],
    side: TrafficSide,
  ): Promise<LaneGeometry | null>;
  dispose(): void;
}

/** Starts the lane engine; `null` where the browser cannot run it (no Web Workers). Tests inject a fake. */
export type LaneEngineLoader = () => Promise<LaneEngine | null>;

/** Messages to the worker (lanes.worker.ts). */
export type LaneWorkerRequest =
  | { kind: "tile"; key: string; xml: string }
  | { kind: "build"; id: number; keys: string[]; setups: StreetSetup[]; side: TrafficSide };

/** Answers from the worker. */
export type LaneWorkerReply = { id: number; json: string | null } | { id: number; error: string };

/**
 * Purpose: start the lane engine (osm2streets, ADR-0047) in a Web Worker.
 * Dependencies: apps/web/src/wasm/street-geometry, built by tools/wasm/build-street-geometry.sh; loaded only
 * when the street setup tool opens.
 */
export const loadLaneEngine: LaneEngineLoader = async () => {
  if (typeof Worker === "undefined") return null;
  const worker = new Worker(new URL("./lanes.worker.ts", import.meta.url), { type: "module" });
  const waiting = new Map<
    number,
    { resolve: (g: LaneGeometry | null) => void; reject: (e: Error) => void }
  >();
  let next = 0;
  worker.onmessage = (e: MessageEvent<LaneWorkerReply>) => {
    const w = waiting.get(e.data.id);
    if (!w) return;
    waiting.delete(e.data.id);
    if ("error" in e.data) w.reject(new Error(e.data.error));
    else w.resolve(e.data.json ? (JSON.parse(e.data.json) as LaneGeometry) : null);
  };
  worker.onerror = (e) => {
    for (const w of waiting.values()) w.reject(new Error(e.message || "the lane engine stopped"));
    waiting.clear();
  };
  return {
    addTile: (key, xml) => worker.postMessage({ kind: "tile", key, xml } satisfies LaneWorkerRequest),
    build: (keys, setups, side) =>
      new Promise((resolve, reject) => {
        const id = next++;
        waiting.set(id, { resolve, reject });
        worker.postMessage({
          kind: "build",
          id,
          keys: [...keys],
          setups: [...setups],
          side,
        } satisfies LaneWorkerRequest);
      }),
    dispose: () => worker.terminate(),
  };
};
