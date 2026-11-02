//! Walk network analysis for stop spacing and walk coverage (ADR-0035 §5 and §6).
//!
//! - [`WalkGraph`]: undirected pedestrian graph from OSM (footways, sidewalks on streets, paths,
//!   pedestrian zones, steps, crossings), never circular buffers.
//! - [`WalkGraph::coverage`]: one multi-source Dijkstra per rule group from every stop gives each
//!   node its walk time (or walking distance) to the nearest stop; demand points or, without them,
//!   the walkable street length are then counted as covered or not. A crow-flies buffer figure is
//!   reported next to it for comparison only.
//! - [`WalkGraph::catchment_geojson`]: the walk network coloured by minutes to the nearest stop.
//! - [`stop_spacing`]: distance between consecutive stops along the route and on foot.
//!
//! Costs: length ÷ walking speed (`demand.walk_speed_kmh`) plus a delay at each signalised
//! crossing (`walk.crossing_delay_s`). Steps are left out in the step-free variant. Gradient is not
//! applied yet: the OSM tiles carry no elevation. The same code runs in the API (WebAssembly for
//! Node), in the browser and in the worker.

use crate::geo::{dist, project_on_segment, LocalProjection};
use crate::osm::{OsmData, Tags};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap};

/// How people walk. Every value is a Project Preference from the assumption library.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct WalkSettings {
    /// `demand.walk_speed_kmh` (central 4.5 km/h).
    pub walk_speed_kmh: f64,
    /// `walk.crossing_delay_s`: average wait at a signalised crossing (central 20 s).
    pub crossing_delay_s: f64,
    /// Leave out steps (the step-free variant of FR-DEM-03).
    pub step_free: bool,
    /// A stop or demand point further than this from any walkable way is not on the network.
    pub max_snap_m: f64,
}

impl Default for WalkSettings {
    fn default() -> Self {
        Self {
            walk_speed_kmh: 4.5,
            crossing_delay_s: 20.0,
            step_free: false,
            max_snap_m: 250.0,
        }
    }
}

impl WalkSettings {
    fn speed_ms(&self) -> f64 {
        (self.walk_speed_kmh / 3.6).max(0.1)
    }
}

/// What a rule measures: walk time in seconds (with crossing delays) or walking distance in metres.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Metric {
    /// Seconds.
    Time,
    /// Metres along the network.
    Distance,
}

/// One undirected walk edge between two consecutive way nodes.
#[derive(Debug, Clone)]
pub struct WalkEdge {
    /// First node.
    pub a: u32,
    /// Second node.
    pub b: u32,
    /// Length in metres.
    pub length_m: f64,
    /// Part of a flight of steps.
    pub steps: bool,
}

/// Undirected pedestrian graph with a grid index for snapping points.
#[derive(Debug, Clone)]
pub struct WalkGraph {
    /// Projection between degrees and local metres.
    pub proj: LocalProjection,
    /// Node positions in local metres.
    pub nodes: Vec<(f64, f64)>,
    /// Signalised crossing at the node.
    pub signals: Vec<bool>,
    /// Edges.
    pub edges: Vec<WalkEdge>,
    adj: Vec<Vec<u32>>,
    grid: HashMap<(i32, i32), Vec<u32>>,
}

const CELL_M: f64 = 100.0;

fn cell(x: f64, y: f64) -> (i32, i32) {
    ((x / CELL_M).floor() as i32, (y / CELL_M).floor() as i32)
}

fn tag<'a>(t: &'a Tags, k: &str) -> Option<&'a str> {
    t.get(k).map(String::as_str)
}

/// Purpose: whether people may walk along a way, and whether it is a flight of steps.
/// Output: `None` when walking is not allowed (motorways, `foot=no`, private, trunk roads without
/// a sidewalk, ways mapped as "use the separate sidewalk").
pub fn walk_way(t: &Tags) -> Option<bool> {
    let hw = tag(t, "highway")?;
    let foot = tag(t, "foot");
    let foot_yes = matches!(foot, Some("yes" | "designated" | "permissive"));
    if matches!(
        foot,
        Some("no" | "private" | "use_sidepath" | "discouraged")
    ) {
        return None;
    }
    if matches!(tag(t, "access"), Some("no" | "private")) && !foot_yes {
        return None;
    }
    let sidewalk = matches!(
        tag(t, "sidewalk").or(tag(t, "sidewalk:both")),
        Some("both" | "left" | "right" | "yes")
    );
    let ok = match hw {
        "footway" | "path" | "pedestrian" | "steps" | "living_street" | "residential"
        | "service" | "unclassified" | "tertiary" | "tertiary_link" | "secondary"
        | "secondary_link" | "primary" | "primary_link" | "track" | "road" | "corridor"
        | "platform" => true,
        "trunk" | "trunk_link" => foot_yes || sidewalk,
        "cycleway" | "bridleway" => foot_yes,
        _ => false,
    };
    ok.then_some(hw == "steps")
}

fn is_signal(t: &Tags) -> bool {
    tag(t, "highway") == Some("traffic_signals")
        || tag(t, "crossing") == Some("traffic_signals")
        || tag(t, "crossing:signals") == Some("yes")
}

/// A point snapped to the walk network.
#[derive(Debug, Clone, Copy)]
struct Snap {
    edge: u32,
    /// Position along the edge, 0 at `a`.
    t: f64,
    /// Straight distance from the point to the network.
    off_m: f64,
}

