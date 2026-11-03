use std::collections::{BTreeSet, VecDeque};

use rail_model::topology::{import_json, ImportOptions};
use rail_model::{Model, RouteExit, RouteId};

fn load(name: &str) -> (Model, Vec<String>) {
    let path = format!("{}/tests/data/{name}.json", env!("CARGO_MANIFEST_DIR"));
    let json = std::fs::read_to_string(path).unwrap();
    let imp = import_json(&json, &ImportOptions::default()).unwrap();
    assert!(imp.signals_generated);
    let m = Model::compile(&imp.spec).unwrap_or_else(|e| panic!("{name}: {e:?}"));
    (m, imp.notes)
}

/// Routes reachable from a route by following exits.
fn reachable(m: &Model, from: RouteId) -> BTreeSet<RouteId> {
    let mut seen = BTreeSet::from([from]);
    let mut q = VecDeque::from([from]);
    while let Some(r) = q.pop_front() {
        for &n in m.next_routes(r) {
            if seen.insert(n) {
                q.push_back(n);
            }
        }
    }
    seen
}

/// Platforms a route sequence starting at `from` can stop at.
fn platforms_reached(m: &Model, from: RouteId) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    for r in reachable(m, from) {
        for st in &m.routes[r as usize].steps {
            let track = m.pieces[st.piece as usize].track;
            for p in &m.platforms {
                if p.track == track {
                    out.insert(p.id.clone());
                }
            }
        }
    }
    out
}

#[test]
fn sample_exports_compile_with_a_provisional_signal_plan() {
    for name in ["metro", "regional_rail", "tram"] {
        let (m, notes) = load(name);
        assert!(!m.routes.is_empty(), "{name}: no routes");
        assert!(notes.iter().any(|n| n.contains("provisional")));
        // The export gives fouling points, so no default distance is assumed.
        assert!(
            !notes.iter().any(|n| n.contains("without fouling points")),
            "{name}: {notes:?}"
        );
        // Conflicts are symmetric and no route conflicts with itself.
        for (a, cs) in m.conflicts.iter().enumerate() {
            assert!(!cs.contains(&(a as u32)));
            for &b in cs {
                assert!(m.conflicts[b as usize].contains(&(a as u32)), "{name}");
            }
        }
        // Same-name platforms form two stations, grouped by name.
        assert_eq!(m.groups.len(), 2, "{name}");
    }
}

#[test]
fn both_terminals_are_connected_by_routes() {
    let (m, _) = load("regional_rail");
    // From every platform starter, the other station's platforms are reachable.
    let station_of = |pid: &str| {
        m.stations[m.platforms[m.platform(pid).unwrap() as usize].station as usize]
            .name
            .clone()
    };
    let mut checked = 0;
    for (i, r) in m.routes.iter().enumerate() {
        let entry_track = match m.signals[r.entry as usize].at {
            rail_model::SignalAt::Entry { piece, .. }
            | rail_model::SignalAt::Exit { piece, .. } => m.pieces[piece as usize].track,
        };
        let Some(p) = m.platforms.iter().find(|p| p.track == entry_track) else {
            continue;
        };
        let here = station_of(&p.id);
        let there: BTreeSet<String> = platforms_reached(&m, i as RouteId)
            .iter()
            .map(|x| station_of(x))
            .collect();
        if there.iter().any(|s| *s != here) {
            checked += 1;
        }
    }
    assert!(
        checked >= 2,
        "trains can leave both stations towards the other"
    );
}

#[test]
fn switch_areas_are_short_detection_sections() {
    let (m, _) = load("regional_rail");
    // The 1.4 km line sections next to switch 4 are not one detection section with it.
    let sw = m
        .tds
        .iter()
        .find(|t| t.id.starts_with("sw4") || t.id.starts_with("sw5"))
        .expect("switch section");
    let len: f64 = sw
        .pieces
        .iter()
        .map(|&p| m.pieces[p as usize].length_m())
        .sum();
    assert!(len < 400.0, "switch area is {len} m");
    // Routes ending at a buffer stop exist (terminal platforms).
    assert!(m
        .routes
        .iter()
        .any(|r| matches!(r.exit, RouteExit::BufferStop(_))));
}

#[test]
fn diamond_crossing_between_alignments_is_shared() {
    let (m, _) = load("regional_rail");
    let x = m
        .tds
        .iter()
        .find(|t| t.id.starts_with("xx3-7"))
        .expect("crossing section");
    let tracks: BTreeSet<&str> = x
        .pieces
        .iter()
        .map(|&p| {
            m.tracks[m.pieces[p as usize].track]
                .id
                .split('/')
                .next()
                .unwrap()
        })
        .collect();
    // Both tracks of line 3 and both of line 7 meet in one section.
    assert!(tracks.len() >= 3, "{tracks:?}");
}

#[test]
fn level_crossing_is_imported() {
    let (m, _) = load("regional_rail");
    assert_eq!(
        m.level_crossings.len(),
        2,
        "one per track of the double-track line"
    );
    let lc = &m.level_crossings[0];
    assert_eq!(lc.spec.protection, "barriers");
    assert!(lc.spec.approach_m > 1000.0);
    assert!(lc.spec.keep_clear_m > 0.0);
}

#[test]
fn rejects_unknown_schema_and_invalid_designs() {
    assert!(import_json(r#"{"schema":"x","valid":true,"nodes":[],"sections":[],"links":[],"switches":[],"platform_edges":[]}"#, &ImportOptions::default()).is_err());
    let e = import_json(
        r#"{"schema":"mobsimlab.rail-topology/1","valid":false,"errors":["radius too small"],"nodes":[],"sections":[],"links":[],"switches":[],"platform_edges":[]}"#,
        &ImportOptions::default(),
    )
    .unwrap_err();
    assert!(e.contains("radius too small"));
}

#[test]
fn crossing_outside_the_usual_rules_is_imported_with_a_warning() {
    let path = format!(
        "{}/tests/data/regional_rail.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let json = std::fs::read_to_string(path).unwrap().replacen(
        "\"standard\": true,\n      \"special_measures\": [],",
        "\"standard\": false,\n      \"special_measures\": [\"line_speed\"],",
        1,
    );
    let imp = import_json(&json, &ImportOptions::default()).unwrap();
    assert!(imp
        .notes
        .iter()
        .any(|n| n.contains("obstacle detection") && n.contains("line_speed")));
    let m = Model::compile(&imp.spec).unwrap();
    assert_eq!(m.level_crossings.len(), 2);
    assert!(m
        .level_crossings
        .iter()
        .all(|lc| lc.spec.special_measures == ["line_speed"]));
    let (std_m, _) = load("regional_rail");
    assert!(std_m
        .level_crossings
        .iter()
        .all(|lc| lc.spec.special_measures.is_empty()));
}

#[test]
fn train_protection_is_read_per_section() {
    let path = format!(
        "{}/tests/data/regional_rail.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let json: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let mut json = json;
    for s in json["sections"].as_array_mut().unwrap() {
        s["train_protection"] = "etcs_l2".into();
    }
    let imp = import_json(&json.to_string(), &ImportOptions::default()).unwrap();
    assert!(imp
        .spec
        .tracks
        .iter()
        .all(|t| t.protection == rail_model::TrainProtection::EtcsL2));
    json["sections"][0]["train_protection"] = "semaphore".into();
    assert!(import_json(&json.to_string(), &ImportOptions::default()).is_err());
}
