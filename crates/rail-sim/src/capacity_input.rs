//! Inputs of the capacity run, read from JSON texts: the network (the railway
//! editor's track topology export, `contracts/rail-topology.schema.json`, or
//! the built-in example metro) and the lines file the timetable planner reads
//! (`{"lines": [LineSpec, ...]}` or a plain list).
//!
//! The simulator tab's WebAssembly module (`rail-sim-wasm`) and the
//! simulation worker's Python module (`mobsim-py`) both read their inputs
//! here, so a run in the browser and a run on the server start from the same
//! network and lines.

use rail_model::topology::{import_json, ImportOptions};
use rail_model::{examples, Model};
use rail_plan::{Band, LineSpec};
use serde::{Deserialize, Serialize};

/// The network name of the built-in example metro.
pub const EXAMPLE_NETWORK: &str = "example:metro";

/// A lines file: a list of lines, or an object with `lines` (extra fields such as `mode` and
/// `color` are ignored).
#[derive(Deserialize)]
#[serde(untagged)]
enum LinesFile {
    List(Vec<LineSpec>),
    File { lines: Vec<LineSpec> },
}

/// Purpose: read a lines file (JSON text).
/// Output: the lines, or an error naming the problem.
pub fn parse_lines(text: &str) -> Result<Vec<LineSpec>, String> {
    let f: LinesFile = serde_json::from_str(text).map_err(|e| format!("not a lines file: {e}"))?;
    let lines = match f {
        LinesFile::List(l) | LinesFile::File { lines: l } => l,
    };
    if lines.is_empty() {
        return Err("the lines file has no lines".into());
    }
    Ok(lines)
}

/// Purpose: compile a network: [`EXAMPLE_NETWORK`] or a topology export (JSON text).
/// Output: the model and the import notes.
pub fn compile_network(network: &str) -> Result<(Model, Vec<String>), String> {
    if network == EXAMPLE_NETWORK {
        let m = Model::compile(&examples::metro_line()).map_err(|e| format!("{e:?}"))?;
        return Ok((m, Vec::new()));
    }
    let imp = import_json(network, &ImportOptions::default())?;
    let m = Model::compile(&imp.spec).map_err(|e| format!("{e:?}"))?;
    Ok((m, imp.notes))
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
        let one = serde_json::to_string(&vec![rail_plan::examples::metro_m1()]).unwrap();
        assert_eq!(parse_lines(&one).unwrap().len(), 1);
        assert!(parse_lines("{\"lines\": []}").is_err());
        assert!(parse_lines("nonsense").is_err());
        assert_eq!(parse_lines(&example_lines_json()).unwrap().len(), 1);
    }

    #[test]
    fn the_example_network_compiles() {
        let (_, notes) = compile_network(EXAMPLE_NETWORK).unwrap();
        assert!(notes.is_empty());
        assert!(compile_network("{}").is_err());
    }
}