/// Total-ordered f64 for the priority queue (costs are never NaN).
#[derive(Debug, Clone, Copy, PartialEq)]
struct Cost(f64);
impl Eq for Cost {}
impl PartialOrd for Cost {
    fn partial_cmp(&self, o: &Self) -> Option<Ordering> {
        Some(self.cmp(o))
    }
}
impl Ord for Cost {
    fn cmp(&self, o: &Self) -> Ordering {
        o.0.total_cmp(&self.0)
    }
}

/// Cost to the nearest source for every node, and which source it was.
#[derive(Debug, Clone)]
struct Field {
    cost: Vec<f64>,
    src: Vec<u32>,
}

/// A stop or station given to an analysis.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StopPoint {
    /// Stop id.
    pub id: String,
    /// Longitude.
    pub lon: f64,
    /// Latitude.
    pub lat: f64,
}

/// A weighted demand point, for example a building or a population grid cell centre.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DemandPoint {
    /// Longitude.
    pub lon: f64,
    /// Latitude.
    pub lat: f64,
    /// People (or any weight).
    #[serde(default = "one")]
    pub weight: f64,
}

fn one() -> f64 {
    1.0
}

/// Stops that count for one rule, and the limit they must meet (seconds or metres).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoverageGroup {
    /// Name shown in the report, for example `low capacity (500 m)`.
    pub label: String,
    /// Indices into `CoverageRequest::stops`.
    pub stops: Vec<usize>,
    /// Time or distance.
    pub metric: Metric,
    /// Seconds for time, metres for distance.
    pub limit: f64,
}

/// A coverage question: which demand lies within the limit of any group.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoverageRequest {
    /// All stops referenced by the groups.
    pub stops: Vec<StopPoint>,
    /// One or more rule groups; a point is covered when any group covers it.
    pub groups: Vec<CoverageGroup>,
    /// Weighted points. Without them the walkable street length in the study area is counted.
    #[serde(default)]
    pub demand: Option<Vec<DemandPoint>>,
    /// `[west, south, east, north]`; without it the area around the stops (see API docs).
    #[serde(default)]
    pub study_area: Option<[f64; 4]>,
    /// Walking settings.
    #[serde(default)]
    pub settings: WalkSettings,
    /// How many uncovered demand points to list (largest weight first).
    #[serde(default)]
    pub list_uncovered: usize,
    /// Without `demand`: count walkable street length in square cells of this size (metres) instead of
    /// exactly per edge, so uncovered cells can be listed as gaps.
    #[serde(default)]
    pub street_cells_m: Option<f64>,
}

/// Coverage of one group on its own.
#[derive(Debug, Clone, Serialize)]
pub struct GroupCoverage {
    /// Group label.
    pub label: String,
    /// Covered demand.
    pub covered: f64,
    /// Covered share of the total, 0–1.
    pub share: f64,
}

/// Demand by minutes to the nearest stop (time groups only).
#[derive(Debug, Clone, Serialize)]
pub struct Band {
    /// Lower bound in minutes.
    pub from_min: f64,
    /// Upper bound in minutes (`None` for the open last band).
    pub to_min: Option<f64>,
    /// Demand in the band.
    pub demand: f64,
}

/// An uncovered demand point with its walk to the nearest stop.
#[derive(Debug, Clone, Serialize)]
pub struct Uncovered {
    /// Longitude.
    pub lon: f64,
    /// Latitude.
    pub lat: f64,
    /// Weight.
    pub weight: f64,
    /// Walk time (s) or distance (m) to the nearest stop of the first group; `None` when unreachable.
    pub nearest: Option<f64>,
}

/// Result of a coverage question.
#[derive(Debug, Clone, Serialize)]
pub struct CoverageResult {
    /// `points` (weights summed), `street_length_m` (walkable street metres, a proxy) or `street_cells`
    /// (the same proxy gathered in square cells; `uncovered` then lists cells with their street metres).
    pub demand_kind: String,
    /// Total demand in the study area.
    pub total: f64,
    /// Covered demand along the walk network.
    pub covered: f64,
    /// `covered / total`, 0–1.
    pub share: f64,
    /// Crow-flies comparison: share within the same limit as a straight-line radius.
    pub buffer_share: f64,
    /// Per group.
    pub groups: Vec<GroupCoverage>,
    /// Demand by minutes to the nearest stop of the first time group (5-minute bands).
    pub minutes_bands: Vec<Band>,
    /// Study area used.
    pub study_area: [f64; 4],
    /// Stops further than `max_snap_m` from any walkable way.
    pub stops_off_network: Vec<String>,
    /// Demand points further than `max_snap_m` from any walkable way (counted as not covered).
    pub demand_off_network: usize,
    /// Largest uncovered demand points (up to `list_uncovered`).
    pub uncovered: Vec<Uncovered>,
}

