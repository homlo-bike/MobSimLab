//! The editors' quick estimate (ADR-0038 §1, step N1): line sources from the drawn lines,
//! free-field propagation, L_den and L_night, the band distances either side of the lines, a
//! receiver grid for the map, and checks for the side panel.
//!
//! All coordinates are local metres (x east, y north). Flows are vehicles (buses or trains) per
//! hour on the drawn line, per period.

use crate::emission::{pow10, road_vehicle_lw, RoadCategory};
use crate::ground::TerrainInput;
use crate::params::{Library, Mode, Variant, BANDS_HZ, NB, VARIANTS};
use crate::propagation::{absorption, ground, Propagation};
use crate::rail::{
    dipole, train_power, vertical_a_db, vertical_b_aero_db, RailSource, TrackState, TrainPower,
};
use crate::screening::{
    barrier_db, lateral_db, lateral_db_63, BuildingInput, HeightRule, Lateral, Obstacles,
    RayScratch, LATERAL_MAX_BUILDINGS,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Longest source element, m.
const ELEMENT_M: f64 = 10.0;
/// Spacing of the band probes along a line, m.
const PROBE_STEP_M: f64 = 20.0;
/// Distance from which paired elements stand for their two halves on the screened map, m.
const PAIR_FROM_M: f64 = 80.0;
/// Most grid cells computed for the map picture.
const MAX_GRID_CELLS: f64 = 40_000.0;
/// Lateral paths are looked for until those left could add at most this share of the energy.
const LATERAL_TOLERANCE: f64 = 0.01;
/// Half chord used to measure a curve radius, m.
const RADIUS_HALF_CHORD_M: f64 = 15.0;

/// Vehicles per hour in each period.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq)]
pub struct Flows {
    /// Day (07–19 by default).
    pub day: f64,
    /// Evening (19–23).
    pub evening: f64,
    /// Night (23–07), the average over the period.
    pub night: f64,
}

/// What applies along part of a line.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RangeKind {
    /// Underground: no emission at the surface.
    Underground,
    /// On a bridge or viaduct: bridge correction, source raised by `height_m`.
    Bridge,
    /// Tram track embedded in paving.
    Embedded,
    /// A switch or crossing: impact noise.
    Switch,
}

/// A stretch of a line by chainage.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Range {
    /// Start, m along the line.
    pub from_m: f64,
    /// End, m.
    pub to_m: f64,
    /// What applies.
    pub kind: RangeKind,
    /// Height of the track or road above ground, m (bridges).
    #[serde(default)]
    pub height_m: f64,
}

/// One drawn line (a street line leg, a railway track).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LineInput {
    /// Id the checks refer to.
    pub id: String,
    /// Name used in the checks ("" for none).
    #[serde(default)]
    pub label: String,
    /// Mode.
    pub mode: Mode,
    /// Electric road vehicle (battery bus); trolleybuses are always electric.
    #[serde(default)]
    pub electric: bool,
    /// Vehicle or train length, m.
    pub vehicle_length_m: f64,
    /// Vehicles per hour on this line.
    pub flows: Flows,
    /// Centre line, local metres.
    pub points: Vec<[f64; 2]>,
    /// Speed profile `[chainage m, km/h]`, piecewise linear; empty uses `speed_kmh`.
    #[serde(default)]
    pub speed: Vec<[f64; 2]>,
    /// Constant speed when there is no profile, km/h.
    #[serde(default)]
    pub speed_kmh: Option<f64>,
    /// Stretches with corrections.
    #[serde(default)]
    pub ranges: Vec<Range>,
    /// Stops (road modes: acceleration zones), m along the line.
    #[serde(default)]
    pub stops_m: Vec<f64>,
}

/// A fixed source of known A-weighted sound power (cable car tower or station, ferry berth).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PointSourceInput {
    /// Id.
    pub id: String,
    /// Name.
    #[serde(default)]
    pub label: String,
    /// Position, local metres.
    pub p: [f64; 2],
    /// Height above ground, m.
    #[serde(default)]
    pub height_m: f64,
    /// Sound power while operating, dB(A).
    pub lw_dba: f64,
    /// Share of each period it operates, 0–1.
    pub active: Flows,
}

/// What the estimate is for.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EstimateInput {
    /// Line sources.
    pub lines: Vec<LineInput>,
    /// Point sources.
    #[serde(default)]
    pub point_sources: Vec<PointSourceInput>,
    /// Compute the receiver grid for the map picture.
    #[serde(default = "yes")]
    pub grid: bool,
    /// Project preference overrides, `noise.*` key → value.
    #[serde(default)]
    pub overrides: HashMap<String, f64>,
    /// How far the map grid reaches from the sources, m (clamped to the largest source
    /// distance); `None` follows the band edges, as the editors do.
    #[serde(default)]
    pub grid_reach_m: Option<f64>,
    /// Buildings that screen the map grid (step N2). The band distances stay free field.
    #[serde(default)]
    pub buildings: Vec<BuildingInput>,
    /// Ground heights for the map (step N2): sources, receivers and buildings stand on them and
    /// the ground can screen. `None` is flat ground.
    #[serde(default)]
    pub terrain: Option<TerrainInput>,
}

fn yes() -> bool {
    true
}

/// Severity of a check, as in the editors' Checks list.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    /// Worth a look.
    Warning,
    /// For information.
    Info,
}

/// A line in the Checks list.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Check {
    /// Severity.
    pub severity: Severity,
    /// Text.
    pub text: String,
    /// Where, local metres.
    pub at: Option<[f64; 2]>,
    /// Line id.
    pub line: Option<String>,
}

/// The band distance for one indicator.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Band {
    /// Level at the band edge, dB.
    pub threshold_db: f64,
    /// Typical (median) distance either side of the lines, m, at the low, central and high end
    /// of the assumption ranges.
    pub typical_m: [f64; 3],
    /// Widest distance (central, 95th percentile of the probes), m.
    pub max_m: f64,
    /// Where it is widest: the point at the band edge.
    pub max_at: Option<[f64; 2]>,
    /// Probes along the lines.
    pub probes: usize,
}

/// Receiver grid at the receiver height, cell centres from `(x0, y0)` east and north.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Grid {
    /// West edge, m.
    pub x0: f64,
    /// South edge, m.
    pub y0: f64,
    /// Cell size, m.
    pub cell: f64,
    /// Columns.
    pub nx: usize,
    /// Rows, south to north.
    pub ny: usize,
    /// L_den per cell (row-major from the south-west), NaN outside the computed corridor.
    pub lden: Vec<f32>,
    /// L_night per cell.
    pub lnight: Vec<f32>,
}

/// The result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Estimate {
    /// L_den band.
    pub lden: Band,
    /// L_night band.
    pub lnight: Band,
    /// Checks, warnings first.
    pub checks: Vec<Check>,
    /// The map picture, when asked for.
    pub grid: Option<Grid>,
    /// Highest L_den and L_night in the grid cells next to each input building (NaN where the
    /// grid does not reach it or the building was dropped), by input index.
    pub building_levels: Vec<[f32; 2]>,
    /// Level of detail of the inputs (ADR-0038 §4).
    pub input_level: &'static str,
    /// Whether terrain heights shaped the map (a flat or empty grid does not).
    pub terrain: bool,
}

