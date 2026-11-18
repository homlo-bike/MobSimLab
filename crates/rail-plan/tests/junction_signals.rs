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
