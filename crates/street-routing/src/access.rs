//! Accessibility measures on the walk or cycle network (ADR-0035 §6).
//!
//! - [`WalkGraph::matrix`]: a bounded, sparse travel-cost matrix from sources to targets along the
//!   network (one small Dijkstra per source into a reused buffer).
//! - [`WalkGraph::ptal`]: Transport for London's Public Transport Accessibility Level per grid
//!   point: walk to each route's nearest stop, plus half the headway and a reliability allowance,
//!   turned into an equivalent doorstep frequency and banded 0 to 6b (TfL, *Assessing transport
//!   connectivity in London*, 2015).
//! - [`WalkGraph::reach_counts`]: how many destinations of each category lie within a time limit of
//!   each origin (cumulative-opportunity accessibility, the 15-minute city of Moreno et al. 2021).

use crate::geo::dist;
use crate::walk::{DemandPoint, Field, Metric, Snap, StopPoint, WalkGraph, WalkSettings};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// A point given to the matrix.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Place {
    /// Longitude.
    pub lon: f64,
    /// Latitude.
    pub lat: f64,
}

/// A sparse matrix question: every source–target pair within `limit` along the network.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatrixRequest {
    /// Sources.
    pub sources: Vec<Place>,
    /// Targets.
    pub targets: Vec<Place>,
    /// Time (seconds) or distance (metres).
    pub metric: Metric,
    /// Largest cost kept.
    pub limit: f64,
    /// Walking (or cycling) settings; for cycling `walk_speed_kmh` is the cycling speed.
    #[serde(default)]
    pub settings: WalkSettings,
}

/// The pairs within the limit, as three parallel lists, and the points off the network.
#[derive(Debug, Clone, Default, Serialize)]
pub struct MatrixResult {
    /// Source index of each pair.
    pub from: Vec<u32>,
    /// Target index of each pair.
    pub to: Vec<u32>,
    /// Cost of each pair, rounded to 0.1.
    pub cost: Vec<f64>,
    /// Sources further than `max_snap_m` from the network.
    pub sources_off_network: Vec<usize>,
    /// Targets further than `max_snap_m` from the network.
    pub targets_off_network: Vec<usize>,
}

/// Square grid over projected points, for "which targets lie within r metres".
struct PointGrid {
    cell: f64,
    cells: HashMap<(i64, i64), Vec<usize>>,
}

impl PointGrid {
    fn new(xy: &[Option<(f64, f64)>], cell: f64) -> Self {
        let cell = cell.max(50.0);
        let mut cells: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
        for (i, p) in xy.iter().enumerate() {
            if let Some(p) = p {
                cells
                    .entry(((p.0 / cell).floor() as i64, (p.1 / cell).floor() as i64))
                    .or_default()
                    .push(i);
            }
        }
        PointGrid { cell, cells }
    }

    fn near(&self, p: (f64, f64), r: f64, out: &mut Vec<usize>) {
        out.clear();
        let (x0, x1) = (
            ((p.0 - r) / self.cell).floor() as i64,
            ((p.0 + r) / self.cell).floor() as i64,
        );
        let (y0, y1) = (
            ((p.1 - r) / self.cell).floor() as i64,
            ((p.1 + r) / self.cell).floor() as i64,
        );
        for cx in x0..=x1 {
            for cy in y0..=y1 {
                if let Some(v) = self.cells.get(&(cx, cy)) {
                    out.extend_from_slice(v);
                }
            }
        }
    }
}

/// One public transport route for PTAL: its stops (indices into the request's stops) and service.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PtalRoute {
    /// Route id, for the output.
    pub id: String,
    /// TfL mode group the route belongs to (`bus`, `tram`, `underground`, `rail`); the best route of
    /// each mode counts in full, the others at half weight.
    pub mode: String,
    /// Stops served, indices into `stops`.
    pub stops: Vec<usize>,
    /// Departures per hour in the period (the busier direction).
    pub frequency_per_hour: f64,
    /// Longest walk to a stop of this route that counts (TfL: 640 m bus and tram, 960 m rail).
    pub max_walk_m: f64,
    /// Reliability allowance added to the wait, minutes (TfL: 2 bus, 0.75 rail and tram).
    pub reliability_min: f64,
}