/// Period lengths and penalties.
#[derive(Debug, Clone, Copy)]
struct Periods {
    hours: [f64; 3],
    w_evening: f64,
    w_night: f64,
}

impl Periods {
    fn new(lib: &Library) -> Self {
        let d0 = lib.central("noise.day_start_h");
        let e0 = lib.central("noise.evening_start_h");
        let n0 = lib.central("noise.night_start_h");
        let day = (e0 - d0).max(0.0);
        let evening = (n0 - e0).max(0.0);
        Self {
            hours: [day, evening, (24.0 - day - evening).max(0.0)],
            w_evening: pow10(lib.central("noise.evening_penalty_db")),
            w_night: pow10(lib.central("noise.night_penalty_db")),
        }
    }

    /// L_den energy from period energies.
    fn den(&self, e: [f64; 3]) -> f64 {
        (self.hours[0] * e[0]
            + self.hours[1] * e[1] * self.w_evening
            + self.hours[2] * e[2] * self.w_night)
            / 24.0
    }
}

fn level(e: f64) -> f64 {
    if e > 0.0 {
        10.0 * e.log10()
    } else {
        f64::NEG_INFINITY
    }
}

/// Vertical directivity of a source class (CNOSSOS-EU railway, 2.3.16 and 2.3.17).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Vertical {
    /// Omnidirectional in the vertical plane.
    None,
    /// Railway source A.
    RailA,
    /// Railway aerodynamic source B.
    AeroB,
}

/// A source element: a short piece of line, or a point source.
#[derive(Debug, Clone)]
struct Element {
    p: [f64; 2],
    /// Direction of travel (unit vector) for the horizontal dipole, or `None` for
    /// omnidirectional sources.
    dipole: Option<[f64; 2]>,
    /// Index into the transfer tables (source height and vertical directivity).
    table: usize,
    /// Source height above ground, m.
    h: f64,
    /// Source height above the datum (ground + `h`), m; set once the ground is known.
    z: f64,
    /// Line index, or `lines + point index`.
    owner: usize,
    /// Band power for one vehicle per hour (lines) or full operation (points), per variant.
    power: [[f64; NB]; 3],
}

/// Transfer factors tabulated against log distance for one source height.
struct TransferTable {
    ln_min: f64,
    step: f64,
    rows: Vec<[f64; NB]>,
    /// Ground attenuation A_gr per band, dB (the barrier term replaces it when screened).
    ground: Vec<[f64; NB]>,
}

impl TransferTable {
    fn new(prop: &Propagation, hs: f64, vert: Vertical, hr: f64, max_d: f64) -> Self {
        let (min, n) = (0.5f64, 240usize);
        let ln_min = min.ln();
        let step = ((max_d * 1.01).ln() - ln_min) / (n - 1) as f64;
        let d = |i: usize| (ln_min + step * i as f64).exp();
        let rows = (0..n)
            .map(|i| {
                let mut t = prop.transfer(d(i), hs, hr);
                // Elevation of the receiver seen from the source, positive upwards.
                let psi = (hr - hs).atan2(d(i));
                for (b, x) in t.iter_mut().enumerate() {
                    *x *= pow10(match vert {
                        Vertical::None => 0.0,
                        Vertical::RailA => vertical_a_db(psi, BANDS_HZ[b]),
                        Vertical::AeroB => vertical_b_aero_db(psi),
                    });
                }
                t
            })
            .collect();
        let ground = (0..n)
            .map(|i| ground(d(i).max(0.5), hs, hr, prop.g))
            .collect();
        Self {
            ln_min,
            step,
            rows,
            ground,
        }
    }

    fn index(&self, d: f64) -> usize {
        let f = ((d.max(0.5).ln() - self.ln_min) / self.step).round() as usize;
        f.min(self.rows.len() - 1)
    }

    fn at(&self, d: f64) -> &[f64; NB] {
        &self.rows[self.index(d)]
    }
}

/// Elements bucketed on a square grid.
struct Buckets {
    cell: f64,
    map: HashMap<(i64, i64), Vec<usize>>,
}

impl Buckets {
    fn new(els: &[Element], cell: f64) -> Self {
        let mut map: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
        for (i, e) in els.iter().enumerate() {
            map.entry((
                (e.p[0] / cell).floor() as i64,
                (e.p[1] / cell).floor() as i64,
            ))
            .or_default()
            .push(i);
        }
        Self { cell, map }
    }

    fn near(&self, p: [f64; 2], r: f64, mut f: impl FnMut(usize)) {
        let (i0, i1) = (
            ((p[0] - r) / self.cell).floor() as i64,
            ((p[0] + r) / self.cell).floor() as i64,
        );
        let (j0, j1) = (
            ((p[1] - r) / self.cell).floor() as i64,
            ((p[1] + r) / self.cell).floor() as i64,
        );
        for i in i0..=i1 {
            for j in j0..=j1 {
                if let Some(v) = self.map.get(&(i, j)) {
                    v.iter().for_each(|&k| f(k));
                }
            }
        }
    }
}

/// A polyline with chainage.
struct Path {
    pts: Vec<[f64; 2]>,
    cum: Vec<f64>,
}

impl Path {
    fn new(points: &[[f64; 2]]) -> Self {
        let mut pts: Vec<[f64; 2]> = Vec::with_capacity(points.len());
        let mut cum = Vec::with_capacity(points.len());
        for &p in points {
            if !p[0].is_finite() || !p[1].is_finite() {
                continue;
            }
            match pts.last() {
                Some(&q) if dist(p, q) < 1e-6 => continue,
                Some(&q) => cum.push(cum.last().copied().unwrap_or(0.0) + dist(p, q)),
                None => cum.push(0.0),
            }
            pts.push(p);
        }
        Self { pts, cum }
    }

    fn length(&self) -> f64 {
        self.cum.last().copied().unwrap_or(0.0)
    }

    /// Point and unit direction at chainage `s`.
    fn at(&self, s: f64) -> ([f64; 2], [f64; 2]) {
        let s = s.clamp(0.0, self.length());
        let i = self
            .cum
            .partition_point(|&c| c < s)
            .clamp(1, self.pts.len() - 1);
        let (a, b) = (self.pts[i - 1], self.pts[i]);
        let span = (self.cum[i] - self.cum[i - 1]).max(1e-9);
        let f = (s - self.cum[i - 1]) / span;
        let dir = [(b[0] - a[0]) / span, (b[1] - a[1]) / span];
        ([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], dir)
    }

    /// Curve radius at `s` from a chord either side; infinite on a straight or near the ends.
    fn radius(&self, s: f64) -> f64 {
        let h = RADIUS_HALF_CHORD_M;
        if s - h < 0.0 || s + h > self.length() {
            return f64::INFINITY;
        }
        let (a, _) = self.at(s - h);
        let (b, _) = self.at(s);
        let (c, _) = self.at(s + h);
        let cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        if cross.abs() < 1e-9 {
            return f64::INFINITY;
        }
        dist(a, b) * dist(b, c) * dist(c, a) / (2.0 * cross.abs())
    }
}

fn dist(a: [f64; 2], b: [f64; 2]) -> f64 {
    (a[0] - b[0]).hypot(a[1] - b[1])
}

