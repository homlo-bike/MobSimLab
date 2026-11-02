//! Suggested frequencies and dwell times from demand (ADR-0032 §3 step 0).
//!
//! The suggested frequency of a line in a service period is the larger of the
//! **demand frequency** (Ceder's maximum load point method: the hourly load on
//! the busiest link divided by the train capacity times the target load factor)
//! and the **policy frequency** (a minimum service level per mode and period).
//! It is rounded **up** to a clock-face headway, so the pattern repeats every
//! hour and peak and off-peak patterns stay compatible at transfer nodes.
//!
//! The dwell at a call follows the TCQSM dwell model: door opening and closing
//! plus the boarding and alighting time of the busiest door channel, never
//! below the mode's minimum dwell.

use serde::{Deserialize, Serialize};

/// Clock-face headways, s: each divides 60 minutes (or is 60 minutes), so the
/// pattern repeats every hour.
pub const CLOCK_FACE_HEADWAYS_S: [f64; 13] = [
    120.0, 150.0, 180.0, 240.0, 300.0, 360.0, 450.0, 600.0, 720.0, 900.0, 1200.0, 1800.0, 3600.0,
];

/// Kind of service period (ADR-0032 §2).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub enum PeriodKind {
    /// Peak.
    Peak,
    /// Off-peak.
    OffPeak,
    /// No service.
    NoService,
}

/// A service period of a day type, s after service-day midnight.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Period {
    /// Kind.
    pub kind: PeriodKind,
    /// Start, s.
    pub from_s: f64,
    /// End, s.
    pub to_s: f64,
}

/// Purpose: hourly load on each link between consecutive calls of one direction.
/// Inputs: hourly boarders and alighters per call in travel order.
/// Output: the load on each of the `n - 1` links (passengers per hour).
pub fn link_loads(boarders: &[f64], alighters: &[f64]) -> Vec<f64> {
    let mut load = 0.0;
    let n = boarders.len().min(alighters.len());
    let mut out = Vec::with_capacity(n.saturating_sub(1));
    for i in 0..n.saturating_sub(1) {
        load += boarders[i] - alighters[i];
        out.push(load.max(0.0));
    }
    out
}

/// What decided the suggested frequency.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Binding {
    /// Passenger demand at the maximum load point.
    Demand,
    /// The minimum service level of the mode and period.
    Policy,
}

/// Inputs of the frequency suggestion for one line and period.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct FrequencyInput {
    /// Hourly load at the maximum load point (both directions considered; pass the larger).
    pub max_load_pph: f64,
    /// Capacity of one unit (seated + standing at the planning standee density).
    pub unit_capacity: f64,
    /// Units per train today.
    pub units: u32,
    /// Most units a train may have (platform length, coupling).
    pub max_units: u32,
    /// Target load factor at the maximum load point (`timetable.target_load_factor`).
    pub target_load_factor: f64,
    /// Longest headway allowed by policy in this period, s (`timetable.policy_headway_*_min`).
    pub policy_headway_s: f64,
    /// Shortest headway the line can run, s (from the capacity analysis, or
    /// the shortest clock-face headway when not yet known).
    pub min_headway_s: f64,
}

/// A suggested frequency.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct FrequencySuggestion {
    /// Headway that demand alone needs, s (infinite with no demand).
    pub demand_headway_s: f64,
    /// Policy headway, s.
    pub policy_headway_s: f64,
    /// Suggested clock-face headway, s.
    pub headway_s: f64,
    /// Trains per hour.
    pub trains_per_hour: f64,
    /// Units per train (more units are suggested before a headway the line cannot run).
    pub units: u32,
    /// What decided it.
    pub binding: Binding,
    /// Passengers per hour above the capacity offered at the maximum load
    /// point and the target load factor (0 when demand is met).
    pub shortfall_pph: f64,
}

