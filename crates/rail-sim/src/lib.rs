//! MobSimLab rail operations kernel.
//!
//! A fixed-block, signal-to-signal interlocking with atomic route locking and
//! sectional release, combined with longitudinal train dynamics (traction power
//! limit, Davis resistance, gradient, braking curves). Positions are 1-D along
//! each train's path; geometry is derived elsewhere (ADR-0009).
//!
//! The modules `model`, `sim` and `scenarios` are the Phase 0 prototype used
//! by spikes S1 (co-simulation with SUMO) and S2 (performance); see
//! `docs/spikes/`. The [`network`] module is the network kernel of ADR-0032
//! §4: planned days on the compiled network, under the `rail-interlocking`
//! interlocking, with automatic route setting, train protection and a
//! driver model.
#![warn(missing_docs)]

pub mod model;
pub mod network;
pub mod scenarios;
pub mod sim;

pub use model::{SimConfig, StopSpec, TdsId, TdsSpec, TrainId, TrainSpec};
pub use sim::{Event, RailSim, SimStats, TrainState, TrainStatus};
