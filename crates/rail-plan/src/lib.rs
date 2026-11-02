//! MobSimLab railway planning (ADR-0032 §3).
//!
//! This first part computes **blocking times** for train runs over the route
//! table of [`rail_model`], using the running-time calculation of
//! [`rail_dynamics`], checks a timetable for **conflicts** (FR-TT-06) and
//! measures **capacity consumption** with the UIC 406 compression method.
//! Timetable construction (frequencies, periodic timetable, platforming,
//! circulation and depot runs) builds on these.
#![warn(missing_docs)]

pub mod blocking;
pub mod conflicts;

pub use blocking::{
    route_steps, run_timing, timetable_timing, Blocking, BlockingParams, RunTiming, TrainRun,
};
pub use conflicts::{compress, find_conflicts, Compression, Conflict};
