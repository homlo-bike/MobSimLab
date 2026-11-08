import type { TileFetcher } from "../street-lines/types";
import type { RailEngine, RailEngineLoader, RailView } from "./types";

let wasmModule: Promise<typeof import("../../wasm/rail-design/rail_design_wasm.js")> | null = null;

/** Purpose: load and instantiate the WebAssembly module once (React mounts effects twice in development). */
function initWasm() {
  wasmModule ??= import("../../wasm/rail-design/rail_design_wasm.js").then(async (wasm) => {
    await wasm.default();
    return wasm;
  });
  return wasmModule;
}

/**
 * Purpose: load the rail-design WebAssembly module and create an engine.
 * Output: the engine; every edit sends the whole document to `build`.
 * Dependencies: apps/web/src/wasm/rail-design, built by tools/wasm/build-rail-design.sh.
 */
export const loadRailEngine: RailEngineLoader = async () => {
  const wasm = await initWasm();
  const d = new wasm.RailDesigner();
  const engine: RailEngine = {
    build: (doc, draft) => JSON.parse(d.build(JSON.stringify(doc), draft ?? 0)) as RailView,
    nearestTrack: ([lon, lat], maxM) => JSON.parse(d.nearest_track(lon, lat, maxM)),
    chainage: (track, [lon, lat]) => d.chainage(track, lon, lat),
    toLocal: ([olon, olat], [lon, lat]) => {
      const v = wasm.RailDesigner.to_local(olon, olat, lon, lat);
      return [v[0]!, v[1]!];
    },
    defaultParams: (mode) => JSON.parse(wasm.RailDesigner.default_params(mode)),
    sample: (mode, [lon, lat]) => JSON.parse(wasm.RailDesigner.sample(mode, lon, lat)),
    topology: () => JSON.parse(d.topology()),
    addStreetTile: (xml) => d.add_street_tile(xml),
    clearStreets: () => d.clear_streets(),
    addRailTile: (xml) => d.add_rail_tile(xml),
    clearRails: () => d.clear_rails(),
    existingSnap: ([lon, lat], maxM) => JSON.parse(d.existing_snap(lon, lat, maxM)),
    setStreetSetups: (s) => d.set_street_setups(JSON.stringify(s)),
    setValues: (v) => d.set_values(JSON.stringify(v)),
    generateSignals: () => JSON.parse(d.generate_signals()),
    signalAnchor: ([lon, lat], maxM) => JSON.parse(d.signal_anchor(lon, lat, maxM)),
    dispose: () => d.free(),
  };
  return engine;
};

/** Purpose: fetch one railway tile from the API (existing OSM railways, cached server-side). */
export const fetchRailTile: TileFetcher = async (x, y) => {
  const res = await fetch(`/api/street-network/rail-tiles/14/${x}/${y}`);
  if (res.status === 401) throw new Error("Sign in to load existing railways.");
  if (!res.ok)
    throw new Error(
      res.status === 400 ? "Invalid tile" : "OpenStreetMap railways are unavailable right now.",
    );
  return res.text();
};