fn interp(profile: &[[f64; 2]], s: f64) -> f64 {
    let i = profile.partition_point(|q| q[0] < s);
    if i == 0 {
        return profile[0][1];
    }
    if i >= profile.len() {
        return profile[profile.len() - 1][1];
    }
    let (a, b) = (profile[i - 1], profile[i]);
    let span = b[0] - a[0];
    if span <= 0.0 {
        b[1]
    } else {
        a[1] + (b[1] - a[1]) * (s - a[0]) / span
    }
}

/// Squeal class of a curve.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Squeal {
    None,
    R500,
    R300,
    Tram200,
}

/// What one element of a line carries, before power.
#[derive(Debug, Clone)]
struct Piece {
    s: f64,
    len: f64,
    p: [f64; 2],
    /// Direction of the line, unit vector.
    dir: [f64; 2],
    v: f64,
    height: f64,
    underground: bool,
    bridge: bool,
    embedded: bool,
    /// Within a switch or crossing range (rail: extended by the impact extent either side).
    switch: bool,
    radius: f64,
    squeal: Squeal,
    stop_dist: f64,
}

fn pieces(line: &LineInput, path: &Path, lib: &Library) -> Vec<Piece> {
    let len = path.length();
    let n = (len / ELEMENT_M).ceil().max(1.0) as usize;
    let dl = len / n as f64;
    let v_default = line.speed_kmh.unwrap_or(30.0);
    let impact_ext = if line.mode.is_road() {
        0.0
    } else {
        lib.central("noise.rail_impact_extent_m").max(0.0)
    };
    let mut out: Vec<Piece> = (0..n)
        .map(|i| {
            let s = (i as f64 + 0.5) * dl;
            let (p, dir) = path.at(s);
            let in_range = |k: RangeKind| {
                let ext = if k == RangeKind::Switch {
                    impact_ext
                } else {
                    0.0
                };
                line.ranges
                    .iter()
                    .find(|r| r.kind == k && r.from_m - ext <= s && s <= r.to_m + ext)
            };
            let bridge = in_range(RangeKind::Bridge);
            Piece {
                s,
                len: dl,
                p,
                dir,
                v: if line.speed.is_empty() {
                    v_default
                } else {
                    interp(&line.speed, s)
                }
                .max(5.0),
                height: bridge.map_or(0.0, |r| r.height_m.max(0.0)),
                underground: in_range(RangeKind::Underground).is_some(),
                bridge: bridge.is_some(),
                embedded: in_range(RangeKind::Embedded).is_some(),
                switch: in_range(RangeKind::Switch).is_some(),
                radius: if line.mode.is_road() {
                    f64::INFINITY
                } else {
                    path.radius(s)
                },
                squeal: Squeal::None,
                stop_dist: line
                    .stops_m
                    .iter()
                    .map(|&x| (x - s).abs())
                    .fold(f64::INFINITY, f64::min),
            }
        })
        .collect();
    if !line.mode.is_road() {
        let class = |r: f64| {
            if line.mode.is_tram() {
                if r <= 200.0 {
                    Squeal::Tram200
                } else {
                    Squeal::None
                }
            } else if r <= 300.0 {
                Squeal::R300
            } else if r <= 500.0 {
                Squeal::R500
            } else {
                Squeal::None
            }
        };
        let min_len = lib.central("noise.squeal_min_length_m");
        let mut i = 0;
        while i < out.len() {
            let c = class(out[i].radius);
            let mut j = i;
            while j < out.len() && class(out[j].radius) == c {
                j += 1;
            }
            if c != Squeal::None && (j - i) as f64 * dl >= min_len - 1e-6 {
                out[i..j].iter_mut().for_each(|q| q.squeal = c);
            }
            i = j;
        }
    }
    out
}

/// Purpose: the CNOSSOS-EU track state of a rail piece: speed, squeal excess, joint density of
/// a switch (one per 100 m, Table G-4), bridge and embedded track.
fn rail_state(q: &Piece, mode: Mode, lib: &Library, var: Variant) -> TrackState {
    let m = Some(mode);
    TrackState {
        v_kmh: q.v,
        squeal_db: match q.squeal {
            Squeal::None => 0.0,
            Squeal::R300 => lib.get("noise.rail_squeal_r300_db", m, var),
            Squeal::R500 => lib.get("noise.rail_squeal_r500_db", m, var),
            Squeal::Tram200 => lib.get("noise.tram_squeal_r200_db", m, var),
        },
        joint_density: if q.switch { 0.01 } else { 0.0 },
        bridge: q.bridge,
        track_db: if q.embedded && mode.is_tram() {
            lib.get("noise.tram_embedded_track_db", m, var)
        } else {
            0.0
        },
    }
}

/// Purpose: horizontal dipole factor of an element seen from receiver `p` (1 when omni).
fn dipole_at(e: &Element, p: [f64; 2], d: f64) -> f64 {
    match e.dipole {
        None => 1.0,
        Some(u) if d > 1e-9 => {
            let r = [(p[0] - e.p[0]) / d, (p[1] - e.p[1]) / d];
            dipole(u[0] * r[1] - u[1] * r[0])
        }
        Some(_) => 1.0,
    }
}

