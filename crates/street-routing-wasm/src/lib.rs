//! WebAssembly bindings of `street-routing` for the map editor.
//!
//! The editor owns one [`StreetLineEditor`]: it loads a road network, then every
//! edit returns the whole line view as JSON (see `street_routing::LineView`).
//! Routing runs in the browser, so dragging a point re-routes instantly, and it
//! is the same code the simulation worker uses.

use street_routing::line::{PointKind, StreetLine};
use street_routing::{parse_osm_xml, Mode, RoadGraph, RoutingRules, VehicleProfile};
use wasm_bindgen::prelude::*;

fn kind(s: &str) -> Result<PointKind, JsError> {
    match s {
        "via" => Ok(PointKind::Via),
        "stop" => Ok(PointKind::Stop),
        "end_stop" => Ok(PointKind::EndStop),
        _ => Err(JsError::new(&format!("unknown point kind {s}"))),
    }
}

/// Street line editor state: road network plus the line being drawn.
#[wasm_bindgen]
pub struct StreetLineEditor {
    graph: RoadGraph,
    line: StreetLine,
}

#[wasm_bindgen]
impl StreetLineEditor {
    /// Purpose: load a road network from OSM XML. Errors when the file has no bus roads.
    #[wasm_bindgen(constructor)]
    pub fn new(osm_xml: &str) -> Result<StreetLineEditor, JsError> {
        let data = parse_osm_xml(osm_xml).map_err(|e| JsError::new(&e))?;
        let graph = RoadGraph::from_osm(&data).map_err(|e| JsError::new(&e))?;
        let line = StreetLine::new(
            VehicleProfile::default_for(Mode::Bus),
            RoutingRules::default(),
        );
        Ok(Self { graph, line })
    }

    /// Purpose: network bounds `[west, south, east, north]` for fitting the map.
    pub fn bounds(&self) -> Vec<f64> {
        self.graph.bounds_lonlat().to_vec()
    }

    /// Purpose: road network size as JSON `{nodes, arcs, turn_bans}`.
    pub fn stats(&self) -> String {
        format!(
            r#"{{"nodes":{},"arcs":{},"turn_bans":{}}}"#,
            self.graph.nodes.len(),
            self.graph.arcs.len(),
            self.graph.banned.len()
        )
    }

    /// Purpose: set vehicle and project rules from JSON (`VehicleProfile`, `RoutingRules`); re-routes everything.
    pub fn set_settings(
        &mut self,
        profile_json: &str,
        rules_json: &str,
    ) -> Result<String, JsError> {
        let profile: VehicleProfile =
            serde_json::from_str(profile_json).map_err(|e| JsError::new(&e.to_string()))?;
        self.line.rules =
            serde_json::from_str(rules_json).map_err(|e| JsError::new(&e.to_string()))?;
        self.line.set_profile(&self.graph, profile);
        Ok(self.view())
    }

    /// Purpose: default vehicle for a mode (`bus`, `brt`, `trolleybus`, `intercity_bus`) as JSON.
    pub fn default_profile(mode: &str) -> Result<String, JsError> {
        let m: Mode = serde_json::from_str(&format!("\"{mode}\""))
            .map_err(|e| JsError::new(&e.to_string()))?;
        Ok(serde_json::to_string(&VehicleProfile::default_for(m)).unwrap_or_default())
    }

    /// Purpose: default project rules as JSON.
    pub fn default_rules() -> String {
        serde_json::to_string(&RoutingRules::default()).unwrap_or_default()
    }

    /// Purpose: insert a point at circuit position `seq` (`seq >= count` appends). Returns the view.
    pub fn insert_point(
        &mut self,
        seq: usize,
        lon: f64,
        lat: f64,
        point_kind: &str,
    ) -> Result<String, JsError> {
        self.line
            .insert_point(&self.graph, seq, lon, lat, kind(point_kind)?);
        Ok(self.view())
    }

    /// Purpose: move a point. Returns the view.
    pub fn move_point(&mut self, id: u32, lon: f64, lat: f64) -> Result<String, JsError> {
        self.line
            .move_point(&self.graph, id, lon, lat)
            .map_err(|e| JsError::new(&e))?;
        Ok(self.view())
    }

    /// Purpose: delete a point. Returns the view.
    pub fn delete_point(&mut self, id: u32) -> Result<String, JsError> {
        self.line
            .delete_point(&self.graph, id)
            .map_err(|e| JsError::new(&e))?;
        Ok(self.view())
    }

    /// Purpose: set a point's kind (`via`, `stop`, `end_stop`). Returns the view.
    pub fn set_kind(&mut self, id: u32, point_kind: &str) -> Result<String, JsError> {
        self.line
            .set_kind(&self.graph, id, kind(point_kind)?)
            .map_err(|e| JsError::new(&e))?;
        Ok(self.view())
    }

    /// Purpose: set or clear (empty string) a point's name. Returns the view.
    pub fn set_name(&mut self, id: u32, name: &str) -> Result<String, JsError> {
        self.line
            .set_name(id, Some(name.to_string()))
            .map_err(|e| JsError::new(&e))?;
        Ok(self.view())
    }

    /// Purpose: place the depot gate. Returns the view.
    pub fn set_depot(&mut self, lon: f64, lat: f64) -> String {
        self.line.set_depot(&self.graph, Some((lon, lat)));
        self.view()
    }

    /// Purpose: remove the depot. Returns the view.
    pub fn clear_depot(&mut self) -> String {
        self.line.set_depot(&self.graph, None);
        self.view()
    }

    /// Purpose: re-choose travel directions for the shortest whole circuit. Returns the view.
    pub fn optimise(&mut self) -> String {
        self.line.reroute_all(&self.graph);
        self.view()
    }

    /// Purpose: roads usable by the current vehicle as GeoJSON (see `RoadGraph::usable_roads_geojson`).
    pub fn usable_roads(&self) -> String {
        self.graph.usable_roads_geojson(&self.line.profile)
    }

    /// Purpose: current line view as JSON.
    pub fn view(&self) -> String {
        serde_json::to_string(&self.line.view(&self.graph)).unwrap_or_default()
    }
}
