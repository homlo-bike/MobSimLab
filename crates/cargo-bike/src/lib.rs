//! MobSimLab cargo bike plugin (`plugins/cargo-bike`): how far an electric cargo tricycle gets out and back
//! on one battery charge, and what it saves against a car.
//!
//! - [`params`]: the plugin's assumption values with the project's own on top.
//! - [`network`]: the streets a bike may ride from OpenStreetMap in four classes (separated track, bike
//!   lane, quiet street, main road in traffic), and the route that prefers bike lanes.
//! - [`energy`]: battery energy of a pedal-assisted bike along a height profile.
//! - [`trip`]: the round trip to a destination and the range map from one point.
//! - [`savings`]: yearly costs of the bike against a car, in the prices of the start point's country.
//!
//! Compiled to WebAssembly (`crates/cargo-bike-wasm`) for the plugin's Cargo bike tab.
#![warn(missing_docs)]

pub mod energy;
pub mod network;
pub mod params;
pub mod savings;
pub mod trip;

pub use network::{BikeGraph, Class, Route};
pub use params::{Bike, Values};
