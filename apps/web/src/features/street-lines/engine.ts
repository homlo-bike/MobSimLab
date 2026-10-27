import type { EngineLoader, LineView, Mode, RoutingRules, StreetEngine, VehicleProfile } from "./types";

/**
 * Purpose: load the street-routing WebAssembly module and build a road network from OSM XML.
 * Inputs: OSM XML text (from tools/osm/overpass_fetch.py or an openstreetmap.org export).
 * Output: the engine; rejects when the file has no roads usable by buses.
 * Dependencies: apps/web/src/wasm/street-routing, built by tools/wasm/build-street-routing.sh.
 */
export const loadWasmEngine: EngineLoader = async (osmXml) => {
  const wasm = await import("../../wasm/street-routing/street_routing_wasm.js");
  await wasm.default();
  const ed = new wasm.StreetLineEditor(osmXml);
  const v = (json: string): LineView => JSON.parse(json) as LineView;
  const engine: StreetEngine = {
    bounds: () => Array.from(ed.bounds()) as [number, number, number, number],
    stats: () => JSON.parse(ed.stats()),
    view: () => v(ed.view()),
    insertPoint: (seq, [lon, lat], kind) => v(ed.insert_point(seq, lon, lat, kind)),
    movePoint: (id, [lon, lat]) => v(ed.move_point(id, lon, lat)),
    deletePoint: (id) => v(ed.delete_point(id)),
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
