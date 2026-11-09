//! WebAssembly bindings of `rail-design` for the railway editor.
//!
//! The editor keeps the design document (stations, tracks, switches) and sends it after every
//! edit to [`RailDesigner::build`], which returns the map layers, edit handles, summaries and
//! checks as JSON (see `rail_design::view`). Geometry runs in the browser, so dragging a point
//! refits the curves at once, with the same code the simulation will use.
//!
//! The editor also passes the street tiles on screen (OSM XML from the API, the same tiles the
//! street line tool uses) to [`RailDesigner::add_street_tile`], so the build finds level
//! crossings with the streets, and the railway tiles to [`RailDesigner::add_rail_tile`], so new
//! track can join the existing railways. The planner's street setups from the GIS tab
//! ([`RailDesigner::set_street_setups`]) are applied over the OSM tags, so a street set up with a
//! separated tram lane is built as one.

use rail_design::existing::{nearest_on, rail_from_osm, ExistingRail};
use rail_design::geom::{nearest, P2};
use rail_design::proj::LocalTm;
use rail_design::street::{street_from_osm, Street};
use rail_design::terrain::Terrain;
use rail_design::{build_with_terrain, Design, Network, RailMode};
use std::collections::{BTreeMap, HashMap};
use street_routing::osm::Tags;
use street_routing::StreetSetup;
use wasm_bindgen::prelude::*;

fn mode(s: &str) -> Result<RailMode, JsError> {
    serde_json::from_value(serde_json::Value::String(s.into()))
        .map_err(|_| JsError::new(&format!("unknown rail mode {s}")))
}

fn js(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}

/// Railway editor engine: holds the last built design for queries.
#[wasm_bindgen]
pub struct RailDesigner {
    design: Option<Design>,
    /// OSM tags and shape per street way, as loaded.
    streets: BTreeMap<i64, (Tags, Vec<[f64; 2]>)>,
    setups: Vec<StreetSetup>,
    street_list: Vec<Street>,
    rails: BTreeMap<i64, ExistingRail>,
    rail_list: Vec<ExistingRail>,
    values: BTreeMap<String, f64>,
    terrain: Terrain,
}

impl Default for RailDesigner {
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen]
impl RailDesigner {
    /// Purpose: an engine with nothing built yet.
    #[wasm_bindgen(constructor)]
    pub fn new() -> RailDesigner {
        Self {
            design: None,
            streets: BTreeMap::new(),
            setups: Vec::new(),
            street_list: Vec::new(),
            rails: BTreeMap::new(),
            rail_list: Vec::new(),
            values: BTreeMap::new(),
            terrain: Terrain::new(),
        }
    }

    /// Purpose: set design values the project's preferences change for every mode (JSON object of
    /// numbers by design value name, for example `{"street_mixed_traffic_delay_share": 0.3}`).
    /// Side effects: the next build uses them.
    pub fn set_values(&mut self, json: &str) -> Result<(), JsError> {
        self.values = serde_json::from_str(json).map_err(js)?;
        Ok(())
    }

    /// Purpose: build the design from the document (JSON) and return the view (JSON).
    /// `draft` is the id of a track still being drawn (0 for none).
    pub fn build(&mut self, doc: &str, draft: u32) -> Result<String, JsError> {
        let net: Network = serde_json::from_str(doc).map_err(js)?;
        let d = build_with_terrain(
            &net,
            (draft != 0).then_some(draft),
            &self.street_list,
            &self.rail_list,
            &self.values,
            &self.terrain,
        );
        let v = rail_design::view::view(&d);
        self.design = Some(d);
        Ok(v.to_string())
    }

    /// Purpose: the terrain tiles the last build needs and that are not loaded yet, as JSON
    /// `[[x, y], ...]` (see `rail_design::terrain`); empty before the first build.
    pub fn missing_terrain_tiles(&self) -> String {
        let tiles = self.design.as_ref().map_or(vec![], |d| {
            rail_design::terrain::missing_tiles(d, &self.terrain)
        });
        serde_json::to_string(&tiles).unwrap_or_else(|_| "[]".into())
    }