/// A PTAL question.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PtalRequest {
    /// Stops and stations.
    pub stops: Vec<StopPoint>,
    /// Routes with their service in the period.
    pub routes: Vec<PtalRoute>,
    /// Points to grade (homes, a grid); without them a grid of street points of `cell_m`.
    #[serde(default)]
    pub demand: Option<Vec<DemandPoint>>,
    /// Grid spacing in metres when no demand points are given (TfL: 100 m).
    #[serde(default = "default_ptal_cell")]
    pub cell_m: f64,
    /// `[west, south, east, north]`.
    #[serde(default)]
    pub study_area: Option<[f64; 4]>,
    /// Walking speed in metres per minute (TfL: 80).
    #[serde(default = "default_ptal_speed")]
    pub walk_m_per_min: f64,
    /// Longest snap to the network.
    #[serde(default = "default_snap")]
    pub max_snap_m: f64,
    /// Return the graded points too (up to this many).
    #[serde(default)]
    pub list_points: usize,
}

fn default_ptal_cell() -> f64 {
    100.0
}
fn default_ptal_speed() -> f64 {
    80.0
}
fn default_snap() -> f64 {
    250.0
}

/// One graded point.
#[derive(Debug, Clone, Serialize)]
pub struct PtalPoint {
    /// Longitude.
    pub lon: f64,
    /// Latitude.
    pub lat: f64,
    /// Weight (people, or street metres for the street grid).
    pub weight: f64,
    /// Access index: sum over modes of the equivalent doorstep frequency.
    pub ai: f64,
    /// PTAL band.
    pub band: &'static str,
}

/// Demand in one PTAL band.
#[derive(Debug, Clone, Serialize)]
pub struct PtalBand {
    /// Band name (`0`, `1a`, `1b`, `2`, `3`, `4`, `5`, `6a`, `6b`).
    pub band: &'static str,
    /// Lowest access index of the band (exclusive, except band 0).
    pub ai_from: f64,
    /// Highest access index of the band (inclusive); `None` for 6b.
    pub ai_to: Option<f64>,
    /// Demand in the band.
    pub demand: f64,
}

/// Result of a PTAL run.
#[derive(Debug, Clone, Serialize)]
pub struct PtalResult {
    /// `points` or `street_cells`.
    pub demand_kind: String,
    /// Total demand graded.
    pub total: f64,
    /// Demand-weighted mean access index.
    pub mean_ai: f64,
    /// Demand per band, 0 to 6b.
    pub bands: Vec<PtalBand>,
    /// Graded points, when asked for (highest weight first).
    pub points: Vec<PtalPoint>,
    /// Stops further than `max_snap_m` from the network.
    pub stops_off_network: Vec<String>,
    /// Demand points off the network (graded 0).
    pub demand_off_network: usize,
}

/// TfL PTAL bands by access index: name, lower bound (exclusive), upper bound (inclusive).
pub const PTAL_BANDS: [(&str, f64, Option<f64>); 9] = [
    ("0", 0.0, Some(0.0)),
    ("1a", 0.0, Some(2.5)),
    ("1b", 2.5, Some(5.0)),
    ("2", 5.0, Some(10.0)),
    ("3", 10.0, Some(15.0)),
    ("4", 15.0, Some(20.0)),
    ("5", 20.0, Some(25.0)),
    ("6a", 25.0, Some(40.0)),
    ("6b", 40.0, None),
];

/// Purpose: index of the PTAL band of an access index.
pub fn ptal_band(ai: f64) -> usize {
    if ai <= 0.0 {
        return 0;
    }
    PTAL_BANDS
        .iter()
        .position(|(_, _, to)| to.is_some_and(|t| ai <= t))
        .unwrap_or(PTAL_BANDS.len() - 1)
        .max(1)
}

