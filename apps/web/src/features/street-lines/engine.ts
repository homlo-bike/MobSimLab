import { tNow } from "../../i18n/i18n";
import type { StreetInfo, StreetInfoLoader } from "../street-setup/types";
import type {
  CatchmentGeoJson,
  CoverageResult,
  SpacingResult,
  WalkEngine,
  WalkEngineLoader,
  WalkTileFetcher,
} from "../walk/types";
import type {
  EngineLoader,
  LineView,
  Mode,
  RoutingRules,
  StreetEngine,
  TileFetcher,
  VehicleProfile,
} from "./types";
import { withProject } from "../../geodata/projectData";
import { fetchTileWithRetry } from "../../geodata/tileFetch";

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
    switchSide: (id) => v(ed.switch_side(id)),
    sideCost: (id) => ed.side_cost(id),
    setName: (id, name) => v(ed.set_name(id, name)),
    setDepot: ([lon, lat]) => v(ed.set_depot(lon, lat)),
    clearDepot: () => v(ed.clear_depot()),
    setDepotGates: (exits, entrances) =>
      v(ed.set_depot_gates(JSON.stringify(exits), JSON.stringify(entrances))),
    optimise: () => v(ed.optimise()),
    setSettings: (p, r) => v(ed.set_settings(JSON.stringify(p), JSON.stringify(r))),
    setLevelCrossings: (topology, closures) => v(ed.set_level_crossings(topology, closures)),
    setStreetSetups: (s) => v(ed.set_street_setups(JSON.stringify(s))),
    setDelayShares: (d) => v(ed.set_delay_shares(JSON.stringify(d))),
    usableRoads: () => JSON.parse(ed.usable_roads()),
    defaultProfile: (mode: Mode) => JSON.parse(wasm.StreetLineEditor.default_profile(mode)) as VehicleProfile,
    defaultRules: () => JSON.parse(wasm.StreetLineEditor.default_rules()) as RoutingRules,
    dispose: () => ed.free(),
  };
  return engine;
};

/**
 * Purpose: the streets of one OSM XML tile that the GIS tab can set up, with what OSM says about them.
 * Dependencies: the street-routing WebAssembly module (same parser and lane rules as routing).
 */
export const loadStreetInfos: StreetInfoLoader = async () => {
  const wasm = await initWasm();
  return (xml) => JSON.parse(wasm.street_infos(xml)) as StreetInfo[];
};

/** Purpose: fetch one street tile from the API (OSM streets, fetched and cached server-side). */
export const fetchStreetTile: TileFetcher = async (x, y) => {
  const res = await fetchTileWithRetry(withProject(`/api/street-network/tiles/14/${x}/${y}`));
  if (res.status === 401) throw new Error(tNow("street.osmUnauthorised"));
  if (!res.ok)
    throw new Error(res.status === 400 ? tNow("rail.osmInvalidTile") : tNow("street.osmUnavailable"));
  return res.text();
};

/**
 * Purpose: the walk analysis of the GIS tab (walk coverage, gaps and stop spacing, ADR-0035 §5–§6), on the
 * same street-routing WebAssembly module as the street line tool.
 * Output: an engine with no walk network; walk tiles are added with `addOsm` and `build`.
 */
export const loadWalkEngine: WalkEngineLoader = async () => {
  const wasm = await initWasm();
  const w = new wasm.WalkAnalysis();
  return {
    addOsm: (xml) => w.add_osm(xml),
    build: () => w.build(),
    ready: () => w.ready(),
    coverage: (req) => JSON.parse(w.coverage(JSON.stringify(req))) as CoverageResult,
    catchment: (stops, maxMinutes, settings) =>
      JSON.parse(
        w.catchment(JSON.stringify(stops), maxMinutes, JSON.stringify(settings)),
      ) as CatchmentGeoJson,
    spacing: (req) => JSON.parse(w.spacing(JSON.stringify(req))) as SpacingResult,
    dispose: () => w.free(),
  } satisfies WalkEngine;
};

/** Purpose: fetch the walkable ways of one zoom-14 tile from the API (OSM, fetched and cached server-side). */
export const fetchWalkTile: WalkTileFetcher = async (x, y) => {
  const res = await fetchTileWithRetry(withProject(`/api/street-network/walk-tiles/14/${x}/${y}`));
  if (res.status === 401) throw new Error(tNow("street.osmUnauthorised"));
  if (!res.ok)
    throw new Error(res.status === 400 ? tNow("rail.osmInvalidTile") : tNow("walk.osmUnavailable"));
  return res.text();
};
