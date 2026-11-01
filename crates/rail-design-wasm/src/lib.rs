//! WebAssembly bindings of `rail-design` for the railway editor.
//!
//! The editor keeps the design document (stations, tracks, switches) and sends it after every
//! edit to [`RailDesigner::build`], which returns the map layers, edit handles, summaries and
//! checks as JSON (see `rail_design::view`). Geometry runs in the browser, so dragging a point
//! refits the curves at once, with the same code the simulation will use.

use rail_design::geom::{nearest, P2};
use rail_design::proj::LocalTm;
use rail_design::{build, Design, Network, RailMode};
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
        Self { design: None }
    }

    /// Purpose: build the design from the document (JSON) and return the view (JSON).
    /// `draft` is the id of a track still being drawn (0 for none).
    pub fn build(&mut self, doc: &str, draft: u32) -> Result<String, JsError> {
        let net: Network = serde_json::from_str(doc).map_err(js)?;
        let d = build(&net, (draft != 0).then_some(draft));
        let v = rail_design::view::view(&d);
        self.design = Some(d);
        Ok(v.to_string())
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
