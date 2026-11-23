import { tNow } from "../../i18n/i18n";
import type { TileFetcher } from "../street-lines/types";
import type { RailEngine, RailEngineLoader, RailView } from "./types";
import { noteSource, withProject } from "../../geodata/projectData";
import { hashText } from "../../projects/inputKey";
import { CachedDesigner } from "./designerCache";

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
 * Purpose: wait for the browser's next task, so it can paint and answer input between long engine steps
 * (building and publishing a large railway takes a second or more each; the Tables tab froze on the
 * Damascus network, bug 21).
 */
export const nextTask = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Purpose: load the rail-design WebAssembly module and create an engine.
 * Output: the engine; every edit sends the whole document to `build`.
 * Dependencies: apps/web/src/wasm/rail-design, built by tools/wasm/build-rail-design.sh.
 */
export const loadRailEngine: RailEngineLoader = async () => {
  const wasm = await initWasm();
  const c = new CachedDesigner(new wasm.RailDesigner());
  // Calls that read the last build run once the engine has caught up with the answers kept from memory.
  const d = () => c.catchUp();
  const engine: RailEngine = {
    build: (doc, draft) => JSON.parse(c.build(JSON.stringify(doc), draft ?? 0)) as RailView,
    nearestTrack: ([lon, lat], maxM) => JSON.parse(d().nearest_track(lon, lat, maxM)),
    chainage: (track, [lon, lat]) => d().chainage(track, lon, lat),
    toLocal: ([olon, olat], [lon, lat]) => {
      const v = wasm.RailDesigner.to_local(olon, olat, lon, lat);
      return [v[0]!, v[1]!];
    },
    defaultParams: (mode) => JSON.parse(wasm.RailDesigner.default_params(mode)),
    sample: (mode, [lon, lat]) => JSON.parse(wasm.RailDesigner.sample(mode, lon, lat)),
    topology: () => JSON.parse(d().topology()),
    addStreetTile: (xml) => {
      // The count is wanted now, so the engine catches up first.
      c.catchUp();
      let n = 0;
      c.change(`street\u0000${hashText(xml)}`, (e) => (n = e.add_street_tile(xml)));
      return n;
    },
    clearStreets: () => c.change("clear-streets", (e) => e.clear_streets()),
    addRailTile: (xml) => {
      // The count is wanted now, so the engine catches up first.
      c.catchUp();
      let n = 0;
      c.change(`rail\u0000${hashText(xml)}`, (e) => (n = e.add_rail_tile(xml)));
      return n;
    },
    clearRails: () => c.change("clear-rails", (e) => e.clear_rails()),
    missingTerrainTiles: () => JSON.parse(c.missingTerrainTiles()),
    terrainTilePoints: (x, y) => JSON.parse(wasm.RailDesigner.terrain_tile_points(x, y)),
    addTerrainTile: (x, y, heights) => {
      const h = JSON.stringify(heights);
      c.change(`terrain\u0000${x}\u0000${y}\u0000${h}`, (e) => e.add_terrain_tile(x, y, h));
    },
    existingSnap: ([lon, lat], maxM) => JSON.parse(d().existing_snap(lon, lat, maxM)),
    setStreetSetups: (s) => {
      const j = JSON.stringify(s);
      c.change(`setups\u0000${j}`, (e) => e.set_street_setups(j));
    },
    setValues: (v) => {
      const j = JSON.stringify(v);
      c.change(`values\u0000${j}`, (e) => e.set_values(j));
    },
    setSwitchChoice: (s) => {
      const j = JSON.stringify(s);
      c.change(`switches\u0000${j}`, (e) => e.set_switch_choice(j));
    },
    generateSignals: () => JSON.parse(d().generate_signals()),
    signalAnchor: ([lon, lat], maxM) => JSON.parse(d().signal_anchor(lon, lat, maxM)),
    reachable: (from, to) => JSON.parse(d().reachable(from, to)),
    publishLines: (lines, serviceId, options) =>
      JSON.parse(
        c.publishLines(JSON.stringify(lines), serviceId, options ? JSON.stringify(options) : undefined),
      ),
    dispose: () => c.engine.free(),
  };
  return engine;
};

/** Purpose: fetch one railway tile from the API (existing OSM railways, cached server-side). */
export const fetchRailTile: TileFetcher = async (x, y) => {
  const res = await fetch(withProject(`/api/street-network/rail-tiles/14/${x}/${y}`));
  noteSource(res);
  if (res.status === 401) throw new Error(tNow("rail.osmUnauthorised"));
  if (!res.ok)
    throw new Error(res.status === 400 ? tNow("rail.osmInvalidTile") : tNow("rail.osmUnavailable"));
  return res.text();
};
