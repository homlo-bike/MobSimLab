//! MobSimLab street routing for bus, BRT, trolleybus and intercity bus lines.
//!
//! - [`graph`]: directed road graph with bus access, one-ways, turn bans, vehicle
//!   limits, trolley wire and barriers, built from OSM data ([`osm`]).
//! - [`router`]: fastest legal path between two positions; no U-turns except at
//!   turning circles, turn bans respected (edge-based Dijkstra from `pathfinding`).
//! - [`line`]: the route-point tool of ADR-0029: a closed circuit of via points,
//!   stops and end stops, local re-routing on edits, detour warnings, directions,
//!   station groups and depot pull-out/pull-in trips.
//!
//! The same crate runs in the simulation worker and, compiled to WebAssembly, in
//! the map editor, so the planner sees exactly the path the simulation will drive.
#![warn(missing_docs)]

pub mod geo;
pub mod graph;
pub mod line;
pub mod osm;
pub mod profile;
pub mod router;

pub use graph::RoadGraph;
pub use line::{LineView, PointKind, Status, StreetLine};
pub use osm::parse_osm_xml;
pub use profile::{Mode, RoutingRules, TrafficSide, VehicleProfile};
pub use router::{route, Anchor, Path, SearchOptions};
