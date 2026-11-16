//! WebAssembly bindings of the energy and emissions estimate for the energy plugin's
//! `energy_emissions` calculation, shown in the Tables tab.
//!
//! Stateless: the app sends every line with its parameter values and gets the estimate back as JSON
//! (`energy::EnergyInput` in, `energy::EnergyEstimate` out).

use wasm_bindgen::prelude::*;

/// Purpose: estimate the traction energy and emissions of the lines.
/// Input: `energy::EnergyInput` as JSON. Output: `energy::EnergyEstimate` as JSON.
#[wasm_bindgen]
pub fn estimate_energy(input: &str) -> Result<String, JsError> {
    let input: energy::EnergyInput =
        serde_json::from_str(input).map_err(|e| JsError::new(&e.to_string()))?;
    serde_json::to_string(&energy::estimate(&input)).map_err(|e| JsError::new(&e.to_string()))
}