impl WalkGraph {
    /// Purpose: build the walk graph from OSM data.
    /// Inputs: data; an optional projection (`None` centres it on the data).
    /// Output: the graph, or an error when the data holds no walkable way.
    pub fn from_osm(data: &OsmData, proj: Option<LocalProjection>) -> Result<Self, String> {
        let node_by_id: HashMap<i64, usize> = data
            .nodes
            .iter()
            .enumerate()
            .map(|(i, n)| (n.id, i))
            .collect();
        let ways: Vec<(&crate::osm::RawWay, bool)> = data
            .ways
            .iter()
            .filter_map(|w| walk_way(&w.tags).map(|s| (w, s)))
            .collect();
        let (mut lon, mut lat, mut n) = (0.0, 0.0, 0.0);
        for (w, _) in &ways {
            for i in w.nodes.iter().filter_map(|id| node_by_id.get(id)) {
                lon += data.nodes[*i].lon;
                lat += data.nodes[*i].lat;
                n += 1.0;
            }
        }
        if n == 0.0 {
            return Err("No walkable streets or paths in this area.".into());
        }
        let proj = proj.unwrap_or_else(|| LocalProjection::new(lon / n, lat / n));
        let mut g = WalkGraph {
            proj,
            nodes: Vec::new(),
            signals: Vec::new(),
            edges: Vec::new(),
            adj: Vec::new(),
            grid: HashMap::new(),
        };
        let mut local: HashMap<i64, u32> = HashMap::new();
        for (w, steps) in ways {
            let mut prev: Option<u32> = None;
            for id in &w.nodes {
                let Some(&raw) = node_by_id.get(id) else {
                    prev = None;
                    continue;
                };
                let rn = &data.nodes[raw];
                let idx = *local.entry(*id).or_insert_with(|| {
                    g.nodes.push(proj.to_xy(rn.lon, rn.lat));
                    g.signals.push(is_signal(&rn.tags));
                    g.adj.push(Vec::new());
                    (g.nodes.len() - 1) as u32
                });
                if let Some(p) = prev {
                    if p != idx {
                        let length_m = dist(g.nodes[p as usize], g.nodes[idx as usize]);
                        let e = g.edges.len() as u32;
                        g.edges.push(WalkEdge {
                            a: p,
                            b: idx,
                            length_m,
                            steps,
                        });
                        g.adj[p as usize].push(e);
                        g.adj[idx as usize].push(e);
                    }
                }
                prev = Some(idx);
            }
        }
        for (i, e) in g.edges.iter().enumerate() {
            let (a, b) = (g.nodes[e.a as usize], g.nodes[e.b as usize]);
            let (c0, c1) = (
                cell(a.0.min(b.0), a.1.min(b.1)),
                cell(a.0.max(b.0), a.1.max(b.1)),
            );
            for cx in c0.0..=c1.0 {
                for cy in c0.1..=c1.1 {
                    g.grid.entry((cx, cy)).or_default().push(i as u32);
                }
            }
        }
        Ok(g)
    }

    fn usable(&self, e: u32, s: &WalkSettings) -> bool {
        !(s.step_free && self.edges[e as usize].steps)
    }

    fn snap(&self, lon: f64, lat: f64, s: &WalkSettings) -> Option<Snap> {
        let p = self.proj.to_xy(lon, lat);
        let c = cell(p.0, p.1);
        let reach = (s.max_snap_m / CELL_M).ceil() as i32;
        let mut best: Option<Snap> = None;
        for cx in c.0 - reach..=c.0 + reach {
            for cy in c.1 - reach..=c.1 + reach {
                for &e in self.grid.get(&(cx, cy)).map(Vec::as_slice).unwrap_or(&[]) {
                    if !self.usable(e, s) {
                        continue;
                    }
                    let ed = &self.edges[e as usize];
                    let pr =
                        project_on_segment(p, self.nodes[ed.a as usize], self.nodes[ed.b as usize]);
                    if pr.dist <= s.max_snap_m && best.map_or(true, |b| pr.dist < b.off_m) {
                        best = Some(Snap {
                            edge: e,
                            t: pr.t,
                            off_m: pr.dist,
                        });
                    }
                }
            }
        }
        best
    }

    /// Cost of walking `m` metres in the metric (no crossing delay).
    fn along(m: f64, metric: Metric, s: &WalkSettings) -> f64 {
        match metric {
            Metric::Time => m / s.speed_ms(),
            Metric::Distance => m,
        }
    }

    /// Multi-source Dijkstra from snapped sources, stopping beyond `limit`.
    fn field(
        &self,
        sources: &[(u32, Snap)],
        metric: Metric,
        s: &WalkSettings,
        limit: f64,
    ) -> Field {
        let n = self.nodes.len();
        let mut f = Field {
            cost: vec![f64::INFINITY; n],
            src: vec![u32::MAX; n],
        };
        let mut heap = BinaryHeap::new();
        for &(src, sn) in sources {
            let e = &self.edges[sn.edge as usize];
            for (node, m) in [(e.a, sn.t * e.length_m), (e.b, (1.0 - sn.t) * e.length_m)] {
                let mut c = Self::along(sn.off_m + m, metric, s);
                if metric == Metric::Time && m > 0.0 && self.signals[node as usize] {
                    c += s.crossing_delay_s;
                }
                if c < f.cost[node as usize] {
                    f.cost[node as usize] = c;
                    f.src[node as usize] = src;
                    heap.push((Cost(c), node));
                }
            }
        }
        while let Some((Cost(c), u)) = heap.pop() {
            if c > f.cost[u as usize] || c > limit {
                continue;
            }
            for &e in &self.adj[u as usize] {
                if !self.usable(e, s) {
                    continue;
                }
                let ed = &self.edges[e as usize];
                let v = if ed.a == u { ed.b } else { ed.a };
                let mut nc = c + Self::along(ed.length_m, metric, s);
                if metric == Metric::Time && self.signals[v as usize] {
                    nc += s.crossing_delay_s;
                }
                if nc < f.cost[v as usize] {
                    f.cost[v as usize] = nc;
                    f.src[v as usize] = f.src[u as usize];
                    heap.push((Cost(nc), v));
                }
            }
        }
        f
    }

