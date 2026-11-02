//! Plans rail lines on a railway design and writes the timetable the journey planner reads
//! (`contracts/published-timetable.schema.json`):
//! `cargo run --release -p rail-plan --example publish_journeys -- rail-topology.json lines.json > rail-timetable.json`.
//!
//! - `rail-topology.json` is the railway editor's **Download track topology (JSON)**.
//! - `lines.json` lists the lines: `{"service_id": "weekday", "lines": [ { <LineSpec>, "mode": "metro",
//!   "color": "1d4ed8" } ]}` (`mode` and `color` are optional; the mode defaults to the platforms').
//!
//! Load the output in the journey planner panel with **Add rail timetable (JSON)**. Planning issues and
//! placement notes go to standard error.

use rail_model::topology::{import_json, ImportOptions};
use rail_model::Model;
use rail_plan::{journey_timetable, plan, LineSpec, PlanParams, RouteInfo};
use serde::Deserialize;

#[derive(Deserialize)]
struct LineEntry {
    #[serde(flatten)]
    line: LineSpec,
    #[serde(default)]
    mode: Option<String>,
    #[serde(default)]
    color: Option<String>,
}

#[derive(Deserialize)]
struct LinesFile {
    #[serde(default = "weekday")]
    service_id: String,
    lines: Vec<LineEntry>,
}

fn weekday() -> String {
    "weekday".into()
}

fn main() {
    let mut args = std::env::args().skip(1);
    let (Some(topo), Some(lines)) = (args.next(), args.next()) else {
        eprintln!("usage: publish_journeys rail-topology.json lines.json > rail-timetable.json");
        std::process::exit(2);
    };
    let read = |p: &str| std::fs::read_to_string(p).unwrap_or_else(|e| panic!("{p}: {e}"));
    let imp =
        import_json(&read(&topo), &ImportOptions::default()).unwrap_or_else(|e| panic!("{e}"));
    for n in &imp.notes {
        eprintln!("import: {n}");
    }
    let m = Model::compile(&imp.spec).unwrap_or_else(|e| panic!("{e:?}"));
    let file: LinesFile =
        serde_json::from_str(&read(&lines)).unwrap_or_else(|e| panic!("{lines}: {e}"));
    let routes: Vec<RouteInfo> = file
        .lines
        .iter()
        .map(|l| RouteInfo {
            id: l.line.id.clone(),
            name: l.line.name.clone(),
            mode: l.mode.clone(),
            color: l
                .color
                .as_ref()
                .map(|c| c.trim_start_matches('#').to_string()),
        })
        .collect();
    let specs: Vec<LineSpec> = file.lines.into_iter().map(|l| l.line).collect();
    let p = plan(&m, &specs, &PlanParams::default()).unwrap_or_else(|e| panic!("{e:?}"));
    for i in &p.issues {
        eprintln!("plan: {i:?}");
    }
    let origin = imp.origin.unwrap_or_else(|| {
        eprintln!("the export has no origin; positions are relative to 0° E, 0° N");
        [0.0, 0.0]
    });
    let jt = journey_timetable(
        &m,
        &p,
        &routes,
        &imp.platform_places,
        origin,
        &file.service_id,
    );
    for n in &jt.notes {
        eprintln!("publish: {n}");
    }
    eprintln!(
        "{} stops, {} routes, {} trips",
        jt.timetable.stops.len(),
        jt.timetable.routes.len(),
        jt.timetable.trips.len()
    );
    println!("{}", serde_json::to_string_pretty(&jt.timetable).unwrap());
}
