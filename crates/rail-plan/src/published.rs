//! The published timetable (ADR-0032 §5a; the interface agreed with the
//! journey planner, ADR-0034), with GTFS names and meanings.
//!
//! - Each platform edge is a **stop**; its `parent_station` is the station
//!   group, so passengers see one station in several parts.
//! - Each service run is a **trip** with its line as `route_id`, its
//!   `direction_id` and its train as `block_id`.
//! - **Stop times** give arrival and departure in `HH:MM:SS` from service-day
//!   midnight (beyond 24:00:00 after midnight). Arrivals are rounded up and
//!   departures down to whole seconds, so a published connection always
//!   holds. Origins take no alighting, destinations no boarding
//!   (`pickup_type` / `drop_off_type` 1); passes are not published.

use std::collections::BTreeMap;

use rail_model::Model;
use serde::Serialize;

use crate::path::Place;
use crate::plan::{Plan, RunKind};

/// A stop (platform edge) or a station (station group).
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct StopRow {
    /// Platform edge id, or `group:<key>` for a station.
    pub stop_id: String,
    /// Station name.
    pub stop_name: String,
    /// 0 = stop or platform, 1 = station.
    pub location_type: u8,
    /// The station of a platform.
    pub parent_station: Option<String>,
    /// Platform label shown to passengers.
    pub platform_code: Option<String>,
}

/// A trip.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct TripRow {
    /// Trip id.
    pub trip_id: String,
    /// Line id.
    pub route_id: String,
    /// 0 outbound, 1 return.
    pub direction_id: u8,
    /// Train (vehicle block).
    pub block_id: String,
    /// Destination shown on the train.
    pub trip_headsign: String,
}

/// A call of a trip.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct StopTimeRow {
    /// Trip id.
    pub trip_id: String,
    /// Arrival, `HH:MM:SS`.
    pub arrival_time: String,
    /// Departure, `HH:MM:SS`.
    pub departure_time: String,
    /// Platform edge id.
    pub stop_id: String,
    /// Order in the trip, from 1.
    pub stop_sequence: u32,
    /// 0 = boarding, 1 = no boarding.
    pub pickup_type: u8,
    /// 0 = alighting, 1 = no alighting.
    pub drop_off_type: u8,
}

/// The published timetable.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Published {
    /// Stations and platforms.
    pub stops: Vec<StopRow>,
    /// Trips.
    pub trips: Vec<TripRow>,
    /// Stop times, by trip then sequence.
    pub stop_times: Vec<StopTimeRow>,
}

/// Purpose: format seconds after service-day midnight as GTFS `HH:MM:SS`.
pub fn gtfs_time(s: f64) -> String {
    let s = s.max(0.0) as u64;
    format!("{:02}:{:02}:{:02}", s / 3600, (s / 60) % 60, s % 60)
}

/// Purpose: the published timetable of a plan.
/// Inputs: model, plan and the line ids by index.
/// Output: stops, trips and stop times of the service runs.
pub fn publish(m: &Model, plan: &Plan, line_ids: &[String]) -> Published {
    let mut stops: BTreeMap<String, StopRow> = BTreeMap::new();
    let mut trips = Vec::new();
    let mut stop_times = Vec::new();
    for r in plan.runs.iter().filter(|r| r.kind == RunKind::Service) {
        let headsign = match r.calls.last().map(|c| c.place) {
            Some(Place::Platform(p)) => {
                let st = &m.stations[m.platforms[p as usize].station as usize];
                m.groups[st.group as usize].name.clone()
            }
            _ => String::new(),
        };
        trips.push(TripRow {
            trip_id: r.name.clone(),
            route_id: line_ids[r.line].clone(),
            direction_id: r.direction,
            block_id: format!("train-{}", r.vehicle),
            trip_headsign: headsign,
        });
        let n = r.calls.len();
        let mut seq = 0;
        for (i, c) in r.calls.iter().enumerate() {
            let Place::Platform(p) = c.place else {
                continue;
            };
            if !c.stop {
                continue;
            }
            seq += 1;
            let pf = &m.platforms[p as usize];
            let st = &m.stations[pf.station as usize];
            let g = &m.groups[st.group as usize];
            let gid = format!("group:{}", g.key);
            stops.entry(gid.clone()).or_insert_with(|| StopRow {
                stop_id: gid.clone(),
                stop_name: g.name.clone(),
                location_type: 1,
                parent_station: None,
                platform_code: None,
            });
            stops.entry(pf.id.clone()).or_insert_with(|| StopRow {
                stop_id: pf.id.clone(),
                stop_name: g.name.clone(),
                location_type: 0,
                parent_station: Some(gid.clone()),
                platform_code: pf.label.clone(),
            });
            let arr = c.arrive_s.or(c.depart_s).unwrap_or(0.0).ceil();
            let dep = c.depart_s.or(c.arrive_s).unwrap_or(0.0).floor().max(arr);
            stop_times.push(StopTimeRow {
                trip_id: r.name.clone(),
                arrival_time: gtfs_time(arr),
                departure_time: gtfs_time(dep),
                stop_id: pf.id.clone(),
                stop_sequence: seq,
                pickup_type: u8::from(i + 1 == n),
                drop_off_type: u8::from(i == 0),
            });
        }
    }
    Published {
        stops: stops.into_values().collect(),
        trips,
        stop_times,
    }
}
