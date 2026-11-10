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
    // The terrain grid comes in degrees; the projection is linear in each, so it stays a grid.
    if let Some(t) = &mut input.terrain {
        let [x0, y0] = proj.local([t.x0, t.y0]);
        (t.x0, t.y0, t.dx, t.dy) = (x0, y0, t.dx * proj.kx, t.dy * proj.ky);
    }
    // So does the population grid.
    if let Some(g) = &mut input.population {
        let [x0, y0] = proj.local([g.x0, g.y0]);
        (g.x0, g.y0, g.dx, g.dy) = (x0, y0, g.dx * proj.kx, g.dy * proj.ky);
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
        "buildings": exposure(&e.building_levels, e.residents.as_ref()),
        "building_levels": e.building_levels.iter().map(|l| l.map(|x| if x.is_finite() { Some((x * 10.0).round() / 10.0) } else { None })).collect::<Vec<_>>(),
        "input_level": e.input_level,
        "terrain": e.terrain,
    })
}

/// Reporting bands of the Environmental Noise Directive (Annex VI): lower edges, dB.
const LDEN_BANDS: [f64; 5] = [55.0, 60.0, 65.0, 70.0, 75.0];
const LNIGHT_BANDS: [f64; 5] = [50.0, 55.0, 60.0, 65.0, 70.0];

