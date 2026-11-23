//! Inputs of the capacity run, read from JSON texts: the network (the railway
//! editor's track topology export, `contracts/rail-topology.schema.json`, or
//! the built-in example metro) and the lines file the timetable planner reads
//! (`{"lines": [LineSpec, ...]}` or a plain list), or the service lines drawn
//! in the railway editor (`{"service_lines": [ServiceLine, ...]}`, as
//! `publish_lines` takes them), which become the planner's lines on the
//! compiled network exactly as when the timetable is published.
//!
//! The simulator tab's WebAssembly module (`rail-sim-wasm`) and the
//! simulation worker's Python module (`mobsim-py`) both read their inputs
//! here, so a run in the browser and a run on the server start from the same
//! network and lines.

use engine_msg::{msg, Msg};
use rail_model::topology::{import_json, ImportOptions};
use rail_model::{examples, Model};
use rail_plan::service::layout_unusable;
use rail_plan::{line_spec, Band, LineSpec, ServiceLine};
use serde::{Deserialize, Serialize};

/// The network name of the built-in example metro.
pub const EXAMPLE_NETWORK: &str = "example:metro";

/// A lines file: a list of lines, an object with `lines` (extra fields such as `mode` and
/// `color` are ignored), or the railway editor's service lines.
#[derive(Deserialize)]
#[serde(untagged)]
enum LinesFile {
    List(Vec<LineSpec>),
    File { lines: Vec<LineSpec> },
    Service { service_lines: Vec<ServiceLine> },
}

/// Purpose: read a lines file (JSON text) for the compiled network.
/// Output: the lines (service lines drawn in the railway editor as the timetable planner publishes
/// them, `rail_plan::line_spec`), or an error naming the problem.
pub fn parse_lines(text: &str, model: &Model) -> Result<Vec<LineSpec>, Msg> {
    let f: LinesFile = serde_json::from_str(text)
        .map_err(|e| msg!("rail.sim.lines_unreadable", error = e.to_string()))?;
    let lines = match f {
        LinesFile::List(l) | LinesFile::File { lines: l } => l,
        LinesFile::Service { service_lines } => {
            if let Some(l) = service_lines.iter().find(|l| l.stations.len() < 2) {
                return Err(msg!("rail.plan.two_stops", line = l.name.clone()));
            }
            service_lines.iter().map(|l| line_spec(l, model)).collect()
        }
    };
    if lines.is_empty() {
        return Err(msg!("rail.sim.no_lines"));
    }
    Ok(lines)
}

/// Purpose: compile a network: [`EXAMPLE_NETWORK`] or a topology export (JSON text).
/// Output: the model and the import notes.
pub fn compile_network(network: &str) -> Result<(Model, Vec<Msg>), Msg> {
    if network == EXAMPLE_NETWORK {
        let m = Model::compile(&examples::metro_line()).map_err(layout_unusable)?;
        return Ok((m, Vec::new()));
    }
    let imp = import_json(network, &ImportOptions::default())?;
    let m = Model::compile(&imp.spec).map_err(layout_unusable)?;
    Ok((m, imp.notes))
}

/// An import note as the app shows it: the English text and the message to show it in the app
/// language.
#[derive(Serialize)]
pub struct Note<'a> {
    /// The note in English.
    pub text: String,
    /// The note as a message of the engine message catalog.
    pub msg: &'a Msg,
}

/// Purpose: the import notes with their English text, for the app (JSON).
pub fn note_texts(notes: &[Msg]) -> Vec<Note<'_>> {
    notes
        .iter()
        .map(|m| Note {
            text: m.english(),
            msg: m,
        })
        .collect()
}

/// A line as loaded, with its service bands.
#[derive(Serialize)]
pub struct LineSummary<'a> {
    /// Line ID.
    pub id: &'a str,
    /// Line name.
    pub name: &'a str,
    /// Service bands of the day.
    pub bands: &'a [Band],
}

/// Purpose: the lines with their service bands, for the panel.
pub fn line_summaries(lines: &[LineSpec]) -> Vec<LineSummary<'_>> {
    lines
        .iter()
        .map(|l| LineSummary {
            id: &l.id,
            name: &l.name,
            bands: &l.bands,
        })
        .collect()
}

/// Purpose: the lines file of the example metro (line M1), as JSON.
pub fn example_lines_json() -> String {
    #[derive(Serialize)]
    struct File {
        lines: Vec<LineSpec>,
    }
    serde_json::to_string(&File {
        lines: vec![rail_plan::examples::metro_m1()],
    })
    .expect("the example lines serialise")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_plain_list_of_lines_is_read() {
        let (m, _) = compile_network(EXAMPLE_NETWORK).unwrap();
        let one = serde_json::to_string(&vec![rail_plan::examples::metro_m1()]).unwrap();
        assert_eq!(parse_lines(&one, &m).unwrap().len(), 1);
        assert!(parse_lines("{\"lines\": []}", &m).is_err());
        assert!(parse_lines("nonsense", &m).is_err());
        assert_eq!(parse_lines(&example_lines_json(), &m).unwrap().len(), 1);
    }

    /// A shuttle drawn in the railway editor on the metro test design: the same line the
    /// timetable planner publishes (`crates/rail-plan/tests/service.rs`).
    fn drawn_shuttle(stations: &[&str]) -> String {
        serde_json::json!({ "service_lines": [{
            "id": "M7", "name": "M7", "color": "#1d4ed8",
            "stations": stations,
            "vehicle": { "id": "stadler_bvg-j-4-car", "name": "Stadler Class J", "length_m": 64.2,
                         "top_speed_kmh": 70.0, "power_kw": 1200.0, "empty_mass_t": null, "capacity": 463.0 },
            "units": 1, "mode": "metro",
            "first_s": 21600.0, "last_s": 36000.0,
            "peak_headway_s": 600.0, "offpeak_headway_s": 1200.0,
            "peaks": [[25200.0, 32400.0]]
        }]})
        .to_string()
    }

    #[test]
    fn service_lines_drawn_in_the_railway_editor_are_read() {
        let topo = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../rail-model/tests/data/metro.json"
        ))
        .unwrap();
        let (m, _) = compile_network(&topo).unwrap();
        let lines = parse_lines(&drawn_shuttle(&["st1", "st2"]), &m).unwrap();
        assert_eq!(lines[0].id, "M7");
        // The peak (07:00–09:00) runs at the peak headway; the ramps lie either side of it.
        let peak = lines[0]
            .bands
            .iter()
            .find(|b| b.from_s <= 25200.0 && 25200.0 < b.to_s)
            .unwrap();
        assert_eq!((peak.to_s, peak.headway_s), (32400.0, 600.0));
        let p = crate::capacity::CapacityParams {
            from_s: 25200.0,
            to_s: 32400.0,
            stability_runs: 2,
            ..Default::default()
        };
        let r = crate::capacity::capacity_run(&m, &lines, &p).unwrap();
        assert_eq!(r.lines[0].line, "M7");
        assert_eq!(r.lines[0].planned.unplaced, 0);
        let err = parse_lines(&drawn_shuttle(&["st1"]), &m).unwrap_err();
        assert!(err.english().contains("two stops"), "{err}");
    }

    #[test]
    fn the_example_network_compiles() {
        let (_, notes) = compile_network(EXAMPLE_NETWORK).unwrap();
        assert!(notes.is_empty());
        assert!(compile_network("{}").is_err());
    }
}
