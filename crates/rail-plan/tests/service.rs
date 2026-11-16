//! Service lines from the railway editor: stops, a catalogue train and headways, planned on the
//! design's topology export and published for the journey planner in one call.

use rail_plan::{publish_service, service_bands, train_params, ServiceLine, ServiceVehicle};

fn topology() -> String {
    std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../rail-model/tests/data/metro.json"
    ))
    .unwrap()
}

/// Stadler Class J (Berlin U-Bahn, 4 cars) from `vehicles/metro/stadler_bvg-j-4-car.json`.
fn class_j() -> ServiceVehicle {
    ServiceVehicle {
        id: "stadler_bvg-j-4-car".into(),
        name: "Stadler Class J".into(),
        length_m: 64.2,
        top_speed_kmh: 70.0,
        power_kw: Some(1200.0),
        empty_mass_t: None,
        capacity: 463.0,
    }
}

fn shuttle() -> ServiceLine {
    ServiceLine {
        id: "M7".into(),
        name: "M7".into(),
        color: Some("#1d4ed8".into()),
        stations: vec!["st1".into(), "st2".into()],
        vehicle: class_j(),
        units: 1,
        mode: "metro".into(),
        first_s: 6.0 * 3600.0,
        last_s: 10.0 * 3600.0,
        peak_headway_s: 600.0,
        offpeak_headway_s: 1200.0,
        peaks: vec![[7.0 * 3600.0, 9.0 * 3600.0]],
        dwell_s: None,
        turnback_s: None,
    }
}

#[test]
fn bands_follow_the_peaks_and_the_service_day() {
    let b = service_bands(&shuttle());
    let got: Vec<(f64, f64, f64)> = b
        .iter()
        .map(|b| (b.from_s / 3600.0, b.to_s / 3600.0, b.headway_s))
        .collect();
    assert_eq!(
        got,
        vec![(6.0, 7.0, 1200.0), (7.0, 9.0, 600.0), (9.0, 10.0, 1200.0)]
    );
}

#[test]
fn train_estimates_are_plausible_for_a_metro() {
    let t = train_params(&class_j(), 2, "metro");
    assert!((t.length_m - 128.4).abs() < 1e-9);
    // About 1.5 t/m empty plus half the capacity at 75 kg.
    assert!(
        t.mass_kg > 180_000.0 && t.mass_kg < 240_000.0,
        "{}",
        t.mass_kg
    );
    assert!((t.power_w - 2.4e6).abs() < 1.0);
    let a0 = t.max_tractive_effort_n / (t.mass_kg * t.rotating_mass_factor);
    assert!((a0 - 1.1).abs() < 1e-9);
    assert!((t.max_speed_mps - 70.0 / 3.6).abs() < 1e-9);
}

#[test]
fn a_line_drawn_on_the_design_reaches_the_journey_planner() {
    let out = publish_service(&topology(), &[shuttle()], "weekday").unwrap();
    let r = &out.lines[0];
    // 6–7 and 9–10 every 20 min, 7–9 every 10 min: 3 + 12 + 3 = 18 departures each way.
    assert_eq!(r.trips, 36, "{:?}", r.issues);
    assert!(r.trains >= 1);
    let run = r.outbound_s.unwrap();
    assert!(run > 30.0 && run < 900.0, "{run}");
    assert!(r.return_s.is_some());
    let tt = &out.timetable;
    assert_eq!(tt.routes.len(), 1);
    assert_eq!(tt.routes[0].route_id, "M7");
    assert_eq!(tt.routes[0].mode, "metro");
    assert_eq!(tt.routes[0].route_color.as_deref(), Some("1d4ed8"));
    assert_eq!(tt.trips.len(), 36);
    let names: std::collections::BTreeSet<&str> =
        tt.stops.iter().map(|s| s.stop_name.as_str()).collect();
    assert_eq!(
        names.into_iter().collect::<Vec<_>>(),
        ["Northgate", "Riverside"]
    );
    let first = tt
        .trips
        .iter()
        .map(|t| t.stop_times[0].departure_time)
        .min()
        .unwrap();
    assert!((6 * 3600..6 * 3600 + 300).contains(&first), "{first}");
}

#[test]
fn the_report_gives_station_distances_for_the_time_distance_graph() {
    let out = publish_service(&topology(), &[shuttle()], "weekday").unwrap();
    let r = &out.lines[0];
    // st1 (Riverside) is the first terminal.
    let names: Vec<&str> = r.stations.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(names, ["Riverside", "Northgate"], "{:?}", r.stations);
    assert_eq!(r.stations[0].km, 0.0);
    let km = r.stations[1].km;
    assert!(km > 0.1 && km < 20.0, "{km}");
    // Every station id is the parent station of a published stop.
    for s in &r.stations {
        assert!(
            out.timetable
                .stops
                .iter()
                .any(|x| x.parent_station.as_deref() == Some(s.station_id.as_str())),
            "{}",
            s.station_id
        );
    }
    // An easy service: nothing moved or dropped.
    assert!(r.unplaced.is_empty(), "{:?}", r.unplaced);
}

