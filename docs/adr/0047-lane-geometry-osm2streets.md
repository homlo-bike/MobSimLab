# ADR-0047: Lane and junction shapes on the GIS map from osm2streets

- Status: Proposed
- Date: 2026-11-23
- Deciders: product owner, architecture
- Related: ADR-0009 (one routing library), ADR-0029 (street line authoring), ADR-0031 (street routing in the
  browser), ADR-0046 (OSM import), `tools/license-gate/policy.json`

## Context

The GIS tab draws every street as a coloured line of fixed width. Three places guess a street's lanes and widths
from OSM tags on their own, each with its own numbers: the street setup map, the cross-section panel
(`CrossSection.tsx`, fixed typical widths in TypeScript) and the railway design (`rail-design/src/street.rs`,
lanes times a lane width parameter). The planner cannot see lanes, a bus lane they set up, or the shape of a
junction.

[osm2streets](https://github.com/a-b-street/osm2streets) (Apache-2.0, Rust, from A/B Street) turns OSM ways into
roads with an ordered list of lanes (type, direction, width, through `osm2lanes`) and junction polygons, and
renders them as GeoJSON. It already builds for WebAssembly.

A spike on 2026-11-23 (osm2streets commit `fc119c4`, one zoom-14 tile each of central Damascus and Beirut):

| Measure | Damascus | Beirut |
|---------|----------|--------|
| OSM input | 495 KB, 869 ways | 774 KB, 1,078 ways |
| Street network build (Node, WASM) | 112–201 ms | 124–133 ms |
| Lane polygons | 6,456 (12 MB GeoJSON) | 6,941 (13 MB GeoJSON) |
| Lane markings | 109,601 (120 MB GeoJSON) | 99,309 (106 MB GeoJSON) |

The module is 4.2 MB (1.08 MB gzipped) before `wasm-opt`; street routing is 0.91 MB (0.29 MB gzipped). A street
setup bus lane, written by `apply_setups` as `busway=lane` and `lanes=4`, came out as a bus lane of 3.05 m beside
three traffic lanes.

## Decision

1. Add osm2streets as a **drawing-only** dependency in a new crate, `street-geometry-wasm`, compiled to
   WebAssembly for the map editor. It never routes: routing stays in `street-routing` (ADR-0009, ADR-0031).
2. Its input is what the router already reads: the merged street tiles (`/api/street-network/tiles`) with the
   street setups applied as tag overrides (`apply_setups`). The `mobsimlab:` tags are mapped to OSM tags that
   osm2lanes understands (`separated=yes` to a kerb-separated `busway` or `cycleway=track`, a tram in its own lane
   to `embedded_rails=tram`).
3. The map draws lane and junction polygons at zoom 16 and closer, and keeps the line layer below. Lane markings
   are left out or reduced to centre lines and lane separators; coordinates are rounded and the data passes as
   binary or compact arrays, not GeoJSON text.
4. The module loads only when the GIS tab opens.
5. Every git dependency is pinned to a commit in `Cargo.lock`. osm2streets is not on crates.io.
6. The licence gate lists the osm2streets crates whose `Cargo.toml` has no `license` field by name, as
   verified Apache-2.0 (below).
7. The workspace minimum Rust version becomes **1.88**. `muv-osm` (used by osm2lanes) is a Rust 2024 edition
   crate, so Cargo before 1.85 cannot read its manifest. The workspace already needed 1.88 for `pathfinding`
   4.16 and `proptest` 1.12, so the old `1.80` was out of date. CI and the image already build with current
   stable Rust (1.97).

### Licences verified 2026-11-23

| Crate | Source | Licence | Note |
|-------|--------|---------|------|
| osm2streets, osm2lanes, streets_reader | `a-b-street/osm2streets` @ `fc119c4` | Apache-2.0 (repository `LICENSE`) | No `license` field: listed in the gate policy |
| abstutil | `a-b-street/abstreet` | Apache-2.0 (repository `LICENSE`) | No `license` field: listed |
| geom | `a-b-street/geom` | Apache-2.0 (repository `LICENSE`) | No `license` field: listed |
| osm-reader | `a-b-street/osm-reader` | Apache-2.0 (repository `LICENSE`) | No `license` field: listed |
| muv-osm, muv-osm-derive, muv-geo, muv-id | `gitlab.com/LeLuxNet/Muv` | MPL-2.0 (declared) | Passes the gate as declared |
| fast_paths, country-boundaries and other crates.io dependencies | crates.io | Declared, allowed licences | Pass the gate as declared |

Apache-2.0 and MPL-2.0 code may be combined into an AGPL-3.0-or-later work. Apache-2.0 obligations: keep the
copyright and licence notices and any upstream `NOTICE` text in the generated `NOTICE`. MPL-2.0 obligations: the
`muv-*` source files stay under MPL-2.0 and are available in source form (they are, upstream and through the
pinned commit).

## Alternatives considered

| Option | Why not |
|--------|---------|
| Keep fixed-width lines | The planner cannot see lanes, bus lanes or junction shapes |
| Write our own lane geometry | osm2lanes and osm2streets already handle OSM lane tagging, dual carriageways and junction polygons |
| osm2streets on the server, tiles to the browser | Every street setup change would need a server round trip; the editor works on local tiles already (ADR-0031) |
| Use osm2streets for routing too | Second routing engine, forbidden by ADR-0009 |

## Consequences

- One more WebAssembly module in the SPA, about 1 MB gzipped, loaded only by the GIS tab.
- Contributors need Rust 1.88 or newer.
- The project depends on git-only crates with little upstream release activity (npm `osm2streets-js` 0.1.4,
  June 2023; last osm2streets commit October 2025). We may have to maintain fixes ourselves; the wrapper stays thin.
- osm2streets logs many internal fix-ups on real city data (about 460 per tile in the spike); where a junction
  polygon fails, the map falls back to the line.
- The railway design (`rail-design`) may later read the same lane list for street-running and level-crossing
  widths. That changes simulation results and needs its own decision.
