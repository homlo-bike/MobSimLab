//! Planner settings. Defaults come from the assumption library (`assumptions/parameters/operations.yaml`).

use serde::{Deserialize, Serialize};

/// How passengers walk and change. Every value is a Project Preference.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    /// `demand.walk_speed_kmh` (central 4.5 km/h).
    pub walk_speed_kmh: f64,
    /// `journey.walk_detour_factor`: walking distance over straight-line distance (central 1.3).
    pub walk_detour_factor: f64,
    /// Longest walk from the origin to the first stop, and from the last stop to the destination, in
    /// straight-line metres (`mode.catchment_m` of rail, high value 1000 m).
    pub max_access_m: f64,
    /// Longest walk between two stops at a change, in straight-line metres.
    pub max_transfer_m: f64,
    /// Longest journey walked all the way, in straight-line metres; longer ones must use transit.
    pub max_walk_only_m: f64,
    /// `journey.min_change_s`: time to change between two vehicles at the same stop.
    pub min_change_s: u32,
    /// `journey.level_change_s`: added to the walk between two platforms of one station (stairs, lifts).
    pub level_change_s: u32,
    /// Most vehicles in one journey (changes + 1).
    pub max_rides: usize,
    /// Day type of the trips to use (ADR-0020); `None` uses every trip.
    pub service_id: Option<String>,
    /// How far before an arrive-by time the search for a departure starts, in seconds.
    pub arrive_by_window_s: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            walk_speed_kmh: 4.5,
            walk_detour_factor: 1.3,
            max_access_m: 1000.0,
            max_transfer_m: 400.0,
            max_walk_only_m: 3000.0,
            min_change_s: 60,
            level_change_s: 60,
            max_rides: 5,
            service_id: None,
            arrive_by_window_s: 6 * 3600,
        }
    }
}

impl Settings {
    /// Purpose: walking time in whole seconds for a straight-line distance.
    pub fn walk_s(&self, straight_m: f64) -> u32 {
        let speed = (self.walk_speed_kmh / 3.6).max(0.1);
        (straight_m * self.walk_detour_factor / speed).round() as u32
    }

    /// Purpose: walking distance along streets for a straight-line distance.
    pub fn walk_m(&self, straight_m: f64) -> f64 {
        straight_m * self.walk_detour_factor
    }
}