#[test]
fn a_line_with_one_stop_or_an_unknown_station_is_refused() {
    let mut l = shuttle();
    l.stations.truncate(1);
    assert!(publish_service(&topology(), &[l], "weekday")
        .unwrap_err()
        .contains("two stops"));
    let mut l = shuttle();
    l.stations[1] = "st99".into();
    assert!(publish_service(&topology(), &[l], "weekday")
        .unwrap_err()
        .contains("st99"));
}

#[test]
fn trains_leave_a_station_whose_exit_signal_stands_beyond_the_platform() {
    // The regional example of the editor (exported 2026-11) keeps 40 m of track beyond each platform, so the exit signal stands
    // more than 30 m past the platform end; trains must still find their departure routes.
    let topo = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/data/regional-overrun.json"
    ))
    .unwrap();
    let mut l = shuttle();
    l.mode = "regional_rail".into();
    l.peak_headway_s = 1800.0;
    l.offpeak_headway_s = 3600.0;
    let out = publish_service(&topo, &[l], "weekday").unwrap();
    let r = &out.lines[0];
    assert!(
        !r.issues.iter().any(|i| i.starts_with("No track connects")),
        "{:?}",
        r.issues
    );
    assert!(r.trips > 0, "{:?}", r.issues);
}

#[test]
fn stations_joined_by_track_are_reachable_in_both_directions() {
    use rail_plan::station_reachable;
    let topo = topology();
    assert!(station_reachable(&topo, "st1", "st2").unwrap().ok);
    assert!(station_reachable(&topo, "st2", "st1").unwrap().ok);
    assert!(station_reachable(&topo, "st1", "st9").is_err());
}

#[test]
fn trams_leave_their_stops_although_they_drive_on_sight() {
    // Trams drive on sight: the design tool places signals only in front of switch areas and
    // crossings, none at the stops, yet a tram line over the editor's example must publish.
    use rail_design::{design::build, sample::sample, topology::topology, RailMode};
    use rail_plan::station_reachable;
    let topo =
        serde_json::to_string(&topology(&build(&sample(RailMode::Tram, 7.0, 50.9), None))).unwrap();
    assert!(station_reachable(&topo, "st1", "st2").unwrap().ok);
    assert!(station_reachable(&topo, "st2", "st1").unwrap().ok);
    let mut l = shuttle();
    l.id = "T4".into();
    l.name = "T4".into();
    l.mode = "tram".into();
    // Siemens Avenio (Munich, 4 sections) from `vehicles/tram/siemens_avenio-munich-4-car.json`.
    l.vehicle = ServiceVehicle {
        id: "siemens_avenio-munich-4-car".into(),
        name: "Siemens Avenio".into(),
        length_m: 36.85,
        top_speed_kmh: 70.0,
        power_kw: Some(600.0),
        empty_mass_t: None,
        capacity: 219.0,
    };
    let out = publish_service(&topo, &[l], "weekday").unwrap();
    let r = &out.lines[0];
    assert!(
        !r.issues.iter().any(|i| i.starts_with("No track connects")),
        "{:?}",
        r.issues
    );
    assert!(r.trips > 0, "{:?}", r.issues);
}

#[test]
fn every_trip_belongs_to_one_vehicle_block_in_time_order() {
    let out = publish_service(&topology(), &[shuttle()], "weekday").unwrap();
    let r = &out.lines[0];
    let service: usize = out
        .blocks
        .iter()
        .map(|b| b.runs.iter().filter(|x| x.kind == "service").count())
        .sum();
    assert_eq!(service, r.trips);
    // As many blocks as the line's trains, each run after the previous one, at the station it ended at.
    assert_eq!(out.blocks.len(), r.trains);
    for b in &out.blocks {
        for w in b.runs.windows(2) {
            assert!(w[1].depart_s >= w[0].arrive_s, "{:?}", b);
            if w[0].kind == "service" && w[1].kind == "service" {
                assert_eq!(w[0].to, w[1].from, "{:?}", b);
            }
        }
        for x in &b.runs {
            assert!(x.km >= 0.0 && x.km < 50.0, "{x:?}");
            assert_eq!(x.line, "M7");
            if x.kind == "service" {
                assert!(x.km > 0.1, "{x:?}");
                assert!(x.from.is_some() && x.to.is_some());
            }
        }
    }
    // Trips of the published timetable keep their ids in the blocks.
    let ids: std::collections::BTreeSet<&str> = out
        .timetable
        .trips
        .iter()
        .map(|t| t.trip_id.as_str())
        .collect();
    for b in &out.blocks {
        for x in b.runs.iter().filter(|x| x.kind == "service") {
            assert!(ids.contains(x.trip.as_str()), "{}", x.trip);
        }
    }
}

#[test]
fn a_shorter_terminal_wait_sends_trains_to_stabling_sooner() {
    let long = publish_service(&topology(), &[shuttle()], "weekday").unwrap();
    let opts = rail_plan::PublishOptions {
        max_idle_s: Some(0.0),
    };
    let short =
        rail_plan::publish_service_with(&topology(), &[shuttle()], "weekday", &opts).unwrap();
    let pulls = |o: &rail_plan::ServicePublication| {
        o.blocks
            .iter()
            .flat_map(|b| &b.runs)
            .filter(|x| x.kind != "service")
            .count()
    };
    assert!(pulls(&short) >= pulls(&long));
}
