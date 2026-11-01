use rail_dynamics::TrainParams;
use rail_model::{examples, Model};
use rail_plan::{compress, find_conflicts, run_timing, timetable_timing, BlockingParams, TrainRun};

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

fn routes(m: &Model, ids: &[&str]) -> Vec<u32> {
    ids.iter()
        .map(|i| m.route(i).unwrap_or_else(|| panic!("route {i}")))
        .collect()
}

fn line_run(m: &Model, name: &str, depart_s: f64) -> TrainRun {
    TrainRun {
        name: name.into(),
        train: emu(),
        routes: routes(m, &["S0>S1", "S1>S2", "S2>S3", "S3>S4", "S4>end"]),
        start_m: 0.0,
        depart_s,
        stops: vec![],
        stop_at_end: false,
        occupy_until_s: None,
        supplement_share: 0.0,
    }
}

#[test]
fn blocking_stairway_is_ordered_and_covers_the_run() {
    let m = Model::compile(&examples::plain_line(5, 1000.0, 120.0)).unwrap();
    let t = run_timing(&m, &line_run(&m, "a", 0.0), 0, &BlockingParams::default()).unwrap();
    let main: Vec<_> = t.blocking.iter().filter(|b| !b.overlap).collect();
    assert_eq!(main.len(), 5);
    for w in main.windows(2) {
        assert!(w[1].start_s >= w[0].start_s, "stairway rises");
        assert!(w[1].end_s > w[0].end_s);
    }
    // First block is needed before departure (setting + sight/reaction).
    assert!(main[0].start_s < 0.0);
    // Every block is blocked at least for the time the train runs through it.
    for b in &main {
        assert!(b.end_s - b.start_s > 20.0);
    }
}

#[test]
fn minimum_headway_from_blocking_times() {
    let m = Model::compile(&examples::plain_line(5, 1000.0, 120.0)).unwrap();
    let p = BlockingParams::default();
    let t = run_timing(&m, &line_run(&m, "a", 0.0), 0, &p).unwrap();
    // For identical trains the minimum headway is the longest blocking time of one section.
    let mut per_tds = std::collections::BTreeMap::new();
    for b in &t.blocking {
        let e = per_tds.entry(b.tds).or_insert((b.start_s, b.end_s));
        e.0 = f64::min(e.0, b.start_s);
        e.1 = f64::max(e.1, b.end_s);
    }
    let buffer = 10.0;
    let h_min = per_tds.values().map(|(s, e)| e - s).fold(0.0, f64::max) + buffer;
    let pair = |h: f64| {
        let runs = vec![line_run(&m, "a", 0.0), line_run(&m, "b", h)];
        let ts = timetable_timing(&m, &runs, &p).unwrap();
        let blocks: Vec<_> = ts.iter().flat_map(|t| t.blocking.clone()).collect();
        (find_conflicts(&blocks, buffer), blocks)
    };
    assert!(pair(h_min + 1.0).0.is_empty());
    let (c, _) = pair(h_min - 1.0);
    assert!(!c.is_empty());
    assert!(c.iter().all(|x| x.first == 0 && x.second == 1));
    // Compression of two trains 20 minutes apart pushes them to the minimum headway.
    let (_, blocks) = pair(1200.0);
    let comp = compress(&blocks, None, -100.0, 3600.0, buffer);
    assert_eq!(comp.headways_s.len(), 1);
    assert!(
        (comp.headways_s[0] - h_min).abs() < 1.0,
        "{} vs {h_min}",
        comp.headways_s[0]
    );
    assert!(comp.consumption > 0.0 && comp.consumption < 0.2);
}

#[test]
fn capacity_consumption_grows_with_trains() {
    let m = Model::compile(&examples::plain_line(5, 1000.0, 120.0)).unwrap();
    let p = BlockingParams::default();
    let consumption = |n: usize| {
        let runs: Vec<_> = (0..n)
            .map(|i| line_run(&m, &format!("t{i}"), i as f64 * 3600.0 / n as f64))
            .collect();
        let ts = timetable_timing(&m, &runs, &p).unwrap();
        let blocks: Vec<_> = ts.iter().flat_map(|t| t.blocking.clone()).collect();
        compress(&blocks, None, -200.0, 3600.0, 10.0).consumption
    };
    let (c4, c8, c12) = (consumption(4), consumption(8), consumption(12));
    assert!(c4 < c8 && c8 < c12);
}

#[test]
fn terminal_station_parallel_and_conflicting_moves() {
    let m = Model::compile(&examples::terminal_station()).unwrap();
    let p = BlockingParams::default();
    let pe1 = m.platform("pe-1").unwrap();
    let pe2 = m.platform("pe-2").unwrap();
    let arrive = |name: &str, route: &str, pe: u32, depart_s: f64| {
        let rs = routes(&m, &["E2>B2", "B2>H2", route]);
        let steps = rail_plan::route_steps(&m, &rs).unwrap();
        let stop = m.stop_position(&steps, pe, 150.0, 5.0).unwrap();
        let len: f64 = rs.iter().map(|&r| m.routes[r as usize].length_m).sum();
        assert!(stop < len);
        TrainRun {
            name: name.into(),
            train: emu(),
            routes: rs,
            start_m: 0.0,
            depart_s,
            stops: vec![],
            stop_at_end: true,
            occupy_until_s: Some(depart_s + 1200.0),
            supplement_share: 0.0,
        }
    };
    let depart = |name: &str, from: &str, depart_s: f64| TrainRun {
        name: name.into(),
        train: emu(),
        routes: routes(&m, &[from, "B1>end"]),
        start_m: 0.0,
        depart_s,
        stops: vec![],
        stop_at_end: false,
        occupy_until_s: None,
        supplement_share: 0.0,
    };
    let check = |runs: Vec<TrainRun>| {
        let ts = timetable_timing(&m, &runs, &p).unwrap();
        let blocks: Vec<_> = ts.iter().flat_map(|t| t.blocking.clone()).collect();
        find_conflicts(&blocks, 0.0)
    };
    // Arrival into p2 while a train leaves p1: parallel moves, no conflict.
    assert!(check(vec![
        arrive("in", "H2>buf2", pe2, 0.0),
        depart("out", "S_P1>B1", 60.0)
    ])
    .is_empty());
    // Arrival into p2 while a train leaves p2: both need m2a.
    assert!(!check(vec![
        arrive("in", "H2>buf2", pe2, 0.0),
        depart("out", "S_P2>B1", 60.0)
    ])
    .is_empty());
    // A second arrival into p1 while the first still stands there (it stays 20 minutes).
    let c = check(vec![
        arrive("in1", "H2>buf1", pe1, 0.0),
        arrive("in2", "H2>buf1", pe1, 600.0),
    ]);
    let p1 = m.pieces[m.track_pieces(m.track("p1").unwrap())[0] as usize].tds;
    assert!(c
        .iter()
        .any(|x| x.tds == p1 && x.first == 0 && x.second == 1));
}

#[test]
fn broken_route_chain_is_rejected() {
    let m = Model::compile(&examples::plain_line(5, 1000.0, 120.0)).unwrap();
    let mut r = line_run(&m, "a", 0.0);
    r.routes.swap(1, 2);
    assert!(run_timing(&m, &r, 0, &BlockingParams::default()).is_err());
}