/// Purpose: the access index from each route's walk (metres) to its nearest stop, by the TfL method:
/// total access time = walk / speed + 0.5 × 60 / frequency + reliability; equivalent doorstep
/// frequency = 0.5 × 60 / total access time; per mode the best route counts in full and the others
/// at half weight; the modes are summed.
pub fn access_index(routes: &[(&PtalRoute, f64)], walk_m_per_min: f64) -> f64 {
    let mut by_mode: HashMap<&str, (f64, f64)> = HashMap::new();
    for (r, walk_m) in routes {
        if r.frequency_per_hour <= 0.0 {
            continue;
        }
        let tat = walk_m / walk_m_per_min.max(1.0)
            + 0.5 * 60.0 / r.frequency_per_hour
            + r.reliability_min;
        let edf = 30.0 / tat;
        let e = by_mode.entry(r.mode.as_str()).or_insert((0.0, 0.0));
        e.0 = e.0.max(edf);
        e.1 += edf;
    }
    by_mode
        .values()
        .map(|(max, sum)| max + 0.5 * (sum - max))
        .sum()
}

/// One destination for the 15-minute city.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Destination {
    /// Category index.
    pub category: usize,
    /// Longitude.
    pub lon: f64,
    /// Latitude.
    pub lat: f64,
}

/// A cumulative-opportunity question: destinations per category within `limit_s` of each origin.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReachCountRequest {
    /// Destinations.
    pub destinations: Vec<Destination>,
    /// Number of categories.
    pub categories: usize,
    /// Origins (homes, a grid); without them a grid of street points of `cell_m`.
    #[serde(default)]
    pub origins: Option<Vec<DemandPoint>>,
    /// Grid spacing when no origins are given.
    #[serde(default = "default_reach_cell")]
    pub cell_m: f64,
    /// `[west, south, east, north]`.
    #[serde(default)]
    pub study_area: Option<[f64; 4]>,
    /// Time limit in seconds.
    pub limit_s: f64,
    /// Walking (or cycling) settings.
    #[serde(default)]
    pub settings: WalkSettings,
}

fn default_reach_cell() -> f64 {
    200.0
}

/// One origin with its counts.
#[derive(Debug, Clone, Serialize)]
pub struct OriginCounts {
    /// Longitude.
    pub lon: f64,
    /// Latitude.
    pub lat: f64,
    /// Weight.
    pub weight: f64,
    /// Destinations reached per category.
    pub counts: Vec<u32>,
    /// Time to the nearest destination of each category in seconds (`None` beyond the limit).
    pub nearest_s: Vec<Option<f64>>,
}

/// Result of a cumulative-opportunity run.
#[derive(Debug, Clone, Serialize)]
pub struct ReachCountResult {
    /// `points` or `street_cells`.
    pub demand_kind: String,
    /// Origins on the network inside the study area.
    pub origins: Vec<OriginCounts>,
    /// Origins off the network (they reach nothing).
    pub origins_off_network: usize,
    /// Destinations off the network, per category.
    pub destinations_off_network: Vec<u32>,
}

impl WalkGraph {
    /// Snap places, returning the snap and projected position of each (`None` off the network).
    fn snap_places(&self, places: &[Place], s: &WalkSettings) -> Vec<Option<(Snap, (f64, f64))>> {
        places
            .iter()
            .map(|p| {
                self.snap(p.lon, p.lat, s)
                    .map(|sn| (sn, self.proj.to_xy(p.lon, p.lat)))
            })
            .collect()
    }

    /// Core of [`WalkGraph::matrix`]: calls `emit(source, target, cost)` for every pair within the
    /// limit. Targets are prefiltered by straight-line distance, which never exceeds the network one.
    fn pairs(
        &self,
        sources: &[Option<(Snap, (f64, f64))>],
        targets: &[Option<(Snap, (f64, f64))>],
        metric: Metric,
        limit: f64,
        s: &WalkSettings,
        mut emit: impl FnMut(usize, usize, f64),
    ) {
        let radius = match metric {
            Metric::Time => limit * (s.walk_speed_kmh / 3.6).max(0.1),
            Metric::Distance => limit,
        };
        let txy: Vec<Option<(f64, f64)>> = targets.iter().map(|t| t.map(|(_, xy)| xy)).collect();
        let grid = PointGrid::new(&txy, radius.clamp(100.0, 1000.0));
        let mut field = Field::empty(self.nodes.len());
        let mut touched = Vec::new();
        let mut near = Vec::new();
        for (si, src) in sources.iter().enumerate() {
            let Some((sn, sxy)) = src else { continue };
            grid.near(*sxy, radius, &mut near);
            if near.is_empty() {
                continue;
            }
            let one = [(0u32, *sn)];
            self.field_into(&one, metric, s, limit, &mut field, &mut touched);
            for &ti in &near {
                let Some((tsn, txy)) = targets[ti] else {
                    continue;
                };
                if dist(*sxy, txy) > radius {
                    continue;
                }
                let v = self.value(&field, tsn, &one, metric, s);
                if v <= limit {
                    emit(si, ti, v);
                }
            }
        }
    }

