//! MobSimLab railway planning (ADR-0032 §3).
//!
//! - [`blocking`]: **blocking times** of train runs over the route table of
//!   [`rail_model`], with the running-time calculation of [`rail_dynamics`].
//! - [`conflicts`]: timetable **conflicts** (FR-TT-06) and **capacity
//!   consumption** by the UIC 406 compression method.
//! - [`demand`]: suggested **frequencies** (maximum load point, clock-face
//!   headways) and **dwell times** from demand.
//! - [`line`]: rail lines as calls at station groups, station parts or platforms.
//! - [`path`]: path finding through candidate platforms on the route graph.
//! - [`plan`]: **timetable construction**: a periodic pattern per line and
//!   band, circulation with turn-back in the platform, conflict-free train
//!   paths, consistent platforms, pull-out and pull-in runs and stabling.
//! - [`report`]: validation, fleet and UIC 406 capacity per hour, maximum capacity.
//! - [`published`]: the published timetable with GTFS names, for the journey planner.
#![warn(missing_docs)]

pub mod blocking;
pub mod conflicts;
pub mod demand;
pub mod line;
pub mod path;
pub mod plan;
pub mod published;
pub mod report;

pub use blocking::{
    route_steps, run_timing, timetable_timing, Blocking, BlockingParams, RunTiming, TrainRun,
};
pub use conflicts::{compress, find_conflicts, Compression, Conflict};
pub use demand::{
    bands, dwell_s, link_loads, suggest_frequency, Band, Binding, DwellParams, FrequencyInput,
    FrequencySuggestion, Period, PeriodKind, CLOCK_FACE_HEADWAYS_S,
};
pub use line::{resolve, Call, LineSpec, Pick};
pub use path::{find_path, FoundPath, Place};
pub use plan::{plan, CallTime, Issue, Plan, PlanParams, PlannedRun, RunKind};
pub use published::{gtfs_time, publish, Published, StopRow, StopTimeRow, TripRow};
pub use report::{report, HourCapacity, MaxCapacity, Report};
