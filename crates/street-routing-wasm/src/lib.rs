//! WebAssembly bindings of `street-routing` for the map editor.
//!
//! The editor owns one [`StreetLineEditor`]. Street data arrives tile by tile as the planner
//! moves the map ([`StreetLineEditor::add_osm`] then [`StreetLineEditor::rebuild`]); every edit
//! returns the whole line view as JSON (see `street_routing::LineView`). Routing runs in the
//! browser, so dragging a point re-routes instantly, and it is the same code the simulation
//! worker uses.

use street_routing::geo::LocalProjection;
use street_routing::line::{PointKind, StreetLine};
use street_routing::osm::OsmData;
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

fn not_ready() -> JsError {
    JsError::new(
        "Streets for this area are still loading. Zoom in to street level and wait a moment.",
    )
}

/// Street line editor state: the streets loaded so far plus the line being drawn.
#[wasm_bindgen]
pub struct StreetLineEditor {
    data: OsmData,
    proj: Option<LocalProjection>,
    graph: Option<RoadGraph>,
    line: StreetLine,
}

impl Default for StreetLineEditor {
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen]
impl StreetLineEditor {
    /// Purpose: empty editor with a 12 m bus and default project rules.
    #[wasm_bindgen(constructor)]
    pub fn new() -> StreetLineEditor {
        Self {
            data: OsmData::default(),
            proj: None,
            graph: None,
            line: StreetLine::new(
                VehicleProfile::default_for(Mode::Bus),
                RoutingRules::default(),
            ),
        }
    }

    /// Purpose: add streets (OSM XML for one tile) to the network. Call `rebuild` afterwards.
    pub fn add_osm(&mut self, osm_xml: &str) -> Result<(), JsError> {
        let d = parse_osm_xml(osm_xml).map_err(|e| JsError::new(&e))?;
        self.data.merge(d);
        Ok(())
    }

    /// Purpose: rebuild the road network from all streets added so far and re-route the line.
    /// Output: the view, or an error when no street usable by buses has been loaded yet.
    pub fn rebuild(&mut self) -> Result<String, JsError> {
        let g = RoadGraph::from_osm_with(&self.data, self.proj).map_err(|e| JsError::new(&e))?;
        self.proj = Some(g.proj);
        self.line.rebuild(&g);
        self.graph = Some(g);
        Ok(self.view())
    }

    /// Purpose: whether a road network is loaded.
    pub fn ready(&self) -> bool {
        self.graph.is_some()
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
        match &self.graph {
            Some(g) => self.line.set_profile(g, profile),
            None => self.line.profile = profile,
        }
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
        let g = self.graph.as_ref().ok_or_else(not_ready)?;
        self.line.insert_point(g, seq, lon, lat, kind(point_kind)?);
        Ok(self.view())
    }

    /// Purpose: move a point. Returns the view.
    pub fn move_point(&mut self, id: u32, lon: f64, lat: f64) -> Result<String, JsError> {
        let g = self.graph.as_ref().ok_or_else(not_ready)?;
        self.line
            .move_point(g, id, lon, lat)
            .map_err(|e| JsError::new(&e))?;
        Ok(self.view())
    }

    /// Purpose: delete a point. Returns the view.
    pub fn delete_point(&mut self, id: u32) -> Result<String, JsError> {
        let g = self.graph.as_ref().ok_or_else(not_ready)?;
        self.line
            .delete_point(g, id)
            .map_err(|e| JsError::new(&e))?;
        Ok(self.view())
    }

    /// Purpose: delete every point (the depot stays). Returns the view.
    pub fn clear(&mut self) -> Result<String, JsError> {
        let g = self.graph.as_ref().ok_or_else(not_ready)?;
        let ids: Vec<u32> = self.line.view(g).points.iter().map(|p| p.id).collect();
        for id in ids {
            self.line
                .delete_point(g, id)
                .map_err(|e| JsError::new(&e))?;
        }
        Ok(self.view())
    }

    /// Purpose: set a point's kind (`via`, `stop`, `end_stop`). Returns the view.
    pub fn set_kind(&mut self, id: u32, point_kind: &str) -> Result<String, JsError> {
        let g = self.graph.as_ref().ok_or_else(not_ready)?;
        self.line
            .set_kind(g, id, kind(point_kind)?)
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
    pub fn set_depot(&mut self, lon: f64, lat: f64) -> Result<String, JsError> {
        let g = self.graph.as_ref().ok_or_else(not_ready)?;
        self.line.set_depot(g, Some((lon, lat)));
        Ok(self.view())
    }

    /// Purpose: remove the depot. Returns the view.
    pub fn clear_depot(&mut self) -> Result<String, JsError> {
        let g = self.graph.as_ref().ok_or_else(not_ready)?;
        self.line.set_depot(g, None);
        Ok(self.view())
    }

    /// Purpose: re-choose travel directions for the shortest whole circuit. Returns the view.
    pub fn optimise(&mut self) -> Result<String, JsError> {
        let g = self.graph.as_ref().ok_or_else(not_ready)?;
        self.line.reroute_all(g);
        Ok(self.view())
    }

    /// Purpose: roads usable by the current vehicle as GeoJSON (see `RoadGraph::usable_roads_geojson`).
    pub fn usable_roads(&self) -> String {
        match &self.graph {
            Some(g) => g.usable_roads_geojson(&self.line.profile),
            None => r#"{"type":"FeatureCollection","features":[]}"#.to_string(),
        }
    }

    /// Purpose: current line view as JSON (an empty line before streets are loaded).
    pub fn view(&self) -> String {
        match &self.graph {
            Some(g) => serde_json::to_string(&self.line.view(g)).unwrap_or_default(),
            None => r#"{"points":[],"legs":[],"directions":[],"station_groups":[],"depot":null,"depot_trips":[],"issues":[],"length_m":0,"time_s":0}"#.to_string(),
        }
    }
}