    /// Cost from the nearest source to a snapped point (including same-edge sources).
    fn value(
        &self,
        f: &Field,
        p: Snap,
        same_edge: &[(u32, Snap)],
        metric: Metric,
        s: &WalkSettings,
    ) -> f64 {
        let e = &self.edges[p.edge as usize];
        let off = Self::along(p.off_m, metric, s);
        let mut best = (f.cost[e.a as usize] + Self::along(p.t * e.length_m, metric, s))
            .min(f.cost[e.b as usize] + Self::along((1.0 - p.t) * e.length_m, metric, s));
        for (_, q) in same_edge.iter().filter(|(_, q)| q.edge == p.edge) {
            best = best.min(Self::along(
                q.off_m + (p.t - q.t).abs() * e.length_m,
                metric,
                s,
            ));
        }
        best + off
    }

    /// Purpose: snap stops; returns the snapped ones (index, snap) and the ids that are off the network.
    fn snap_stops(
        &self,
        stops: &[StopPoint],
        s: &WalkSettings,
    ) -> (Vec<Option<Snap>>, Vec<String>) {
        let snaps: Vec<Option<Snap>> = stops.iter().map(|p| self.snap(p.lon, p.lat, s)).collect();
        let off = stops
            .iter()
            .zip(&snaps)
            .filter(|(_, sn)| sn.is_none())
            .map(|(p, _)| p.id.clone())
            .collect();
        (snaps, off)
    }

    /// Purpose: bounds of the network `[west, south, east, north]` in degrees.
    pub fn bounds_lonlat(&self) -> [f64; 4] {
        let mut b = [
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        ];
        for &(x, y) in &self.nodes {
            let (lon, lat) = self.proj.to_lonlat(x, y);
            b = [b[0].min(lon), b[1].min(lat), b[2].max(lon), b[3].max(lat)];
        }
        b
    }

    /// Purpose: answer a coverage question (ADR-0035 §6).
    /// Inputs: the request. Output: covered demand, per group, by 5-minute band, with a crow-flies
    /// comparison. Demand outside the study area is ignored.
    pub fn coverage(&self, req: &CoverageRequest) -> CoverageResult {
        let s = &req.settings;
        let (snaps, stops_off_network) = self.snap_stops(&req.stops, s);
        let area = req.study_area.unwrap_or_else(|| self.bounds_lonlat());
        let inside = |lon: f64, lat: f64| {
            lon >= area[0] && lon <= area[2] && lat >= area[1] && lat <= area[3]
        };
        let fields: Vec<(Field, Vec<(u32, Snap)>)> = req
            .groups
            .iter()
            .map(|g| {
                let src: Vec<(u32, Snap)> = g
                    .stops
                    .iter()
                    .filter_map(|&i| snaps.get(i).copied().flatten().map(|sn| (i as u32, sn)))
                    .collect();
                // Search a little beyond the limit so the bands above it are filled.
                let reach = if g.metric == Metric::Time {
                    g.limit.max(1200.0) * 2.0
                } else {
                    g.limit * 2.0
                };
                (self.field(&src, g.metric, s, reach), src)
            })
            .collect();
        let time_group = req.groups.iter().position(|g| g.metric == Metric::Time);
        let mut band_vals = [0.0f64; 5];
        let mut group_cov = vec![0.0f64; req.groups.len()];
        let (mut total, mut covered, mut buffer) = (0.0, 0.0, 0.0);
        let mut demand_off_network = 0usize;
        let mut uncovered: Vec<Uncovered> = Vec::new();
        let demand_kind;
        let band_of = |secs: f64| ((secs / 300.0).floor() as usize).min(4);

        let cells = match (&req.demand, req.street_cells_m) {
            (None, Some(m)) => Some(self.street_cells(m, area)),
            _ => None,
        };
        if let Some(points) = req.demand.as_ref().or(cells.as_ref()) {
            demand_kind = if cells.is_some() {
                "street_cells"
            } else {
                "points"
            };
            let stop_xy: Vec<(f64, f64)> = req
                .stops
                .iter()
                .map(|p| self.proj.to_xy(p.lon, p.lat))
                .collect();
            for d in points.iter().filter(|d| inside(d.lon, d.lat)) {
                total += d.weight;
                let xy = self.proj.to_xy(d.lon, d.lat);
                // Crow-flies comparison: any stop of a group within the limit as a radius.
                let in_buffer = req.groups.iter().any(|g| {
                    let r = match g.metric {
                        Metric::Time => g.limit * s.speed_ms(),
                        Metric::Distance => g.limit,
                    };
                    g.stops
                        .iter()
                        .any(|&i| stop_xy.get(i).is_some_and(|q| dist(xy, *q) <= r))
                });
                if in_buffer {
                    buffer += d.weight;
                }
                let Some(sn) = self.snap(d.lon, d.lat, s) else {
                    demand_off_network += 1;
                    if req.list_uncovered > 0 {
                        uncovered.push(Uncovered {
                            lon: d.lon,
                            lat: d.lat,
                            weight: d.weight,
                            nearest: None,
                        });
                    }
                    continue;
                };
                let mut any = false;
                let mut first: Option<f64> = None;
                for (gi, (g, (f, src))) in req.groups.iter().zip(&fields).enumerate() {
                    let v = self.value(f, sn, src, g.metric, s);
                    if gi == 0 {
                        first = v.is_finite().then_some(v);
                    }
                    if Some(gi) == time_group && v.is_finite() {
                        band_vals[band_of(v)] += d.weight;
                    } else if Some(gi) == time_group {
                        band_vals[4] += d.weight;
                    }
                    if v <= g.limit {
                        group_cov[gi] += d.weight;
                        any = true;
                    }
                }
                if any {
                    covered += d.weight;
                } else if req.list_uncovered > 0 {
                    uncovered.push(Uncovered {
                        lon: d.lon,
                        lat: d.lat,
                        weight: d.weight,
                        nearest: first,
                    });
                }
            }
        } else {
            demand_kind = "street_length_m";
            for e in &self.edges {
                let (pa, pb) = (self.nodes[e.a as usize], self.nodes[e.b as usize]);
                let mid = self
                    .proj
                    .to_lonlat((pa.0 + pb.0) / 2.0, (pa.1 + pb.1) / 2.0);
                if !inside(mid.0, mid.1) {
                    continue;
                }
                let l = e.length_m;
                total += l;
                let (mut ca, mut cb) = (0.0f64, 0.0f64);
                for (gi, (g, (f, _))) in req.groups.iter().zip(&fields).enumerate() {
                    let unit = Self::along(1.0, g.metric, s);
                    let reach = |c: f64| ((g.limit - c) / unit).clamp(0.0, l);
                    let (ga, gb) = (reach(f.cost[e.a as usize]), reach(f.cost[e.b as usize]));
                    group_cov[gi] += (ga + gb).min(l);
                    ca = ca.max(ga);
                    cb = cb.max(gb);
                    if Some(gi) == time_group {
                        let mid_c = (f.cost[e.a as usize] + Self::along(l / 2.0, g.metric, s))
                            .min(f.cost[e.b as usize] + Self::along(l / 2.0, g.metric, s));
                        if mid_c.is_finite() {
                            band_vals[band_of(mid_c)] += l;
                        } else {
                            band_vals[4] += l;
                        }
                    }
                }
                covered += (ca + cb).min(l);
                // Crow-flies comparison at the edge midpoint.
                let m = ((pa.0 + pb.0) / 2.0, (pa.1 + pb.1) / 2.0);
                let in_buffer = req.groups.iter().any(|g| {
                    let r = match g.metric {
                        Metric::Time => g.limit * s.speed_ms(),
                        Metric::Distance => g.limit,
                    };
                    g.stops.iter().any(|&i| {
                        req.stops
                            .get(i)
                            .is_some_and(|p| dist(m, self.proj.to_xy(p.lon, p.lat)) <= r)
                    })
                });
                if in_buffer {
                    buffer += l;
                }
            }
        }
        uncovered.sort_by(|a, b| b.weight.total_cmp(&a.weight));
        uncovered.truncate(req.list_uncovered);
        let share = |v: f64| if total > 0.0 { v / total } else { 0.0 };
        let minutes_bands = if time_group.is_some() {
            (0..5)
                .map(|i| Band {
                    from_min: i as f64 * 5.0,
                    to_min: (i < 4).then_some((i + 1) as f64 * 5.0),
                    demand: band_vals[i],
                })
                .collect()
        } else {
            Vec::new()
        };
        CoverageResult {
            demand_kind: demand_kind.into(),
            total,
            covered,
            share: share(covered),
            buffer_share: share(buffer),
            groups: req
                .groups
                .iter()
                .zip(&group_cov)
                .map(|(g, c)| GroupCoverage {
                    label: g.label.clone(),
                    covered: *c,
                    share: share(*c),
                })
                .collect(),
            minutes_bands,
            study_area: area,
            stops_off_network,
            demand_off_network,
            uncovered,
        }
    }

