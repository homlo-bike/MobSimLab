//! The editors' quick estimate (ADR-0038 §1, step N1): line sources from the drawn lines,
//! free-field propagation, L_den and L_night, the band distances either side of the lines, a
//! receiver grid for the map, and checks for the side panel.
//!
//! All coordinates are local metres (x east, y north). Flows are vehicles (buses or trains) per
//! hour on the drawn line, per period.

use crate::emission::{pow10, rail_passby_db, road_vehicle_lw, RoadCategory};
use crate::params::{Coefficients, Library, Mode, Variant, NB, VARIANTS};
use crate::propagation::{absorption, Propagation};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Longest source element, m.
const ELEMENT_M: f64 = 10.0;
/// Spacing of the band probes along a line, m.
const PROBE_STEP_M: f64 = 20.0;
/// Most grid cells computed for the map picture.
const MAX_GRID_CELLS: f64 = 40_000.0;
/// Half chord used to measure a curve radius, m.
const RADIUS_HALF_CHORD_M: f64 = 15.0;
/// Pass-by measurement position (ISO 3095, TSI NOI): distance and height, m.
const PASSBY_DISTANCE_M: f64 = 7.5;
const PASSBY_HEIGHT_M: f64 = 1.2;

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
    /// Level of detail of the inputs (ADR-0038 §4).
    pub input_level: &'static str,
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

/// A source element: a short piece of line, or a point source.
#[derive(Debug, Clone)]
struct Element {
    p: [f64; 2],
    /// Index into the transfer tables (source height).
    table: usize,
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
}

impl TransferTable {
    fn new(prop: &Propagation, hs: f64, hr: f64, max_d: f64) -> Self {
        let (min, n) = (0.5f64, 240usize);
        let ln_min = min.ln();
        let step = ((max_d * 1.01).ln() - ln_min) / (n - 1) as f64;
        let rows = (0..n)
            .map(|i| prop.transfer((ln_min + step * i as f64).exp(), hs, hr))
            .collect();
        Self { ln_min, step, rows }
    }

