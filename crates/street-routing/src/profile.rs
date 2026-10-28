//! Street modes, vehicle profiles and project rules for street line routing.

use serde::{Deserialize, Serialize};

/// Street-based public transport modes drawn with the route-point tool.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    /// Urban and regional bus. No motorways.
    Bus,
    /// Bus rapid transit: prefers bus lanes and busways, may use guided busways.
    Brt,
    /// Trolleybus: bound to the overhead wire, off-wire only within battery range.
    Trolleybus,
    /// Intercity coach: may use motorways.
    IntercityBus,
}

/// Which side vehicles drive on. Doors open on the kerb side (right for right-hand traffic).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrafficSide {
    /// Right-hand traffic: stops are on the right sidewalk in the direction of travel.
    Right,
    /// Left-hand traffic: stops are on the left sidewalk in the direction of travel.
    Left,
}

/// Vehicle used to check road limits. Values come from the vehicle catalogue (08-vehicles).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct VehicleProfile {
    /// Mode, which sets road access rules.
    pub mode: Mode,
    /// Vehicle height in metres, checked against `maxheight`.
    pub height_m: f64,
    /// Gross weight in tonnes, checked against `maxweight`.
    pub weight_t: f64,
    /// Length in metres, checked against `maxlength`.
    pub length_m: f64,
    /// Top speed in km/h; caps the road speed.
    pub max_speed_kmh: f64,
    /// Trolleybus only: distance it can run off the wire on battery, in metres (0 = none).
    pub battery_range_m: f64,
    /// Doors on both sides (some BRT vehicles), so stops on either side can be served.
    pub doors_both_sides: bool,
}

impl VehicleProfile {
    /// Purpose: typical vehicle for a mode (12 m bus, 18 m BRT and trolleybus, 13 m coach).
    pub fn default_for(mode: Mode) -> Self {
        let (height_m, weight_t, length_m, max_speed_kmh) = match mode {
            Mode::Bus => (3.1, 19.0, 12.0, 80.0),
            Mode::Brt => (3.2, 29.0, 18.0, 80.0),
            Mode::Trolleybus => (3.6, 29.0, 18.0, 65.0),
            Mode::IntercityBus => (3.8, 24.0, 13.0, 100.0),
        };
        Self {
            mode,
            height_m,
            weight_t,
            length_m,
            max_speed_kmh,
            battery_range_m: 0.0,
            doors_both_sides: false,
        }
    }
}

/// Project Preferences that affect street line routing (ADR-0029 §6, 06 §9.3).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct RoutingRules {
    /// Driving side for the project.
    pub traffic_side: TrafficSide,
    /// Warn when turning round costs more than this many extra metres...
    pub detour_warn_m: f64,
    /// ...or more than this share of the direct distance, whichever is larger.
    pub detour_warn_ratio: f64,
    /// Stops closer than this (metres) form one station group.
    pub grouping_distance_m: f64,
    /// A click farther than this from any usable road is rejected.
    pub max_snap_m: f64,
}

impl Default for RoutingRules {
    fn default() -> Self {
        Self {
            traffic_side: TrafficSide::Right,
            detour_warn_m: 500.0,
            detour_warn_ratio: 0.25,
            grouping_distance_m: 150.0,
            max_snap_m: 150.0,
        }
    }
}