    /// Purpose: every source–target pair within the limit along the network (sparse matrix).
    /// Output: the pairs and the points that could not be placed on the network.
    pub fn matrix(&self, req: &MatrixRequest) -> MatrixResult {
        let s = &req.settings;
        let src = self.snap_places(&req.sources, s);
        let tgt = self.snap_places(&req.targets, s);
        let mut out = MatrixResult {
            sources_off_network: off(&src),
            targets_off_network: off(&tgt),
            ..Default::default()
        };
        self.pairs(&src, &tgt, req.metric, req.limit, s, |a, b, c| {
            out.from.push(a as u32);
            out.to.push(b as u32);
            out.cost.push((c * 10.0).round() / 10.0);
        });
        out
    }

    /// Purpose: grade points by the TfL PTAL method on the walk network (distance metric).
    /// Output: demand per band, the mean access index and, if asked, the graded points.
    pub fn ptal(&self, req: &PtalRequest) -> PtalResult {
        let s = WalkSettings {
            walk_speed_kmh: req.walk_m_per_min * 60.0 / 1000.0,
            crossing_delay_s: 0.0,
            step_free: false,
            max_snap_m: req.max_snap_m,
            walk_slope_k: 0.0,
        };
        let area = req.study_area.unwrap_or_else(|| self.bounds_lonlat());
        let inside = |p: &DemandPoint| {
            p.lon >= area[0] && p.lon <= area[2] && p.lat >= area[1] && p.lat <= area[3]
        };
        let (points, demand_kind): (Vec<DemandPoint>, &str) = match &req.demand {
            Some(d) => (d.iter().filter(|p| inside(p)).cloned().collect(), "points"),
            None => (self.street_cells(req.cell_m, area), "street_cells"),
        };
        let stop_places: Vec<Place> = req
            .stops
            .iter()
            .map(|p| Place {
                lon: p.lon,
                lat: p.lat,
            })
            .collect();
        let pt_places: Vec<Place> = points
            .iter()
            .map(|p| Place {
                lon: p.lon,
                lat: p.lat,
            })
            .collect();
        let src = self.snap_places(&stop_places, &s);
        let tgt = self.snap_places(&pt_places, &s);
        let stops_off_network = src
            .iter()
            .zip(&req.stops)
            .filter(|(sn, _)| sn.is_none())
            .map(|(_, p)| p.id.clone())
            .collect();
        // Routes at each stop, and the longest walk any of them allows.
        let mut at_stop: Vec<Vec<usize>> = vec![Vec::new(); req.stops.len()];
        for (ri, r) in req.routes.iter().enumerate() {
            for &si in &r.stops {
                if let Some(v) = at_stop.get_mut(si) {
                    if !v.contains(&ri) {
                        v.push(ri);
                    }
                }
            }
        }
        let reach = req
            .routes
            .iter()
            .map(|r| r.max_walk_m)
            .fold(0.0f64, f64::max);
        // Per point: the shortest walk to each route.
        let mut best: Vec<HashMap<usize, f64>> = vec![HashMap::new(); points.len()];
        self.pairs(&src, &tgt, Metric::Distance, reach, &s, |si, pi, d| {
            for &ri in &at_stop[si] {
                if d <= req.routes[ri].max_walk_m {
                    let e = best[pi].entry(ri).or_insert(f64::INFINITY);
                    if d < *e {
                        *e = d;
                    }
                }
            }
        });
        let mut bands = [0.0f64; 9];
        let (mut total, mut ai_sum) = (0.0, 0.0);
        let mut graded = Vec::new();
        for (pi, p) in points.iter().enumerate() {
            let mut rs: Vec<(&PtalRoute, f64)> = best[pi]
                .iter()
                .map(|(ri, d)| (&req.routes[*ri], *d))
                .collect();
            rs.sort_by(|a, b| a.0.id.cmp(&b.0.id));
            let ai = access_index(&rs, req.walk_m_per_min);
            let b = ptal_band(ai);
            total += p.weight;
            ai_sum += ai * p.weight;
            bands[b] += p.weight;
            if req.list_points > 0 {
                graded.push(PtalPoint {
                    lon: p.lon,
                    lat: p.lat,
                    weight: p.weight,
                    ai: (ai * 100.0).round() / 100.0,
                    band: PTAL_BANDS[b].0,
                });
            }
        }
        graded.sort_by(|a, b| b.weight.total_cmp(&a.weight));
        graded.truncate(req.list_points);
        PtalResult {
            demand_kind: demand_kind.into(),
            total,
            mean_ai: if total > 0.0 { ai_sum / total } else { 0.0 },
            bands: PTAL_BANDS
                .iter()
                .zip(bands)
                .map(|((band, from, to), demand)| PtalBand {
                    band,
                    ai_from: *from,
                    ai_to: *to,
                    demand,
                })
                .collect(),
            points: graded,
            stops_off_network,
            demand_off_network: tgt.iter().filter(|t| t.is_none()).count(),
        }
    }

