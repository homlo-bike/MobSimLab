//! WebAssembly bindings of the GTFS importer and exporter for the GTFS plugin. The app unzips and zips
//! the feed; these functions read and write its text files.

use wasm_bindgen::prelude::*;

fn js(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}

/// Purpose: read a GTFS feed into the published timetable of one service day.
/// Input: `gtfs::ImportInput` as JSON (file name → text, options). Output: `gtfs::Imported` as JSON.
#[wasm_bindgen]
pub fn import_gtfs(input: &str) -> Result<String, JsValue> {
    let input: gtfs::ImportInput = serde_json::from_str(input).map_err(js)?;
    let out = gtfs::import(&input).map_err(|e| engine_msg::js_error(&e))?;
    Ok(serde_json::to_string(&out).map_err(js)?)
}

/// Purpose: write the published timetable as GTFS text files.
/// Input: `gtfs::ExportInput` as JSON. Output: file name → text as JSON.
#[wasm_bindgen]
pub fn export_gtfs(input: &str) -> Result<String, JsError> {
    let input: gtfs::ExportInput = serde_json::from_str(input).map_err(js)?;
    serde_json::to_string(&gtfs::export(&input)).map_err(js)
}
