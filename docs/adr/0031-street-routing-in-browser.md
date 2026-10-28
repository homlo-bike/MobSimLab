# ADR-0031: One street routing crate, compiled for the worker and, as WebAssembly, for the map editor

- Status: Proposed (street line tool PR, 2026-10-27)
- Date: 2026-10-27
- Related: FR-NET-02, FR-NET-11a, ADR-0009 (one routing library), ADR-0017 (outbound gateway), ADR-0029 (street line authoring)

## Context

ADR-0029 asks for a street line tool where the planner clicks points, drags them and sees the route update at once, with legal paths only (one-ways, turn bans, no U-turns, stops served from the door side). ADR-0009 forbids a second routing engine (no OSRM, GraphHopper or pgRouting) and says routing runs in Rust on views of the unified graph.

A round trip to the server for every drag would make editing sluggish, and the API (Phase 1) and the unified graph in PostGIS (Phases 2–3) do not exist yet.

## Decision

1. Street routing lives in one Rust crate, `crates/street-routing`: road graph view with bus access rules, edge-based Dijkstra from `pathfinding` (the state is the directed road link, so turn bans and the no-U-turn rule are exact), and the route-point circuit model of ADR-0029.
2. The same crate is compiled to WebAssembly (`crates/street-routing-wasm`, `wasm-bindgen`) and loaded by the map editor, so the editor routes locally in milliseconds. The simulation worker will use the same crate natively. There is still one routing implementation.
3. The road graph view is built from OSM tags with the same mapping the PostGIS import will use. The planner never loads or exports files. The editor asks the API for the streets on screen, one zoom-14 tile at a time (`GET /api/street-network/tiles/14/{x}/{y}`, members only: `instance.read`), merges the tiles and rebuilds the graph with a fixed projection, so points already drawn keep their places. Until the Phase 2 import exists, the API fills a tile from Overpass through the gateway's `OverpassClient` (ADR-0017: one request at a time, HTTPS only, retries with backoff, size and time limits, identifying User-Agent) and caches it. The browser never calls Overpass itself.
4. Detour warning (ADR-0029 §6): a leg warns when turning round costs more than the larger of 500 m and 25 % of the direct distance, where the direct distance is the same leg with U-turns allowed. Both values are Project Preferences.
5. Snapping prefers main roads: a click must be 15 m closer to a service road, living street or pedestrian street than to a main road to snap to it.

## Consequences

- Dragging a point re-routes its two legs in a few milliseconds (Monaco, 27,000 road links: four stops routed in about 15 ms natively).
- CI and the image build need the `wasm32-unknown-unknown` target and `wasm-bindgen-cli` pinned to the crate's `wasm-bindgen` version (`tools/wasm/build-street-routing.sh`).
- When the graph moves to PostGIS, only the tile endpoint changes: it will serve the project's imported streets instead of Overpass data. The editor and the router stay the same.
- The web app's Content Security Policy allows `'wasm-unsafe-eval'` so the browser may compile the module.
- Line persistence (`svc.route`, ADR-0029 consequences) arrives with the network design module. Until then a line lives only in the open editor.

## Alternatives considered

| Option | Why not |
|--------|---------|
| OSRM, GraphHopper, Valhalla | Second routing engine (ADR-0009); their profiles do not model door-side stops or a per-line no-U-turn rule |
| Route on the server for every edit | Latency on every drag; the API and PostGIS graph are not built yet |
| TypeScript port of the router for the editor | Two implementations that would drift apart |