    /// Purpose: destinations per category within the time limit of each origin, on this graph (the
    /// walk graph, or the cycle graph with the cycling speed in `settings`).
    pub fn reach_counts(&self, req: &ReachCountRequest) -> ReachCountResult {
        let s = &req.settings;
        let area = req.study_area.unwrap_or_else(|| self.bounds_lonlat());
        let inside = |p: &DemandPoint| {
            p.lon >= area[0] && p.lon <= area[2] && p.lat >= area[1] && p.lat <= area[3]
        };
        let (origins, demand_kind): (Vec<DemandPoint>, &str) = match &req.origins {
            Some(d) => (d.iter().filter(|p| inside(p)).cloned().collect(), "points"),
            None => (self.street_cells(req.cell_m, area), "street_cells"),
        };
        let dest_places: Vec<Place> = req
            .destinations
            .iter()
            .map(|d| Place {
                lon: d.lon,
                lat: d.lat,
            })
            .collect();
        let org_places: Vec<Place> = origins
            .iter()
            .map(|p| Place {
                lon: p.lon,
                lat: p.lat,
            })
            .collect();
        let src = self.snap_places(&dest_places, s);
        let tgt = self.snap_places(&org_places, s);
        let k = req.categories;
        let mut counts = vec![vec![0u32; k]; origins.len()];
        let mut nearest = vec![vec![f64::INFINITY; k]; origins.len()];
        // Walks are symmetric on this undirected graph: search from each destination.
        self.pairs(&src, &tgt, Metric::Time, req.limit_s, s, |di, oi, t| {
            let c = req.destinations[di].category;
            if c < k {
                counts[oi][c] += 1;
                nearest[oi][c] = nearest[oi][c].min(t);
            }
        });
        let mut dest_off = vec![0u32; k];
        for (d, sn) in req.destinations.iter().zip(&src) {
            if sn.is_none() && d.category < k {
                dest_off[d.category] += 1;
            }
        }
        ReachCountResult {
            demand_kind: demand_kind.into(),
            origins: origins
                .iter()
                .enumerate()
                .filter(|(i, _)| tgt[*i].is_some())
                .map(|(i, p)| OriginCounts {
                    lon: p.lon,
                    lat: p.lat,
                    weight: p.weight,
                    counts: counts[i].clone(),
                    nearest_s: nearest[i]
                        .iter()
                        .map(|v| v.is_finite().then(|| v.round()))
                        .collect(),
                })
                .collect(),
            origins_off_network: tgt.iter().filter(|t| t.is_none()).count(),
            destinations_off_network: dest_off,
        }
    }
}

fn off(v: &[Option<(Snap, (f64, f64))>]) -> Vec<usize> {
    v.iter()
        .enumerate()
        .filter(|(_, x)| x.is_none())
        .map(|(i, _)| i)
        .collect()
}