/// Purpose: the suggested frequency of a line in a period (Ceder's maximum load point method).
/// Inputs: see [`FrequencyInput`].
/// Output: the largest clock-face headway that meets both demand and policy;
/// if demand needs a headway below `min_headway_s`, longer trains are
/// suggested first (up to `max_units`) and any remaining shortfall is reported.
pub fn suggest_frequency(inp: &FrequencyInput) -> FrequencySuggestion {
    let per_unit = (inp.unit_capacity * inp.target_load_factor).max(1e-9);
    let demand_h = |units: u32| {
        if inp.max_load_pph <= 0.0 {
            f64::INFINITY
        } else {
            3600.0 * per_unit * units as f64 / inp.max_load_pph
        }
    };
    let floor = inp.min_headway_s.max(CLOCK_FACE_HEADWAYS_S[0]);
    let mut units = inp.units.max(1);
    while demand_h(units) < floor && units < inp.max_units {
        units += 1;
    }
    let needed = demand_h(units).min(inp.policy_headway_s);
    let headway = CLOCK_FACE_HEADWAYS_S
        .iter()
        .rev()
        .copied()
        .find(|&h| h <= needed + 1e-6 && h >= floor - 1e-6)
        .unwrap_or_else(|| {
            CLOCK_FACE_HEADWAYS_S
                .iter()
                .copied()
                .find(|&h| h >= floor - 1e-6)
                .unwrap_or(3600.0)
        });
    let offered = 3600.0 / headway * per_unit * units as f64;
    FrequencySuggestion {
        demand_headway_s: demand_h(units),
        policy_headway_s: inp.policy_headway_s,
        headway_s: headway,
        trains_per_hour: 3600.0 / headway,
        units,
        binding: if demand_h(units) < inp.policy_headway_s {
            Binding::Demand
        } else {
            Binding::Policy
        },
        shortfall_pph: (inp.max_load_pph - offered).max(0.0),
    }
}

/// Dwell model parameters (07 §3.3; TCQSM).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DwellParams {
    /// Door opening and closing time, s (`dwell.door_open_close_s`).
    pub door_open_close_s: f64,
    /// Boarding time per passenger per door channel, s (`dwell.board_s_per_pax`).
    pub board_s: f64,
    /// Alighting time per passenger per door channel, s (`dwell.alight_s_per_pax`).
    pub alight_s: f64,
    /// Door channels of the train (doors × channels per door).
    pub door_channels: u32,
    /// Share of passengers using the busiest channel relative to an even spread (≥ 1).
    pub peaking: f64,
    /// Minimum dwell, s (`mode.dwell_s`).
    pub min_dwell_s: f64,
}

/// Purpose: dwell time of one train at one call.
/// Inputs: boarders and alighters per train, dwell parameters.
/// Output: dwell, s, rounded up to whole seconds.
pub fn dwell_s(boarders: f64, alighters: f64, p: &DwellParams) -> f64 {
    let ch = p.door_channels.max(1) as f64;
    let flow = p.peaking.max(1.0) * (boarders * p.board_s + alighters * p.alight_s) / ch;
    (p.door_open_close_s + flow).ceil().max(p.min_dwell_s)
}

/// A headway that holds over a time band (one service period of one line).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Band {
    /// First departure from the first terminal, s.
    pub from_s: f64,
    /// No departure at or after this time, s.
    pub to_s: f64,
    /// Headway, s.
    pub headway_s: f64,
}

/// Purpose: service bands of one line from the day's periods and headways.
/// Inputs: periods in time order, the headway per kind (the suggestion or an
/// override, project-wide or for this line).
/// Output: bands for every period that has service and a headway.
pub fn bands(periods: &[Period], headway: impl Fn(PeriodKind) -> Option<f64>) -> Vec<Band> {
    periods
        .iter()
        .filter(|p| p.kind != PeriodKind::NoService && p.to_s > p.from_s)
        .filter_map(|p| {
            headway(p.kind).map(|h| Band {
                from_s: p.from_s,
                to_s: p.to_s,
                headway_s: h,
            })
        })
        .collect()
}