/// Purpose: the editors' quick noise estimate.
/// Inputs: the lines and point sources (local metres), whether to compute the map grid, and
/// project overrides. Output: band distances, checks and the grid. No side effects;
/// deterministic.
pub fn estimate(input: &EstimateInput) -> Estimate {
    let mut lib = Library::builtin().clone();
    for (k, v) in &input.overrides {
        if k.starts_with("noise.") && v.is_finite() {
            lib.set(k, *v);
        }
    }
    let lib = &lib;
    let periods = Periods::new(lib);
    let prop = Propagation {
        alpha: absorption(
            lib.central("noise.air_temperature_c"),
            lib.central("noise.relative_humidity_pct"),
        ),
        g: lib.central("noise.ground_factor_default").clamp(0.0, 1.0),
    };
    let hr = lib.central("noise.receiver_height_m");
    let max_d = lib.central("noise.max_source_distance_m").max(50.0);
    let rail_ha = lib.central("noise.rail_source_height_a_m");
    let rail_hb = lib.central("noise.rail_source_height_b_m");
    let road_hs = lib.central("noise.road_source_height_m");

    let mut tables_key: Vec<(f64, Vertical)> = Vec::new();
    let mut table_of = |h: f64, v: Vertical| -> usize {
        let h = (h * 20.0).round() / 20.0;
        tables_key
            .iter()
            .position(|&x| x == (h, v))
            .unwrap_or_else(|| {
                tables_key.push((h, v));
                tables_key.len() - 1
            })
    };

    let paths: Vec<Path> = input.lines.iter().map(|l| Path::new(&l.points)).collect();
    let mut elements: Vec<Element> = Vec::new();
    let mut line_pieces: Vec<Vec<Piece>> = Vec::with_capacity(input.lines.len());
    for (li, (line, path)) in input.lines.iter().zip(&paths).enumerate() {
        if path.pts.len() < 2 || path.length() < 1.0 {
            line_pieces.push(Vec::new());
            continue;
        }
        let ps = pieces(line, path, lib);
        let road = line.mode.is_road();
        let electric = line.electric || line.mode == Mode::Trolleybus;
        let zone = lib.central("noise.road_stop_zone_m").max(1.0);
        let len_v = line.vehicle_length_m.max(1.0);
        let cat = RoadCategory::of(line.mode, len_v);
        let trains: Option<[RailSource; 3]> =
            (!road).then(|| VARIANTS.map(|var| RailSource::new(lib, line.mode, len_v, var)));
        for q in &ps {
            if q.underground {
                continue;
            }
            // Per vehicle per hour: sound power per metre is L_W + 10 lg(Q / 1000 v), formula 2.3.2.
            let k = q.len / (1000.0 * q.v);
            let Some(trains) = &trains else {
                let power: [[f64; NB]; 3] = VARIANTS.map(|var| {
                    let delta = if electric {
                        lib.get(
                            "noise.electric_road_propulsion_delta_db",
                            Some(line.mode),
                            var,
                        )
                    } else {
                        0.0
                    };
                    let accel = (1.0 - q.stop_dist / zone).max(0.0);
                    let lw = road_vehicle_lw(cat, q.v, delta, accel);
                    lw.map(|b| pow10(b) * k)
                });
                let hs = road_hs + q.height;
                elements.push(Element {
                    p: q.p,
                    dipole: None,
                    table: table_of(hs, Vertical::None),
                    h: hs,
                    z: hs,
                    owner: li,
                    power,
                });
                continue;
            };
            let tp: [TrainPower; 3] = std::array::from_fn(|v| {
                let var = VARIANTS[v];
                train_power(&trains[v], &rail_state(q, line.mode, lib, var))
            });
            for (bands, hs, vert, dir) in [
                (tp.map(|t| t.a), rail_ha, Vertical::RailA, Some(q.dir)),
                (tp.map(|t| t.a_bridge), rail_ha, Vertical::None, None),
                (tp.map(|t| t.b), rail_hb, Vertical::None, Some(q.dir)),
                (tp.map(|t| t.b_aero), rail_hb, Vertical::AeroB, Some(q.dir)),
            ] {
                if bands.iter().all(|b| b.iter().all(|&x| x <= 0.0)) {
                    continue;
                }
                let hs = hs + q.height;
                elements.push(Element {
                    p: q.p,
                    dipole: dir,
                    table: table_of(hs, vert),
                    h: hs,
                    z: hs,
                    owner: li,
                    power: bands.map(|b| b.map(|x| x * k)),
                });
            }
        }
        line_pieces.push(ps);
    }
    let n_lines = input.lines.len();
    for (pi, ps) in input.point_sources.iter().enumerate() {
        let w = pow10(ps.lw_dba);
        let flat = [w / NB as f64; NB];
        elements.push(Element {
            p: ps.p,
            dipole: None,
            table: table_of(ps.height_m.max(0.0), Vertical::None),
            h: ps.height_m.max(0.0),
            z: ps.height_m.max(0.0),
            owner: n_lines + pi,
            power: [flat; 3],
        });
    }
    // Buildings and terrain for the map grid (step N2); sources stand on the ground.
    let obstacles = Obstacles::new(
        &input.buildings,
        HeightRule {
            level_m: lib.central("noise.building_storey_height_m"),
            default_m: lib.central("noise.building_default_height_m"),
        },
        input.terrain.as_ref().filter(|_| input.grid),
        lib.central("noise.terrain_filter_window_m"),
    );
    for e in &mut elements {
        e.z = obstacles.ground_at(e.p) + e.h;
    }
    let tables: Vec<TransferTable> = tables_key
        .iter()
        .map(|&(h, v)| TransferTable::new(&prop, h, v, hr, max_d))
        .collect();
    let buckets = Buckets::new(&elements, 50.0);

    // Period flows per owner.
    let flows: Vec<[f64; 3]> =
        input
            .lines
            .iter()
            .map(|l| [l.flows.day, l.flows.evening, l.flows.night].map(|x| x.max(0.0)))
            .chain(input.point_sources.iter().map(|p| {
                [p.active.day, p.active.evening, p.active.night].map(|x| x.clamp(0.0, 1.0))
            }))
            .collect();

    // Energy per owner at a receiver, per variant (central only when `all` is false).
    let mut scratch = vec![[0.0f64; 3]; flows.len()];
    let levels = |p: [f64; 2], all: bool, scratch: &mut Vec<[f64; 3]>| -> [[f64; 2]; 3] {
        scratch.iter_mut().for_each(|x| *x = [0.0; 3]);
        buckets.near(p, max_d, |k| {
            let e = &elements[k];
            let d = dist(p, e.p);
            if d > max_d {
                return;
            }
            let t = tables[e.table].at(d);
            let dp = dipole_at(e, p, d);
            let acc = &mut scratch[e.owner];
            for (v, a) in acc.iter_mut().enumerate() {
                if !all && v != 1 {
                    continue;
                }
                *a += dp * (0..NB).map(|b| e.power[v][b] * t[b]).sum::<f64>();
            }
        });
        std::array::from_fn(|v| {
            let mut per = [0.0; 3];
            for (o, e) in scratch.iter().enumerate() {
                for k in 0..3 {
                    per[k] += flows[o][k] * e[v];
                }
            }
            [level(periods.den(per)), level(per[2])]
        })
    };

    let th_den = lib.central("noise.band_lden_db");
    let th_night = lib.central("noise.band_lnight_db");

    // Probes either side of the lines.
    let mut dists = Vec::new();
    let mut d = 1.5;
    while d <= max_d {
        dists.push(d);
        d *= 1.25;
    }
    let edge = |ls: &[f64]| -> f64 { edge_distance(&dists, ls) };
    let mut widths: [[Vec<f64>; 3]; 2] = Default::default();
    // Central band edges with their positions, for the widest point.
    let mut edges: [Vec<(f64, [f64; 2])>; 2] = Default::default();
    for (line, (path, ps)) in input.lines.iter().zip(paths.iter().zip(&line_pieces)) {
        if ps.is_empty() {
            continue;
        }
        let _ = line;
        let len = path.length();
        let n = (len / PROBE_STEP_M).ceil().max(2.0) as usize;
        for i in 0..n {
            let s = (i as f64 + 0.5) * len / n as f64;
            if ps
                .iter()
                .any(|q| q.underground && (q.s - s).abs() <= q.len / 2.0 + 1e-9)
            {
                continue;
            }
            let (p, dir) = path.at(s);
            let nrm = [-dir[1], dir[0]];
            for side in [1.0, -1.0] {
                // Walk outward until the probe comes nearer to another stretch of line than to
                // this one (a crossing or parallel track): beyond that the band is the other's.
                let mut per: Vec<[[f64; 2]; 3]> = Vec::with_capacity(dists.len());
                for &dd in &dists {
                    let q = [p[0] + nrm[0] * dd * side, p[1] + nrm[1] * dd * side];
                    if dd > 10.0 {
                        let mut other = false;
                        buckets.near(q, dd * 0.5, |k| other |= dist(q, elements[k].p) < dd * 0.5);
                        if other {
                            break;
                        }
                    }
                    per.push(levels(q, true, &mut scratch));
                }
                let walked = per.len();
                for (k, th) in [th_den, th_night].into_iter().enumerate() {
                    for v in 0..3 {
                        let ls: Vec<f64> = per.iter().map(|x| x[v][k] - th).collect();
                        // Still above the threshold where another line takes over: no edge here.
                        if walked < dists.len() && ls.last().is_some_and(|&l| l >= 0.0) {
                            continue;
                        }
                        let w = edge(&ls);
                        widths[k][v].push(w);
                        if v == 1 && w > 0.0 {
                            edges[k]
                                .push((w, [p[0] + nrm[0] * w * side, p[1] + nrm[1] * w * side]));
                        }
                    }
                }
            }
        }
    }
    // Widest: the 95th percentile edge, so one probe running along a junction does not set it.
    let widest: [(f64, Option<[f64; 2]>); 2] = std::array::from_fn(|k| {
        let e = &mut edges[k];
        e.sort_by(|a, b| a.0.total_cmp(&b.0));
        match e.len() {
            0 => (0.0, None),
            n => {
                let (w, at) = e[((n - 1) as f64 * 0.95).round() as usize];
                (w, Some(at))
            }
        }
    });
    let band = |k: usize, th: f64, widths: &mut [[Vec<f64>; 3]; 2]| Band {
        threshold_db: th,
        typical_m: std::array::from_fn(|v| median(&mut widths[k][v])),
        max_m: widest[k].0,
        max_at: widest[k].1,
        probes: widths[k][1].len(),
    };
    let lden = band(0, th_den, &mut widths);
    let lnight = band(1, th_night, &mut widths);

    // Buildings and terrain screen the grid receivers (step N2).
    let mut building_levels = vec![[f32::NAN; 2]; input.buildings.len()];
    // Central L_den and L_night at a receiver with the roof paths over the buildings.
    // Far from a receiver, neighbouring elements are paired so each pair costs one roof path.
    let mut pairs: Vec<(Element, usize, usize)> = Vec::new();
    if !obstacles.is_empty() {
        let mut i = 0;
        while i < elements.len() {
            let a = &elements[i];
            match elements.get(i + 1) {
                Some(b)
                    if b.owner == a.owner
                        && b.table == a.table
                        && b.dipole.is_some() == a.dipole.is_some()
                        && dist(a.p, b.p) <= 1.5 * ELEMENT_M =>
                {
                    let power = std::array::from_fn(|v| {
                        std::array::from_fn(|k| a.power[v][k] + b.power[v][k])
                    });
                    let p = [(a.p[0] + b.p[0]) / 2.0, (a.p[1] + b.p[1]) / 2.0];
                    pairs.push((
                        Element {
                            p,
                            power,
                            z: obstacles.ground_at(p) + a.h,
                            ..a.clone()
                        },
                        i,
                        2,
                    ));
                    i += 2;
                }
                _ => {
                    pairs.push((a.clone(), i, 1));
                    i += 1;
                }
            }
        }
    }
    let pair_els: Vec<Element> = pairs.iter().map(|x| x.0.clone()).collect();
    let pair_buckets = Buckets::new(&pair_els, 50.0);
    // L_den and L_night energy of one unit of an owner's sound.
    let weight: Vec<[f64; 2]> = flows.iter().map(|f| [periods.den(*f), f[2]]).collect();
    let rho = lib
        .central("noise.facade_reflection_coefficient")
        .clamp(0.0, 1.0);
    let refl_r = if lib.central("noise.reflection_order") >= 0.5 && rho > 0.0 {
        lib.central("noise.reflection_max_distance_m").max(0.0)
    } else {
        0.0
    };
    // Central L_den and L_night at a receiver past the buildings and over the terrain: the path
    // over the top, the lateral paths round the building ends, and first-order reflections from
    // the facades near the receiver. `adj` are buildings beside the receiver: the level without
    // their own facade reflections is returned for each, as the Directive takes the level in
    // front of a facade without its own reflection.
    let screened = |p: [f64; 2], adj: &[usize], sc: &mut Scratch| -> ([f64; 2], Vec<[f64; 2]>) {
        sc.energy.iter_mut().for_each(|x| *x = [0.0; 3]);
        for o in sc.own.iter_mut() {
            o.iter_mut().for_each(|x| *x = 0.0);
        }
        let zr = obstacles.ground_at(p) + hr;
        let Scratch {
            energy,
            own,
            ray,
            near,
            walls,
            lateral,
        } = sc;
        lateral.clear();
        // Paths whose lateral paths may count: (pair or element, index, distance, upper bounds of
        // their L_den and L_night energy).
        let mut add = |e: &Element, at: (bool, usize), d: f64, ray: &mut RayScratch| {
            let tab = &tables[e.table];
            let idx = tab.index(d);
            let t = &tab.rows[idx];
            let w = &e.power[1];
            let sum: f64 = match obstacles.screen(e.p, p, e.z, zr, ray) {
                None => (0..NB).map(|b| w[b] * t[b]).sum(),
                Some(v) => {
                    // ISO 9613-2: A_bar = D_z − A_gr, not below 0; it replaces the ground term.
                    let dz = barrier_db(&v.screen);
                    let gr = &tab.ground[idx];
                    let abar: [f64; NB] = std::array::from_fn(|b| (dz[b] - gr[b]).max(0.0));
                    if v.buildings {
                        // Lateral paths keep the ground term. Their single-edge bound gives the
                        // most they can add; they are found below only where that matters.
                        // D_z rises with frequency, so the 63 Hz value bounds every band.
                        let all: f64 = (0..NB).map(|b| w[b] * t[b]).sum();
                        let ub: f64 = obstacles
                            .lateral_bounds(e.p, p, e.z, zr, ray)
                            .iter()
                            .flatten()
                            .map(|&z| all * pow10(-lateral_db_63(z)))
                            .sum::<f64>()
                            * dipole_at(e, p, d);
                        let mut ids = [0u32; LATERAL_MAX_BUILDINGS];
                        if let Some(n) = obstacles.blocking(e.z, zr, ray, &mut ids) {
                            if ub > 0.0 && n > 0 {
                                lateral.push(Candidate {
                                    pair: at.0,
                                    i: at.1,
                                    d,
                                    ub: [ub * weight[e.owner][0], ub * weight[e.owner][1]],
                                    ids,
                                    n: n as u8,
                                });
                            }
                        }
                    }
                    (0..NB).map(|b| w[b] * t[b] * pow10(-abar[b])).sum()
                }
            };
            energy[e.owner][1] += sum * dipole_at(e, p, d);
        };
        near.clear();
        pair_buckets.near(p, max_d, |k| {
            if dist(p, pairs[k].0.p) <= max_d {
                near.push(k);
            }
        });
        for &k in near.iter() {
            let (e, first, n) = &pairs[k];
            let d = dist(p, e.p);
            if d >= PAIR_FROM_M {
                add(e, (true, k), d, ray);
            } else {
                for (i, f) in elements[*first..*first + *n].iter().enumerate() {
                    add(f, (false, first + i), dist(p, f.p), ray);
                }
            }
        }
        // First-order reflections: the image of the receiver in each facade near it.
        if refl_r > 0.0 {
            obstacles.walls_near(p, refl_r, ray, walls);
            for &wi in walls.iter() {
                let wl = obstacles.wall(wi);
                let n = wl.n;
                let dr = (p[0] - wl.a[0]) * n[0] + (p[1] - wl.a[1]) * n[1];
                let img = [p[0] - 2.0 * dr * n[0], p[1] - 2.0 * dr * n[1]];
                let ab = [wl.b[0] - wl.a[0], wl.b[1] - wl.a[1]];
                let ab2 = ab[0] * ab[0] + ab[1] * ab[1];
                let slot = adj.iter().position(|&b| b == wl.building);
                for &k in near.iter() {
                    let e = &pairs[k].0;
                    let ds = (e.p[0] - wl.a[0]) * n[0] + (e.p[1] - wl.a[1]) * n[1];
                    if ds <= 0.05 {
                        continue;
                    }
                    let f = ds / (ds + dr);
                    let q = [
                        e.p[0] + (img[0] - e.p[0]) * f,
                        e.p[1] + (img[1] - e.p[1]) * f,
                    ];
                    let lam = ((q[0] - wl.a[0]) * ab[0] + (q[1] - wl.a[1]) * ab[1]) / ab2;
                    if !(0.0..=1.0).contains(&lam) {
                        continue;
                    }
                    let (d1, d2) = (dist(e.p, q), dist(q, p));
                    let dt = d1 + d2;
                    if dt > max_d || d1 < 0.1 {
                        continue;
                    }
                    let zq = e.z + (zr - e.z) * d1 / dt;
                    if zq >= wl.top {
                        continue;
                    }
                    let q2 = [q[0] + n[0] * 0.05, q[1] + n[1] * 0.05];
                    if obstacles.blocked(q2, p, zq, zr, ray)
                        || obstacles.blocked(e.p, q2, e.z, zq, ray)
                    {
                        continue;
                    }
                    let t = tables[e.table].at(dt);
                    let w = &e.power[1];
                    let sum = rho * dipole_at(e, q, d1) * (0..NB).map(|b| w[b] * t[b]).sum::<f64>();
                    energy[e.owner][1] += sum;
                    if let Some(s) = slot {
                        own[s][e.owner] += sum;
                    }
                }
            }
        }
        // Lateral paths, largest possible first, until what is left could not add 1 %. First the
        // corner bounds are tightened to the path round the blocking buildings (no index walk),
        // then the largest of those are checked for other buildings in the way.
        let total = |energy: &[[f64; 3]], k: usize| -> f64 {
            energy.iter().zip(&weight).map(|(e, w)| e[1] * w[k]).sum()
        };
        let (mut tot_den, mut tot_night) = (total(energy, 0), total(energy, 1));
        let small = |rem: [f64; 2], tot: [f64; 2]| {
            rem[0] <= LATERAL_TOLERANCE * tot[0] && rem[1] <= LATERAL_TOLERANCE * tot[1]
        };
        // Energy of the lateral paths; as a bound, from the 63 Hz single-edge value.
        let energy_of = |e: &Element, d: f64, plan: &[Option<Lateral>; 2], bound: bool| -> f64 {
            let t = tables[e.table].at(d);
            let w = &e.power[1];
            let all: f64 = (0..NB).map(|b| w[b] * t[b]).sum();
            let mut sum = 0.0;
            for l in plan.iter().flatten() {
                let sc = l.screen(zr - e.z);
                sum += if bound {
                    all * pow10(-lateral_db_63(sc.z))
                } else {
                    let dl = lateral_db(&sc);
                    (0..NB).map(|b| w[b] * t[b] * pow10(-dl[b])).sum::<f64>()
                };
            }
            sum * dipole_at(e, p, d)
        };
        let el = |c: &Candidate| {
            if c.pair {
                &pairs[c.i].0
            } else {
                &elements[c.i]
            }
        };
        for stage in [false, true] {
            let mut rem = lateral
                .iter()
                .fold([0.0, 0.0], |a, c| [a[0] + c.ub[0], a[1] + c.ub[1]]);
            lateral.sort_by(|a, b| {
                b.ub[0]
                    .total_cmp(&a.ub[0])
                    .then(b.ub[1].total_cmp(&a.ub[1]))
            });
            let mut keep = 0;
            // The plan paths of one position serve its sources at other heights (rail A and B).
            let mut plans: Vec<([u64; 2], [Option<Lateral>; 2])> = Vec::new();
            for k in 0..lateral.len() {
                if small(rem, [tot_den, tot_night]) {
                    break;
                }
                let c = lateral[k];
                rem = [rem[0] - c.ub[0], rem[1] - c.ub[1]];
                let e = el(&c);
                let key = [e.p[0].to_bits(), e.p[1].to_bits()];
                let plan = match plans.iter().find(|x| x.0 == key) {
                    Some(x) => x.1,
                    None => {
                        let l = obstacles.lateral(
                            e.p,
                            p,
                            [e.z, zr],
                            Some(&c.ids[..c.n as usize]),
                            stage,
                            ray,
                        );
                        plans.push((key, l));
                        l
                    }
                };
                let sum = energy_of(e, c.d, &plan, !stage);
                if stage {
                    energy[e.owner][1] += sum;
                    tot_den += sum * weight[e.owner][0];
                    tot_night += sum * weight[e.owner][1];
                } else if sum > 0.0 {
                    // Tightened bound, for the second stage.
                    lateral[keep] = Candidate {
                        ub: [sum * weight[e.owner][0], sum * weight[e.owner][1]],
                        ..c
                    };
                    keep += 1;
                }
            }
            if !stage {
                lateral.truncate(keep);
            }
        }
        let lv = |sub: Option<&Vec<f64>>| {
            let mut per = [0.0; 3];
            for (o, e) in energy.iter().enumerate() {
                let x = (e[1] - sub.map_or(0.0, |s| s[o])).max(0.0);
                for k in 0..3 {
                    per[k] += flows[o][k] * x;
                }
            }
            [level(periods.den(per)), level(per[2])]
        };
        (
            lv(None),
            (0..adj.len()).map(|s| lv(Some(&own[s]))).collect(),
        )
    };

    // Map grid round the lines.
    let grid = if input.grid && !elements.is_empty() {
        let reach = input
            .grid_reach_m
            .filter(|r| r.is_finite() && *r > 0.0)
            .unwrap_or(lden.max_m.max(lnight.max_m) * 1.3 + 25.0)
            .clamp(30.0, max_d);
        let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
        for e in &elements {
            x0 = x0.min(e.p[0]);
            y0 = y0.min(e.p[1]);
            x1 = x1.max(e.p[0]);
            y1 = y1.max(e.p[1]);
        }
        let (x0, y0, x1, y1) = (x0 - reach, y0 - reach, x1 + reach, y1 + reach);
        // Cells within reach of the sources: estimate the area as the corridor length × width.
        let corridor_area =
            elements.len() as f64 * ELEMENT_M * 2.0 * reach + std::f64::consts::PI * reach * reach;
        let area = corridor_area.min((x1 - x0) * (y1 - y0));
        let cell = lib
            .get("noise.grid_spacing_m", None, Variant::Low)
            .max((area / MAX_GRID_CELLS).sqrt())
            .max(1.0);
        let nx = ((x1 - x0) / cell).ceil() as usize;
        let ny = ((y1 - y0) / cell).ceil() as usize;
        let mut mask = vec![false; nx * ny];
        let r_cells = (reach / cell).ceil() as i64;
        for e in &elements {
            let ci = ((e.p[0] - x0) / cell) as i64;
            let cj = ((e.p[1] - y0) / cell) as i64;
            for j in (cj - r_cells).max(0)..=(cj + r_cells).min(ny as i64 - 1) {
                for i in (ci - r_cells).max(0)..=(ci + r_cells).min(nx as i64 - 1) {
                    let c = [x0 + (i as f64 + 0.5) * cell, y0 + (j as f64 + 0.5) * cell];
                    if dist(c, e.p) <= reach {
                        mask[j as usize * nx + i as usize] = true;
                    }
                }
            }
        }
        let mut g_den = vec![f32::NAN; nx * ny];
        let mut g_night = vec![f32::NAN; nx * ny];
        // Building each cell centre stands in (receivers there are not computed).
        let mut inside: Vec<Option<usize>> = vec![None; nx * ny];
        if !obstacles.is_empty() {
            for j in 0..ny {
                for i in 0..nx {
                    let k = j * nx + i;
                    if mask[k] {
                        let c = [x0 + (i as f64 + 0.5) * cell, y0 + (j as f64 + 0.5) * cell];
                        inside[k] = obstacles.inside(c);
                    }
                }
            }
        }
        let mut sc = Scratch {
            energy: vec![[0.0; 3]; flows.len()],
            own: vec![vec![0.0; flows.len()]; 4],
            ..Default::default()
        };
        // Per computed cell: the level without the own facade reflection of each building beside it.
        let mut beside: Vec<Vec<(usize, [f32; 2])>> = vec![Vec::new(); nx * ny];
        let mut adj: Vec<usize> = Vec::with_capacity(4);
        for j in 0..ny {
            for i in 0..nx {
                let k = j * nx + i;
                if !mask[k] || inside[k].is_some() {
                    continue;
                }
                let c = [x0 + (i as f64 + 0.5) * cell, y0 + (j as f64 + 0.5) * cell];
                let l = if obstacles.is_empty() {
                    levels(c, false, &mut scratch)[1]
                } else {
                    adj.clear();
                    for (ii, jj) in neighbours(i, j, nx, ny) {
                        if let Some(b) = inside[jj * nx + ii] {
                            if !adj.contains(&b) {
                                adj.push(b);
                            }
                        }
                    }
                    let (l, without) = screened(c, &adj, &mut sc);
                    beside[k] = adj
                        .iter()
                        .zip(without)
                        .map(|(&b, w)| (b, [w[0] as f32, w[1] as f32]))
                        .collect();
                    l
                };
                g_den[k] = l[0] as f32;
                g_night[k] = l[1] as f32;
            }
        }
        // Each building takes the highest level of the computed cells round its footprint,
        // without the reflection from its own facade.
        if !obstacles.is_empty() {
            for j in 0..ny {
                for i in 0..nx {
                    let Some(b) = inside[j * nx + i] else {
                        continue;
                    };
                    let src = obstacles.source(b);
                    for (ii, jj) in neighbours(i, j, nx, ny) {
                        let k = jj * nx + ii;
                        if g_den[k].is_nan() {
                            continue;
                        }
                        let [den, night] = beside[k]
                            .iter()
                            .find(|x| x.0 == b)
                            .map_or([g_den[k], g_night[k]], |x| x.1);
                        let bl = &mut building_levels[src];
                        if bl[0].is_nan() || den > bl[0] {
                            bl[0] = den;
                        }
                        if bl[1].is_nan() || night > bl[1] {
                            bl[1] = night;
                        }
                    }
                }
            }
        }
        Some(Grid {
            x0,
            y0,
            cell,
            nx,
            ny,
            lden: g_den,
            lnight: g_night,
        })
    } else {
        None
    };

    let checks = checks(input, &paths, &line_pieces, lib, &lden, &lnight);
    Estimate {
        lden,
        lnight,
        checks,
        grid,
        building_levels,
        input_level: "planned",
        terrain: obstacles.has_ground(),
    }
}

