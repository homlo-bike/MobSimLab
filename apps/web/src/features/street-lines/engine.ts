import type {
  EngineLoader,
  LineView,
  Mode,
  RoutingRules,
  StreetEngine,
  TileFetcher,
  VehicleProfile,
} from "./types";

let wasmModule: Promise<typeof import("../../wasm/street-routing/street_routing_wasm.js")> | null = null;

/**
 * Purpose: load and instantiate the WebAssembly wasmModule once. Two concurrent instantiations (React
 * mounts effects twice in development) would swap the wasmModule's memory under live editor objects.
 */
function initWasm() {
  wasmModule ??= import("../../wasm/street-routing/street_routing_wasm.js").then(async (wasm) => {
    await wasm.default();
    return wasm;
  });
  return wasmModule;
}

/**
 * Purpose: load the street-routing WebAssembly wasmModule and create an empty editor.
 * Output: the engine. Streets are added tile by tile with `addOsm` and `rebuild`.
 * Dependencies: apps/web/src/wasm/street-routing, built by tools/wasm/build-street-routing.sh.
 */
export const loadWasmEngine: EngineLoader = async () => {
  const wasm = await initWasm();
  const ed = new wasm.StreetLineEditor();
  const v = (json: string): LineView => JSON.parse(json) as LineView;
  const engine: StreetEngine = {
    addOsm: (xml) => ed.add_osm(xml),
    rebuild: () => v(ed.rebuild()),
    ready: () => ed.ready(),
    view: () => v(ed.view()),
    insertPoint: (seq, [lon, lat], kind) => v(ed.insert_point(seq, lon, lat, kind)),
    movePoint: (id, [lon, lat]) => v(ed.move_point(id, lon, lat)),
    deletePoint: (id) => v(ed.delete_point(id)),
    clear: () => v(ed.clear()),
    setKind: (id, kind) => v(ed.set_kind(id, kind)),
    setName: (id, name) => v(ed.set_name(id, name)),
    setDepot: ([lon, lat]) => v(ed.set_depot(lon, lat)),
    clearDepot: () => v(ed.clear_depot()),
    optimise: () => v(ed.optimise()),
    setSettings: (p, r) => v(ed.set_settings(JSON.stringify(p), JSON.stringify(r))),
    usableRoads: () => JSON.parse(ed.usable_roads()),
    defaultProfile: (mode: Mode) => JSON.parse(wasm.StreetLineEditor.default_profile(mode)) as VehicleProfile,
    defaultRules: () => JSON.parse(wasm.StreetLineEditor.default_rules()) as RoutingRules,
    dispose: () => ed.free(),
  };
  return engine;
};

/** Purpose: fetch one street tile from the API (OSM streets, fetched and cached server-side). */
export const fetchStreetTile: TileFetcher = async (x, y) => {
  const res = await fetch(`/api/street-network/tiles/14/${x}/${y}`);
  if (!res.ok)
    throw new Error(res.status === 400 ? "Invalid tile" : "OpenStreetMap streets are unavailable right now.");
  return res.text();
};
