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
        end_m: None,
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
            end_m: None,
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
        end_m: None,
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

#[test]
fn run_across_an_imported_design() {
    use rail_model::topology::{import_json, ImportOptions};
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../rail-model/tests/data/regional_rail.json"
    ))
    .unwrap();
    let imp = import_json(&json, &ImportOptions::default()).unwrap();
    let m = Model::compile(&imp.spec).unwrap();
    // Breadth-first search over routes from a starter on a Riverside platform to a buffer stop at Northgate.
    let station_tracks = |name: &str| -> Vec<usize> {
        m.platforms
            .iter()
            .filter(|p| m.stations[p.station as usize].name == name)
            .map(|p| p.track)
            .collect()
    };
    let (from, to) = (station_tracks("Riverside"), station_tracks("Northgate"));
    let starts: Vec<u32> = (0..m.routes.len() as u32)
        .filter(|&r| {
            let first = m.routes[r as usize].steps[0].piece;
            // Starter: the route leaves a platform track.
            let entry = match m.signals[m.routes[r as usize].entry as usize].at {
                rail_model::SignalAt::Exit { piece, .. }
                | rail_model::SignalAt::Entry { piece, .. } => piece,
            };
            from.contains(&m.pieces[entry as usize].track) && first != u32::MAX
        })
        .collect();
    assert!(!starts.is_empty());
    let mut prev = std::collections::BTreeMap::new();
    let mut q: std::collections::VecDeque<u32> = starts.iter().copied().collect();
    let mut goal = None;
    for &s in &starts {
        prev.insert(s, None);
    }
    while let Some(r) = q.pop_front() {
        let last = m.routes[r as usize].steps.last().unwrap().piece;
        if to.contains(&m.pieces[last as usize].track)
            && matches!(
                m.routes[r as usize].exit,
                rail_model::RouteExit::BufferStop(_)
            )
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
    let run = TrainRun {
        name: "RE 1".into(),
        train: emu(),
        routes: path,
        start_m: 0.0,
        depart_s: 6.0 * 3600.0,
        stops: vec![],
        stop_at_end: true,
        end_m: None,
        occupy_until_s: None,
        supplement_share: 0.05,
    };
    let t = run_timing(&m, &run, 0, &BlockingParams::default()).unwrap();
    let minutes = t.profile.total_time_s() / 60.0;
    // About 3.5 km with a 40 km/h crossover and 80 km/h station speed: a few minutes.
    assert!(minutes > 2.0 && minutes < 8.0, "{minutes} min");
    assert!(t.blocking.iter().all(|b| b.end_s > b.start_s));
}

#[test]
fn starter_route_after_a_stop_is_needed_at_departure_not_on_arrival() {
    // Alder's eastbound platform lies between the block signal E0B and the
    // starter SE1, 2 m behind the platform end; a train that stops there
    // needs SE1's route only when it is about to leave.
    let m = Model::compile(&examples::metro_line()).unwrap();
    let mut train = emu();
    train.length_m = 120.0;
    let run = TrainRun {
        name: "a".into(),
        train,
        routes: routes(&m, &["E0B>SE1", "SE1>E1B"]),
        start_m: 0.0,
        depart_s: 0.0,
        stops: vec![rail_dynamics::Stop {
            position_m: 540.0,
            dwell_s: 300.0,
        }],
        stop_at_end: false,
        end_m: None,
        occupy_until_s: None,
        supplement_share: 0.0,
    };
    let t = run_timing(&m, &run, 0, &BlockingParams::default()).unwrap();
    let (arrive, depart) = t.profile.stops[0];
    assert!(depart - arrive >= 299.0);
    let starter = t
        .blocking
        .iter()
        .filter(|b| b.route == run.routes[1] && !b.overlap)
        .map(|b| b.start_s)
        .fold(f64::INFINITY, f64::min);
    assert!(
        starter > arrive + 200.0 && starter < depart,
        "starter route blocked from {starter}, train stands {arrive}..{depart}"
    );
}

#[test]
fn street_traffic_delay_lengthens_the_running_time_there() {
    // Block b2 runs in a main road's traffic: +25 % running time over its 1000 m.
    let plain = Model::compile(&examples::plain_line(5, 1000.0, 50.0)).unwrap();
    let mut spec = examples::plain_line(5, 1000.0, 50.0);
    spec.tracks[2].traffic_delay_ranges = vec![rail_model::Range {
        from_m: 0.0,
        to_m: 1000.0,
        value: 0.25,
    }];
    let street = Model::compile(&spec).unwrap();
    let p = BlockingParams::default();
    let a = run_timing(&plain, &line_run(&plain, "a", 0.0), 0, &p).unwrap();
    let b = run_timing(&street, &line_run(&street, "b", 0.0), 0, &p).unwrap();
    let extra = b.profile.total_time_s() - a.profile.total_time_s();
    // 1000 m at 50 km/h is 72 s; a quarter of it is 18 s.
    assert!((extra - 18.0).abs() < 0.5, "extra {extra}");
    // Before the street the trains are on the same time.
    assert!((b.profile.time_at(1500.0) - a.profile.time_at(1500.0)).abs() < 1e-6);
}