/// Scratch of the screened receivers.
#[derive(Default)]
struct Scratch {
    /// Energy per owner and variant.
    energy: Vec<[f64; 3]>,
    /// Central energy of the own facade reflections per building beside the receiver, per owner.
    own: Vec<Vec<f64>>,
    ray: RayScratch,
    /// Paired elements within reach.
    near: Vec<usize>,
    /// Walls near the receiver.
    walls: Vec<usize>,
    /// Candidate lateral paths.
    lateral: Vec<Candidate>,
}

/// A path whose lateral paths may count.
#[derive(Debug, Clone, Copy)]
struct Candidate {
    /// A paired element (else a single one), and its index.
    pair: bool,
    i: usize,
    /// Horizontal distance, m.
    d: f64,
    /// Upper bound of the L_den and L_night energy the lateral paths add.
    ub: [f64; 2],
    /// Buildings above the line of sight.
    ids: [u32; LATERAL_MAX_BUILDINGS],
    n: u8,
}

/// Purpose: the four grid neighbours of cell (i, j) inside an nx × ny grid.
fn neighbours(i: usize, j: usize, nx: usize, ny: usize) -> impl Iterator<Item = (usize, usize)> {
    [(-1i64, 0i64), (1, 0), (0, -1), (0, 1)]
        .into_iter()
        .map(move |(di, dj)| (i as i64 + di, j as i64 + dj))
        .filter(move |&(a, b)| a >= 0 && b >= 0 && a < nx as i64 && b < ny as i64)
        .map(|(a, b)| (a as usize, b as usize))
}

