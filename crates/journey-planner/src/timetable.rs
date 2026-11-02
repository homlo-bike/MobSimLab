//! The published timetable: what the journey planner reads (ADR-0034, `contracts/published-timetable.schema.json`).
//!
//! Field names follow GTFS so the GTFS export (FR-TT-05) is a copy without renames. Times are seconds after
//! midnight of the service day and may pass 86 400 for trips after midnight. Rail lines (`rail-plan`,
//! ADR-0032) always publish exact trips; a stop is one platform edge and `parent_station` groups the platforms
//! (and same-name station parts) of one station. Lines without exact trips yet, such as street lines, publish
//! a [`FrequencyPattern`]: a stop sequence with running and dwell times plus service periods with a headway.

use serde::{Deserialize, Serialize};

/// One boarding point: a bus stop or one platform edge.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Stop {
    pub stop_id: String,
    pub stop_name: String,
    pub stop_lat: f64,
    pub stop_lon: f64,
    /// Station group: the platforms of one station, paired stops, or same-name station parts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_station: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub platform_code: Option<String>,
}

/// A line as passengers know it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Route {
    pub route_id: String,
    pub route_short_name: String,
    /// MobSimLab mode id (`bus`, `tram`, `metro`, `regional_rail`, …).
    pub mode: String,
    /// Line colour without `#`, as in GTFS.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub route_color: Option<String>,
}

/// One call of a trip at a stop. Pass-through calls are not listed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StopTime {
    pub stop_id: String,
    pub stop_sequence: u32,
    pub arrival_time: u32,
    pub departure_time: u32,
    /// 0 regular, 1 no pickup (GTFS).
    #[serde(default)]
    pub pickup_type: u8,
    /// 0 regular, 1 no drop-off (GTFS).
    #[serde(default)]
    pub drop_off_type: u8,
}

/// One vehicle journey along a route.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Trip {
    pub trip_id: String,
    pub route_id: String,
    #[serde(default)]
    pub direction_id: u8,
    /// Day type (ADR-0020), for example `weekday`.
    #[serde(default = "default_service")]
    pub service_id: String,
    /// Vehicle circulation: consecutive trips of one vehicle share it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub block_id: Option<String>,
    pub stop_times: Vec<StopTime>,
}

/// A transfer rule between two stops (or within one, when `from_stop_id == to_stop_id`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transfer {
    pub from_stop_id: String,
    pub to_stop_id: String,
    /// GTFS: 0 recommended, 1 timed (guaranteed, the Swiss node connections of ADR-0032), 2 needs
    /// `min_transfer_time`, 3 not possible.
    #[serde(default)]
    pub transfer_type: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_transfer_time: Option<u32>,
    /// How long the connecting vehicle is planned to hold for a late feeder (operations, not planning).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_wait_s: Option<u32>,
    /// The time is an estimate (straight line and level change) until the station model provides it.
    #[serde(default)]
    pub estimated: bool,
}

/// Kind of a service period. No service is simply the absence of a period.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PeriodKind {
    Peak,
    OffPeak,
}

/// Departures every `headway_secs` from `start_time` (inclusive) to `end_time` (exclusive) at the first stop.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Period {
    pub start_time: u32,
    pub end_time: u32,
    pub headway_secs: u32,
    /// Clock-face minute of the first departure within the headway, in seconds (keeps departures at the
    /// same minutes every hour). Defaults to `start_time`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub offset_secs: Option<u32>,
    pub kind: PeriodKind,
}

/// One stop of a frequency pattern.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatternStop {
    pub stop_id: String,
    /// Running time from the previous stop's departure (0 at the first stop).
    pub run_time: u32,
    pub dwell_time: u32,
}

/// A line direction run at a headway per period, for lines without exact trips yet.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrequencyPattern {
    pub pattern_id: String,
    pub route_id: String,
    #[serde(default)]
    pub direction_id: u8,
    #[serde(default = "default_service")]
    pub service_id: String,
    pub stops: Vec<PatternStop>,
    pub periods: Vec<Period>,
}

/// The whole published timetable of a scenario.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Timetable {
    #[serde(default)]
    pub stops: Vec<Stop>,
    #[serde(default)]
    pub routes: Vec<Route>,
    #[serde(default)]
    pub trips: Vec<Trip>,
    #[serde(default)]
    pub transfers: Vec<Transfer>,
    #[serde(default)]
    pub frequency_patterns: Vec<FrequencyPattern>,
}

fn default_service() -> String {
    "weekday".into()
}

impl FrequencyPattern {
    /// Purpose: departure times at the first stop over all periods, in order.
    pub fn departures(&self) -> Vec<u32> {
        let mut out = Vec::new();
        for p in &self.periods {
            if p.headway_secs == 0 || p.end_time <= p.start_time {
                continue;
            }
            let h = p.headway_secs;
            let off = p.offset_secs.unwrap_or(p.start_time) % h;
            let mut t = p.start_time + (off + h - p.start_time % h) % h;
            while t < p.end_time {
                out.push(t);
                t += h;
            }
        }
        out.sort_unstable();
        out.dedup();
        out
    }

    /// Purpose: expand the pattern into exact trips (`<pattern_id>@<departure seconds>`).
    pub fn expand(&self) -> Vec<Trip> {
        self.departures()
            .into_iter()
            .map(|dep0| {
                let mut t = dep0;
                let stop_times = self
                    .stops
                    .iter()
                    .enumerate()
                    .map(|(i, s)| {
                        let arr = if i == 0 { t } else { t + s.run_time };
                        let dep = if i == 0 { t } else { arr + s.dwell_time };
                        t = dep;
                        StopTime {
                            stop_id: s.stop_id.clone(),
                            stop_sequence: i as u32,
                            arrival_time: arr,
                            departure_time: dep,
                            pickup_type: 0,
                            drop_off_type: 0,
                        }
                    })
                    .collect();
                Trip {
                    trip_id: format!("{}@{dep0}", self.pattern_id),
                    route_id: self.route_id.clone(),
                    direction_id: self.direction_id,
                    service_id: self.service_id.clone(),
                    block_id: None,
                    stop_times,
                }
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn departures_follow_periods_and_clock_face_offset() {
        let p = FrequencyPattern {
            pattern_id: "p".into(),
            route_id: "r".into(),
            direction_id: 0,
            service_id: "weekday".into(),
            stops: vec![],
            periods: vec![
                Period {
                    start_time: 6 * 3600,
                    end_time: 7 * 3600,
                    headway_secs: 900,
                    offset_secs: Some(300),
                    kind: PeriodKind::OffPeak,
                },
                Period {
                    start_time: 7 * 3600,
                    end_time: 7 * 3600 + 1800,
                    headway_secs: 600,
                    offset_secs: None,
                    kind: PeriodKind::Peak,
                },
            ],
        };
        let mins: Vec<u32> = p.departures().iter().map(|t| t / 60).collect();
        assert_eq!(mins, vec![365, 380, 395, 410, 420, 430, 440]);
    }
}
