//! MobSimLab journey planner (ADR-0034).
//!
//! The benchmark question "how long does it take from A to B with my network?": walk to a stop, wait, ride,
//! change, ride, walk to B. The planner reads the published timetable ([`timetable`]): exact trips from the
//! railway operations planner (ADR-0032) and frequency patterns for lines without exact trips yet (street
//! lines, ADR-0029). It answers depart-at and arrive-by questions with RAPTOR ([`planner`]) and splits each
//! journey into walking, waiting, in-vehicle and transfer time ([`journey::Breakdown`]); a profile repeats
//! the question through the day.

pub mod journey;
pub mod planner;
pub mod settings;
pub mod timetable;

pub use journey::{Breakdown, Journey, Leg, Place, WaitKind, WalkKind};
pub use planner::{NetworkSummary, Plan, Planner, ProfilePoint, ProfileQuery, Query, TimeMode};
pub use settings::Settings;
pub use timetable::{FrequencyPattern, Period, PeriodKind, Timetable};
