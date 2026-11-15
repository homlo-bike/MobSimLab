/**
 * The cargo bike plugin's calculations (`cargo_bike_range`, `cargo_bike_savings`) for its tab: streets from
 * the API's walk tiles, heights from the terrain service, the engine in WebAssembly (crates/cargo-bike).
 * Dependencies: apps/web/src/wasm/cargo-bike, built by tools/wasm/build-cargo-bike.sh.
 */
import { fetchProfiles, type TerrainProfiles } from "../../terrain/terrain";
import type { StreetSetup } from "../street-setup/types";
import {
  amenitiesAlong,
  type AmenityNear,
  type BikeAmenity,
  type Conversion,
  corridorTiles,
  type LonLat,
  MAX_TILES,
  type ParamDefault,
  type PerTrip,
  type Reach,
  rayEnds,
  type Route,
  routeTiles,
  type Savings,
  thin,
  type Trip,
} from "./model";

let wasmModule: Promise<typeof import("../../wasm/cargo-bike/cargo_bike_wasm.js")> | null = null;

/** Purpose: load and instantiate the WebAssembly module once. */
function initWasm() {
  wasmModule ??= import("../../wasm/cargo-bike/cargo_bike_wasm.js").then(async (wasm) => {
    await wasm.default();
    return wasm;
  });
  return wasmModule;
}

/** A trip's failure the tab explains in words. */
export class TripError extends Error {
  constructor(
    readonly code: "too_far" | "no_streets" | "no_route" | "tiles",
    message: string = code,
  ) {
    super(message);
  }
}

/** What the tab needs from the network and the engine; tests pass their own. */
export interface CargoBikeEngine {
  defaults(): Promise<Record<string, ParamDefault>>;
  trip(
    start: LonLat,
    destination: LonLat,
    values: Record<string, number>,
    setups: StreetSetup[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ trip: Trip; go: Route; back: Route; snapM: [number, number] }>;
  rangeMap(origin: LonLat, values: Record<string, number>, radiusM?: number): Promise<{ reach: Reach[] }>;
  savings(trip: PerTrip, values: Record<string, number>, conv: Conversion | null): Promise<Savings>;
  /** Charging points and secure or cargo bike parkings along a route, in order from its start. */
  amenities(coords: LonLat[]): Promise<AmenityNear[]>;
}

/** Most amenity tiles one route loads. */
const MAX_AMENITY_TILES = 120;

/** Purpose: fetch one walk tile (OSM XML) from the API. */
async function fetchWalkTile(x: number, y: number): Promise<string> {
  const res = await fetch(`/api/street-network/walk-tiles/14/${x}/${y}`, { credentials: "same-origin" });
  if (!res.ok) throw new TripError("tiles", `walk tile ${x}/${y}: ${res.status}`);
  return res.text();
}

/** Purpose: run `f` over `items`, at most `n` at a time. */
async function pool<T, R>(items: T[], n: number, f: (x: T) => Promise<R>, tick: () => void): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await f(items[i]!);
      tick();
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

/** Profile of one line as the engine takes it: `[distance m, height m | null]`. */
function profileOf(p: TerrainProfiles, i: number): [number, number | null][] {
  return (p.lines[i]?.samples ?? []).map((s) => [s.distM, s.elevationM]);
}

/** Purpose: the engine over HTTP and WebAssembly. */
export function cargoBikeEngine(): CargoBikeEngine {
  return {
    async defaults() {
      const wasm = await initWasm();
      return JSON.parse(wasm.defaults()) as Record<string, ParamDefault>;
    },

    async trip(start, destination, values, setups, onProgress) {
      const tiles = corridorTiles(start, destination);
      if (tiles.length > MAX_TILES) throw new TripError("too_far");
      const wasm = await initWasm();
      let done = 0;
      onProgress?.(0, tiles.length);
      const xmls = await pool(
        tiles,
        6,
        ([x, y]) => fetchWalkTile(x, y),
        () => onProgress?.(++done, tiles.length),
      );
      const router = new wasm.CargoBikeRouter();
      try {
        for (const xml of xmls) router.add_osm(xml);
        router.set_street_setups(JSON.stringify(setups));
        if (router.build() === 0) throw new TripError("no_streets");
        const r = JSON.parse(router.route(JSON.stringify({ from: start, to: destination, values }))) as {
          go: Route | null;
          back: Route | null;
          snap_m: [number, number];
        };
        if (!r.go || !r.back) throw new TripError("no_route");
        // Heights every 25 m and at each vertex, within the terrain service's 20,000 samples.
        const total = r.go.length_m + r.back.length_m;
        const spacingM = Math.max(25, Math.ceil(total / 12_000));
        const prof = await fetchProfiles([thin(r.go.coords, 3000), thin(r.back.coords, 3000)], { spacingM });
        const trip = JSON.parse(
          wasm.trip(
            JSON.stringify({
              go: { route: r.go, profile: profileOf(prof, 0) },
              back: { route: r.back, profile: profileOf(prof, 1) },
              values,
            }),
          ),
        ) as Trip;
        return { trip, go: r.go, back: r.back, snapM: r.snap_m };
      } finally {
        router.free();
      }
    },

    async rangeMap(origin, values, radiusM = 60_000) {
      const wasm = await initWasm();
      const ends = rayEnds(origin, radiusM, 24);
      // 24 lines within the terrain service's 20,000 samples.
      const spacingM = Math.max(50, Math.ceil((radiusM * ends.length) / 15_000));
      const prof = await fetchProfiles(
        ends.map((e) => [origin, e.end]),
        { spacingM },
      );
      const rays = ends.map((e, i) => ({ bearing_deg: e.bearing, end: e.end, profile: profileOf(prof, i) }));
      return JSON.parse(wasm.range_map(JSON.stringify({ origin, rays, values }))) as { reach: Reach[] };
    },

    async amenities(coords) {
      const tiles = routeTiles(coords);
      if (tiles.length > MAX_AMENITY_TILES) throw new TripError("too_far");
      const lists = await pool(
        tiles,
        6,
        async ([x, y]) => {
          const res = await fetch(`/api/street-network/bike-amenity-tiles/14/${x}/${y}`, {
            credentials: "same-origin",
          });
          if (!res.ok) throw new TripError("tiles", `bike amenity tile ${x}/${y}: ${res.status}`);
          return ((await res.json()) as { amenities: BikeAmenity[] }).amenities;
        },
        () => {},
      );
      return amenitiesAlong(coords, lists.flat());
    },

    async savings(trip, values, conv) {
      const wasm = await initWasm();
      return JSON.parse(
        wasm.savings(
          JSON.stringify({
            round_trip_km: trip.km,
            wh_per_km: trip.whPerKm,
            rider_wh: trip.riderWh,
            time_s: trip.timeS,
            values,
            conversion: conv ?? { fx: 1, ppp: 1 },
          }),
        ),
      ) as Savings;
    },
  };
}