    fn at(&self, d: f64) -> &[f64; NB] {
        let f = ((d.max(0.5).ln() - self.ln_min) / self.step).round() as usize;
        &self.rows[f.min(self.rows.len() - 1)]
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
    v: f64,
    height: f64,
    underground: bool,
    bridge: bool,
    embedded: bool,
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
    let mut out: Vec<Piece> = (0..n)
        .map(|i| {
            let s = (i as f64 + 0.5) * dl;
            let (p, _) = path.at(s);
            let in_range = |k: RangeKind| {
                line.ranges
                    .iter()
                    .find(|r| r.kind == k && r.from_m <= s && s <= r.to_m)
            };
            let bridge = in_range(RangeKind::Bridge);
            Piece {
                s,
                len: dl,
                p,
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
    let coef = Coefficients::builtin();
    let shape = coef.rail_shape();

    // Rail calibration: band power per metre that gives the pass-by level at 7.5 m.
    let rail_hs = lib.central("noise.rail_source_height_m");
    let road_hs = lib.central("noise.road_source_height_m");
    let rail_cal_db = {
        let mut sum = 0.0;
        let mut x = 0.0;
        while x < max_d.max(1000.0) {
            let dx = if x < 50.0 {
                0.25
            } else if x < 300.0 {
                1.0
            } else {
                4.0
            };
            let xm = x + dx / 2.0;
            let t = prop.transfer(
                (PASSBY_DISTANCE_M.powi(2) + xm * xm).sqrt(),
                rail_hs,
                PASSBY_HEIGHT_M,
            );
            sum += 2.0 * dx * (0..NB).map(|b| pow10(shape[b]) * t[b]).sum::<f64>();
            x += dx;
        }
        10.0 * sum.log10()
    };

    let mut heights: Vec<f64> = Vec::new();
    let mut table_of = |h: f64| -> usize {
        let h = (h * 20.0).round() / 20.0;
        heights.iter().position(|&x| x == h).unwrap_or_else(|| {
            heights.push(h);
            heights.len() - 1
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
        for q in &ps {
            if q.underground {
                continue;
            }
            let power: [[f64; NB]; 3] = VARIANTS.map(|var| {
                if road {
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
                    let k = q.len / (1000.0 * q.v);
                    lw.map(|b| pow10(b) * k)
                } else {
                    let mut corr = 0.0;
                    corr += match q.squeal {
                        Squeal::None => 0.0,
                        Squeal::R300 => lib.get("noise.rail_squeal_r300_db", Some(line.mode), var),
                        Squeal::R500 => lib.get("noise.rail_squeal_r500_db", Some(line.mode), var),
                        Squeal::Tram200 => {
                            lib.get("noise.tram_squeal_r200_db", Some(line.mode), var)
                        }
                    };
                    if q.bridge {
                        corr += lib.get("noise.rail_bridge_db", Some(line.mode), var);
                    }
                    if q.switch {
                        corr += lib.get("noise.rail_switch_db", Some(line.mode), var);
                    }
                    if q.embedded && line.mode.is_tram() {
                        corr += lib.get("noise.tram_embedded_track_db", Some(line.mode), var);
                    }
                    let lp = rail_passby_db(lib, line.mode, q.v, var) + corr - rail_cal_db;
                    let k = len_v / (1000.0 * q.v) * q.len;
                    shape.map(|b| pow10(lp + b) * k)
                }
            });
            let hs = if road { road_hs } else { rail_hs } + q.height;
            elements.push(Element {
                p: q.p,
                table: table_of(hs),
                owner: li,
                power,
            });
        }
        line_pieces.push(ps);
    }
    let n_lines = input.lines.len();
    for (pi, ps) in input.point_sources.iter().enumerate() {
        let w = pow10(ps.lw_dba);
        let flat = [w / NB as f64; NB];
        elements.push(Element {
            p: ps.p,
            table: table_of(ps.height_m.max(0.0)),
            owner: n_lines + pi,
            power: [flat; 3],
        });
    }
    let tables: Vec<TransferTable> = heights
        .iter()
        .map(|&h| TransferTable::new(&prop, h, hr, max_d))
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
            let acc = &mut scratch[e.owner];
            for (v, a) in acc.iter_mut().enumerate() {
                if !all && v != 1 {
                    continue;
                }
                *a += (0..NB).map(|b| e.power[v][b] * t[b]).sum::<f64>();
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

    // Map grid round the lines.
    let grid = if input.grid && !elements.is_empty() {
        let reach = (lden.max_m.max(lnight.max_m) * 1.3 + 25.0).clamp(30.0, max_d);
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
        for j in 0..ny {
            for i in 0..nx {
                let k = j * nx + i;
                if !mask[k] {
                    continue;
                }
                let c = [x0 + (i as f64 + 0.5) * cell, y0 + (j as f64 + 0.5) * cell];
                let l = levels(c, false, &mut scratch)[1];
                g_den[k] = l[0] as f32;
                g_night[k] = l[1] as f32;
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
        input_level: "planned",
    }
}

/// Distance where the level (relative to the threshold, per probe distance) last falls below 0,
/// interpolated in log distance; 0 when the nearest probe is already below.
fn edge_distance(dists: &[f64], rel: &[f64]) -> f64 {
    if !rel.first().is_some_and(|r| *r >= 0.0) {
        return 0.0;
    }
    for i in 1..rel.len() {
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
            for (a, b) in runs(ps, |q| q.bridge && !q.underground) {
                let len = ps[a..=b].iter().map(|q| q.len).sum::<f64>();
                out.push(Check {
                    severity: Severity::Info,
                    text: named(
                        l,
                        format!(
                            "Elevated over {}: bridge noise {} dB for a concrete viaduct; a steel bridge can add up to {} dB",
                            fmt_m(len),
                            fmt_db(lib.get("noise.rail_bridge_db", Some(l.mode), Variant::Central)),
                            fmt_db(lib.get("noise.rail_bridge_db", Some(l.mode), Variant::High))
                        ),
                    ),
                    at: Some(path.at((ps[a].s + ps[b].s) / 2.0).0),
                    line: Some(l.id.clone()),
                });
            }
            let sw = runs(ps, |q| q.switch && !q.underground);
            if let Some(&(a, _)) = sw.first() {
                out.push(Check {
                    severity: Severity::Info,
                    text: named(
                        l,
                        format!(
                            "{} {}: impact noise {} dB over each",
                            sw.len(),
                            if sw.len() == 1 { "switch" } else { "switches" },
                            fmt_db(lib.get("noise.rail_switch_db", Some(l.mode), Variant::Central))
                        ),
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
