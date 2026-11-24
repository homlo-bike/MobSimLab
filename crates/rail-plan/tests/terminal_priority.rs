//! A double-track main line of 141 km with five stations (the Syria test line, Damascus to Homs),
//! loops at the three stations between, and terminals whose crossover lets arriving trains into one
//! platform only. Regional trains every 20 min take that platform most of the time; the high-speed
//! trains, ranked higher, get it first and the regional trains give way.

use rail_model::topology::{import_json, ImportOptions};
use rail_model::Model;
use rail_plan::{line_spec, plan, Issue, LineSpec, PlanParams, RunKind, ServiceLine};

fn model() -> Model {
    let doc = include_str!("data/one-platform-terminals.json");
    let net: rail_design::Network = serde_json::from_str(doc).unwrap();
    let t = rail_design::topology::topology(&rail_design::build(&net, None));
    let imp = import_json(
        &serde_json::to_string(&t).unwrap(),
        &ImportOptions::default(),
    )
    .unwrap();
    Model::compile(&imp.spec).unwrap()
}

fn line(
    id: &str,
    stations: &[&str],
    mode: &str,
    v: (f64, f64, f64),
    first_min: f64,
    headway_min: f64,
) -> ServiceLine {
    serde_json::from_value(serde_json::json!({
        "id": id, "name": id, "color": null, "stations": stations,
        "vehicle": {"id": id, "name": id, "length_m": v.0, "top_speed_kmh": v.1, "power_kw": v.2,
                    "empty_mass_t": null, "capacity": 400.0},
        "units": 1, "mode": mode, "first_s": first_min * 60.0, "last_s": 9.0 * 3600.0,
        "peak_headway_s": headway_min * 60.0, "offpeak_headway_s": headway_min * 60.0,
        "peaks": [[0.0, 86400.0]], "dwell_s": null, "stop_dwells_s": null, "turnback_s": null,
        "accel_ms2": null, "decel_ms2": null, "supplement_share": null
    }))
    .unwrap()
}

fn trips(p: &rail_plan::Plan, line: usize) -> usize {
    p.runs
        .iter()
        .filter(|r| r.line == line && r.kind == RunKind::Service)
        .count()
}

fn unplaced(p: &rail_plan::Plan, prefix: &str) -> usize {
    p.issues
        .iter()
        .filter(|i| matches!(i, Issue::Unplaced { trip, .. } if trip.starts_with(prefix)))
        .count()
}

#[test]
fn high_speed_trains_get_the_one_terminal_platform_first() {
    let m = model();
    let r1 = line(
        "r1",
        &["st5", "st4", "st3", "st2", "st1"],
        "regional_rail",
        (75.0, 160.0, 2600.0),
        300.0,
        20.0,
    );
    let hs = line(
        "hs1",
        &["st1", "st5"],
        "high_speed_rail",
        (205.0, 230.0, 6400.0),
        330.0,
        30.0,
    );
    let specs: Vec<LineSpec> = [&r1, &hs].iter().map(|l| line_spec(l, &m)).collect();
    assert!(specs[1].priority > specs[0].priority);
    let p = plan(&m, &specs, &PlanParams::default()).unwrap();
    // Every high-speed trip runs; regional trips give way.
    assert_eq!(unplaced(&p, "hs1"), 0, "{:?}", p.issues);
    assert!(trips(&p, 1) >= 12, "high-speed trips {}", trips(&p, 1));
    assert!(trips(&p, 0) > 0);

    // Ranked alike, the trains are planned in order of departure as before: the regional trains,
    // leaving first, take the platform.
    let alike: Vec<LineSpec> = specs
        .iter()
        .cloned()
        .map(|s| LineSpec { priority: 2, ..s })
        .collect();
    let same = plan(&m, &alike, &PlanParams::default()).unwrap();
    assert!(trips(&same, 1) < trips(&p, 1));
}

#[test]
fn with_room_for_both_the_trains_keep_the_plan_in_order_of_departure() {
    // Hourly regional trains and high-speed trains every 30 min fit together: every trip runs.
    let m = model();
    let r1 = line(
        "r1",
        &["st5", "st4", "st3", "st2", "st1"],
        "regional_rail",
        (75.0, 160.0, 2600.0),
        300.0,
        60.0,
    );
    let hs = line(
        "hs1",
        &["st1", "st5"],
        "high_speed_rail",
        (205.0, 230.0, 6400.0),
        330.0,
        30.0,
    );
    let specs: Vec<LineSpec> = [&r1, &hs].iter().map(|l| line_spec(l, &m)).collect();
    let p = plan(&m, &specs, &PlanParams::default()).unwrap();
    assert_eq!(unplaced(&p, "hs1"), 0, "{:?}", p.issues);
    assert_eq!(unplaced(&p, "r1"), 0, "{:?}", p.issues);
}