/// Distance where the level (relative to the threshold, per probe distance) last falls below 0,
/// interpolated in log distance; 0 when no probe is above.
fn edge_distance(dists: &[f64], rel: &[f64]) -> f64 {
    // The level can rise over the first metres (the railway source A directivity points away
    // from receivers steeply above the track): the band starts at the first probe above it.
    let Some(first) = rel.iter().position(|r| *r >= 0.0) else {
        return 0.0;
    };
    for i in first + 1..rel.len() {
        if rel[i].is_nan() || rel[i] < 0.0 {
            let (a, b) = (rel[i - 1], rel[i]);
            let f = if b.is_finite() && a - b > 0.0 {
                a / (a - b)
            } else {
                0.0
            };
            return (dists[i - 1].ln() + f * (dists[i].ln() - dists[i - 1].ln())).exp();
        }
    }
    *dists.last().unwrap_or(&0.0)
}

fn median(v: &mut [f64]) -> f64 {
    if v.is_empty() {
        return 0.0;
    }
    v.sort_by(|a, b| a.total_cmp(b));
    let n = v.len();
    if n % 2 == 1 {
        v[n / 2]
    } else {
        (v[n / 2 - 1] + v[n / 2]) / 2.0
    }
}

fn fmt_m(m: f64) -> String {
    if m >= 1000.0 {
        format!("{:.1} km", m / 1000.0)
    } else {
        format!("{} m", m.round())
    }
}

