//! MobSimLab railway design (ADR-0030, ADR-0033).
//!
//! Station-first design of tram, light rail, metro, commuter, regional, intercity and
//! high-speed lines, drawn to scale:
//!
//! - [`model`]: the document the planner edits (stations, tracks, switches).
//! - [`station`]: side and island platforms, one track per platform edge, connection points.
//! - [`alignment`]: tracks fitted from straights, clothoids and arcs; double track; levels and
//!   ramps sized from the maximum gradient.
//! - [`switch`]: catalogue turnouts, double junctions, crossovers and scissors crossovers.
//! - [`design`]: builds everything and runs the live checks of 06 §9.2.
//! - [`signal`]: the signal plan, generated from the design and edited by the planner.
//! - [`street`]: streets from OpenStreetMap and the level crossings where track crosses them.
//! - [`view`]: GeoJSON layers, handles and summaries for the map editor.
//! - [`topology`]: the track graph for railway operations (`contracts/rail-topology.schema.json`).
//! - [`params`]: rail modes, design values and the switch catalogue from the assumption library.
//!
//! The same crate runs natively (simulation worker, rail kernel input) and, compiled to
//! WebAssembly, in the map editor.
#![warn(missing_docs)]

pub mod alignment;
pub mod design;
pub mod geom;
pub mod issue;
pub mod model;
pub mod params;
pub mod proj;
pub mod sample;
pub mod signal;
pub mod station;
pub mod street;
pub mod switch;
pub mod topology;
pub mod view;

pub use design::{build, build_with_streets, Design};
pub use model::Network;
pub use params::{defaults, RailMode};
