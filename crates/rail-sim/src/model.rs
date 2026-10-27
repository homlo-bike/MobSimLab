//! Input data model for the rail operations kernel.
//!
//! All units are SI: metres, seconds, metres per second, kilograms, newtons, watts.

use serde::{Deserialize, Serialize};

/// Index of a train detection section (TDS) in [`crate::RailSim`].
pub type TdsId = u32;
/// Index of a train in [`crate::RailSim`].
pub type TrainId = u32;

/// A train detection section: the smallest piece of track that can be
/// occupied, reserved and released. Plain-line blocks and switch areas are both TDS.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct TdsSpec {
    /// Length along the track in metres. Must be > 0.
    pub length_m: f64,
    /// Permanent speed limit in m/s. Must be > 0.
    pub speed_limit_mps: f64,
    /// Average gradient as rise over run (0.01 = 1 % uphill in travel direction).
    #[serde(default)]
    pub gradient: f64,
}

/// A scheduled stop of a train at a position on its path.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct StopSpec {
    /// Index into [`TrainSpec::path`] of the section where the train head stops.
    pub path_index: usize,
    /// Head position within that section, metres from its start.
    pub offset_m: f64,
    /// Minimum dwell time in seconds.
    pub dwell_s: f64,
}

/// Static description of one train and the path it runs.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct TrainSpec {
    /// Human-readable identifier (for example the persistent vehicle or consist ID).
    pub name: String,
    /// Train length in metres.
    pub length_m: f64,
    /// Total mass in kg (including load).
    pub mass_kg: f64,
    /// Maximum acceleration at low speed, m/s².
    pub max_accel_mps2: f64,
    /// Service braking deceleration, m/s² (positive number).
    pub service_decel_mps2: f64,
    /// Vehicle maximum speed, m/s.
    pub max_speed_mps: f64,
    /// Maximum traction power at the wheel, W. Limits acceleration at speed.
    pub power_w: f64,
    /// Davis resistance coefficients: R = a + b·v + c·v² (N, N·s/m, N·s²/m²).
    pub davis_a_n: f64,
    /// Davis coefficient b (N·s/m).
    pub davis_b_n_per_mps: f64,
    /// Davis coefficient c (N·s²/m²).
    pub davis_c_n_per_mps2: f64,
    /// Ordered sections the train runs over. For a cyclic path the last entry
    /// connects back to the first.
    pub path: Vec<TdsId>,
    /// Path indices with a main signal at the **start** of that entry. A route
    /// always runs from one signal to the next, so this defines the routes the
    /// interlocking locks atomically. Index 0 is always treated as a signal.
    pub signals_at: Vec<usize>,
    /// Whether the path repeats (loop line) or ends (portal or buffer stop).
    pub cyclic: bool,
    /// Scheduled stops, sorted by position along the path.
    #[serde(default)]
    pub stops: Vec<StopSpec>,
    /// Initial head position measured from the start of path entry 0, metres.
    /// Must be at least `length_m`, so the whole train starts on its path.
    pub start_head_m: f64,
    /// Earliest departure time in seconds; the train holds until then.
    #[serde(default)]
    pub depart_s: f64,
}

/// Tuning parameters of the kernel. Defaults are documented assumptions.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct SimConfig {
    /// Extra distance beyond the braking distance at which a route is requested (m).
    /// Assumption: roughly one sighting distance for a main signal.
    pub route_request_margin_m: f64,
    /// Seconds of running at current speed added to the request distance.
    pub route_request_lookahead_s: f64,
    /// A run is reported as deadlocked when no train has moved for this long (s).
    pub deadlock_timeout_s: f64,
    /// Record per-event logs (route set, stop arrival, ...). Off for benchmarks.
    pub record_events: bool,
}

impl Default for SimConfig {
    /// Purpose: sensible planning defaults.
    /// Outputs: a config with a 200 m request margin, 10 s look-ahead, 900 s
    /// deadlock timeout and event recording off.
    fn default() -> Self {
        Self {
            route_request_margin_m: 200.0,
            route_request_lookahead_s: 10.0,
            deadlock_timeout_s: 900.0,
            record_events: false,
        }
    }
}
