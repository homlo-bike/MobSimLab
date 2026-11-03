//! The plan as the journey planner reads it (ADR-0034,
//! `contracts/published-timetable.schema.json`).
//!
//! [`crate::published`] keeps GTFS's text form (`HH:MM:SS`, flat stop times)
//! for the GTFS export. The journey planner reads the same rows in the
//! contract's form: times in seconds, stop times inside their trip, and a
//! position for every stop so passengers can walk to it.
//!
//! - Each platform edge the trains call at is a **stop**, at the middle of the
//!   edge (from the railway editor's topology export), named after its station
//!   group and with `parent_station` = `group:<key>`. The journey planner treats
//!   the platforms of one group as one station, and joins street stops with the
//!   same name close by (a bus stop named like the station) to it.
//! - Each line is a **route** with its mode; each service run a **trip** with
//!   its train as `block_id`. Pull-out and pull-in runs are not published.

use std::collections::BTreeMap;

use journey_planner::timetable::{Route, Stop, StopTime, Timetable, Trip};
use rail_design::geom::P2;
use rail_design::proj::LocalTm;
use rail_model::topology::PlatformPlace;
use rail_model::Model;

use crate::path::Place;
use crate::plan::{Plan, RunKind};

/// A line as passengers see it.
#[derive(Clone, Debug, PartialEq)]
pub struct RouteInfo {
    /// Line id (the [`crate::LineSpec`] id).
    pub id: String,
    /// Public name.
    pub name: String,
    /// MobSimLab mode id; `None` takes the mode of the line's platforms.
    pub mode: Option<String>,
    /// Colour without `#`.
    pub color: Option<String>,
}

/// The journey planner's timetable and what could not be placed.
#[derive(Clone, Debug)]
pub struct JourneyTimetable {
    /// Stops, routes and trips in the contract's form.
    pub timetable: Timetable,
    /// Platforms placed by an estimate, for the run report.
    pub notes: Vec<String>,
}

/// Purpose: the published timetable of a plan in the journey planner's form.
/// Inputs: model, plan, one [`RouteInfo`] per line (by line index), the
/// platform places and frame origin from the topology import, and the day type.
/// Output: the timetable; platforms without a place take the middle of their
/// station's placed platforms, else the origin, with a note.
pub fn journey_timetable(
    m: &Model,
    plan: &Plan,
    routes: &[RouteInfo],
    places: &BTreeMap<String, PlatformPlace>,
    origin: [f64; 2],
    service_id: &str,
) -> JourneyTimetable {
    let tm = LocalTm::new(origin[0], origin[1]);
    let mut notes = Vec::new();
    let mut stops: BTreeMap<String, Stop> = BTreeMap::new();
    let mut line_modes: Vec<Option<String>> = vec![None; routes.len()];
    let mut trips = Vec::new();

    // Where each platform is: its own place, else its station group's middle.
    let place_of =
        |p: usize| -> Option<[f64; 2]> { places.get(&m.platforms[p].id).map(|pl| [pl.x, pl.y]) };
    let group_middle = |g: usize| -> Option<[f64; 2]> {
        let pts: Vec<[f64; 2]> = m.groups[g]
            .stations
            .iter()
            .flat_map(|&s| m.stations[s as usize].platforms.iter())
            .filter_map(|&p| place_of(p as usize))
            .collect();
        (!pts.is_empty()).then(|| {
            let n = pts.len() as f64;
            [
                pts.iter().map(|p| p[0]).sum::<f64>() / n,
                pts.iter().map(|p| p[1]).sum::<f64>() / n,
            ]
        })
    };

    for r in plan.runs.iter().filter(|r| r.kind == RunKind::Service) {
        let mut stop_times = Vec::new();
        let n = r.calls.len();
        for (i, c) in r.calls.iter().enumerate() {
            let Place::Platform(p) = c.place else {
                continue;
            };
            if !c.stop {
                continue;
            }
            let pf = &m.platforms[p as usize];
            let st = &m.stations[pf.station as usize];
            let g = &m.groups[st.group as usize];
            if line_modes.get(r.line).is_some_and(|x| x.is_none()) {
                line_modes[r.line] = places.get(&pf.id).and_then(|pl| pl.mode.clone());
            }
            if !stops.contains_key(&pf.id) {
                let xy = place_of(p as usize)
                    .or_else(|| {
                        notes.push(format!(
                            "Platform {} has no position in the design; placed at the middle of {}.",
                            pf.id, g.name
                        ));
                        group_middle(st.group as usize)
                    })
                    .unwrap_or_else(|| {
                        notes.push(format!(
                            "Station {} has no position in the design; placed at the origin.",
                            g.name
                        ));
                        [0.0, 0.0]
                    });
                let [lon, lat] = tm.to_lonlat(P2::new(xy[0], xy[1]));
                stops.insert(
                    pf.id.clone(),
                    Stop {
                        stop_id: pf.id.clone(),
                        stop_name: g.name.clone(),
                        stop_lat: lat,
                        stop_lon: lon,
                        parent_station: Some(format!("group:{}", g.key)),
                        platform_code: pf.label.clone(),
                    },
                );
            }
            // As the GTFS rows: arrivals rounded up, departures down, so a published connection holds.
            let arr = c.arrive_s.or(c.depart_s).unwrap_or(0.0).ceil();
            let dep = c.depart_s.or(c.arrive_s).unwrap_or(0.0).floor().max(arr);
            stop_times.push(StopTime {
                stop_id: pf.id.clone(),
                stop_sequence: stop_times.len() as u32 + 1,
                arrival_time: arr.max(0.0) as u32,
                departure_time: dep.max(0.0) as u32,
                pickup_type: u8::from(i + 1 == n),
                drop_off_type: u8::from(i == 0),
            });
        }
        if stop_times.len() < 2 {
            continue;
        }
        trips.push(Trip {
            trip_id: r.name.clone(),
            route_id: routes
                .get(r.line)
                .map_or_else(|| format!("line-{}", r.line), |x| x.id.clone()),
            direction_id: r.direction,
            service_id: service_id.into(),
            block_id: Some(format!("train-{}", r.vehicle)),
            stop_times,
        });
    }

    let routes = routes
        .iter()
        .zip(line_modes)
        .map(|(ri, found)| Route {
            route_id: ri.id.clone(),
            route_short_name: ri.name.clone(),
            mode: ri
                .mode
                .clone()
                .or(found)
                .unwrap_or_else(|| "regional_rail".into()),
            route_color: ri.color.clone(),
        })
        .collect();
    JourneyTimetable {
        timetable: Timetable {
            stops: stops.into_values().collect(),
            routes,
            trips,
            transfers: Vec::new(),
            frequency_patterns: Vec::new(),
        },
        notes,
    }
}
