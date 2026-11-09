//! WebAssembly bindings of the noise estimate (ADR-0038) for the noise plugin's `noise_estimate`
//! calculation, shown live in the street line tool and the railway editor.
//!
//! The editor sends the drawn lines in longitude and latitude ([`NoiseEstimator::estimate`]); the
//! engine projects them to local metres, runs `noise::estimate` and returns the band distances
//! and checks with positions back in longitude and latitude. The map picture of the receiver grid
//! comes from [`NoiseEstimator::image`] as RGBA pixels, north row first, for a MapLibre image
//! source at the returned corners.

use noise::{band_colour, estimate, Estimate, EstimateInput};
use serde_json::{json, Value};
use wasm_bindgen::prelude::*;

const EARTH_R: f64 = 6_371_008.8;

/// Local equirectangular projection round an origin; fine over the few kilometres of a drawing.
#[derive(Debug, Clone, Copy)]
struct Proj {
    lon0: f64,
    lat0: f64,
    kx: f64,
    ky: f64,
}

impl Proj {
    fn new(lon0: f64, lat0: f64) -> Self {
        let ky = EARTH_R * std::f64::consts::PI / 180.0;
        Self {
            lon0,
            lat0,
            kx: ky * lat0.to_radians().cos(),
            ky,
        }
    }
    fn local(&self, ll: [f64; 2]) -> [f64; 2] {
        [(ll[0] - self.lon0) * self.kx, (ll[1] - self.lat0) * self.ky]
    }
    fn lonlat(&self, p: [f64; 2]) -> [f64; 2] {
        let r = |x: f64| (x * 1e7).round() / 1e7;
        [r(self.lon0 + p[0] / self.kx), r(self.lat0 + p[1] / self.ky)]
    }
}

fn js(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}

/// Purpose: project an input given in longitude and latitude to local metres.
/// Output: the input and the projection, or `None` when it has no coordinates.
fn project(mut input: EstimateInput) -> (EstimateInput, Option<Proj>) {
    let first = input
        .lines
        .iter()
        .flat_map(|l| l.points.first())
        .chain(input.point_sources.iter().map(|p| &p.p))
        .find(|p| p[0].is_finite() && p[1].is_finite())
        .copied();
    let Some([lon0, lat0]) = first else {
        return (input, None);
    };
    let proj = Proj::new(lon0, lat0);
    for l in &mut input.lines {
        l.points.iter_mut().for_each(|p| *p = proj.local(*p));
    }
    for p in &mut input.point_sources {
        p.p = proj.local(p.p);
    }
    for b in &mut input.buildings {
        b.ring.iter_mut().for_each(|p| *p = proj.local(*p));
    }
    (input, Some(proj))
}

/// Purpose: the estimate as JSON with positions in longitude and latitude.
fn to_json(e: &Estimate, proj: Option<Proj>) -> Value {
    let ll = |p: Option<[f64; 2]>| p.zip(proj).map(|(p, pr)| pr.lonlat(p));
    let band = |b: &noise::estimate::Band| {
        json!({"threshold_db": b.threshold_db, "typical_m": b.typical_m, "max_m": b.max_m,
               "max_at": ll(b.max_at), "probes": b.probes})
    };
    let image = e.grid.as_ref().zip(proj).map(|(g, pr)| {
        let (x1, y1) = (g.x0 + g.nx as f64 * g.cell, g.y0 + g.ny as f64 * g.cell);
        json!({"width": g.nx, "height": g.ny, "cell_m": g.cell,
               "coordinates": [pr.lonlat([g.x0, y1]), pr.lonlat([x1, y1]), pr.lonlat([x1, g.y0]), pr.lonlat([g.x0, g.y0])]})
    });
    json!({
        "lden": band(&e.lden),
        "lnight": band(&e.lnight),
        "checks": e.checks.iter().map(|c| json!({"severity": c.severity, "text": c.text, "at": ll(c.at), "line": c.line})).collect::<Vec<_>>(),
        "image": image,
        "buildings": exposure(&e.building_levels),
        "building_levels": e.building_levels.iter().map(|l| l.map(|x| if x.is_finite() { Some((x * 10.0).round() / 10.0) } else { None })).collect::<Vec<_>>(),
        "input_level": e.input_level,
    })
}

/// Reporting bands of the Environmental Noise Directive (Annex VI): lower edges, dB.
const LDEN_BANDS: [f64; 5] = [55.0, 60.0, 65.0, 70.0, 75.0];
const LNIGHT_BANDS: [f64; 5] = [50.0, 55.0, 60.0, 65.0, 70.0];

/// Purpose: buildings counted by the band of their most exposed side, as the Directive reports
/// dwellings; `null` without buildings.
fn exposure(levels: &[[f32; 2]]) -> Value {
    if levels.is_empty() {
        return Value::Null;
    }
    let count = |k: usize, edges: &[f64; 5]| -> Vec<usize> {
        let mut out = vec![0usize; edges.len()];
        for l in levels {
            let v = l[k] as f64;
            if let Some(i) = edges.iter().rposition(|&e| v >= e) {
                out[i] += 1;
            }
        }
        out
    };
    json!({
        "count": levels.len(),
        "reached": levels.iter().filter(|l| l[0].is_finite()).count(),
        "lden": {"from_db": LDEN_BANDS, "buildings": count(0, &LDEN_BANDS)},
        "lnight": {"from_db": LNIGHT_BANDS, "buildings": count(1, &LNIGHT_BANDS)},
    })
}

