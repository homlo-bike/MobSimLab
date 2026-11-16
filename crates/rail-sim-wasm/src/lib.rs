//! WebAssembly bindings of the rail **capacity run** (`rail_sim::capacity`) for the simulator tab.
//!
//! The panel loads a network and its lines once ([`CapacityRunner::new`]): the railway editor's
//! track topology export (`contracts/rail-topology.schema.json`) or the built-in example metro, and
//! the lines file the timetable planner reads (`{"lines": [LineSpec, ...]}`, as for
//! `cargo run -p rail-plan --example publish_journeys`), or the service lines drawn in the railway
//! editor (`{"service_lines": [rail_plan::ServiceLine, ...]}`, as `publish_lines` takes them), which
//! become the planner's lines on the compiled network as when the timetable is published. It then runs the period
//! ([`CapacityRunner::run`]) and the frequency sweep one point at a time
//! ([`CapacityRunner::sweep_point`]), so a web worker can report progress between points. The code is
//! the same the simulation worker runs: timetable planner, UIC 406 compression, interlocking and
//! network kernel.

use rail_model::topology::{import_json, ImportOptions};
use rail_model::{examples, Model};
use rail_plan::{line_spec, LineSpec, ServiceLine};
use rail_sim::capacity::{capacity_run, sweep_headways, sweep_point, CapacityParams};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

fn js(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}

fn json<T: Serialize>(v: &T) -> String {
    serde_json::to_string(v).expect("capacity output serialises")
}

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
pub fn parse_lines(text: &str, model: &Model) -> Result<Vec<LineSpec>, String> {
    let f: LinesFile = serde_json::from_str(text).map_err(|e| format!("not a lines file: {e}"))?;
    let lines = match f {
        LinesFile::List(l) | LinesFile::File { lines: l } => l,
        LinesFile::Service { service_lines } => {
            if let Some(l) = service_lines.iter().find(|l| l.stations.len() < 2) {
                return Err(format!("{} needs at least two stops.", l.name));
            }
            service_lines.iter().map(|l| line_spec(l, model)).collect()
        }
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
    /// the lines (JSON text: a lines file or the railway editor's service lines).
    #[wasm_bindgen(constructor)]
    pub fn new(network: &str, lines_json: &str) -> Result<CapacityRunner, JsError> {
        let (model, notes) = compile_network(network).map_err(js)?;
        let lines = parse_lines(lines_json, &model).map_err(js)?;
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
        let (m, _) = compile_network("example:metro").unwrap();
        let one = serde_json::to_string(&vec![rail_plan::examples::metro_m1()]).unwrap();
        assert_eq!(parse_lines(&one, &m).unwrap().len(), 1);
        assert!(parse_lines("{\"lines\": []}", &m).is_err());
        assert!(parse_lines("nonsense", &m).is_err());
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
    fn service_lines_drawn_in_the_railway_editor_run() {
        let topo = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../rail-model/tests/data/metro.json"
        ))
        .unwrap();
        let r = CapacityRunner::new(&topo, &drawn_shuttle(&["st1", "st2"])).unwrap();
        let ls: serde_json::Value = serde_json::from_str(&r.lines()).unwrap();
        assert_eq!(ls[0]["id"], "M7");
        assert_eq!(ls[0]["bands"][1]["headway_s"], 600.0);
        let out = r
            .run(r#"{"from_s": 25200, "to_s": 32400, "stability_runs": 2}"#)
            .unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["lines"][0]["line"], "M7");
        assert_eq!(v["lines"][0]["planned"]["unplaced"], 0);
        let (m, _) = compile_network(&topo).unwrap();
        let err = parse_lines(&drawn_shuttle(&["st1"]), &m).unwrap_err();
        assert!(err.contains("two stops"), "{err}");
    }
}
