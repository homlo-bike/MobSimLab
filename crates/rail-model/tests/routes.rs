use rail_model::{examples, normalise_name, Model, RouteExit, SwitchPosition};

fn model() -> Model {
    Model::compile(&examples::terminal_station()).expect("compiles")
}

fn route_ids(m: &Model) -> Vec<String> {
    let mut v: Vec<String> = m.routes.iter().map(|r| r.id.clone()).collect();
    v.sort();
    v
}

#[test]
fn terminal_station_route_table() {
    let m = model();
    assert_eq!(
        route_ids(&m),
        vec![
            "B1>end",
            "B2>H2",
            "E2>B2",
            "H2>buf1",
            "H2>buf2",
            "S_P1>B1",
            "S_P1>B1#1",
            "S_P2>B1",
        ]
    );
    let sw = |id: &str| m.switches.iter().position(|s| s.id == id).unwrap() as u32;
    // Westbound into platform 2: straight through sd and sb.
    let r = &m.routes[m.route("H2>buf2").unwrap() as usize];
    assert_eq!(
        r.switches,
        vec![
            (sw("sb"), SwitchPosition::Straight),
            (sw("sd"), SwitchPosition::Straight)
        ]
    );
    assert!(matches!(r.exit, RouteExit::BufferStop(_)));
    assert!((r.length_m - 350.0).abs() < 1e-9);
    // Westbound into platform 1 uses the crossover at 40 km/h.
    let r = &m.routes[m.route("H2>buf1").unwrap() as usize];
    assert_eq!(r.length_m, 100.0 + 60.0 + 250.0);
    let prof = m.profile(&r.steps);
    assert!(prof.iter().any(|s| (s.speed_mps - 40.0 / 3.6).abs() < 1e-9));
    // Departure from platform 2 crosses to the eastbound main through xo2.
    let r = &m.routes[m.route("S_P2>B1").unwrap() as usize];
    assert!(r.switches.contains(&(sw("sd"), SwitchPosition::Diverging)));
    assert!(r.switches.contains(&(sw("sc"), SwitchPosition::Diverging)));
    // The block route has a 200 m overlap into the next block.
    let r = &m.routes[m.route("B2>H2").unwrap() as usize];
    assert!(
        r.overlap_m > 0.0,
        "home signal overlap runs into the throat"
    );
}

#[test]
fn conflicts_follow_shared_sections_and_switches() {
    let m = model();
    let id = |s: &str| m.route(s).unwrap();
    // Parallel moves: depart from p1 straight while arriving into p2.
    assert!(!m.routes_conflict(id("S_P1>B1"), id("H2>buf2")));
    // Arrival into p1 and departure from p1 share p1.
    assert!(m.routes_conflict(id("S_P1>B1"), id("H2>buf1")));
    // Arrival into p2 and departure from p2 share m2a.
    assert!(m.routes_conflict(id("S_P2>B1"), id("H2>buf2")));
    // Arrival into p1 needs sb diverging, arrival into p2 sb straight.
    assert!(m.routes_conflict(id("H2>buf1"), id("H2>buf2")));
    // Conflicts are symmetric.
    for (a, cs) in m.conflicts.iter().enumerate() {
        for &b in cs {
            assert!(m.conflicts[b as usize].contains(&(a as u32)));
        }
    }
}

#[test]
fn routes_chain_signal_to_signal() {
    let m = model();
    let e2 = m.route("E2>B2").unwrap();
    let next: Vec<&str> = m
        .next_routes(e2)
        .iter()
        .map(|&r| m.routes[r as usize].id.as_str())
        .collect();
    assert_eq!(next, vec!["B2>H2"]);
}

#[test]
fn same_name_stations_form_one_group() {
    let m = model();
    assert_eq!(m.groups.len(), 1);
    assert_eq!(m.groups[0].stations.len(), 2);
    assert_eq!(m.groups[0].name, "Westbahnhof");
    assert_eq!(normalise_name("Zürich  HB"), normalise_name("zurich-hb"));
    assert_ne!(normalise_name("Bern"), normalise_name("Basel"));
}

#[test]
fn explicit_group_key_splits_same_names() {
    let mut spec = examples::terminal_station();
    spec.stations[1].group = Some("west-freight".into());
    let m = Model::compile(&spec).unwrap();
    assert_eq!(m.groups.len(), 2);
}

#[test]
fn stop_position_at_platform_end() {
    let m = model();
    let r = &m.routes[m.route("H2>buf2").unwrap() as usize];
    let pe = m.platform("pe-2").unwrap();
    // Westbound, the platform's far end is chainage 0 of p2: 350 m from the home signal.
    let pos = m.stop_position(&r.steps, pe, 200.0, 5.0).unwrap();
    assert!((pos - 345.0).abs() < 1e-9);
    assert!(m.stop_position(&r.steps, pe, 260.0, 5.0).is_err());
}

#[test]
fn plain_line_has_one_route_per_block() {
    let m = Model::compile(&examples::plain_line(5, 1000.0, 100.0)).unwrap();
    assert_eq!(m.routes.len(), 5);
    let r = &m.routes[m.route("S0>S1").unwrap() as usize];
    assert_eq!(r.overlap_m, 50.0);
    assert_eq!(r.overlap_tds.len(), 1);
    assert!(m.routes_conflict(m.route("S0>S1").unwrap(), m.route("S1>S2").unwrap()));
    assert!(!m.routes_conflict(m.route("S0>S1").unwrap(), m.route("S2>S3").unwrap()));
}

#[test]
fn validation_reports_unknown_ids() {
    let mut spec = examples::terminal_station();
    spec.signals[0].track = "nope".into();
    spec.platforms[0].station = "nowhere".into();
    let errs = Model::compile(&spec).unwrap_err();
    assert!(errs.iter().any(|e| e.contains("unknown track nope")));
    assert!(errs.iter().any(|e| e.contains("unknown station nowhere")));
}

#[test]
fn diamond_crossing_is_one_section_shared_by_two_systems() {
    // Two plain lines cross on one level; the crossing pieces form one section.
    let mut a = examples::plain_line(3, 500.0, 80.0);
    let b = examples::plain_line(3, 500.0, 50.0);
    for mut t in b.tracks {
        t.id = format!("t{}", t.id);
        t.mode = Some("tram".into());
        a.tracks.push(t);
    }
    for mut s in b.signals {
        s.id = format!("t{}", s.id);
        s.track = format!("t{}", s.track);
        a.signals.push(s);
    }
    for n in b.nodes {
        if let rail_model::NodeSpec::Link { a: mut x, b: mut y } = n {
            x.track = format!("t{}", x.track);
            y.track = format!("t{}", y.track);
            a.nodes.push(rail_model::NodeSpec::Link { a: x, b: y });
        }
    }
    a.detection.push(rail_model::DetectionSpec {
        id: "x-b1-tb1".into(),
        tracks: vec!["b1".into(), "tb1".into()],
    });
    let m = Model::compile(&a).unwrap();
    assert!(m.routes_conflict(m.route("S1>S2").unwrap(), m.route("tS1>tS2").unwrap()));
    assert!(!m.routes_conflict(m.route("S0>S1").unwrap(), m.route("tS0>tS1").unwrap()));
}
