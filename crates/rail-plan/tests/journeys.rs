//! Rail trips in the journey planner: a design drawn in the railway editor (topology export), a line
//! planned on it, published for the journey planner and merged with a street bus line that changes with
//! the trains at a stop named like the station.

mod common;

use journey_planner::timetable::{
    FrequencyPattern, PatternStop, Period, PeriodKind, Route, Stop, Timetable,
};
use journey_planner::{Leg, Planner, Query, Settings, TimeMode};
use rail_design::geom::P2;
use rail_design::proj::LocalTm;
use rail_model::topology::{import_json, ImportOptions, Imported};
use rail_model::Model;
use rail_plan::{journey_timetable, plan, Band, Call, LineSpec, PlanParams, RouteInfo};

fn design() -> (Imported, Model) {
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../rail-model/tests/data/metro.json"
    ))
    .unwrap();
    let imp = import_json(&json, &ImportOptions::default()).unwrap();
    let m = Model::compile(&imp.spec).unwrap();
    (imp, m)
}

/// Purpose: shuttle Riverside – Northgate every 10 minutes, 06:00–10:00.
fn shuttle(m: &Model) -> LineSpec {
    // The fixture's siding is not reachable from a free platform, so trains stable in the platforms.
    let stabling = m
        .tracks
        .iter()
        .filter(|t| t.id.starts_with('s'))
        .map(|t| t.id.clone())
        .collect();
    LineSpec {
        id: "M7".into(),
        name: "M7".into(),
        calls: vec![Call::at("Riverside"), Call::at("Northgate")],
        train: rail_dynamics_train(),
        dwell_s: 30.0,
        turnback_s: 180.0,
        supplement_share: 0.05,
        stabling,
        bands: vec![Band {
            from_s: 6.0 * 3600.0,
            to_s: 10.0 * 3600.0,
            headway_s: 600.0,
        }],
        return_offset_s: None,
    }
}

fn rail_timetable() -> (Timetable, LocalTm, Imported) {
    let (imp, m) = design();
    let line = shuttle(&m);
    let p = plan(&m, &[line], &PlanParams::default()).unwrap();
    assert!(p.issues.is_empty(), "{:?}", p.issues);
    let origin = imp.origin.expect("export has an origin");
    let routes = [RouteInfo {
        id: "M7".into(),
        name: "M7".into(),
        mode: None,
        color: Some("1d4ed8".into()),
    }];
    let jt = journey_timetable(&m, &p, &routes, &imp.platform_places, origin, "weekday");
    assert!(jt.notes.is_empty(), "{:?}", jt.notes);
    (jt.timetable, LocalTm::new(origin[0], origin[1]), imp)
}

#[test]
fn every_platform_called_at_is_a_placed_stop_of_its_station() {
    let (tt, tm, imp) = rail_timetable();
    assert_eq!(tt.routes.len(), 1);
    assert_eq!(tt.routes[0].mode, "metro", "mode taken from the platforms");
    assert!(!tt.trips.is_empty());
    for s in &tt.stops {
        let place = &imp.platform_places[&s.stop_id];
        let xy = tm.to_xy(s.stop_lon, s.stop_lat);
        assert!((xy.x - place.x).abs() < 0.01 && (xy.y - place.y).abs() < 0.01);
        let parent = s.parent_station.as_deref().unwrap();
        assert!(parent.starts_with("group:"), "{parent}");
        assert!(s.stop_name == "Riverside" || s.stop_name == "Northgate");
    }
    for t in &tt.trips {
        let st = &t.stop_times;
        assert!(st.len() >= 2);
        assert!(st
            .windows(2)
            .all(|w| w[1].arrival_time >= w[0].departure_time));
        assert_eq!(st[0].drop_off_type, 1);
        assert_eq!(st.last().unwrap().pickup_type, 1);
    }
    // The contract shape round-trips through JSON (what the web app loads).
    let json = serde_json::to_string(&tt).unwrap();
    let back: Timetable = serde_json::from_str(&json).unwrap();
    assert_eq!(back.trips.len(), tt.trips.len());
}

