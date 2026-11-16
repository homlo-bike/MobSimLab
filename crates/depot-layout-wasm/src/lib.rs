//! WebAssembly bindings of the road depot layouts (`crates/depot-layout`) for the Create tab's depot tool.
//! Every function takes a depot (contracts/depot.schema.json with the vehicles, fleet and project values)
//! as JSON text and returns JSON text.

use depot_layout::model::DepotInput;
use wasm_bindgen::prelude::*;

fn input(json: &str) -> Result<DepotInput, JsError> {
    serde_json::from_str(json).map_err(|e| JsError::new(&format!("depot: {e}")))
}

fn out(v: &impl serde::Serialize) -> Result<String, JsError> {
    serde_json::to_string(v).map_err(|e| JsError::new(&e.to_string()))
}

/// Purpose: the auto layout of a depot's zones. Output: `{layout, issues}`.
#[wasm_bindgen]
pub fn generate_layout(depot_json: &str) -> Result<String, JsError> {
    out(&depot_layout::generate(&input(depot_json)?))
}

/// Purpose: all checks of a depot's layout: swept path per lane, driving network from the gates,
/// capacity with a slot per vehicle, dynamic sizing and issues.
#[wasm_bindgen]
pub fn analyse_depot(depot_json: &str) -> Result<String, JsError> {
    out(&depot_layout::analyse(&input(depot_json)?))
}

/// Purpose: the outlines a vehicle sweeps driving into and out of one lane, as rings of [lon, lat].
#[wasm_bindgen]
pub fn lane_envelope(depot_json: &str, lane_id: &str) -> Result<String, JsError> {
    out(&depot_layout::report::envelope(
        &input(depot_json)?,
        lane_id,
    ))
}

/// Purpose: dynamic sizing: the smallest area for the fleet of the depot's lines, and the fleet its outline
/// holds with each lane angle.
#[wasm_bindgen]
pub fn size_depot(depot_json: &str) -> Result<String, JsError> {
    out(&depot_layout::size(&input(depot_json)?))
}
