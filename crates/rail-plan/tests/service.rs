//! Service lines from the railway editor: stops, a catalogue train and headways, planned on the
//! design's topology export and published for the journey planner in one call.

use rail_plan::{
    line_spec, publish_service, service_bands, train_params, train_params_with, ServiceLine,
    ServiceVehicle,
};

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
        accel_ms2: None,
        decel_ms2: None,
        supplement_share: None,
    }
}

#[test]
fn bands_follow_the_peaks_and_the_service_day() {
    let b = service_bands(&shuttle());
    let got: Vec<(f64, f64, f64)> = b
        .iter()
        .map(|b| (b.from_s / 3600.0, b.to_s / 3600.0, b.headway_s))
        .collect();
    // A gradual start and finish (Homlo, Damascus test): twice the off-peak headway at the start,
    // steps to and from the peak (each ramp takes half the short off-peak hour here), and twice
    // the off-peak headway again at the end of the day.
    assert_eq!(
        got,
        vec![
            (6.0, 6.25, 2400.0),
            (6.25, 6.5, 1800.0),
            (6.5, 6.75, 1020.0),
            (6.75, 7.0, 780.0),
            (7.0, 9.0, 600.0),
            (9.0, 9.25, 780.0),
            (9.25, 9.5, 1020.0),
            (9.5, 9.75, 1800.0),
            (9.75, 10.0, 2400.0),
        ]
    );
}

#[test]
fn a_long_off_peak_runs_at_its_headway_between_the_ramps() {
    let mut l = shuttle();
    l.first_s = 5.0 * 3600.0;
    l.last_s = 24.0 * 3600.0;
    l.peaks = vec![[7.0 * 3600.0, 9.0 * 3600.0], [16.0 * 3600.0, 19.0 * 3600.0]];
    let b = service_bands(&l);
    let at = |h: f64| {
        b.iter()
            .find(|x| x.from_s <= h * 3600.0 && h * 3600.0 < x.to_s)
            .map(|x| x.headway_s)
    };
    assert_eq!(at(5.1), Some(2400.0));
    assert_eq!(at(6.2), Some(1020.0));
    assert_eq!(at(8.0), Some(600.0));
    assert_eq!(at(12.0), Some(1200.0));
    assert_eq!(at(15.7), Some(780.0));
    assert_eq!(at(17.0), Some(600.0));
    assert_eq!(at(21.0), Some(1200.0));
    assert_eq!(at(23.8), Some(2400.0));
    // The bands cover the day without gaps.
    for w in b.windows(2) {
        assert!((w[0].to_s - w[1].from_s).abs() < 1e-6);
    }
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
    // 7–9 every 10 min (12), and the ramps of the short off-peak hours either side, each band
    // from its start: 06:00 (40 min), 06:15 (30), 06:30 (17), 06:45 and 06:58 (13); 09:00 and
    // 09:13 (13), 09:15 (17), 09:30 (30), 09:45 (40): 22 departures each way.
    assert_eq!(r.trips, 44, "{:?}", r.issues);
    assert!(r.trains >= 1);
    let run = r.outbound_s.unwrap();
    assert!(run > 30.0 && run < 900.0, "{run}");
    assert!(r.return_s.is_some());
    let tt = &out.timetable;
    assert_eq!(tt.routes.len(), 1);
    assert_eq!(tt.routes[0].route_id, "M7");
    assert_eq!(tt.routes[0].mode, "metro");
    assert_eq!(tt.routes[0].route_color.as_deref(), Some("1d4ed8"));
    assert_eq!(tt.trips.len(), 44);
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
fn stations_stay_reachable_while_the_design_has_unrelated_errors() {
    // A service line gets its stops while the planner still fixes other errors (a crossover
    // that does not fit elsewhere); only publishing needs an error-free design.
    use rail_plan::station_reachable;
    let mut t: serde_json::Value = serde_json::from_str(&topology()).unwrap();
    t["valid"] = serde_json::Value::Bool(false);
    t["errors"] = serde_json::json!(["Crossover 7: the tracks are 3.00 m apart, too close"]);
    assert!(station_reachable(&t.to_string(), "st1", "st2").unwrap().ok);
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

#[test]
fn trains_per_hour_on_each_section_follow_the_timetable() {
    let out = publish_service(&topology(), &[shuttle()], "weekday").unwrap();
    assert!(!out.section_trains.is_empty());
    let topo: serde_json::Value = serde_json::from_str(&topology()).unwrap();
    let sections: Vec<&str> = topo["sections"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["id"].as_str().unwrap())
        .collect();
    for s in &out.section_trains {
        assert_eq!(s.line, "M7");
        assert!(sections.contains(&s.section.as_str()), "{}", s.section);
        // No trains before 06:00 or after 11:00.
        assert!(s.hours[..6].iter().all(|&n| n == 0), "{s:?}");
        assert!(s.hours[11..].iter().all(|&n| n == 0), "{s:?}");
    }
    // Some section carries both directions of the peak: 6 trips each way an hour, 12 in all.
    let busiest = out
        .section_trains
        .iter()
        .map(|s| s.hours[7] + s.hours[8])
        .max()
        .unwrap();
    assert!((20..=26).contains(&busiest), "{busiest}");
    // A section counts every trip at most once.
    let total: u32 = out
        .section_trains
        .iter()
        .map(|s| s.hours.iter().sum::<u32>())
        .max()
        .unwrap();
    assert!(total <= 44, "{total}");
}

#[test]
fn the_projects_acceleration_braking_and_supplement_replace_the_modes() {
    let t = train_params_with(&class_j(), 1, "metro", Some(0.8), Some(0.9));
    let a0 = t.max_tractive_effort_n / (t.mass_kg * t.rotating_mass_factor);
    assert!((a0 - 0.8).abs() < 1e-9);
    assert!((t.service_decel_mps2 - 0.9).abs() < 1e-9);
    // Nonsense keeps the mode's values.
    let d = train_params_with(&class_j(), 1, "metro", Some(-1.0), None);
    assert_eq!(d, train_params(&class_j(), 1, "metro"));
    let imp = rail_model::topology::import_json(
        &topology(),
        &rail_model::topology::ImportOptions::default(),
    )
    .unwrap();
    let m = rail_model::Model::compile(&imp.spec).unwrap();
    let l = ServiceLine {
        supplement_share: Some(0.08),
        ..shuttle()
    };
    assert!((line_spec(&l, &m).supplement_share - 0.08).abs() < 1e-9);
    assert!((line_spec(&shuttle(), &m).supplement_share - 0.05).abs() < 1e-9);
}