    /// Purpose: the grid points of a terrain tile to fetch heights for, as JSON `[[lon, lat], ...]`
    /// in the order [`RailDesigner::add_terrain_tile`] expects the heights.
    pub fn terrain_tile_points(x: i32, y: i32) -> String {
        serde_json::to_string(&Terrain::tile_points(x, y)).unwrap_or_else(|_| "[]".into())
    }

    /// Purpose: add a terrain tile's heights (JSON list of metres or null, in the order of
    /// [`RailDesigner::terrain_tile_points`]). Side effects: the next build gives the tracks
    /// vertical profiles over it.
    pub fn add_terrain_tile(&mut self, x: i32, y: i32, heights: &str) -> Result<(), JsError> {
        let h: Vec<Option<f64>> = serde_json::from_str(heights).map_err(js)?;
        self.terrain.add_tile(x, y, &h).map_err(js)
    }

    /// Purpose: forget all terrain tiles. Side effects: the next build uses flat ground.
    pub fn clear_terrain(&mut self) {
        self.terrain.clear();
    }

    /// Purpose: add the streets of one OSM XML tile, for level crossings. A way already known is
    /// kept with the longer of its two shapes (a way cut at a tile edge). Output: number of streets.
    /// Side effects: the next build checks the tracks against these streets.
    pub fn add_street_tile(&mut self, xml: &str) -> Result<u32, JsError> {
        let data = street_routing::osm::parse_osm_xml(xml).map_err(js)?;
        let nodes: HashMap<i64, [f64; 2]> =
            data.nodes.iter().map(|n| (n.id, [n.lon, n.lat])).collect();
        for w in &data.ways {
            let coords: Vec<[f64; 2]> = w
                .nodes
                .iter()
                .filter_map(|n| nodes.get(n).copied())
                .collect();
            if street_from_osm(w.id, &w.tags, coords.clone()).is_none() {
                continue;
            }
            if self
                .streets
                .get(&w.id)
                .map_or(true, |old| old.1.len() < coords.len())
            {
                self.streets.insert(w.id, (w.tags.clone(), coords));
            }
        }
        self.refresh_streets();
        Ok(self.streets.len() as u32)
    }

    /// Purpose: set the planner's street setups from the GIS tab (JSON list of
    /// `street_routing::StreetSetup`). Side effects: the next build uses them.
    pub fn set_street_setups(&mut self, json: &str) -> Result<(), JsError> {
        self.setups = serde_json::from_str(json).map_err(js)?;
        self.refresh_streets();
        Ok(())
    }

    /// Purpose: forget all streets. Side effects: the next build has no level crossings.
    pub fn clear_streets(&mut self) {
        self.streets.clear();
        self.street_list.clear();
    }

    /// Purpose: add the existing railways of one OSM XML railway tile. A way already known is kept
    /// with the longer of its two shapes. Output: number of existing railways.
    /// Side effects: the next build draws them and joins new track ends to them.
    pub fn add_rail_tile(&mut self, xml: &str) -> Result<u32, JsError> {
        let data = street_routing::osm::parse_osm_xml(xml).map_err(js)?;
        let nodes: HashMap<i64, [f64; 2]> =
            data.nodes.iter().map(|n| (n.id, [n.lon, n.lat])).collect();
        for w in &data.ways {
            let coords: Vec<[f64; 2]> = w
                .nodes
                .iter()
                .filter_map(|n| nodes.get(n).copied())
                .collect();
            let Some(r) = rail_from_osm(w.id, &w.tags, coords) else {
                continue;
            };
            if self
                .rails
                .get(&w.id)
                .map_or(true, |old| old.coords.len() < r.coords.len())
            {
                self.rails.insert(w.id, r);
            }
        }
        self.rail_list = self.rails.values().cloned().collect();
        Ok(self.rails.len() as u32)
    }

