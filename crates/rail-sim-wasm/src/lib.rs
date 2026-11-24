//! WebAssembly bindings of the rail **capacity run** (`rail_sim::capacity`) for the simulator tab.
//!
//! The panel loads a network and its lines once ([`CapacityRunner::new`]): the railway editor's
//! track topology export (`contracts/rail-topology.schema.json`) or the built-in example metro, and
//! the lines file the timetable planner reads (`{"lines": [LineSpec, ...]}`, as for
//! `cargo run -p rail-plan --example publish_journeys`), or the service lines drawn in the railway
//! editor (`{"service_lines": [...]}`, `rail_sim::capacity_input`). It then runs the period
//! ([`CapacityRunner::run`]) and the frequency sweep one point at a time
//! ([`CapacityRunner::sweep_point`]), so a web worker can report progress between points. The code is
//! the same the simulation worker runs: timetable planner, UIC 406 compression, interlocking and
//! network kernel.

use engine_msg::{js_error, Msg};
use rail_model::Model;
use rail_plan::LineSpec;
use rail_sim::capacity::{capacity_run, replay, sweep_headways, sweep_point, CapacityParams};
use rail_sim::capacity_input::{
    compile_network, example_lines_json, line_summaries, note_texts, parse_lines,
};
use serde::Serialize;
use wasm_bindgen::prelude::*;

fn js(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}

fn json<T: Serialize>(v: &T) -> String {
    serde_json::to_string(v).expect("capacity output serialises")
}

/// A network and its lines, ready for capacity runs.
#[wasm_bindgen]
pub struct CapacityRunner {
    model: Model,
    lines: Vec<LineSpec>,
    notes: Vec<Msg>,
}

#[wasm_bindgen]
impl CapacityRunner {
    /// Purpose: compile the network (`"example:metro"` or a topology export, JSON text) and read
    /// the lines (JSON text).
    #[wasm_bindgen(constructor)]
    pub fn new(network: &str, lines_json: &str) -> Result<CapacityRunner, JsValue> {
        let (model, notes) = compile_network(network).map_err(|e| js_error(&e))?;
        let lines = parse_lines(lines_json, &model).map_err(|e| js_error(&e))?;
        Ok(CapacityRunner {
            model,
            lines,
            notes,
        })
    }

    /// Purpose: the lines with their service bands, as JSON.
    pub fn lines(&self) -> String {
        json(&line_summaries(&self.lines))
    }

    /// Purpose: notes from importing the topology, as JSON (a list of `{text, msg}`).
    pub fn notes(&self) -> String {
        json(&note_texts(&self.notes))
    }

    /// Purpose: the capacity run of the period (JSON `CapacityParams`; missing fields take their
    /// defaults). Output: JSON `CapacityRun`.
    pub fn run(&self, params_json: &str) -> Result<String, JsValue> {
        let p: CapacityParams = serde_json::from_str(params_json).map_err(js)?;
        let r = capacity_run(&self.model, &self.lines, &p).map_err(|e| js_error(&e))?;
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
    ) -> Result<String, JsValue> {
        let p: CapacityParams = serde_json::from_str(params_json).map_err(js)?;
        let pt =
            sweep_point(&self.model, &self.lines, &p, line, headway_s).map_err(|e| js_error(&e))?;
        Ok(json(&pt))
    }

    /// Purpose: the replay of the period without random delays: where every train is, one frame
    /// every `frame_s` seconds (JSON `CapacityParams` as for [`CapacityRunner::run`]).
    /// Output: JSON `Replay`.
    pub fn replay(&self, params_json: &str, frame_s: f64) -> Result<String, JsValue> {
        let p: CapacityParams = serde_json::from_str(params_json).map_err(js)?;
        let r = replay(&self.model, &self.lines, &p, frame_s).map_err(|e| js_error(&e))?;
        Ok(json(&r))
    }

    /// Purpose: the default settings, as JSON.
    pub fn default_params() -> String {
        json(&CapacityParams::default())
    }

    /// Purpose: the lines file of the example metro (line M1), as JSON.
    pub fn example_lines() -> String {
        example_lines_json()
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
}
