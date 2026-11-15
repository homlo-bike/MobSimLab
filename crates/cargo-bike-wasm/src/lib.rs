//! WebAssembly bindings of the cargo bike plugin (`plugins/cargo-bike`) for its Cargo bike tab.
//!
//! The tab loads the walk tiles around the start point and the destination into a [`CargoBikeRouter`],
//! asks it for the route there and back, fetches the heights along both routes from the terrain service
//! and hands them to [`trip`]. The range map sends heights along straight bearings to [`range_map`]; the
//! savings table comes from [`savings`]. All inputs and outputs are JSON text.

use cargo_bike::network::{BikeGraph, Route};
use cargo_bike::params::{defaults as plugin_defaults, Bike, Values};
use cargo_bike::savings::{savings as savings_table, Conversion};
use cargo_bike::trip::{range_map as reach, ride_route, trip as round_trip, Profile, Ray};
use serde_json::{json, Value};
use std::collections::HashMap;
use street_routing::osm::{parse_osm_xml, OsmData};
use street_routing::setup::{apply_setups, StreetSetup};
use wasm_bindgen::prelude::*;

fn js(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}

fn parse(json: &str) -> Result<Value, JsError> {
    serde_json::from_str(json).map_err(js)
}

/// Purpose: the project's own values from a request's `values` object.
fn values(req: &Value) -> HashMap<String, f64> {
    req.get("values")
        .and_then(Value::as_object)
        .map(|m| {
            m.iter()
                .filter_map(|(k, v)| v.as_f64().map(|x| (k.clone(), x)))
                .collect()
        })
        .unwrap_or_default()
}

fn point(v: Option<&Value>) -> Result<[f64; 2], JsError> {
    let p: [f64; 2] = serde_json::from_value(v.cloned().unwrap_or(Value::Null))
        .map_err(|_| js("expected a [lon, lat] point"))?;
    if p.iter().all(|x| x.is_finite()) {
        Ok(p)
    } else {
        Err(js("expected a finite [lon, lat] point"))
    }
}

/// The bike network of the loaded streets, for routes there and back.
#[wasm_bindgen]
#[derive(Default)]
pub struct CargoBikeRouter {
    osm: OsmData,
    setups: Vec<StreetSetup>,
    graph: BikeGraph,
}

#[wasm_bindgen]
impl CargoBikeRouter {
    /// Purpose: an empty router.
    #[wasm_bindgen(constructor)]
    pub fn new() -> CargoBikeRouter {
        CargoBikeRouter::default()
    }

    /// Purpose: add one walk tile (OSM XML). Call [`CargoBikeRouter::build`] after the last one.
    pub fn add_osm(&mut self, osm_xml: &str) -> Result<(), JsError> {
        self.osm.merge(parse_osm_xml(osm_xml).map_err(js)?);
        Ok(())
    }

    /// Purpose: the planner's street setups from the GIS tab (JSON array), applied on build.
    pub fn set_street_setups(&mut self, json: &str) -> Result<(), JsError> {
        self.setups = serde_json::from_str(json).map_err(js)?;
        Ok(())
    }

    /// Purpose: build the bike network from the tiles and setups. Output: the number of nodes.
    pub fn build(&mut self) -> usize {
        let mut data = self.osm.clone();
        apply_setups(&mut data, &self.setups);
        self.graph = BikeGraph::from_osm(&data);
        self.graph.len()
    }

    /// Purpose: the routes there and back.
    /// Input: `{from: [lon, lat], to: [lon, lat], values?: {key: number}}`.
    /// Output: `{go: Route | null, back: Route | null, snap_m: [from, to]}`; a route is null when the
    /// destination cannot be reached by bike on the loaded streets.
    pub fn route(&self, request_json: &str) -> Result<String, JsError> {
        let req = parse(request_json)?;
        let from = point(req.get("from"))?;
        let to = point(req.get("to"))?;
        let bike = Bike::from_values(&Values::new(&values(&req)));
        let (Some((a, da)), Some((b, db))) = (self.graph.nearest(from), self.graph.nearest(to))
        else {
            return Err(js("no streets a bike may ride were loaded"));
        };
        let go = self.graph.route(a, b, &bike);
        let back = self.graph.route(b, a, &bike);
        Ok(json!({ "go": go, "back": back, "snap_m": [da, db] }).to_string())
    }
}

#[derive(serde::Deserialize)]
struct LegIn {
    route: Route,
    profile: Profile,
}

/// Purpose: ride a round trip.
/// Input: `{go: {route, profile}, back: {route, profile}, values?}` where a profile is
/// `[[distance m, height m | null], …]` along the route. Output: the `Trip` (crates/cargo-bike `trip`).
#[wasm_bindgen]
pub fn trip(request_json: &str) -> Result<String, JsError> {
    let req = parse(request_json)?;
    let bike = Bike::from_values(&Values::new(&values(&req)));
    let leg = |k: &str| -> Result<LegIn, JsError> {
        serde_json::from_value(req.get(k).cloned().unwrap_or(Value::Null)).map_err(js)
    };
    let (go, back) = (leg("go")?, leg("back")?);
    let t = round_trip(
        ride_route(&go.route, &go.profile, &bike),
        ride_route(&back.route, &back.profile, &bike),
        &bike,
    );
    serde_json::to_string(&t).map_err(js)
}

/// Purpose: the range map: how far the bike gets out and back along each bearing.
/// Input: `{origin: [lon, lat], rays: [{bearing_deg, end, profile}], values?}`.
/// Output: `{reach: [{bearing_deg, straight_m, street_m, at, beyond}], usable_wh}`.
#[wasm_bindgen]
pub fn range_map(request_json: &str) -> Result<String, JsError> {
    let req = parse(request_json)?;
    let origin = point(req.get("origin"))?;
    let rays: Vec<Ray> =
        serde_json::from_value(req.get("rays").cloned().unwrap_or(Value::Null)).map_err(js)?;
    let bike = Bike::from_values(&Values::new(&values(&req)));
    Ok(json!({ "reach": reach(origin, &rays, &bike), "usable_wh": bike.usable_wh }).to_string())
}

/// Purpose: the savings table.
/// Input: `{round_trip_km, wh_per_km, values?, conversion?: {fx, ppp}}`. Output: the `Savings`.
#[wasm_bindgen]
pub fn savings(request_json: &str) -> Result<String, JsError> {
    let req = parse(request_json)?;
    let num = |k: &str| req.get(k).and_then(Value::as_f64).unwrap_or(0.0);
    let conv: Conversion = req
        .get("conversion")
        .cloned()
        .map(serde_json::from_value)
        .transpose()
        .map_err(js)?
        .unwrap_or_default();
    let s = savings_table(num("round_trip_km"), num("wh_per_km"), &values(&req), conv);
    serde_json::to_string(&s).map_err(js)
}

/// Purpose: the plugin's parameters with label, unit, low, central and high (keys without the prefix).
#[wasm_bindgen]
pub fn defaults() -> String {
    let m: serde_json::Map<String, Value> = plugin_defaults()
        .iter()
        .map(|(k, d)| {
            (
                k.clone(),
                json!({"label": d.label, "unit": d.unit, "low": d.low, "central": d.central, "high": d.high}),
            )
        })
        .collect();
    Value::Object(m).to_string()
}
