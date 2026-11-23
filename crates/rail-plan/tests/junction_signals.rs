//! A depot joined to a double-track tram line by a double junction (Damascus acceptance test,
//! bugs 8 and 9): no generated signal may stand inside the junction's legs, which would make the
//! whole layout unusable for service lines, and the depot's trains must have a signal to leave by.

use rail_design::design::build;
use rail_design::model::SwitchKind;
use rail_design::sample::sample;
use rail_design::topology::topology;
use rail_design::RailMode;
use rail_model::topology::{import_json, ImportOptions};
use rail_model::{Dir, Model, TrackUse};
use rail_plan::path::departure_routes;
use rail_plan::Place;

fn depot_by_double_junction() -> rail_design::Network {
    let mut net = sample(RailMode::Tram, 7.0, 50.9);
    for sw in net.switches.iter_mut().filter(|s| s.id == 5) {
        sw.kind = SwitchKind::DoubleJunction;
    }
    for t in net.tracks.iter_mut().filter(|t| t.id == 6) {
        t.tracks = 2;
    }
    net
}

#[test]
fn no_generated_signal_inside_a_double_junction_and_the_depot_can_be_left() {
    let net = depot_by_double_junction();
    let t = topology(&build(&net, None));
    assert!(t.valid, "{:?}", t.errors);
    assert!(
        t.switches.iter().any(|s| s.id == 5),
        "the junction is drawn"
    );
    for s in t.signals.iter().filter(|s| s.section.starts_with("w5.")) {
        let len = t
            .sections
            .iter()
            .find(|x| x.id == s.section)
            .unwrap()
            .length_m;
        assert!(
            s.chainage_m < 0.5 || s.chainage_m > len - 0.5,
            "signal inside the junction's leg: {s:?}"
        );
    }
    let json = serde_json::to_string(&t).unwrap();
    let imp = import_json(&json, &ImportOptions::default()).unwrap();
    let m = Model::compile(&imp.spec).expect("the layout can be used for service lines");
    let storage: Vec<usize> = (0..m.tracks.len())
        .filter(|&i| m.tracks[i].usage == TrackUse::Storage)
        .collect();
    assert_eq!(storage.len(), 2, "both storage tracks of the depot");
    for i in storage {
        let out = [Dir::Up, Dir::Down]
            .into_iter()
            .any(|d| !departure_routes(&m, Place::Storage(i), d).is_empty());
        assert!(
            out,
            "storage track {} has no signal to leave by",
            m.tracks[i].id
        );
    }
}

#[test]
fn a_signal_inside_a_junction_leg_is_left_out_instead_of_refusing_the_layout() {
    // An export with a route signal part-way along a junction leg (as the generator used to
    // place them): the import leaves it out with a note instead of refusing the whole layout.
    let t = topology(&build(&depot_by_double_junction(), None));
    let mut v: serde_json::Value = serde_json::to_value(&t).unwrap();
    let leg = t.sections.iter().find(|s| s.id == "w5.0").unwrap();
    let mut extra = v["signals"][0].clone();
    extra["id"] = "g999".into();
    extra["section"] = "w5.0".into();
    extra["chainage_m"] = (leg.length_m / 2.0).into();
    extra["kind"] = "main".into();
    v["signals"].as_array_mut().unwrap().push(extra);
    let imp = import_json(&v.to_string(), &ImportOptions::default()).unwrap();
    assert!(Model::compile(&imp.spec).is_ok());
    assert!(
        imp.notes
            .iter()
            .any(|n| n.english().contains("g999") && n.english().contains("inside the switch")),
        "{:?}",
        imp.notes
    );
}

