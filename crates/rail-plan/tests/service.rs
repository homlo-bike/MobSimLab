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