/// Noise engine: keeps the last estimate for the map picture.
#[wasm_bindgen]
pub struct NoiseEstimator {
    last: Option<Estimate>,
}

impl Default for NoiseEstimator {
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen]
impl NoiseEstimator {
    /// Purpose: an engine with no estimate yet.
    #[wasm_bindgen(constructor)]
    pub fn new() -> NoiseEstimator {
        Self { last: None }
    }

    /// Purpose: estimate the noise of the drawn lines.
    /// Inputs: `noise::EstimateInput` as JSON with `points` and point source `p` in
    /// `[lon, lat]`. Output: JSON `{lden, lnight, checks, image, input_level}` (see `to_json`).
    /// Side effects: keeps the result for [`NoiseEstimator::image`].
    pub fn estimate(&mut self, input: &str) -> Result<String, JsError> {
        let input: EstimateInput = serde_json::from_str(input).map_err(js)?;
        let (input, proj) = project(input);
        let e = estimate(&input);
        let out = to_json(&e, proj).to_string();
        self.last = Some(e);
        Ok(out)
    }

    /// Purpose: the map picture of the last estimate as RGBA pixels, north row first.
    /// Inputs: `"lden"` or `"lnight"`, the level the colours start at (dB) and the opacity 0–255
    /// of coloured pixels. Output: width × height × 4 bytes, empty without a grid.
    pub fn image(&self, indicator: &str, from_db: f64, alpha: u8) -> Vec<u8> {
        let Some(g) = self.last.as_ref().and_then(|e| e.grid.as_ref()) else {
            return Vec::new();
        };
        let values = if indicator == "lnight" {
            &g.lnight
        } else {
            &g.lden
        };
        let mut out = vec![0u8; g.nx * g.ny * 4];
        for row in 0..g.ny {
            let j = g.ny - 1 - row;
            for i in 0..g.nx {
                if let Some([r, gg, b]) = band_colour(values[j * g.nx + i] as f64, from_db) {
                    let k = (row * g.nx + i) * 4;
                    out[k..k + 4].copy_from_slice(&[r, gg, b, alpha]);
                }
            }
        }
        out
    }

    /// Purpose: the engine's default parameter values (`noise.*` → `[low, central, high]` per
    /// mode) as JSON, for the panel.
    pub fn defaults() -> String {
        include_str!("../../noise/data/defaults.json").to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn estimates_in_lon_lat() {
        let input = json!({"lines": [{"id": "a", "mode": "tram", "vehicle_length_m": 30,
            "flows": {"day": 24, "evening": 16, "night": 4}, "speed_kmh": 40,
            "points": [[4.35, 50.85], [4.365, 50.85]]}]});
        let mut n = NoiseEstimator::new();
        let v: Value = serde_json::from_str(&n.estimate(&input.to_string()).unwrap()).unwrap();
        assert!(v["lden"]["typical_m"][1].as_f64().unwrap() > 5.0, "{v}");
        let img = &v["image"];
        let (w, h) = (
            img["width"].as_u64().unwrap() as usize,
            img["height"].as_u64().unwrap() as usize,
        );
        let px = n.image("lden", 55.0, 160);
        assert_eq!(px.len(), w * h * 4);
        assert!(px.chunks(4).any(|p| p[3] == 160));
        // The picture's west edge is west of the line.
        assert!(img["coordinates"][0][0].as_f64().unwrap() < 4.35);
        assert!(NoiseEstimator::defaults().contains("noise.rail_track_transfer"));
        assert!(v["buildings"].is_null());
    }

    #[test]
    fn counts_buildings_by_band() {
        // A house 20 m north of a busy tram line, 4 m square.
        let (lat, dlat) = (50.85, 20.0 / 111_195.0);
        let house = |dy: f64| {
            let y = lat + dy * dlat;
            json!({"ring": [[4.357, y], [4.35706, y], [4.35706, y + 0.2 * dlat], [4.357, y + 0.2 * dlat]], "height_m": 8})
        };
        let input = json!({"lines": [{"id": "a", "mode": "tram", "vehicle_length_m": 30,
            "flows": {"day": 30, "evening": 20, "night": 6}, "speed_kmh": 50,
            "points": [[4.35, lat], [4.365, lat]]}],
            "grid_reach_m": 200, "buildings": [house(1.0), house(30.0)]});
        let mut n = NoiseEstimator::new();
        let v: Value = serde_json::from_str(&n.estimate(&input.to_string()).unwrap()).unwrap();
        let b = &v["buildings"];
        assert_eq!(b["count"], 2, "{b}");
        let total: u64 = b["lden"]["buildings"]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| x.as_u64().unwrap())
            .sum();
        assert_eq!(total, 1, "only the near house is at 55 dB or more: {b}");
    }
}