#[test]
fn trams_running_straight_on_the_two_tracks_of_a_junction_pass_each_other() {
    // Damascus test, bug 9: a crossover or double junction was one detection section over both
    // tracks, so a tram running straight on one track blocked every tram on the other one.
    let t = topology(&build(&depot_by_double_junction(), None));
    let imp = import_json(
        &serde_json::to_string(&t).unwrap(),
        &ImportOptions::default(),
    )
    .unwrap();
    let m = Model::compile(&imp.spec).unwrap();
    let tracks = |tds: &rail_model::Tds| -> Vec<String> {
        tds.pieces
            .iter()
            .map(|&p| m.tracks[m.pieces[p as usize].track].id.clone())
            .collect()
    };
    for tds in m.tds.iter().filter(|x| x.id.starts_with("sw")) {
        let tr = tracks(tds);
        assert!(
            !(tr.iter().any(|x| x.starts_with("t3.0."))
                && tr.iter().any(|x| x.starts_with("t3.1."))),
            "{} covers both tracks of the line: {tr:?}",
            tds.id
        );
    }
    // The junction's leg from the far track crosses the near track at grade: they share a section,
    // which the near track's own leg (a parallel move) is not part of.
    let crossing = m
        .tds
        .iter()
        .find(|x| {
            let tr = tracks(x);
            tr.iter().any(|s| s.starts_with("w5.1")) && tr.iter().any(|s| s.starts_with("t3.0."))
        })
        .expect("the far leg crosses the near track");
    assert!(
        !tracks(crossing).iter().any(|s| s.starts_with("w5.0")),
        "{:?}",
        tracks(crossing)
    );
}

#[test]
fn a_siding_joined_straight_to_a_terminal_end_gets_a_signal_to_leave_by() {
    // Damascus test, bug 15: a double layover siding beyond a tram terminal's free end, joined to
    // the platform tracks with no switch, got no exit signal, so its trains could not come out.
    let mut net = sample(RailMode::Tram, 7.0, 50.9);
    let st = net.stations.iter().find(|s| s.id == 1).unwrap().clone();
    let siding: rail_design::model::Track = serde_json::from_value(serde_json::json!({
        "id": 99,
        "use": "storage",
        "level": "street",
        "tracks": 2,
        "start": { "type": "station", "station": 1, "end": 0, "tracks": [0, 1] },
        "end": { "type": "free", "x": st.x - 250.0, "y": st.y, "level": "street" },
        "points": [],
        "storage_role": "layover"
    }))
    .unwrap();
    net.tracks.push(siding);
    let t = topology(&build(&net, None));
    assert!(t.valid, "{:?}", t.errors);
    let json = serde_json::to_string(&t).unwrap();
    let imp = import_json(&json, &ImportOptions::default()).unwrap();
    let m = Model::compile(&imp.spec).unwrap();
    let siding: Vec<usize> = (0..m.tracks.len())
        .filter(|&i| m.tracks[i].usage == TrackUse::Storage && m.tracks[i].id.starts_with("t99."))
        .collect();
    assert_eq!(siding.len(), 2, "both tracks of the siding");
    for i in siding {
        let out = [Dir::Up, Dir::Down]
            .into_iter()
            .any(|d| !departure_routes(&m, Place::Storage(i), d).is_empty());
        assert!(out, "{} has no signal to leave by", m.tracks[i].id);
    }
}