    /// Purpose: the walk network around the stops as GeoJSON, each edge with `minutes` (to the nearest
    /// stop, at its midpoint) and `stop` (id of that stop). Edges further than `max_minutes` are left out.
    pub fn catchment_geojson(
        &self,
        stops: &[StopPoint],
        max_minutes: f64,
        s: &WalkSettings,
    ) -> String {
        let (snaps, _) = self.snap_stops(stops, s);
        let src: Vec<(u32, Snap)> = snaps
            .iter()
            .enumerate()
            .filter_map(|(i, sn)| sn.map(|sn| (i as u32, sn)))
            .collect();
        let limit = max_minutes * 60.0;
        let f = self.field(&src, Metric::Time, s, limit);
        let mut feats: Vec<serde_json::Value> = Vec::new();
        for (ei, e) in self.edges.iter().enumerate() {
            if !self.usable(ei as u32, s) {
                continue;
            }
            let half = Self::along(e.length_m / 2.0, Metric::Time, s);
            let (ca, cb) = (f.cost[e.a as usize] + half, f.cost[e.b as usize] + half);
            let mid = ca.min(cb);
            if !mid.is_finite() || mid > limit {
                continue;
            }
            let from = if ca <= cb { e.a } else { e.b };
            let stop = stops
                .get(f.src[from as usize] as usize)
                .map(|p| p.id.clone());
            let ll = |n: u32| {
                let (x, y) = self.nodes[n as usize];
                let (lon, lat) = self.proj.to_lonlat(x, y);
                [round6(lon), round6(lat)]
            };
            feats.push(serde_json::json!({
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": [ll(e.a), ll(e.b)]},
                "properties": {"minutes": (mid / 6.0).round() / 10.0, "stop": stop},
            }));
        }
        serde_json::json!({"type": "FeatureCollection", "features": feats}).to_string()
    }

