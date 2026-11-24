//! A main line shared by regional and ICE trains: five stations 25 km apart, each with a loop on
//! either side of the two through tracks. The ICE keeps its times; regional trains wait in a
//! station for it to pass.

use rail_model::topology::{import_json, ImportOptions};
use rail_model::Model;
use rail_plan::{
    line_spec, plan, LineSpec, Plan, PlanParams, RunKind, ServiceLine, ServiceVehicle,
};

/// The topology export of the test line's drawing.
fn topology() -> String {
    let doc = include_str!("data/main-line-overtaking.json");
    let net: rail_design::Network = serde_json::from_str(doc).unwrap();
    let d = rail_design::build(&net, None);
    let t = rail_design::topology::topology(&d);
    assert!(t.valid, "{:?}", t.errors);
    serde_json::to_string(&t).unwrap()
}

fn vehicle(id: &str, length_m: f64, top_speed_kmh: f64, power_kw: f64) -> ServiceVehicle {
    ServiceVehicle {
        id: id.into(),
        name: id.into(),
        length_m,
        top_speed_kmh,
        power_kw: Some(power_kw),
        empty_mass_t: None,
        capacity: 400.0,
    }
}

fn line(
    id: &str,
    stations: &[&str],
    v: ServiceVehicle,
    mode: &str,
    first_min: f64,
    headway_min: f64,
) -> ServiceLine {
    ServiceLine {
        id: id.into(),
        name: id.to_uppercase(),
        color: None,
        stations: stations.iter().map(|s| s.to_string()).collect(),
        vehicle: v,
        units: 1,
        mode: mode.into(),
        first_s: first_min * 60.0,
        last_s: 9.0 * 3600.0,
        peak_headway_s: headway_min * 60.0,
        offpeak_headway_s: headway_min * 60.0,
        peaks: vec![[0.0, 24.0 * 3600.0]],
        dwell_s: None,
        stop_dwells_s: None,
        turnback_s: None,
        accel_ms2: None,
        decel_ms2: None,
        supplement_share: None,
    }
}

/// Regional trains every 20 min calling everywhere and an ICE every 30 min without stops, from
/// 06:00 to 09:00: an ICE catches up with a regional train on most trips.
fn lines() -> Vec<ServiceLine> {
    vec![
        line(
            "rb",
            &["st1", "st2", "st3", "st4", "st5"],
            vehicle("flirt", 75.0, 160.0, 2000.0),
            "regional_rail",
            360.0,
            20.0,
        ),
        line(
            "ice",
            &["st1", "st5"],
            vehicle("ice", 200.0, 250.0, 8000.0),
            "high_speed_rail",
            370.0,
            30.0,
        ),
    ]
}

fn run(specs: &[LineSpec], m: &Model) -> Plan {
    plan(m, specs, &PlanParams::default()).unwrap()
}

fn trips(p: &Plan, line: usize) -> usize {
    p.runs
        .iter()
        .filter(|r| r.line == line && r.kind == RunKind::Service)
        .count()
}

#[test]
fn regional_trains_wait_in_a_station_for_the_ice_to_pass() {
    let imp = import_json(&topology(), &ImportOptions::default()).unwrap();
    let m = Model::compile(&imp.spec).unwrap();
    let specs: Vec<LineSpec> = lines().iter().map(|l| line_spec(l, &m)).collect();
    assert!(specs[1].priority > specs[0].priority);
    let ranked = run(&specs, &m);
    // Ranked alike, the trains do not give way to each other.
    let alike: Vec<LineSpec> = specs
        .iter()
        .cloned()
        .map(|s| LineSpec { priority: 2, ..s })
        .collect();
    let same = run(&alike, &m);
    assert!(
        trips(&ranked, 1) > trips(&same, 1),
        "ICE trips {} ranked, {} alike",
        trips(&ranked, 1),
        trips(&same, 1)
    );
    assert!(trips(&ranked, 0) + trips(&ranked, 1) >= trips(&same, 0) + trips(&same, 1));
    // Regional trains wait beyond their dwell at a station for an ICE to pass: at a station before
    // the last one (the timetable's own extra time is held at the last), or at the last one in a
    // loop, a platform the line does not usually use there.
    let waits = |p: &Plan| {
        let runs: Vec<_> = p
            .runs
            .iter()
            .filter(|r| r.line == 0 && r.kind == RunKind::Service)
            .collect();
        let usual = |dir: u8, i: usize| {
            let mut n: std::collections::HashMap<&str, usize> = Default::default();
            for r in runs
                .iter()
                .filter(|r| r.direction == dir && r.calls.len() > i)
            {
                *n.entry(r.calls[i].id.as_str()).or_default() += 1;
            }
            n.into_iter().max_by_key(|x| x.1).map(|x| x.0.to_string())
        };
        runs.iter()
            .filter(|r| {
                let n = r.calls.len();
                r.calls[1..n - 1].iter().enumerate().any(|(i, c)| {
                    let long = match (c.arrive_s, c.depart_s) {
                        (Some(a), Some(d)) => d - a > specs[0].dwell_s + 25.0,
                        _ => false,
                    };
                    long && (i + 2 < n - 1 || usual(r.direction, i + 1).as_deref() != Some(&c.id))
                })
            })
            .count()
    };
    assert!(waits(&ranked) > 0);
    assert_eq!(waits(&same), 0);
    // With no wait allowed (the project's "longest wait for a faster train"), none waits.
    let no_wait = PlanParams {
        max_overtake_wait_s: 0.0,
        ..PlanParams::default()
    };
    assert_eq!(waits(&plan(&m, &specs, &no_wait).unwrap()), 0);
}