/// Purpose: buildings, and the people living in them, counted by the band of their most exposed
/// side, as the Directive reports dwellings and people; `null` without buildings.
fn exposure(levels: &[[f32; 2]], residents: Option<&noise::Residents>) -> Value {
    if levels.is_empty() {
        return Value::Null;
    }
    let people = |i: usize| {
        residents
            .and_then(|r| r.people.get(i))
            .copied()
            .unwrap_or(0.0)
    };
    let count = |k: usize, edges: &[f64; 5], weight: &dyn Fn(usize) -> f64| -> Vec<f64> {
        let mut out = vec![0.0; edges.len()];
        for (b, l) in levels.iter().enumerate() {
            let v = l[k] as f64;
            if let Some(i) = edges.iter().rposition(|&e| v >= e) {
                out[i] += weight(b);
            }
        }
        out
    };
    let one = |_: usize| 1.0;
    // People are reported rounded to the nearest whole person, as the Directive's tables are.
    let round = |v: Vec<f64>| v.into_iter().map(|x| x.round()).collect::<Vec<_>>();
    let whole = |v: Vec<f64>| v.into_iter().map(|x| x as usize).collect::<Vec<_>>();
    let reached = |w: &dyn Fn(usize) -> f64| -> f64 {
        (0..levels.len())
            .filter(|&b| levels[b][0].is_finite())
            .map(w)
            .sum()
    };
    let total: f64 = (0..levels.len()).map(people).sum();
    json!({
        "count": levels.len(),
        "reached": reached(&one) as usize,
        "lden": {"from_db": LDEN_BANDS, "buildings": whole(count(0, &LDEN_BANDS, &one)),
                 "people": round(count(0, &LDEN_BANDS, &people))},
        "lnight": {"from_db": LNIGHT_BANDS, "buildings": whole(count(1, &LNIGHT_BANDS, &one)),
                   "people": round(count(1, &LNIGHT_BANDS, &people))},
        "people": residents.map(|r| json!({
            "source": r.source,
            "total": total.round(),
            "reached": reached(&people).round(),
            "unplaced": r.unplaced.round(),
        })),
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
    /// Inputs: `noise::EstimateInput` as JSON with `points`, point source `p` and building rings in
    /// `[lon, lat]`, and the terrain grid's corner (`x0` longitude, `y0` latitude) and spacing
    /// (`dx`, `dy`) in degrees. Output: JSON `{lden, lnight, checks, image, input_level}` (see `to_json`).
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
    fn terrain_in_degrees_screens_the_map() {
        // A 10 m high ridge 50 to 130 m north of a tram line, in a 0.0002° grid.
        let (lat, dlat) = (50.85, 1.0 / 111_195.0);
        let (nx, ny) = (80, 40);
        let z: Vec<f64> = (0..ny)
            .flat_map(|j| {
                let y = -50.0 + j as f64 * 0.0002 / dlat;
                (0..nx).map(move |_| {
                    if (50.0..=130.0).contains(&y) {
                        10.0
                    } else {
                        0.0
                    }
                })
            })
            .collect();
        let line = json!({"id": "a", "mode": "tram", "vehicle_length_m": 30,
            "flows": {"day": 24, "evening": 16, "night": 4}, "speed_kmh": 40,
            "points": [[4.35, lat], [4.358, lat]]});
        let terrain = json!({"x0": 4.349, "y0": lat - 50.0 * dlat, "dx": 0.0002, "dy": 0.0002,
            "nx": nx, "ny": ny, "z": z});
        // A house 160 m north, behind the ridge.
        let y = lat + 160.0 * dlat;
        let house = json!({"ring": [[4.354, y], [4.35406, y], [4.35406, y + 4.0 * dlat], [4.354, y + 4.0 * dlat]], "height_m": 8});
        let mut n = NoiseEstimator::new();
        let mut run = |t: Value| -> Value {
            let input = json!({"lines": [line.clone()], "grid_reach_m": 250, "terrain": t,
                "buildings": [house.clone()]});
            serde_json::from_str(&n.estimate(&input.to_string()).unwrap()).unwrap()
        };
        let flat = run(Value::Null);
        let hilly = run(terrain);
        assert_eq!(flat["terrain"], false);
        assert_eq!(hilly["terrain"], true);
        let level = |v: &Value| v["building_levels"][0][0].as_f64().unwrap();
        assert!(
            level(&flat) - level(&hilly) > 5.0,
            "{} {}",
            level(&flat),
            level(&hilly)
        );
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

    #[test]
    fn counts_people_from_a_population_grid_in_degrees() {
        // The near house of `counts_buildings_by_band` in a cell of 12 people, the far one
        // alone in the next cell north with 5 (cells 3 arc seconds wide, 600 m tall).
        let (lat, dlat) = (50.85, 20.0 / 111_195.0);
        let house = |dy: f64| {
            let y = lat + dy * dlat;
            json!({"ring": [[4.357, y], [4.3572, y], [4.3572, y + 0.5 * dlat], [4.357, y + 0.5 * dlat]], "height_m": 8})
        };
        let d = 1.0 / 1200.0;
        let lines = json!([{"id": "a", "mode": "tram", "vehicle_length_m": 30,
            "flows": {"day": 30, "evening": 20, "night": 6}, "speed_kmh": 50,
            "points": [[4.35, lat], [4.365, lat]]}]);
        let grid = json!({"x0": 4.3565, "y0": lat, "dx": d, "dy": 30.0 * dlat, "nx": 1, "ny": 2,
            "people": [12.0, 5.0]});
        let mut n = NoiseEstimator::new();
        let mut run = |population: Value| -> Value {
            let input = json!({"lines": lines, "grid_reach_m": 200,
                "buildings": [house(1.0), house(30.0)], "population": population});
            serde_json::from_str(&n.estimate(&input.to_string()).unwrap()).unwrap()
        };
        let v = run(grid);
        let b = &v["buildings"];
        assert_eq!(b["people"]["source"], "grid", "{b}");
        assert_eq!(b["people"]["total"], 17.0, "{b}");
        let people: f64 = b["lden"]["people"]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| x.as_f64().unwrap())
            .sum();
        assert_eq!(people, 12.0, "only the near house is at 55 dB or more: {b}");
        // Without the grid: the building size (two houses 14 m × 10 m, 3 storeys, 55 m² a person).
        let v = run(Value::Null);
        assert_eq!(v["buildings"]["people"]["source"], "building_size");
        let total = v["buildings"]["people"]["total"].as_f64().unwrap();
        assert!((14.0..=16.0).contains(&total), "{total}");
    }
}
