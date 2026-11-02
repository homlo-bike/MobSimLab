//! Road closures at level crossings from train runs over the imported regional design.

#[path = "common/mod.rs"]
mod common;

use rail_dynamics::TrainParams;
use rail_model::topology::{import_json, ImportOptions};
use rail_model::{Model, RouteExit, SignalAt};
use rail_plan::{
    level_crossing_closures, run_closures, run_timing, BlockingParams, Plan, PlannedRun, RunKind,
    TrainRun,
};

fn emu() -> TrainParams {
    TrainParams {
        length_m: 150.0,
        mass_kg: 250_000.0,
        rotating_mass_factor: 1.06,
        max_tractive_effort_n: 250_000.0,
        power_w: 4.0e6,
        davis_a_n: 2_500.0,
        davis_b_n_per_mps: 30.0,
        davis_c_n_per_mps2: 6.0,
        service_decel_mps2: 0.8,
        max_speed_mps: 160.0 / 3.6,
    }
}

fn model() -> Model {
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../rail-model/tests/data/regional_rail.json"
    ))
    .unwrap();
    let imp = import_json(&json, &ImportOptions::default()).unwrap();
    Model::compile(&imp.spec).unwrap()
}

/// Purpose: routes from a Riverside starter to a Northgate buffer stop (breadth-first search).
fn riverside_to_northgate(m: &Model) -> Vec<u32> {
    let tracks = |name: &str| -> Vec<usize> {
        m.platforms
            .iter()
            .filter(|p| m.stations[p.station as usize].name == name)
            .map(|p| p.track)
            .collect()
    };
    let (from, to) = (tracks("Riverside"), tracks("Northgate"));
    let starts: Vec<u32> = (0..m.routes.len() as u32)
        .filter(|&r| {
            let entry = match m.signals[m.routes[r as usize].entry as usize].at {
                SignalAt::Exit { piece, .. } | SignalAt::Entry { piece, .. } => piece,
            };
            from.contains(&m.pieces[entry as usize].track)
        })
        .collect();
    let mut prev = std::collections::BTreeMap::new();
    let mut q: std::collections::VecDeque<u32> = starts.iter().copied().collect();
    for &s in &starts {
        prev.insert(s, None);
    }
    let mut goal = None;
    while let Some(r) = q.pop_front() {
        let last = m.routes[r as usize].steps.last().unwrap().piece;
        if to.contains(&m.pieces[last as usize].track)
            && matches!(m.routes[r as usize].exit, RouteExit::BufferStop(_))
        {
            goal = Some(r);
            break;
        }
        for &n in m.next_routes(r) {
            if let std::collections::btree_map::Entry::Vacant(e) = prev.entry(n) {
                e.insert(Some(r));
                q.push_back(n);
            }
        }
    }
    let mut path = vec![goal.expect("Northgate reachable")];
    while let Some(Some(p)) = prev.get(path.last().unwrap()) {
        path.push(*p);
    }
    path.reverse();
    path
}

fn run(name: &str, routes: &[u32], depart_s: f64) -> TrainRun {
    TrainRun {
        name: name.into(),
        train: emu(),
        routes: routes.to_vec(),
        start_m: 0.0,
        depart_s,
        stops: vec![],
        stop_at_end: true,
        end_m: None,
        occupy_until_s: None,
        supplement_share: 0.05,
    }
}

fn planned(m: &Model, r: TrainRun) -> PlannedRun {
    let t = run_timing(m, &r, 0, &BlockingParams::default()).unwrap();
    PlannedRun {
        name: r.name.clone(),
        line: 0,
        kind: RunKind::Service,
        direction: 0,
        vehicle: 0,
        planned_depart_s: r.depart_s,
        run: r,
        calls: vec![],
        blocking: t.blocking,
    }
}

