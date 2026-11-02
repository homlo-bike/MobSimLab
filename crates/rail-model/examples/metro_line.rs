//! Prints the route table of the example metro line: `cargo run -p rail-model --example metro_line`.

use rail_model::{examples, Model};

fn main() {
    let m = Model::compile(&examples::metro_line()).unwrap_or_else(|e| panic!("{e:?}"));
    println!(
        "{} detection sections, {} signals, {} routes",
        m.tds.len(),
        m.signals.len(),
        m.routes.len()
    );
    for (i, r) in m.routes.iter().enumerate() {
        println!(
            "route {:<18} {:>7.1} m  overlap {:>5.1} m  {} switches  {} conflicts",
            r.id,
            r.length_m,
            r.overlap_m,
            r.switches.len(),
            m.conflicts[i].len()
        );
    }
}
