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
            .any(|n| n.contains("g999") && n.contains("inside the switch")),
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
