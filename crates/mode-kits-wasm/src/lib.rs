//! WebAssembly bindings of `mode-kits` for the cable car, people mover, ferry and on-demand bus tools.
//!
//! Stateless: the editor sends the whole line after every edit and gets the built line back as JSON
//! (`mode_kits::spans::SpanView`, `mode_kits::water::WaterView`, `mode_kits::zone::ZoneView`, `mode_kits::segment::SimOutput`).

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

/// Purpose: estimate an on-demand service with the service zone kit.
/// Input: `mode_kits::zone::ZoneInput` as JSON. Output: `ZoneView` as JSON.
#[wasm_bindgen]
pub fn estimate_zone(input: &str) -> Result<String, JsError> {
    let zone: mode_kits::zone::ZoneInput = serde_json::from_str(input).map_err(js)?;
    serde_json::to_string(&mode_kits::zone::estimate(&zone)).map_err(js)
}

/// Purpose: simulate one service day of an on-demand zone, request by request (ADR-0041).
/// Input: `mode_kits::dispatch::DispatchInput` as JSON. Output: `DispatchResult` as JSON.
#[wasm_bindgen]
pub fn simulate_zone(input: &str) -> Result<String, JsError> {
    let day: mode_kits::dispatch::DispatchInput = serde_json::from_str(input).map_err(js)?;
    serde_json::to_string(&mode_kits::dispatch::simulate(&day)).map_err(js)
}