    /// Purpose: walkable street length gathered in square cells of `cell_m` metres inside `area`.
    /// Output: one demand point per cell with street, placed at the edge midpoint nearest the cell
    /// centre (so it lies on the network), weighted by the street metres in the cell.
    pub fn street_cells(&self, cell_m: f64, area: [f64; 4]) -> Vec<DemandPoint> {
        let cell_m = cell_m.max(25.0);
        // Per cell: street metres, representative point, its distance to the cell centre.
        type Cell = (f64, (f64, f64), f64);
        let mut cells: HashMap<(i64, i64), Cell> = HashMap::new();
        for e in &self.edges {
            let (pa, pb) = (self.nodes[e.a as usize], self.nodes[e.b as usize]);
            let m = ((pa.0 + pb.0) / 2.0, (pa.1 + pb.1) / 2.0);
            let (lon, lat) = self.proj.to_lonlat(m.0, m.1);
            if lon < area[0] || lon > area[2] || lat < area[1] || lat > area[3] {
                continue;
            }
            let key = ((m.0 / cell_m).floor() as i64, (m.1 / cell_m).floor() as i64);
            let centre = ((key.0 as f64 + 0.5) * cell_m, (key.1 as f64 + 0.5) * cell_m);
            let d = dist(m, centre);
            let c = cells.entry(key).or_insert((0.0, m, f64::INFINITY));
            c.0 += e.length_m;
            if d < c.2 {
                c.1 = m;
                c.2 = d;
            }
        }
        let mut keys: Vec<_> = cells.keys().copied().collect();
        keys.sort_unstable();
        keys.into_iter()
            .map(|k| {
                let (w, m, _) = cells[&k];
                let (lon, lat) = self.proj.to_lonlat(m.0, m.1);
                DemandPoint {
                    lon,
                    lat,
                    weight: w.round(),
                }
            })
            .collect()
    }

    /// Purpose: suggest where to add stops so the most demand gains a walk within the limit: the Maximal
    /// Covering Location Problem (Church & ReVelle 1974) solved greedily, which reaches at least 63 % of
    /// the optimum (1 − 1/e) and is exact for one stop.
    /// Inputs: the request. Output: up to `k` candidates in the order chosen, with the demand each adds.
    pub fn suggest_stops(&self, req: &SuggestRequest) -> SuggestResult {
        let s = &req.settings;
        let area = req.study_area.unwrap_or_else(|| self.bounds_lonlat());
        let cells;
        let (points, demand_kind): (&[DemandPoint], &str) = match &req.demand {
            Some(p) => (p, "points"),
            None => {
                cells = self.street_cells(req.street_cells_m.unwrap_or(150.0), area);
                (&cells, "street_cells")
            }
        };
        let pts: Vec<(usize, Snap)> = points
            .iter()
            .enumerate()
            .filter(|(_, d)| {
                d.lon >= area[0] && d.lon <= area[2] && d.lat >= area[1] && d.lat <= area[3]
            })
            .filter_map(|(i, d)| self.snap(d.lon, d.lat, s).map(|sn| (i, sn)))
            .collect();
        let total: f64 = pts.iter().map(|(i, _)| points[*i].weight).sum();
        let (ex, _) = self.snap_stops(&req.existing, s);
        let ex_src: Vec<(u32, Snap)> = ex
            .iter()
            .enumerate()
            .filter_map(|(i, sn)| sn.map(|sn| (i as u32, sn)))
            .collect();
        let f = self.field(&ex_src, Metric::Time, s, req.limit_s);
        let mut covered: Vec<bool> = pts
            .iter()
            .map(|(_, sn)| self.value(&f, *sn, &ex_src, Metric::Time, s) <= req.limit_s)
            .collect();
        let before: f64 = pts
            .iter()
            .zip(&covered)
            .filter(|(_, c)| **c)
            .map(|((i, _), _)| points[*i].weight)
            .sum();
        // Demand points each candidate would cover on its own.
        let cand: Vec<(usize, Vec<usize>)> = req
            .candidates
            .iter()
            .take(MAX_CANDIDATES)
            .enumerate()
            .filter_map(|(ci, c)| {
                let sn = self.snap(c.lon, c.lat, s)?;
                let src = [(0u32, sn)];
                let f = self.field(&src, Metric::Time, s, req.limit_s);
                let cover: Vec<usize> = pts
                    .iter()
                    .enumerate()
                    .filter(|(pi, (_, p))| {
                        !covered[*pi] && self.value(&f, *p, &src, Metric::Time, s) <= req.limit_s
                    })
                    .map(|(pi, _)| pi)
                    .collect();
                (!cover.is_empty()).then_some((ci, cover))
            })
            .collect();
        let mut placed: Vec<(f64, f64)> = req
            .existing
            .iter()
            .map(|p| self.proj.to_xy(p.lon, p.lat))
            .collect();
        let mut suggestions = Vec::new();
        let mut after = before;
        for _ in 0..req.k {
            let best = cand
                .iter()
                .filter(|(ci, _)| {
                    let c = &req.candidates[*ci];
                    let xy = self.proj.to_xy(c.lon, c.lat);
                    placed.iter().all(|q| dist(xy, *q) >= req.min_spacing_m)
                })
                .map(|(ci, cover)| {
                    let gain: f64 = cover
                        .iter()
                        .filter(|pi| !covered[**pi])
                        .map(|pi| points[pts[*pi].0].weight)
                        .sum();
                    (ci, cover, gain)
                })
                .filter(|(_, _, g)| *g > 0.0)
                .max_by(|a, b| a.2.total_cmp(&b.2).then(b.0.cmp(a.0)));
            let Some((ci, cover, gain)) = best else { break };
            for pi in cover {
                covered[*pi] = true;
            }
            after += gain;
            let c = &req.candidates[*ci];
            placed.push(self.proj.to_xy(c.lon, c.lat));
            suggestions.push(Suggestion {
                candidate: c.id.clone(),
                lon: c.lon,
                lat: c.lat,
                gain,
            });
        }
        SuggestResult {
            demand_kind: demand_kind.into(),
            total,
            covered_before: before,
            covered_after: after,
            suggestions,
        }
    }

