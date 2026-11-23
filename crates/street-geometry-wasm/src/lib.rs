//! WebAssembly bindings of `street-geometry` for the GIS tab (ADR-0047).
//!
//! The GIS tab owns one [`StreetGeometry`]. Street tiles arrive as the planner moves the map
//! ([`StreetGeometry::add_osm`], the same OSM XML tiles the street setup tool loads); [`StreetGeometry::build`]
//! returns the lane and junction shapes with the project's street setups applied, as JSON
//! (`street_geometry::Geometry`). It only draws: routing stays in `street-routing-wasm`.

use street_geometry::DrivingSide;
use street_routing::osm::OsmData;
use street_routing::{parse_osm_xml, StreetSetup};
use wasm_bindgen::prelude::*;

/// Streets loaded so far.
#[wasm_bindgen]
#[derive(Default)]
pub struct StreetGeometry {
    data: OsmData,
}

#[wasm_bindgen]
impl StreetGeometry {
    /// Purpose: an empty set of streets.
    #[wasm_bindgen(constructor)]
    pub fn new() -> StreetGeometry {
        StreetGeometry::default()
    }

    /// Purpose: add one street tile (OSM XML). Side effects: merges it into the streets loaded so far.
    pub fn add_osm(&mut self, osm_xml: &str) -> Result<(), JsError> {
        let tile = parse_osm_xml(osm_xml).map_err(|m| JsError::new(&m.english()))?;
        self.data.merge(tile);
        Ok(())
    }

    /// Purpose: whether any street is loaded.
    pub fn ready(&self) -> bool {
        !self.data.ways.is_empty()
    }

    /// Purpose: the lane and junction shapes of the streets loaded, with the street setups applied.
    /// Inputs: the project's street setups as JSON (`StreetSetup[]`); the side traffic drives on
    /// (`right` or `left`, Project preferences; anything else takes it from the country).
    /// Output: `street_geometry::Geometry` as JSON.
    pub fn build(&self, setups_json: &str, driving_side: &str) -> Result<String, JsError> {
        let setups: Vec<StreetSetup> =
            serde_json::from_str(setups_json).map_err(|e| JsError::new(&e.to_string()))?;
        let side = match driving_side {
            "right" => Some(DrivingSide::Right),
            "left" => Some(DrivingSide::Left),
            _ => None,
        };
        let g = street_geometry::build(&self.data, &setups, side).map_err(|e| JsError::new(&e))?;
        serde_json::to_string(&g).map_err(|e| JsError::new(&e.to_string()))
    }
}
