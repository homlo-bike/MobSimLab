//! MobSimLab core authoring kits and segment engine for plugin modes (ADR-0036 §6 and §8, ADR-0037).
//!
//! The kits are generic geometry and timing; a mode plugin supplies the numbers (line speed, span limit,
//! berthing time…) as parameters from the assumption library. Everything takes JSON-shaped structs and
//! returns JSON-shaped structs, so the same code runs in the browser (through `mode-kits-wasm`), the API
//! and, later, the worker.
//!
//! - [`spans`]: the **straight spans kit**: stations clicked in order, straight sections, towers placed
//!   automatically within the span limit, rope sag and clearance, angle checks, running time, capacity and
//!   cabin count. Used by the aerial-lift plugin for cable cars and aerial tramways.
//! - [`water`]: the **water route kit**: an ordered list of pier calls with via points, speed zones,
//!   berthing manoeuvre, dwell from gangway throughput, vessel blocks and a berth check that runs the
//!   service on the segment engine. Used by the ferry plugin.
//! - [`segment`]: the **mesoscopic segment engine**: vehicles run from call to call with fixed running and
//!   dwell times, and hold until a reservable resource (a berth, a lock, a single track) is free.
//! - [`issue`]: findings shared by the kits (error, warning, info).

pub mod geo;
pub mod issue;
pub mod segment;
pub mod spans;
pub mod water;

pub use issue::{Issue, Level};