#[test]
fn trains_from_a_siding_beyond_a_terminal_run_straight_on_into_service() {
    // Damascus test, bug 20: a train coming out of a layover siding beyond a tram terminal's far
    // end reaches the platform facing the line already. The planner made it turn back towards the
    // siding, found no way on, and dropped the trip with an empty reason ("pull-out: .").
    let mut net = sample(RailMode::Tram, 7.0, 50.9);
    let st = net.stations.iter().find(|s| s.id == 1).unwrap().clone();
    let siding: rail_design::model::Track = serde_json::from_value(serde_json::json!({
        "id": 99,
        "use": "storage",
        "level": "street",
        "tracks": 2,
        "start": { "type": "station", "station": 1, "end": 0, "tracks": [0, 1] },
        "end": { "type": "free", "x": st.x - 250.0, "y": st.y, "level": "street" },
        "points": [],
    }))
    .unwrap();
    net.tracks.push(siding);
    let t = topology(&build(&net, None));
    assert!(t.valid, "{:?}", t.errors);
    let line = rail_plan::ServiceLine {
        id: "T1".into(),
        name: "T1".into(),
        color: None,
        stations: vec!["st1".into(), "st2".into()],
        vehicle: rail_plan::ServiceVehicle {
            id: "tram".into(),
            name: "Tram".into(),
            length_m: 30.0,
            top_speed_kmh: 70.0,
            power_kw: Some(420.0),
            empty_mass_t: None,
            capacity: 200.0,
        },
        units: 1,
        mode: "tram".into(),
        first_s: 6.0 * 3600.0,
        last_s: 8.0 * 3600.0,
        peak_headway_s: 600.0,
        offpeak_headway_s: 600.0,
        peaks: vec![],
        dwell_s: None,
        stop_dwells_s: None,
        turnback_s: None,
        accel_ms2: None,
        decel_ms2: None,
        supplement_share: None,
    };
    let out = rail_plan::publish_service(&serde_json::to_string(&t).unwrap(), &[line], "weekday")
        .unwrap();
    let r = &out.lines[0];
    assert!(
        !r.issues
            .iter()
            .any(|i| i.contains("pull-out: .") || i.contains("no way on")),
        "{:?}",
        r.issues
    );
    assert!(r.trips > 0, "{:?}", r.issues);
}

#[test]
fn a_train_ending_at_a_terminal_puts_away_straight_on_into_the_siding_beyond_it() {
    // Damascus test, bug 25: a train that ended its trip at a terminal with a siding beyond the
    // platforms always turned back to put away, so it ran empty to a storage track elsewhere
    // (along the whole line, against the service) instead of straight on into that siding.
    let mut net = sample(RailMode::Tram, 7.0, 50.9);
    let st = net.stations.iter().find(|s| s.id == 1).unwrap().clone();
    let siding: rail_design::model::Track = serde_json::from_value(serde_json::json!({
        "id": 99,
        "use": "storage",
        "level": "street",
        "tracks": 2,
        "start": { "type": "station", "station": 1, "end": 0, "tracks": [0, 1] },
        "end": { "type": "free", "x": st.x - 250.0, "y": st.y, "level": "street" },
        "points": [],
    }))
    .unwrap();
    net.tracks.push(siding);
    let t = topology(&build(&net, None));
    let imp = import_json(
        &serde_json::to_string(&t).unwrap(),
        &ImportOptions::default(),
    )
    .unwrap();
    let m = Model::compile(&imp.spec).unwrap();
    let line = rail_plan::ServiceLine {
        id: "T1".into(),
        name: "T1".into(),
        color: None,
        stations: vec!["st2".into(), "st1".into()],
        vehicle: rail_plan::ServiceVehicle {
            id: "tram".into(),
            name: "Tram".into(),
            length_m: 30.0,
            top_speed_kmh: 70.0,
            power_kw: Some(420.0),
            empty_mass_t: None,
            capacity: 200.0,
        },
        units: 1,
        mode: "tram".into(),
        first_s: 6.0 * 3600.0,
        last_s: 12.0 * 3600.0,
        peak_headway_s: 3600.0,
        offpeak_headway_s: 3600.0,
        peaks: vec![],
        dwell_s: None,
        stop_dwells_s: None,
        turnback_s: None,
        accel_ms2: None,
        decel_ms2: None,
        supplement_share: None,
    };
    let spec = rail_plan::line_spec_with_roles(&line, &m, &imp.storage_roles);
    let p = rail_plan::plan(&m, &[spec], &rail_plan::PlanParams::default()).unwrap();
    let st1: Vec<_> = m
        .stations
        .iter()
        .find(|s| s.id == "st1")
        .unwrap()
        .platforms
        .iter()
        .map(|&p| Place::Platform(p))
        .collect();
    let pull_ins: Vec<_> = p
        .runs
        .iter()
        .filter(|r| r.kind == rail_plan::RunKind::PullIn)
        .filter(|r| st1.contains(&r.calls[0].place))
        .collect();
    // The first train put away at st1 finds the siding beyond it free.
    let r = pull_ins.first().expect("a train is put away at st1");
    let to = &r.calls.last().unwrap().id;
    assert!(
        to.starts_with("t99."),
        "{} puts away on {to}, not the siding beyond st1",
        r.name
    );
}