#[test]
fn journey_rides_the_train_then_changes_to_a_bus_at_the_same_name_stop() {
    let (rail, tm, imp) = rail_timetable();
    let northgate = imp
        .platform_places
        .iter()
        .find(|(id, _)| id.starts_with("p2."))
        .map(|(_, p)| P2::new(p.x, p.y))
        .unwrap();
    let riverside = imp
        .platform_places
        .iter()
        .find(|(id, _)| id.starts_with("p1."))
        .map(|(_, p)| P2::new(p.x, p.y))
        .unwrap();
    let ll = |p: P2| tm.to_lonlat(p);
    // Bus stop "Northgate" 450 m from the platforms: farther than an ordinary change walk (400 m), so
    // only the shared name makes it an interchange. The bus runs 3 km further on to "Hill Farm".
    let bus_at = |dy: f64| ll(P2::new(northgate.x, northgate.y + dy));
    let stop = |id: &str, name: &str, p: [f64; 2]| Stop {
        stop_id: id.into(),
        stop_name: name.into(),
        stop_lat: p[1],
        stop_lon: p[0],
        parent_station: None,
        platform_code: None,
    };
    let bus = Timetable {
        stops: vec![
            stop("bus:1", "NORTHGATE", bus_at(450.0)),
            stop("bus:2", "Hill Farm", bus_at(3450.0)),
        ],
        routes: vec![Route {
            route_id: "street-42".into(),
            route_short_name: "42".into(),
            mode: "bus".into(),
            route_color: None,
        }],
        trips: vec![],
        transfers: vec![],
        frequency_patterns: vec![FrequencyPattern {
            pattern_id: "street-42-0".into(),
            route_id: "street-42".into(),
            direction_id: 0,
            service_id: "weekday".into(),
            stops: vec![
                PatternStop {
                    stop_id: "bus:1".into(),
                    run_time: 0,
                    dwell_time: 0,
                },
                PatternStop {
                    stop_id: "bus:2".into(),
                    run_time: 360,
                    dwell_time: 20,
                },
            ],
            periods: vec![Period {
                start_time: 5 * 3600,
                end_time: 12 * 3600,
                headway_secs: 300,
                offset_secs: Some(0),
                kind: PeriodKind::OffPeak,
            }],
        }],
    };
    let tt = Timetable {
        stops: [rail.stops.clone(), bus.stops].concat(),
        routes: [rail.routes.clone(), bus.routes].concat(),
        trips: rail.trips.clone(),
        transfers: vec![],
        frequency_patterns: bus.frequency_patterns,
    };
    let from = ll(P2::new(riverside.x, riverside.y - 100.0));
    let to = ll(P2::new(northgate.x, northgate.y + 3550.0));
    let q = Query {
        from,
        to,
        time_s: 7 * 3600,
        mode: TimeMode::DepartAt,
    };

    let planner = Planner::new(&tt, Settings::default());
    assert_eq!(
        planner.summary().joined_by_name,
        1,
        "{:?}",
        planner.summary()
    );
    let plan = planner.plan(&q);
    let j = plan.journeys.first().expect("a journey");
    let rides: Vec<&str> = j
        .legs
        .iter()
        .filter_map(|l| match l {
            Leg::Ride { route_id, .. } => Some(route_id.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(rides, vec!["M7", "street-42"], "{j:?}");

    // Without the shared name the change is out of walking reach: no train-and-bus journey.
    let mut renamed = tt.clone();
    renamed
        .stops
        .iter_mut()
        .find(|s| s.stop_id == "bus:1")
        .unwrap()
        .stop_name = "Elm Road".into();
    let planner = Planner::new(&renamed, Settings::default());
    assert_eq!(planner.summary().joined_by_name, 0);
    let plan = planner.plan(&q);
    assert!(plan.journeys.iter().all(|j| {
        let n = j
            .legs
            .iter()
            .filter(|l| matches!(l, Leg::Ride { .. }))
            .count();
        n < 2
    }));
}

/// Purpose: the example metro train shortened to two cars (80 m) to fit the design's 120 m platforms.
fn rail_dynamics_train() -> rail_dynamics::TrainParams {
    rail_dynamics::TrainParams {
        length_m: 80.0,
        mass_kg: 140_000.0,
        ..common::metro_train()
    }
}
