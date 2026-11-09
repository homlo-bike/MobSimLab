//! WebAssembly bindings of the rail **capacity run** (`rail_sim::capacity`) for the simulator tab.
//!
//! The panel loads a network and its lines once ([`CapacityRunner::new`]): the railway editor's
//! track topology export (`contracts/rail-topology.schema.json`) or the built-in example metro, and
//! the lines file the timetable planner reads (`{"lines": [LineSpec, ...]}`, as for
//! `cargo run -p rail-plan --example publish_journeys`). It then runs the period
//! ([`CapacityRunner::run`]) and the frequency sweep one point at a time
//! ([`CapacityRunner::sweep_point`]), so a web worker can report progress between points. The code is
//! the same the simulation worker runs: timetable planner, UIC 406 compression, interlocking and
//! network kernel.

use rail_model::topology::{import_json, ImportOptions};
use rail_model::{examples, Model};
use rail_plan::LineSpec;
use rail_sim::capacity::{capacity_run, sweep_headways, sweep_point, CapacityParams};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

fn js(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}

fn json<T: Serialize>(v: &T) -> String {
    serde_json::to_string(v).expect("capacity output serialises")
}

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

/// Purpose: compile a network: `"example:metro"` or a topology export (JSON text).
/// Output: the model and the import notes.
pub fn compile_network(network: &str) -> Result<(Model, Vec<String>), String> {
    if network == "example:metro" {
        let m = Model::compile(&examples::metro_line()).map_err(|e| format!("{e:?}"))?;
        return Ok((m, Vec::new()));
    }
    let imp = import_json(network, &ImportOptions::default())?;
    let m = Model::compile(&imp.spec).map_err(|e| format!("{e:?}"))?;
    Ok((m, imp.notes))
}

/// A network and its lines, ready for capacity runs.
#[wasm_bindgen]
pub struct CapacityRunner {
    model: Model,
    lines: Vec<LineSpec>,
    notes: Vec<String>,
}

#[derive(Serialize)]
struct LineSummary<'a> {
    id: &'a str,
    name: &'a str,
    bands: &'a [rail_plan::Band],
}

#[wasm_bindgen]
impl CapacityRunner {
    /// Purpose: compile the network (`"example:metro"` or a topology export, JSON text) and read
    /// the lines (JSON text).
    #[wasm_bindgen(constructor)]
    pub fn new(network: &str, lines_json: &str) -> Result<CapacityRunner, JsError> {
        let (model, notes) = compile_network(network).map_err(js)?;
        let lines = parse_lines(lines_json).map_err(js)?;
        Ok(CapacityRunner {
            model,
            lines,
            notes,
        })
    }

    /// Purpose: the lines with their service bands, as JSON.
    pub fn lines(&self) -> String {
        let v: Vec<LineSummary> = self
            .lines
            .iter()
            .map(|l| LineSummary {
                id: &l.id,
                name: &l.name,
                bands: &l.bands,
            })
            .collect();
        json(&v)
    }

    /// Purpose: notes from importing the topology, as JSON (a list of strings).
    pub fn notes(&self) -> String {
        json(&self.notes)
    }

    /// Purpose: the capacity run of the period (JSON `CapacityParams`; missing fields take their
    /// defaults). Output: JSON `CapacityRun`.
    pub fn run(&self, params_json: &str) -> Result<String, JsError> {
        let p: CapacityParams = serde_json::from_str(params_json).map_err(js)?;
        let r = capacity_run(&self.model, &self.lines, &p).map_err(js)?;
        Ok(json(&r))
    }

    /// Purpose: the headways the frequency sweep tries for line `line`. Output: JSON list of s.
    pub fn sweep_headways(
        &self,
        params_json: &str,
        line: usize,
        works: bool,
    ) -> Result<String, JsError> {
        let p: CapacityParams = serde_json::from_str(params_json).map_err(js)?;
        let l = self.lines.get(line).ok_or_else(|| js("no such line"))?;
        Ok(json(&sweep_headways(l, &p, works)))
    }

    /// Purpose: one point of the frequency sweep. Output: JSON `Point`.
    pub fn sweep_point(
        &self,
        params_json: &str,
        line: usize,
        headway_s: f64,
    ) -> Result<String, JsError> {
        let p: CapacityParams = serde_json::from_str(params_json).map_err(js)?;
        let pt = sweep_point(&self.model, &self.lines, &p, line, headway_s).map_err(js)?;
        Ok(json(&pt))
    }

    /// Purpose: the default settings, as JSON.
    pub fn default_params() -> String {
        json(&CapacityParams::default())
    }

    /// Purpose: the lines file of the example metro (line M1), as JSON.
    pub fn example_lines() -> String {
        #[derive(Serialize)]
        struct File {
            lines: Vec<LineSpec>,
        }
        json(&File {
            lines: vec![rail_plan::examples::metro_m1()],
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_example_runs_from_json() {
        let r = CapacityRunner::new("example:metro", &CapacityRunner::example_lines()).unwrap();
        let out = r.run("{}").unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["verdict"], "near_limit");
        assert_eq!(v["lines"][0]["line"], "M1");
        let hs: Vec<f64> = serde_json::from_str(&r.sweep_headways("{}", 0, true).unwrap()).unwrap();
        assert_eq!(hs[0], 240.0);
    }

    #[test]
    fn a_plain_list_of_lines_is_read() {
        let one = serde_json::to_string(&vec![rail_plan::examples::metro_m1()]).unwrap();
        assert_eq!(parse_lines(&one).unwrap().len(), 1);
        assert!(parse_lines("{\"lines\": []}").is_err());
        assert!(parse_lines("nonsense").is_err());
    }
}
