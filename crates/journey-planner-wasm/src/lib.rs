//! WebAssembly bindings of `journey-planner` for the web app's journey planner panel.
//!
//! The panel compiles the published timetable once ([`JourneyPlanner::new`]) and then asks questions as
//! JSON: one depart-at or arrive-by journey ([`JourneyPlanner::plan`]) or the same question through the day
//! ([`JourneyPlanner::profile`]). It is the same code the simulation worker will use for batch benchmarks.

use journey_planner::{Planner, ProfileQuery, Query, Settings, Timetable};
use wasm_bindgen::prelude::*;

fn parse<T: serde::de::DeserializeOwned>(what: &str, json: &str) -> Result<T, JsError> {
    serde_json::from_str(json).map_err(|e| JsError::new(&format!("invalid {what}: {e}")))
}

fn json<T: serde::Serialize>(v: &T) -> String {
    serde_json::to_string(v).expect("planner output serialises")
}

/// A timetable compiled for routing.
#[wasm_bindgen]
pub struct JourneyPlanner {
    planner: Planner,
}

#[wasm_bindgen]
impl JourneyPlanner {
    /// Purpose: compile a published timetable (JSON, `contracts/published-timetable.schema.json`) with
    /// planner settings (JSON; missing fields take their defaults).
    #[wasm_bindgen(constructor)]
    pub fn new(timetable_json: &str, settings_json: &str) -> Result<JourneyPlanner, JsError> {
        let tt: Timetable = parse("timetable", timetable_json)?;
        let settings: Settings = parse("settings", settings_json)?;
        Ok(JourneyPlanner {
            planner: Planner::new(&tt, settings),
        })
    }

    /// Purpose: counts and warnings of the compiled network, as JSON.
    pub fn summary(&self) -> String {
        json(self.planner.summary())
    }

    /// Purpose: answer one question (JSON `Query`). Output: JSON `Plan`, fastest journey first.
    pub fn plan(&self, query_json: &str) -> Result<String, JsError> {
        let q: Query = parse("query", query_json)?;
        Ok(json(&self.planner.plan(&q)))
    }

    /// Purpose: the same question through the day (JSON `ProfileQuery`). Output: JSON list of points.
    pub fn profile(&self, query_json: &str) -> Result<String, JsError> {
        let q: ProfileQuery = parse("profile query", query_json)?;
        Ok(json(&self.planner.profile(&q)))
    }

    /// Purpose: earliest arrival at every stop when leaving `[lon, lat]` at `t0` (seconds after midnight).
    /// Output: JSON `{"stop_ids": [...], "arrive_s": [s or null, ...]}` in the same order.
    pub fn reach(&self, lon: f64, lat: f64, t0: u32) -> String {
        let arrive = self.planner.reach([lon, lat], t0);
        json(&serde_json::json!({ "stop_ids": self.planner.stop_ids(), "arrive_s": arrive }))
    }

    /// Purpose: the default settings, as JSON.
    pub fn default_settings() -> String {
        json(&Settings::default())
    }
}