    /// Purpose: walking distance in metres between two points along the network (`None` when either
    /// is off the network or the walk is longer than `limit_m`).
    pub fn walk_distance(
        &self,
        from: (f64, f64),
        to: (f64, f64),
        limit_m: f64,
        s: &WalkSettings,
    ) -> Option<f64> {
        let a = self.snap(from.0, from.1, s)?;
        let b = self.snap(to.0, to.1, s)?;
        let f = self.field(&[(0, a)], Metric::Distance, s, limit_m);
        let v = self.value(&f, b, &[(0, a)], Metric::Distance, s);
        (v <= limit_m).then_some(v)
    }
}

/// Most candidate locations one suggestion run evaluates (each needs its own Dijkstra).
pub const MAX_CANDIDATES: usize = 400;

/// Where new stops would add the most walk coverage (ADR-0035 §6, `suggest_stop_locations`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SuggestRequest {
    /// Stops already served.
    pub existing: Vec<StopPoint>,
    /// Candidate locations, for example every 100 m along existing routes (first `MAX_CANDIDATES` used).
    pub candidates: Vec<StopPoint>,
    /// Weighted demand points; without them, walkable street length in cells.
    #[serde(default)]
    pub demand: Option<Vec<DemandPoint>>,
    /// Cell size for the street-length proxy (default 150 m).
    #[serde(default)]
    pub street_cells_m: Option<f64>,
    /// `[west, south, east, north]`.
    #[serde(default)]
    pub study_area: Option<[f64; 4]>,
    /// Walk limit in seconds.
    pub limit_s: f64,
    /// Number of stops to add.
    pub k: usize,
    /// No two stops (new or existing) closer than this, straight line, metres.
    pub min_spacing_m: f64,
    /// Walking settings.
    #[serde(default)]
    pub settings: WalkSettings,
}

/// One suggested stop.
#[derive(Debug, Clone, Serialize)]
pub struct Suggestion {
    /// Candidate id.
    pub candidate: String,
    /// Longitude.
    pub lon: f64,
    /// Latitude.
    pub lat: f64,
    /// Demand newly within the limit thanks to this stop.
    pub gain: f64,
}

/// Result of a suggestion run.
#[derive(Debug, Clone, Serialize)]
pub struct SuggestResult {
    /// `points` or `street_cells`.
    pub demand_kind: String,
    /// Total demand in the study area on the walk network.
    pub total: f64,
    /// Covered before adding stops.
    pub covered_before: f64,
    /// Covered after adding the suggested stops.
    pub covered_after: f64,
    /// Chosen stops in order.
    pub suggestions: Vec<Suggestion>,
}

fn round6(v: f64) -> f64 {
    (v * 1e6).round() / 1e6
}

/// A stop-spacing question for one route pattern (one direction of a line).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpacingRequest {
    /// Stops in running order.
    pub stops: Vec<StopPoint>,
    /// Route geometry `[lon, lat]` in running order; without it the straight line between stops.
    #[serde(default)]
    pub route: Option<Vec<[f64; 2]>>,
    /// Guidance range `[low, high]` in metres (`mode.stop_spacing_m`); segments outside are flagged.
    #[serde(default)]
    pub guidance_m: Option<[f64; 2]>,
    /// Walking settings for the on-foot distance.
    #[serde(default)]
    pub settings: WalkSettings,
}

/// Spacing between two consecutive stops.
#[derive(Debug, Clone, Serialize)]
pub struct SpacingSegment {
    /// From stop id.
    pub from: String,
    /// To stop id.
    pub to: String,
    /// Along the route geometry, metres.
    pub along_m: f64,
    /// Straight line, metres.
    pub straight_m: f64,
    /// On foot along the walk network (`None` without a walk network or when unreachable).
    pub walk_m: Option<f64>,
    /// `short` or `long` against the guidance range, else `None`.
    pub flag: Option<String>,
}

/// Summary statistics of a set of values.
#[derive(Debug, Clone, Serialize, Default)]
pub struct Stats {
    /// Number of values.
    pub count: usize,
    /// Mean.
    pub mean: f64,
    /// Median.
    pub median: f64,
    /// 10th percentile.
    pub p10: f64,
    /// 90th percentile.
    pub p90: f64,
    /// Smallest.
    pub min: f64,
    /// Largest.
    pub max: f64,
}

/// Purpose: summary statistics (linear-interpolated percentiles). Empty input gives zeros.
pub fn stats(values: &[f64]) -> Stats {
    if values.is_empty() {
        return Stats::default();
    }
    let mut v = values.to_vec();
    v.sort_by(f64::total_cmp);
    let q = |p: f64| {
        let r = p * (v.len() - 1) as f64;
        let (lo, hi) = (r.floor() as usize, r.ceil() as usize);
        v[lo] + (v[hi] - v[lo]) * (r - lo as f64)
    };
    Stats {
        count: v.len(),
        mean: v.iter().sum::<f64>() / v.len() as f64,
        median: q(0.5),
        p10: q(0.1),
        p90: q(0.9),
        min: v[0],
        max: v[v.len() - 1],
    }
}