#[test]
fn a_train_closes_the_street_from_the_approach_point_until_its_tail_clears() {
    let m = model();
    let routes = riverside_to_northgate(&m);
    let r = run("RE 1", &routes, 6.0 * 3600.0);
    let t = run_timing(&m, &r, 0, &BlockingParams::default()).unwrap();
    let c = run_closures(&m, &r, &t, 10.0).unwrap();
    assert_eq!(
        c.len(),
        1,
        "the train passes the crossing once, on one line: {c:?}"
    );
    let (i, s, e) = c[0];
    let lc = &m.level_crossings[i].spec;
    // The train starts at a platform about 1 km from the crossing, inside the 1.1 km approach,
    // so the street closes when it departs; at least the warning time before it arrives.
    assert!((s - r.depart_s).abs() < 1e-6, "closes at departure: {s}");
    let dur = e - s;
    assert!(
        dur > lc.warning_time_s + 10.0 && dur < 240.0,
        "closed for {dur:.0} s"
    );
}

#[test]
fn closures_of_trains_close_together_are_merged_and_far_apart_are_kept() {
    let m = model();
    let routes = riverside_to_northgate(&m);
    let base = 6.0 * 3600.0;
    let runs = vec![
        planned(&m, run("RE 1", &routes, base)),
        planned(&m, run("RE 2", &routes, base + 20.0)),
        planned(&m, run("RE 3", &routes, base + 1800.0)),
    ];
    let plan = Plan {
        runs,
        issues: vec![],
        vehicles: 3,
        stabling_start: Default::default(),
        stabling_end: Default::default(),
    };
    let out = level_crossing_closures(&m, &plan, &BlockingParams::default(), 10.0).unwrap();
    assert_eq!(out.schema, "mobsimlab.level-crossing-closures/1");
    assert_eq!(out.level_crossings.len(), 1, "one crossing for both lines");
    let x = &out.level_crossings[0];
    assert_eq!((x.id.as_str(), x.way), ("lc3-1001-0", 1001));
    assert_eq!(x.closures.len(), 2, "{:?}", x.closures);
    assert_eq!(x.closures[0].runs, ["RE 1", "RE 2"]);
    assert_eq!(x.closures[1].runs, ["RE 3"]);
    assert!(x.closures[0].end_s < x.closures[1].start_s);
}

#[test]
fn a_planned_day_closes_a_metro_crossing_for_every_train() {
    use rail_model::{examples, LevelCrossingSpec};
    let mut spec = examples::metro_line();
    for track in ["e1", "w1"] {
        spec.level_crossings.push(LevelCrossingSpec {
            id: format!("lc1-55-0@{track}"),
            track: track.into(),
            position_m: 600.0,
            rail_zone_m: 6.0,
            approach_m: 25.0 * 80.0 / 3.6,
            warning_time_s: 25.0,
            protection: "barriers".into(),
            street_way: 55,
            street_name: "Mill Lane".into(),
            keep_clear_m: 9.0,
            bus: true,
            special_measures: vec![],
            reopen_s: Some(10.0),
        });
    }
    let m = Model::compile(&spec).unwrap();
    let day =
        rail_plan::plan(&m, &[common::metro_m1()], &rail_plan::PlanParams::default()).unwrap();
    let out = level_crossing_closures(&m, &day, &BlockingParams::default(), 10.0).unwrap();
    let x = &out.level_crossings[0];
    assert_eq!(
        (x.id.as_str(), x.street.as_str()),
        ("lc1-55-0", "Mill Lane")
    );
    let services = day
        .runs
        .iter()
        .filter(|r| r.kind == RunKind::Service)
        .count();
    let passes: usize = x.closures.iter().map(|c| c.runs.len()).sum();
    // Every service trip runs the whole line, over the crossing between Alder and Birch.
    assert!(passes >= services, "{passes} passes, {services} trips");
    for w in x.closures.windows(2) {
        assert!(w[0].end_s < w[1].start_s);
    }
    for c in &x.closures {
        let d = c.end_s - c.start_s;
        // Warning time, the 120 m train over the rail zone at line speed, and the barriers
        // rising (longer where trains meet: one closure for both).
        assert!((25.0 + 10.0..200.0).contains(&d), "{d} s");
    }
}