fn fmt_db(x: f64) -> String {
    let r = (x * 10.0).round() / 10.0;
    if r.fract() == 0.0 {
        format!("{r:+.0}")
    } else {
        format!("{r:+.1}")
    }
}

/// Contiguous runs of pieces where `f` holds: (first, last) indices.
fn runs(ps: &[Piece], f: impl Fn(&Piece) -> bool) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < ps.len() {
        if f(&ps[i]) {
            let mut j = i;
            while j + 1 < ps.len() && f(&ps[j + 1]) {
                j += 1;
            }
            out.push((i, j));
            i = j + 1;
        } else {
            i += 1;
        }
    }
    out
}

fn checks(
    input: &EstimateInput,
    paths: &[Path],
    line_pieces: &[Vec<Piece>],
    lib: &Library,
    lden: &Band,
    lnight: &Band,
) -> Vec<Check> {
    let mut out = Vec::new();
    let named = |l: &LineInput, t: String| {
        if l.label.is_empty() {
            t
        } else {
            format!("{}: {t}", l.label)
        }
    };
    let mut any_electric: Option<Mode> = None;
    for (l, (path, ps)) in input.lines.iter().zip(paths.iter().zip(line_pieces)) {
        if ps.is_empty() {
            continue;
        }
        if l.mode.is_road() && (l.electric || l.mode == Mode::Trolleybus) {
            any_electric.get_or_insert(l.mode);
        }
        for (class, key) in [
            (Squeal::R300, "noise.rail_squeal_r300_db"),
            (Squeal::R500, "noise.rail_squeal_r500_db"),
            (Squeal::Tram200, "noise.tram_squeal_r200_db"),
        ] {
            for (a, b) in runs(ps, |q| q.squeal == class) {
                let r = ps[a..=b]
                    .iter()
                    .map(|q| q.radius)
                    .fold(f64::INFINITY, f64::min);
                let len = ps[a..=b].iter().map(|q| q.len).sum::<f64>();
                let db = lib.range(key, Some(l.mode));
                let what = if class == Squeal::Tram200 {
                    "Tram curve"
                } else {
                    "Curve"
                };
                out.push(Check {
                    severity: Severity::Warning,
                    text: named(
                        l,
                        format!(
                            "{what} R {} over {}: squeal correction {} dB ({} to {} dB), the corridor widens here",
                            fmt_m(r),
                            fmt_m(len),
                            fmt_db(db[1]),
                            fmt_db(db[0]),
                            fmt_db(db[2])
                        ),
                    ),
                    at: Some(path.at((ps[a].s + ps[b].s) / 2.0).0),
                    line: Some(l.id.clone()),
                });
            }
        }
        if !l.mode.is_road() {
            // Increase of the train's sound power on a piece when a state flag is set, dB, at the
            // low, central and high end of the ranges.
            let excess = |q: &Piece, with: fn(&mut TrackState)| -> [f64; 3] {
                std::array::from_fn(|v| {
                    let var = VARIANTS[v];
                    let src = RailSource::new(lib, l.mode, l.vehicle_length_m, var);
                    let mut st = rail_state(q, l.mode, lib, var);
                    st.bridge = false;
                    st.joint_density = 0.0;
                    let base = train_power(&src, &st).total_db();
                    with(&mut st);
                    train_power(&src, &st).total_db() - base
                })
            };
            for (a, b) in runs(ps, |q| q.bridge && !q.underground) {
                let len = ps[a..=b].iter().map(|q| q.len).sum::<f64>();
                let db = excess(&ps[(a + b) / 2], |st| st.bridge = true);
                out.push(Check {
                    severity: Severity::Info,
                    text: named(
                        l,
                        format!(
                            "Elevated over {}: bridge structure noise {} dB ({} to {} dB, CNOSSOS-EU bridge transfer functions)",
                            fmt_m(len),
                            fmt_db(db[1]),
                            fmt_db(db[0]),
                            fmt_db(db[2])
                        ),
                    ),
                    at: Some(path.at((ps[a].s + ps[b].s) / 2.0).0),
                    line: Some(l.id.clone()),
                });
            }
            let sw = runs(ps, |q| q.switch && !q.underground);
            if let Some(&(a, b)) = sw.first() {
                let db = excess(&ps[(a + b) / 2], |st| st.joint_density = 0.01)[1];
                let ext = lib.central("noise.rail_impact_extent_m");
                out.push(Check {
                    severity: Severity::Info,
                    text: named(
                        l,
                        if db > 0.0 {
                            format!(
                                "{} {}: impact noise {} dB from {} before to {} after each",
                                sw.len(),
                                if sw.len() == 1 { "switch" } else { "switches" },
                                fmt_db(db),
                                fmt_m(ext),
                                fmt_m(ext)
                            )
                        } else {
                            format!(
                                "{} {}: no impact noise below {} km/h (CNOSSOS-EU)",
                                sw.len(),
                                if sw.len() == 1 { "switch" } else { "switches" },
                                lib.get(
                                    "noise.rail_min_roughness_speed_kmh",
                                    Some(l.mode),
                                    Variant::Central
                                )
                            )
                        },
                    ),
                    at: Some(ps[a].p),
                    line: Some(l.id.clone()),
                });
            }
            if let Some(&(a, b)) = runs(ps, |q| q.underground).first() {
                let len = ps
                    .iter()
                    .filter(|q| q.underground)
                    .map(|q| q.len)
                    .sum::<f64>();
                out.push(Check {
                    severity: Severity::Info,
                    text: named(
                        l,
                        format!(
                            "{} underground: no noise at the surface; tunnel portals are not modelled yet",
                            fmt_m(len)
                        ),
                    ),
                    at: Some(path.at((ps[a].s + ps[b].s) / 2.0).0),
                    line: Some(l.id.clone()),
                });
            }
        }
    }
    let th = |b: &Band| format!("{} dB", b.threshold_db.round());
    if lden.max_m > 0.0 {
        out.push(Check {
            severity: Severity::Info,
            text: format!(
                "The {} L_den band is widest here: {} from the line",
                th(lden),
                fmt_m(lden.max_m)
            ),
            at: lden.max_at,
            line: None,
        });
    }
    if input.lines.iter().all(|l| l.flows.night <= 0.0) && !input.lines.is_empty() {
        out.push(Check {
            severity: Severity::Info,
            text: format!("No night service: no {} L_night band", th(lnight)),
            at: None,
            line: None,
        });
    }
    if let Some(m) = any_electric {
        let r = lib.range("noise.electric_road_propulsion_delta_db", Some(m));
        out.push(Check {
            severity: Severity::Info,
            text: format!(
                "Electric buses: propulsion noise {} dB ({} to {} dB), an educated guess until measured values are added",
                fmt_db(r[1]),
                fmt_db(r[0]),
                fmt_db(r[2])
            ),
            at: None,
            line: None,
        });
    }
    if !input.point_sources.is_empty() {
        out.push(Check {
            severity: Severity::Info,
            text: "Cable car and ferry sources use placeholder sound powers: indicative only"
                .into(),
            at: None,
            line: None,
        });
    }
    out.push(Check {
        severity: Severity::Info,
        text: "Quick estimate: free field over flat ground, no buildings or terrain (no screening), service lines only without general traffic".into(),
        at: None,
        line: None,
    });
    out.sort_by_key(|c| c.severity == Severity::Info);
    out
}
