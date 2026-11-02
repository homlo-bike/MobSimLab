//! Imports a railway topology export and prints the operations model:
//! `cargo run -p rail-model --example import_topology -- FILE.json`.

use rail_model::topology::{import_json, ImportOptions};
use rail_model::Model;

fn main() {
    let path = std::env::args()
        .nth(1)
        .expect("usage: import_topology FILE.json");
    let json = std::fs::read_to_string(&path).expect("read");
    let imp = import_json(&json, &ImportOptions::default()).unwrap_or_else(|e| panic!("{e}"));
    for n in &imp.notes {
        println!("note: {n}");
    }
    let m = Model::compile(&imp.spec).unwrap_or_else(|e| panic!("{e:?}"));
    println!(
        "{} tracks, {} detection sections, {} signals, {} routes, {} level crossings",
        m.tracks.len(),
        m.tds.len(),
        m.signals.len(),
        m.routes.len(),
        m.level_crossings.len()
    );
    for t in &m.tds {
        let len: f64 = t
            .pieces
            .iter()
            .map(|&p| m.pieces[p as usize].length_m())
            .sum();
        println!("TDS {:<16} {:>7.1} m  {} pieces", t.id, len, t.pieces.len());
    }
    for (i, r) in m.routes.iter().enumerate() {
        println!(
            "route {:<14} {:>7.1} m  overlap {:>5.1} m  {} switches  {} conflicts",
            r.id,
            r.length_m,
            r.overlap_m,
            r.switches.len(),
            m.conflicts[i].len()
        );
    }
}