/// The sample tram line (Riverside st1 to Northgate st2), its model and a T1 line between the
/// two stations every `headway_s` from 6:00 to 12:00.
fn sample_line(net: &rail_design::Network, headway_s: f64) -> (Model, rail_plan::LineSpec) {
    let t = topology(&build(net, None));
    assert!(t.valid, "{:?}", t.errors);
    let imp = import_json(
        &serde_json::to_string(&t).unwrap(),
        &ImportOptions::default(),
    )
    .unwrap();
    let m = Model::compile(&imp.spec).unwrap();
    let line = rail_plan::ServiceLine {
        id: "T1".into(),
        name: "T1".into(),
        color: None,
        stations: vec!["st1".into(), "st2".into()],
        vehicle: rail_plan::ServiceVehicle {
            id: "tram".into(),
            name: "Tram".into(),
            length_m: 30.0,
            top_speed_kmh: 70.0,
            power_kw: Some(420.0),
            empty_mass_t: None,
            capacity: 200.0,
        },
        units: 1,
        mode: "tram".into(),
        first_s: 6.0 * 3600.0,
        last_s: 12.0 * 3600.0,
        peak_headway_s: headway_s,
        offpeak_headway_s: headway_s,
        peaks: vec![],
        dwell_s: None,
        stop_dwells_s: None,
        turnback_s: None,
        accel_ms2: None,
        decel_ms2: None,
        supplement_share: None,
    };
    let spec = rail_plan::line_spec_with_roles(&line, &m, &imp.storage_roles);
    (m, spec)
}

#[test]
fn tram_signals_keep_no_overlap() {
    // Damascus test, bug 25: trams run on sight. A signal a little way in front of a terminal kept
    // the 200 m overlap of a main line, which reached into the platform, so a tram could not come
    // up to the signal while the tram ahead still stood in the platform.
    let (m, _) = sample_line(&sample(RailMode::Tram, 7.0, 50.9), 1800.0);
    assert!(!m.signals.is_empty());
    for s in &m.signals {
        assert_eq!(s.overlap_m, 0.0, "signal {} keeps an overlap", s.id);
    }
}

#[test]
fn a_tram_leaving_a_terminal_takes_the_crossover_in_front_of_it() {
    // Damascus test, bug 25: with a second crossover added in front of a terminal, trams leaving
    // it still ran back along the arrival track to the old crossover further out, against the
    // trams coming in, because both ways are as long.
    let mut net = sample(RailMode::Tram, 7.0, 50.9);
    let len = build(&net, None).track(3).unwrap().length;
    let near = net.switches.iter().find(|s| s.id == 4).unwrap().clone();
    net.switches.push(rail_design::model::Switch {
        id: 7,
        s: len - near.s - 60.0,
        ..near
    });
    let (m, spec) = sample_line(&net, 1800.0);
    let p = rail_plan::plan(&m, &[spec], &rail_plan::PlanParams::default()).unwrap();
    let st2: Vec<_> = m
        .stations
        .iter()
        .find(|s| s.id == "st2")
        .unwrap()
        .platforms
        .iter()
        .map(|&p| Place::Platform(p))
        .collect();
    let crossover_of = |r: &rail_plan::PlannedRun| -> Vec<String> {
        rail_plan::route_steps(&m, &r.run.routes)
            .unwrap()
            .iter()
            .map(|st| m.tracks[m.pieces[st.piece as usize].track].id.clone())
            .filter(|id| id.starts_with("w4.") || id.starts_with("w7."))
            .collect()
    };
    let from_st2: Vec<_> = p
        .runs
        .iter()
        .filter(|r| r.kind == rail_plan::RunKind::Service && st2.contains(&r.calls[0].place))
        .collect();
    assert!(!from_st2.is_empty(), "trips leave st2");
    for r in from_st2 {
        let x = crossover_of(r);
        assert!(
            x.iter().all(|id| id.starts_with("w7.")),
            "{} leaves st2 by {x:?}",
            r.name
        );
    }
}