/// Histogram bin.
#[derive(Debug, Clone, Serialize)]
pub struct Bin {
    /// Lower bound, metres.
    pub from_m: f64,
    /// Upper bound, metres.
    pub to_m: f64,
    /// Segments in the bin.
    pub count: usize,
}

/// Result of a stop-spacing question.
#[derive(Debug, Clone, Serialize)]
pub struct SpacingResult {
    /// `route` or `straight` (no geometry given).
    pub geometry: String,
    /// One per pair of consecutive stops.
    pub segments: Vec<SpacingSegment>,
    /// Statistics of `along_m`.
    pub along: Stats,
    /// Statistics of `walk_m` where known.
    pub walk: Stats,
    /// 100 m bins of `along_m` (wider when spacing is long).
    pub histogram: Vec<Bin>,
    /// Segments flagged short / long.
    pub short: usize,
    /// See `short`.
    pub long: usize,
}

/// Purpose: stop spacing along a route and on foot (ADR-0035 §5).
/// Inputs: the request; the walk graph when one is loaded (else `walk_m` stays empty).
/// Output: per-segment distances, statistics, histogram and flags.
pub fn stop_spacing(req: &SpacingRequest, walk: Option<&WalkGraph>) -> SpacingResult {
    let proj = walk.map(|w| w.proj).unwrap_or_else(|| {
        let p = req.stops.first().map_or((0.0, 0.0), |p| (p.lon, p.lat));
        LocalProjection::new(p.0, p.1)
    });
    let xy: Vec<(f64, f64)> = req.stops.iter().map(|p| proj.to_xy(p.lon, p.lat)).collect();
    let route: Option<Vec<(f64, f64)>> = req
        .route
        .as_ref()
        .filter(|r| r.len() >= 2)
        .map(|r| r.iter().map(|c| proj.to_xy(c[0], c[1])).collect());
    // Chainage of each stop on the route, never going backwards (routes may loop or overlap).
    let chain: Vec<f64> = match &route {
        Some(r) => {
            let cum: Vec<f64> = std::iter::once(0.0)
                .chain(r.windows(2).scan(0.0, |acc, w| {
                    *acc += dist(w[0], w[1]);
                    Some(*acc)
                }))
                .collect();
            let mut out = Vec::with_capacity(xy.len());
            let mut from_seg = 0usize;
            let mut last = 0.0f64;
            for p in &xy {
                let mut best: Option<(f64, f64, usize)> = None;
                for i in from_seg..r.len() - 1 {
                    let pr = project_on_segment(*p, r[i], r[i + 1]);
                    let ch = cum[i] + pr.t * (cum[i + 1] - cum[i]);
                    if ch + 1e-6 < last {
                        continue;
                    }
                    if best.map_or(true, |b| pr.dist < b.0 - 1e-9) {
                        best = Some((pr.dist, ch, i));
                    }
                }
                let (_, ch, i) = best.unwrap_or((0.0, last, from_seg));
                out.push(ch);
                last = ch;
                from_seg = i;
            }
            out
        }
        None => std::iter::once(0.0)
            .chain(xy.windows(2).scan(0.0, |acc, w| {
                *acc += dist(w[0], w[1]);
                Some(*acc)
            }))
            .collect(),
    };
    let mut segments = Vec::new();
    for i in 1..req.stops.len() {
        let along = chain[i] - chain[i - 1];
        let straight = dist(xy[i - 1], xy[i]);
        let walk_m = walk.and_then(|w| {
            let (a, b) = (&req.stops[i - 1], &req.stops[i]);
            w.walk_distance(
                (a.lon, a.lat),
                (b.lon, b.lat),
                (straight * 4.0).max(2000.0),
                &req.settings,
            )
        });
        let flag = req.guidance_m.and_then(|[lo, hi]| {
            if along < lo {
                Some("short".to_string())
            } else if along > hi {
                Some("long".to_string())
            } else {
                None
            }
        });
        segments.push(SpacingSegment {
            from: req.stops[i - 1].id.clone(),
            to: req.stops[i].id.clone(),
            along_m: along.round(),
            straight_m: straight.round(),
            walk_m: walk_m.map(f64::round),
            flag,
        });
    }
    let along: Vec<f64> = segments.iter().map(|s| s.along_m).collect();
    let walks: Vec<f64> = segments.iter().filter_map(|s| s.walk_m).collect();
    let max = along.iter().copied().fold(0.0, f64::max);
    let width = if max <= 2000.0 {
        100.0
    } else if max <= 10_000.0 {
        500.0
    } else {
        5000.0
    };
    let nbins = ((max / width).floor() as usize + 1).min(200);
    let mut histogram: Vec<Bin> = (0..nbins)
        .map(|i| Bin {
            from_m: i as f64 * width,
            to_m: (i + 1) as f64 * width,
            count: 0,
        })
        .collect();
    for a in &along {
        let i = ((a / width).floor() as usize).min(nbins - 1);
        histogram[i].count += 1;
    }
    if along.is_empty() {
        histogram.clear();
    }
    SpacingResult {
        geometry: if route.is_some() { "route" } else { "straight" }.into(),
        short: segments
            .iter()
            .filter(|s| s.flag.as_deref() == Some("short"))
            .count(),
        long: segments
            .iter()
            .filter(|s| s.flag.as_deref() == Some("long"))
            .count(),
        along: stats(&along),
        walk: stats(&walks),
        histogram,
        segments,
    }
}
