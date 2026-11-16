//! Python bindings for the MobSimLab kernels, used by the sim-worker.
//!
//! Structured values cross the boundary as JSON strings, so the Python side
//! can validate them with the same JSON Schemas as the rest of the platform
//! (contracts/). The per-step calls (`step`, `set_external_speed`, ...) take
//! plain numbers and do not allocate.
#![warn(missing_docs)]

use pyo3::exceptions::{PyRuntimeError, PyValueError};
use pyo3::prelude::*;
use rail_model::Model;
use rail_plan::LineSpec;
use rail_sim::capacity::{capacity_run, sweep_headways, sweep_point, CapacityParams};
use rail_sim::capacity_input::{compile_network, example_lines_json, line_summaries, parse_lines};
use rail_sim::{RailSim, SimConfig, TdsSpec, TrainSpec};

fn json_err(e: serde_json::Error) -> PyErr {
    PyValueError::new_err(e.to_string())
}

/// Rail operations kernel (see the `rail-sim` crate).
#[pyclass(name = "RailSim", unsendable)]
struct PyRailSim {
    inner: RailSim,
}

#[pymethods]
impl PyRailSim {
    /// Purpose: create a kernel.
    /// Inputs: `sections_json` (list of TdsSpec), optional `config_json` (SimConfig).
    /// Output: the kernel. Raises ValueError on invalid input.
    #[new]
    #[pyo3(signature = (sections_json, config_json=None))]
    fn new(sections_json: &str, config_json: Option<&str>) -> PyResult<Self> {
        let sections: Vec<TdsSpec> = serde_json::from_str(sections_json).map_err(json_err)?;
        let cfg: SimConfig = match config_json {
            Some(s) => serde_json::from_str(s).map_err(json_err)?,
            None => SimConfig::default(),
        };
        Ok(Self {
            inner: RailSim::new(sections, cfg).map_err(PyValueError::new_err)?,
        })
    }

    /// Purpose: place a train (TrainSpec JSON). Output: train ID.
    /// Raises ValueError if the spec is invalid or its sections are taken.
    fn add_train(&mut self, spec_json: &str) -> PyResult<u32> {
        let spec: TrainSpec = serde_json::from_str(spec_json).map_err(json_err)?;
        self.inner.add_train(spec).map_err(PyValueError::new_err)
    }

    /// Purpose: advance by `dt` seconds.
    fn step(&mut self, dt: f64) {
        self.inner.step(dt);
    }

    /// Purpose: current simulation time in seconds.
    fn time(&self) -> f64 {
        self.inner.time()
    }

    /// Purpose: snapshot of one train as JSON (TrainState).
    fn train_state(&self, id: u32) -> PyResult<String> {
        serde_json::to_string(&self.inner.train_state(id)).map_err(json_err)
    }

    /// Purpose: open or close the exit portal of a non-cyclic train path.
    fn set_exit_open(&mut self, id: u32, open: bool) {
        self.inner.set_exit_open(id, open);
    }

    /// Purpose: set the speed of an exiting train from the road engine.
    fn set_external_speed(&mut self, id: u32, v: f64) {
        self.inner.set_external_speed(id, v);
    }

    /// Purpose: block or unblock a section.
    fn set_blocked(&mut self, tds: u32, blocked: bool) {
        self.inner.set_blocked(tds, blocked);
    }

    /// Purpose: train holding a reservation on `tds`, or None.
    fn reserved_by(&self, tds: u32) -> Option<u32> {
        self.inner.reserved_by(tds)
    }

    /// Purpose: verify safety invariants. Raises RuntimeError on violation.
    fn check_invariants(&self) -> PyResult<()> {
        self.inner
            .check_invariants()
            .map_err(PyRuntimeError::new_err)
    }

    /// Purpose: take recorded events as a JSON list.
    fn drain_events(&mut self) -> PyResult<String> {
        serde_json::to_string(&self.inner.drain_events()).map_err(json_err)
    }

    /// Purpose: aggregate counters as JSON (SimStats).
    fn stats(&self) -> PyResult<String> {
        serde_json::to_string(self.inner.stats()).map_err(json_err)
    }
}

/// Rail capacity run (`rail_sim::capacity`): the same calls as the simulator tab's
/// WebAssembly module, so a run on the server gives the same result as one in the browser.
#[pyclass(name = "CapacityRunner", unsendable)]
struct PyCapacityRunner {
    model: Model,
    lines: Vec<LineSpec>,
    notes: Vec<String>,
}

fn params(params_json: &str) -> PyResult<CapacityParams> {
    serde_json::from_str(params_json).map_err(json_err)
}

#[pymethods]
impl PyCapacityRunner {
    /// Purpose: compile the network (`"example:metro"` or a topology export, JSON text) and read
    /// the lines (JSON text). Raises ValueError naming the problem.
    #[new]
    fn new(network: &str, lines_json: &str) -> PyResult<Self> {
        let (model, notes) = compile_network(network).map_err(PyValueError::new_err)?;
        let lines = parse_lines(lines_json).map_err(PyValueError::new_err)?;
        Ok(Self {
            model,
            lines,
            notes,
        })
    }

    /// Purpose: the lines with their service bands, as JSON.
    fn lines(&self) -> PyResult<String> {
        serde_json::to_string(&line_summaries(&self.lines)).map_err(json_err)
    }

    /// Purpose: notes from importing the topology, as JSON (a list of strings).
    fn notes(&self) -> PyResult<String> {
        serde_json::to_string(&self.notes).map_err(json_err)
    }

    /// Purpose: the capacity run of the period (JSON `CapacityParams`; missing fields take their
    /// defaults). Output: JSON `CapacityRun`. Raises ValueError on invalid settings.
    fn run(&self, params_json: &str) -> PyResult<String> {
        let r = capacity_run(&self.model, &self.lines, &params(params_json)?)
            .map_err(PyValueError::new_err)?;
        serde_json::to_string(&r).map_err(json_err)
    }

    /// Purpose: the headways the frequency sweep tries for line `line`. Output: JSON list of s.
    fn sweep_headways(&self, params_json: &str, line: usize, works: bool) -> PyResult<String> {
        let l = self
            .lines
            .get(line)
            .ok_or_else(|| PyValueError::new_err("no such line"))?;
        serde_json::to_string(&sweep_headways(l, &params(params_json)?, works)).map_err(json_err)
    }

    /// Purpose: one point of the frequency sweep. Output: JSON `Point`.
    fn sweep_point(&self, params_json: &str, line: usize, headway_s: f64) -> PyResult<String> {
        let pt = sweep_point(
            &self.model,
            &self.lines,
            &params(params_json)?,
            line,
            headway_s,
        )
        .map_err(PyValueError::new_err)?;
        serde_json::to_string(&pt).map_err(json_err)
    }

    /// Purpose: the lines file of the example metro (line M1), as JSON.
    #[staticmethod]
    fn example_lines() -> String {
        example_lines_json()
    }
}

/// MobSimLab simulation kernels.
#[pymodule]
fn mobsim_kernels(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<PyRailSim>()?;
    m.add_class::<PyCapacityRunner>()?;
    Ok(())
}
