//! MobSimLab rail operations kernel.
//!
//! A fixed-block, signal-to-signal interlocking with atomic route locking and
//! sectional release, combined with longitudinal train dynamics (traction power
//! limit, Davis resistance, gradient, braking curves). Positions are 1-D along
//! each train's path; geometry is derived elsewhere (ADR-0009).
//!
//! This is the Phase 0 prototype used by spikes S1 (co-simulation with SUMO)
//! and S2 (performance). See `docs/spikes/`.
#![warn(missing_docs)]

pub mod model;
pub mod scenarios;
pub mod sim;

pub use model::{SimConfig, StopSpec, TdsId, TdsSpec, TrainId, TrainSpec};
pub use sim::{Event, RailSim, SimStats, TrainState, TrainStatus};
