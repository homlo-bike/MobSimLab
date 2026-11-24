//! A double-track line whose legs meet other station tracks at each end of a station: the leg into
//! a station joins tracks 2 and 3, the leg out of it tracks 1 and 2, so a train moves over by one
//! track at each station and runs out of track two stations on (Syria intercity test, bugs 10 and
//! 11). The stop picker and the planner say where.

use rail_model::topology::{import_json, ImportOptions};
use rail_model::Model;
use rail_plan::service::issue_message;
use rail_plan::{
    line_spec, plan, station_reachable, Issue, PlanParams, ServiceLine, ServiceVehicle,
};
use serde_json::json;

/// The topology export of five stations 5 km apart, 4 tracks each; `offset`: the legs leave a
/// station on tracks 2 and 3 and arrive on tracks 1 and 2, otherwise on 1 and 2 throughout.
fn topology(offset: bool) -> String {
    let gap = 5000.0;
    let stations: Vec<_> = (0..5)
        .map(|i| {
            let name = ["A", "B", "C", "D", "E"][i];
            json!({"id": i + 1, "name": name, "x": i as f64 * gap, "y": 0,
                "rotation_deg": 0, "level": "street", "side_platforms": 2, "island_platforms": 1,
                "platform_length_m": 220})
        })
        .collect();
    let tracks: Vec<_> = (0..4)
        .map(|i| {
            let out = if offset { [2, 3] } else { [1, 2] };
            json!({"id": 100 + i, "use": "running", "name": "", "level": "street", "power": "auto",
                "bed": "auto", "tracks": 2,
                "start": {"type": "station", "station": i + 1, "end": 1, "tracks": out},
                "end": {"type": "station", "station": i + 2, "end": 0, "tracks": [1, 2]},
                "points": [{"x": i as f64 * gap + 410.0, "y": 0, "level": "street"},
                           {"x": (i + 1) as f64 * gap - 410.0, "y": 0, "level": "street"}]})
        })
        .collect();
    let net: rail_design::Network = serde_json::from_value(json!({
        "mode": "regional_rail", "origin": [10, 51], "stations": stations, "tracks": tracks,
        "switches": [], "lines": []
    }))
    .unwrap();
    let t = rail_design::topology::topology(&rail_design::build(&net, None));
    let mut v = serde_json::to_value(&t).unwrap();
    // The termini have no crossover; the check here is only whether track joins the stops.
    v["valid"] = json!(true);
    v.to_string()
}

fn all_stops() -> ServiceLine {
    ServiceLine {
        id: "r1".into(),
        name: "R1".into(),
        color: None,
        stations: (1..=5).map(|i| format!("st{i}")).collect(),
        vehicle: ServiceVehicle {
            id: "flirt".into(),
            name: "FLIRT".into(),
            length_m: 75.0,
            top_speed_kmh: 160.0,
            power_kw: Some(2000.0),
            empty_mass_t: None,
            capacity: 400.0,
        },
        units: 1,
        mode: "regional_rail".into(),
        first_s: 6.0 * 3600.0,
        last_s: 8.0 * 3600.0,
        peak_headway_s: 3600.0,
        offpeak_headway_s: 3600.0,
        peaks: vec![[0.0, 24.0 * 3600.0]],
        dwell_s: None,
        stop_dwells_s: None,
        turnback_s: None,
        accel_ms2: None,
        decel_ms2: None,
        supplement_share: None,
    }
}

#[test]
fn the_stop_picker_names_the_stations_trains_reach_where_the_track_runs_out() {
    let t = topology(true);
    assert!(station_reachable(&t, "st1", "st2").unwrap().ok);
    assert!(station_reachable(&t, "st1", "st3").unwrap().ok);
    let r = station_reachable(&t, "st1", "st5").unwrap();
    assert!(!r.ok);
    let why = r.reason.unwrap();
    assert!(why.contains("can only reach B, C"), "{why}");
    assert!(why.contains("into and out of C"), "{why}");
    // Lined up, a train runs through.
    assert!(
        station_reachable(&topology(false), "st1", "st5")
            .unwrap()
            .ok
    );
}

#[test]
fn the_planner_says_which_stop_trains_cannot_carry_on_from() {
    let imp = import_json(&topology(true), &ImportOptions::default()).unwrap();
    let m = Model::compile(&imp.spec).unwrap();
    let spec = line_spec(&all_stops(), &m);
    let p = plan(&m, &[spec], &PlanParams::default()).unwrap();
    let texts: Vec<String> = p
        .issues
        .iter()
        .filter(|i| matches!(i, Issue::NoPath { .. }))
        .map(|i| issue_message(i, &m).english())
        .collect();
    assert_eq!(texts.len(), 2, "{texts:?}");
    assert!(
        texts[0].starts_with("No track connects the stops in the line's direction: trains from A reach C, but on station tracks that do not lead on to D."),
        "{}",
        texts[0]
    );
    assert!(
        texts[1].starts_with("No track connects the stops in the return direction: "),
        "{}",
        texts[1]
    );
    // Lined up, the line plans its trips.
    let imp = import_json(&topology(false), &ImportOptions::default()).unwrap();
    let m = Model::compile(&imp.spec).unwrap();
    let p = plan(&m, &[line_spec(&all_stops(), &m)], &PlanParams::default()).unwrap();
    assert!(
        !p.issues.iter().any(|i| matches!(i, Issue::NoPath { .. })),
        "{:?}",
        p.issues
    );
    assert!(!p.runs.is_empty());
}