    /// Purpose: forget all existing railways. Side effects: the next build has none.
    pub fn clear_rails(&mut self) {
        self.rails.clear();
        self.rail_list.clear();
    }

    /// Purpose: the nearest point on an existing railway (in use or under construction) within
    /// `max_m` metres, to snap a track end onto, as JSON `{lonlat, heading_deg (anticlockwise from east), way, name,
    /// railway}`, or `null`. Needs a build first (for the local frame).
    pub fn existing_snap(&self, lon: f64, lat: f64, max_m: f64) -> String {
        let Some(d) = &self.design else {
            return "null".into();
        };
        let q = d.proj.to_xy(lon, lat);
        let mut best: Option<(f64, serde_json::Value)> = None;
        for e in d
            .existing
            .iter()
            .filter(|e| matches!(e.rail.status.as_str(), "active" | "construction"))
        {
            let Some((dist, p, dir, _)) = nearest_on(&e.pts, q) else {
                continue;
            };
            if dist > max_m || best.as_ref().is_some_and(|b| dist >= b.0) {
                continue;
            }
            best = Some((
                dist,
                serde_json::json!({"lonlat": d.proj.to_lonlat(p), "heading_deg": dir.heading().to_degrees(),
                                   "way": e.rail.way, "name": e.rail.name, "railway": e.rail.kind}),
            ));
        }
        best.map_or("null".into(), |b| b.1.to_string())
    }

    /// Purpose: rebuild the street list from the loaded ways with the setups applied.
    fn refresh_streets(&mut self) {
        let by_way: HashMap<i64, &StreetSetup> = self.setups.iter().map(|s| (s.way, s)).collect();
        self.street_list = self
            .streets
            .iter()
            .filter_map(|(way, (tags, coords))| {
                let mut t = tags.clone();
                if let Some(s) = by_way.get(way) {
                    s.apply(&mut t);
                }
                street_from_osm(*way, &t, coords.clone())
            })
            .collect();
    }

    /// Purpose: the track nearest to a map position within `max_m` metres, as JSON
    /// `{track, s, side, distance, tracks, straight}`, or `null`.
    pub fn nearest_track(&self, lon: f64, lat: f64, max_m: f64) -> String {
        let Some(d) = &self.design else {
            return "null".into();
        };
        let q = d.proj.to_xy(lon, lat);
        let mut best: Option<(f64, serde_json::Value)> = None;
        for g in &d.tracks {
            let Some(r) = nearest(&g.centre, q) else {
                continue;
            };
            let tol = max_m + g.spacing_at(r.s) / 2.0;
            if r.d > tol || best.as_ref().is_some_and(|b| r.d >= b.0) {
                continue;
            }
            let straight = !g.curves.iter().any(|c| r.s >= c.s0 && r.s <= c.s1);
            best = Some((
                r.d,
                serde_json::json!({"track": g.id, "s": r.s, "side": r.side.signum(), "distance": r.d,
                                   "tracks": g.ntracks, "straight": straight, "spacing": g.spacing_at(r.s)}),
            ));
        }
        best.map_or("null".into(), |b| b.1.to_string())
    }

    /// Purpose: the track topology of the last build for railway operations, as JSON
    /// (`contracts/rail-topology.schema.json`); "null" before the first build.
    pub fn topology(&self) -> String {
        self.design.as_ref().map_or("null".into(), |d| {
            serde_json::to_string(&rail_design::topology::topology(d))
                .unwrap_or_else(|_| "null".into())
        })
    }

