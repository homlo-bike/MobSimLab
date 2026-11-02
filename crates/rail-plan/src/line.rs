//! Rail line authoring (ADR-0032 §2): a line is an ordered list of calls,
//! each picking a station group, one station part or platform edges.

use rail_dynamics::TrainParams;
use rail_model::{normalise_name, Model, PlatformId};
use serde::{Deserialize, Serialize};

use crate::demand::Band;

/// What a call picks.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum Pick {
    /// A station group by name (all parts with the same normalised name): any platform.
    Group(String),
    /// One station part by id: any of its platforms.
    Station(String),
    /// Platform edges by id: the first is preferred, the rest are allowed alternatives.
    Platforms(Vec<String>),
}

/// One call of a line.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Call {
    /// Where.
    pub pick: Pick,
    /// Whether the train stops (false = passes through).
    pub stop: bool,
    /// Dwell, s (None = the line's default dwell).
    pub dwell_s: Option<f64>,
}

impl Call {
    /// Purpose: a stopping call at a station group with the line's default dwell.
    pub fn at(group: &str) -> Call {
        Call {
            pick: Pick::Group(group.into()),
            stop: true,
            dwell_s: None,
        }
    }
}

/// A rail line with its service for one day type.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LineSpec {
    /// Stable id.
    pub id: String,
    /// Public name.
    pub name: String,
    /// Calls from the first terminal to the last; the return direction runs them in reverse.
    pub calls: Vec<Call>,
    /// The train type (from the vehicle catalogue; units coupled).
    pub train: TrainParams,
    /// Default dwell at intermediate calls, s (`mode.dwell_s`, or from demand).
    pub dwell_s: f64,
    /// Minimum turn-back time in a terminal platform, s (`timetable.layover_min`).
    pub turnback_s: f64,
    /// Running-time supplement share (`timetable.recovery_share`).
    pub supplement_share: f64,
    /// Storage tracks (depot and stabling sidings) the line's trains may use.
    pub stabling: Vec<String>,
    /// Service bands of the outbound direction (from [`crate::demand::bands`]).
    pub bands: Vec<Band>,
    /// Offset of the return direction's departures from the outbound ones, s.
    /// None = chosen by the planner so that, at both terminals, arrivals fall
    /// as far as possible from departures (no crossing moves at the same time
    /// in the terminal throat).
    pub return_offset_s: Option<f64>,
}

/// Purpose: candidate platforms of a pick, in preference order.
/// Output: platform ids, or Err naming the unknown pick.
pub fn resolve(m: &Model, pick: &Pick) -> Result<Vec<PlatformId>, String> {
    match pick {
        Pick::Group(name) => {
            let key = normalise_name(name);
            let g = m
                .groups
                .iter()
                .find(|g| g.key == key || g.key == *name)
                .ok_or_else(|| format!("unknown station {name}"))?;
            Ok(g.stations
                .iter()
                .flat_map(|&s| m.stations[s as usize].platforms.iter().copied())
                .collect())
        }
        Pick::Station(id) => m
            .stations
            .iter()
            .find(|s| s.id == *id)
            .map(|s| s.platforms.clone())
            .ok_or_else(|| format!("unknown station part {id}")),
        Pick::Platforms(ids) => ids
            .iter()
            .map(|i| m.platform(i).ok_or_else(|| format!("unknown platform {i}")))
            .collect(),
    }
}
