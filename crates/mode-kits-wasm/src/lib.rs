//! WebAssembly bindings of `mode-kits` for the cable car and ferry tools.
//!
//! Stateless: the editor sends the whole line after every edit and gets the built line back as JSON
//! (`mode_kits::spans::SpanView`, `mode_kits::water::WaterView`, `mode_kits::segment::SimOutput`).

use wasm_bindgen::prelude::*;

fn js(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}

/// Purpose: build a ropeway line with the straight spans kit.
/// Input: `mode_kits::spans::SpanLine` as JSON. Output: `SpanView` as JSON.
#[wasm_bindgen]
pub fn build_span_line(input: &str) -> Result<String, JsError> {
    let line: mode_kits::spans::SpanLine = serde_json::from_str(input).map_err(js)?;
    serde_json::to_string(&mode_kits::spans::build(&line)).map_err(js)
}

/// Purpose: build a ferry line with the water route kit, including the berth check.
/// Input: `mode_kits::water::WaterLine` as JSON. Output: `WaterView` as JSON.
#[wasm_bindgen]
pub fn build_water_line(input: &str) -> Result<String, JsError> {
    let line: mode_kits::water::WaterLine = serde_json::from_str(input).map_err(js)?;
    serde_json::to_string(&mode_kits::water::build(&line)).map_err(js)
}

/// Purpose: run vehicles on the segment engine with reservable resources.
/// Input: `mode_kits::segment::SimInput` as JSON. Output: `SimOutput` as JSON.
#[wasm_bindgen]
pub fn simulate_segments(input: &str) -> Result<String, JsError> {
    let sim: mode_kits::segment::SimInput = serde_json::from_str(input).map_err(js)?;
    serde_json::to_string(&mode_kits::segment::simulate(&sim)).map_err(js)
}