    /// Purpose: plan the service lines drawn in the editor on the last built design and publish them
    /// for the journey planner (`rail_plan::service`).
    /// Inputs: JSON list of `rail_plan::ServiceLine`, the day type id.
    /// Output: JSON `rail_plan::ServicePublication` (timetable, report per line, notes); Err before a
    /// build, for a design with errors or for a line with fewer than two stops.
    pub fn publish_lines(&self, lines: &str, service_id: &str) -> Result<String, JsError> {
        let d = self
            .design
            .as_ref()
            .ok_or_else(|| JsError::new("Nothing is drawn yet."))?;
        let lines: Vec<rail_plan::ServiceLine> = serde_json::from_str(lines).map_err(js)?;
        let topo = serde_json::to_string(&rail_design::topology::topology(d)).map_err(js)?;
        let out =
            rail_plan::publish_service(&topo, &lines, service_id).map_err(|e| JsError::new(&e))?;
        serde_json::to_string(&out).map_err(js)
    }

    /// Purpose: whether a train can run from station `from` to station `to` (document ids) on the
    /// last built design, for picking a service line's stations in order.
    /// Output: JSON `rail_plan::Reach`; Err before a build or for a design with errors.
    pub fn reachable(&self, from: u32, to: u32) -> Result<String, JsError> {
        let d = self
            .design
            .as_ref()
            .ok_or_else(|| JsError::new("Nothing is drawn yet."))?;
        let topo = serde_json::to_string(&rail_design::topology::topology(d)).map_err(js)?;
        let r = rail_plan::station_reachable(&topo, &format!("st{from}"), &format!("st{to}"))
            .map_err(|e| JsError::new(&e))?;
        serde_json::to_string(&r).map_err(js)
    }

    /// Purpose: a signal plan generated from the last built design (JSON list of document
    /// signals, ids continuing the document's), for "Generate signals". "[]" before a build.
    pub fn generate_signals(&self) -> String {
        self.design.as_ref().map_or("[]".into(), |d| {
            serde_json::to_string(&rail_design::topology::topology(d).generated)
                .unwrap_or_else(|_| "[]".into())
        })
    }

    /// Purpose: where a signal placed at a map position would stand (JSON anchor: a track line,
    /// station track or switch leg within `max_m`), or "null".
    pub fn signal_anchor(&self, lon: f64, lat: f64, max_m: f64) -> String {
        let Some(d) = &self.design else {
            return "null".into();
        };
        rail_design::signal::nearest_anchor(d, d.proj.to_xy(lon, lat), max_m)
            .and_then(|(at, _)| serde_json::to_string(&at).ok())
            .unwrap_or_else(|| "null".into())
    }

    /// Purpose: chainage on a given track nearest to a map position (NaN when the track is unknown).
    pub fn chainage(&self, track: u32, lon: f64, lat: f64) -> f64 {
        let Some(d) = &self.design else {
            return f64::NAN;
        };
        let Some(g) = d.track(track) else {
            return f64::NAN;
        };
        nearest(&g.centre, d.proj.to_xy(lon, lat)).map_or(f64::NAN, |r| r.s)
    }

    /// Purpose: degrees to local metres `[x, y]` around an origin.
    pub fn to_local(origin_lon: f64, origin_lat: f64, lon: f64, lat: f64) -> Vec<f64> {
        let p = LocalTm::new(origin_lon, origin_lat).to_xy(lon, lat);
        vec![p.x, p.y]
    }

    /// Purpose: local metres to degrees `[lon, lat]` around an origin.
    pub fn to_lonlat(origin_lon: f64, origin_lat: f64, x: f64, y: f64) -> Vec<f64> {
        LocalTm::new(origin_lon, origin_lat)
            .to_lonlat(P2::new(x, y))
            .to_vec()
    }

    /// Purpose: the design values of a mode from the assumption library (JSON).
    pub fn default_params(m: &str) -> Result<String, JsError> {
        serde_json::to_string(rail_design::defaults().mode(mode(m)?)).map_err(js)
    }

    /// Purpose: an example line for a mode around a position (document JSON).
    pub fn sample(m: &str, lon: f64, lat: f64) -> Result<String, JsError> {
        serde_json::to_string(&rail_design::sample::sample(mode(m)?, lon, lat)).map_err(js)
    }
}
