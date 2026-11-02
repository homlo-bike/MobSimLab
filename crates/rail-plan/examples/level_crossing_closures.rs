//! Plans the lines on a railway design and writes when each level crossing closes the street
//! (`contracts/level-crossing-closures.schema.json`), for the street line tool:
//! `cargo run --release -p rail-plan --example level_crossing_closures -- TOPOLOGY.json LINES.json > closures.json`.
//!
//! TOPOLOGY.json is the railway tool's **Download track topology**; LINES.json is a list of
//! [`rail_plan::LineSpec`] in serde JSON form (calls, train, dwell, turn-back, stabling tracks and
//! service bands).

use rail_model::topology::{import_json, ImportOptions};
use rail_model::Model;
use rail_plan::{level_crossing_closures, plan, LineSpec, PlanParams};

/// Barrier rising time where the topology gives none, s (`level_crossing.reopen_s`).
const DEFAULT_REOPEN_S: f64 = 10.0;

fn main() {
    let mut args = std::env::args().skip(1);
    let usage = "usage: level_crossing_closures TOPOLOGY.json LINES.json";
    let topo = std::fs::read_to_string(args.next().expect(usage)).expect("read topology");
    let lines: Vec<LineSpec> = serde_json::from_str(
        &std::fs::read_to_string(args.next().expect(usage)).expect("read lines"),
    )
    .expect("lines JSON");
    let imp = import_json(&topo, &ImportOptions::default()).unwrap_or_else(|e| panic!("{e}"));
    let m = Model::compile(&imp.spec).unwrap_or_else(|e| panic!("{e:?}"));
    let p = PlanParams::default();
    let day = plan(&m, &lines, &p).unwrap_or_else(|e| panic!("{e}"));
    for i in &day.issues {
        eprintln!("issue: {i:?}");
    }
    let out = level_crossing_closures(&m, &day, &p.blocking, DEFAULT_REOPEN_S).unwrap();
    println!("{}", serde_json::to_string_pretty(&out).unwrap());
}
