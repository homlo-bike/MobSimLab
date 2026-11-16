//! MobSimLab road depots (07-simulation §7, FR-NET-09, FR-SIM-09): bus, BRT, trolleybus and intercity bus
//! depots shared by all street lines.
//!
//! - [`model`]: the depot as saved: outline, gates, zones, and the lanes, slots and aisles of its layout.
//! - [`layout`]: auto layout of drive-through lanes, straight or angled, in each zone.
//! - [`check`] and [`sweep`]: the swept-path check of every lane with the vehicle's body ([`vehicle`]).
//! - [`network`]: the driving network inside the depot (aisles, lanes and drives to the gates) and
//!   whether each lane can be reached from an entrance and left to an exit.
//! - [`capacity`]: slots against the fleet of the lines that use the depot, and a slot for each vehicle.
//! - [`sizing`]: dynamic sizing: the smallest area for a fleet, and the fleet an outline can hold.
//! - [`report`]: all checks of a depot in one report.
//!
//! Compiled to WebAssembly (`crates/depot-layout-wasm`) for the Create tab's depot tool; the road
//! simulation reads the saved layout and the slot of each vehicle from [`capacity::assign`].
#![warn(missing_docs)]

pub mod capacity;
pub mod check;
pub mod geom;
pub mod layout;
pub mod model;
pub mod network;
pub mod report;
pub mod sizing;
pub mod sweep;
pub mod vehicle;

pub use layout::{generate, Generated, Issue};
pub use model::{DepotInput, Layout};
pub use report::{analyse, Report};
pub use sizing::size;
