//! Planner settings. Defaults come from the assumption library (`assumptions/parameters/operations.yaml`).

use serde::{Deserialize, Serialize};

/// Tobler's hiking function is fastest on a 5 % downhill gradient.
const TOBLER_FASTEST: f64 = 0.05;
/// Steepest average gradient a walk is timed on (1 in 2, steeper than most stairs).
const MAX_GRADIENT: f64 = 0.5;

/// How passengers walk and change. Every value is a Project Preference.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    /// `demand.walk_speed_kmh` (central 4.5 km/h).
    pub walk_speed_kmh: f64,
    /// `journey.walk_detour_factor`: walking distance over straight-line distance (central 1.3).
    pub walk_detour_factor: f64,
    /// `journey.walk_slope_k`: steepness term of Tobler's hiking function (central 3.5). A walk whose two
    /// ends have known heights takes `exp(k * (|gradient + 0.05| - 0.05))` times its flat time, so uphill
    /// and steep downhill walks are slower and gentle downhill ones a little faster. 0 ignores slopes.
    pub walk_slope_k: f64,
    /// Longest walk from the origin to the first stop, and from the last stop to the destination, in
    /// straight-line metres (`mode.catchment_m` of rail, high value 1000 m).
    pub max_access_m: f64,
    /// Longest walk between two stops at a change, in straight-line metres.
    pub max_transfer_m: f64,
    /// `journey.same_name_station_m`: stops with the same name within this straight-line distance are one
    /// station. A bus stop named like the railway station beside it is an interchange even beyond
    /// `max_transfer_m` (station names are shared within the 150 m grouping distance of the platform line,
    /// so a long platform's middle can be a few hundred metres from the stop).
    pub same_name_station_m: f64,
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
            walk_slope_k: 3.5,
            max_access_m: 1000.0,
            max_transfer_m: 400.0,
            same_name_station_m: 600.0,
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
    /// Purpose: walking time in whole seconds for a straight-line distance on flat ground.
    pub fn walk_s(&self, straight_m: f64) -> u32 {
        self.walk_s_rise(straight_m, None)
    }

    /// Purpose: walking time in whole seconds for a straight-line distance that climbs `rise_m` (negative
    /// downhill). Unknown heights (`None`) walk as flat.
    pub fn walk_s_rise(&self, straight_m: f64, rise_m: Option<f64>) -> u32 {
        let speed = (self.walk_speed_kmh / 3.6).max(0.1);
        let flat = straight_m * self.walk_detour_factor / speed;
        (flat * self.slope_factor(straight_m, rise_m)).round() as u32
    }

    /// Purpose: walking time on a slope over walking time on the flat, from Tobler's hiking function
    /// (Tobler 1993): speed = 6 exp(-3.5 |s + 0.05|) km/h for gradient s, scaled so the flat speed is
    /// `walk_speed_kmh`. The gradient is the rise over the walking distance (straight line times the detour
    /// factor), the average over the whole walk, and is held within ±50 % (steeper than stairs is likely an
    /// error in the heights). Output: 1 when a height is unknown, the walk has no length or `walk_slope_k` is 0.
    pub fn slope_factor(&self, straight_m: f64, rise_m: Option<f64>) -> f64 {
        let walk_m = straight_m * self.walk_detour_factor;
        match rise_m {
            Some(rise) if rise.is_finite() && walk_m > 0.0 && self.walk_slope_k > 0.0 => {
                let s = (rise / walk_m).clamp(-MAX_GRADIENT, MAX_GRADIENT);
                (self.walk_slope_k * ((s + TOBLER_FASTEST).abs() - TOBLER_FASTEST)).exp()
            }
            _ => 1.0,
        }
    }

    /// Purpose: walking distance along streets for a straight-line distance.
    pub fn walk_m(&self, straight_m: f64) -> f64 {
        straight_m * self.walk_detour_factor
    }
}
