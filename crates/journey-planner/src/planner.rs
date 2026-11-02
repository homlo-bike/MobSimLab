//! RAPTOR journey planner (Delling, Pajor & Werneck, "Round-Based Public Transit Routing", Transportation
//! Science 49(3), 2015).
//!
//! Round k finds the earliest arrival at every stop with at most k vehicles. Trips with the same stop
//! sequence form a route; a route whose trips overtake each other is split so that every route is FIFO and
//! the earliest catchable trip can be found by binary search. Walking from the origin, between stops and to
//! the destination uses straight-line distance times a detour factor until the walking graph exists.
//! Arrive-by queries search for the latest departure whose earliest arrival is not after the asked time:
//! the earliest arrival never decreases with a later departure, so a binary search is exact.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::journey::{Journey, Leg, Place, WaitKind, WalkKind};
use crate::settings::Settings;
use crate::timetable::{Route as RouteInfo, Timetable};

const INF: u32 = u32::MAX;

/// Depart at, or arrive by, the asked time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TimeMode {
    DepartAt,
    ArriveBy,
}

/// One A-to-B question.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Query {
    /// `[lon, lat]` of A.
    pub from: [f64; 2],
    /// `[lon, lat]` of B.
    pub to: [f64; 2],
    pub time_s: u32,
    pub mode: TimeMode,
}

/// The same question asked every `step_s` from `start_s` to `end_s` (inclusive).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileQuery {
    pub from: [f64; 2],
    pub to: [f64; 2],
    pub mode: TimeMode,
    pub start_s: u32,
    pub end_s: u32,
    pub step_s: u32,
}

/// The answer to one question: the fastest journey first, then journeys with fewer changes that take longer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Plan {
    pub query: Query,
    pub journeys: Vec<Journey>,
}

/// One point of a time-of-day profile.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfilePoint {
    pub time_s: u32,
    pub journey: Option<Journey>,
}

/// Counts shown next to the planner so the planner knows what it is routing on.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkSummary {
    pub stops: usize,
    pub routes: usize,
    pub trips: usize,
    pub raptor_routes: usize,
    pub footpaths: usize,
    /// Stations with more than one stop (platforms of one station, a station group, or same-name stops).
    #[serde(default)]
    pub stations: usize,
    /// Stops joined into a station because they share a name with a stop close by.
    #[serde(default)]
    pub joined_by_name: usize,
    pub first_departure_s: Option<u32>,
    pub last_arrival_s: Option<u32>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone)]
struct StopData {
    place: Place,
    x: f64,
    y: f64,
    change_s: u32,
    change_guaranteed: bool,
}

#[derive(Debug, Clone)]
struct TripData {
    trip_id: String,
    route: usize,
    arr: Vec<u32>,
    dep: Vec<u32>,
    board: Vec<bool>,
    alight: Vec<bool>,
}

#[derive(Debug, Clone)]
struct RaptorRoute {
    stops: Vec<usize>,
    trips: Vec<TripData>,
}

#[derive(Debug, Clone, Copy)]
struct Foot {
    to: usize,
    dur: u32,
    straight_m: f64,
    guaranteed: bool,
}

#[derive(Debug, Clone, Copy)]
enum VLabel {
    None,
    Ride {
        route: u32,
        trip: u32,
        board: u32,
        alight: u32,
        from_foot: bool,
    },
}

#[derive(Debug, Clone, Copy)]
enum FLabel {
    None,
    Access { dur: u32, straight_m: f64 },
    Walk { from: usize, foot: usize },
}

/// A timetable compiled for routing.
#[derive(Debug, Clone)]
pub struct Planner {
    settings: Settings,
    stops: Vec<StopData>,
    lines: Vec<RouteInfo>,
    routes: Vec<RaptorRoute>,
    stop_routes: Vec<Vec<(usize, usize)>>,
    footpaths: Vec<Vec<Foot>>,
    summary: NetworkSummary,
    k_lat: f64,
    k_lon: f64,
}

/// Union-find over stop indices: the stations.
struct Stations {
    parent: Vec<usize>,
}

impl Stations {
    fn new(n: usize) -> Self {
        Self {
            parent: (0..n).collect(),
        }
    }
    fn find(&mut self, i: usize) -> usize {
        let mut r = i;
        while self.parent[r] != r {
            r = self.parent[r];
        }
        let mut j = i;
        while self.parent[j] != r {
            let next = self.parent[j];
            self.parent[j] = r;
            j = next;
        }
        r
    }
    fn union(&mut self, a: usize, b: usize) {
        let (ra, rb) = (self.find(a), self.find(b));
        if ra != rb {
            self.parent[ra.max(rb)] = ra.min(rb);
        }
    }
}

/// Purpose: the key two stop names are compared by; case, accents and spacing are ignored (as
/// `rail_model::normalise_name` and the web app's `normaliseName`).
pub fn normalise_name(name: &str) -> String {
    use unicode_normalization::UnicodeNormalization;
    let stripped: String = name
        .nfd()
        .filter(|c| !unicode_normalization::char::is_combining_mark(*c))
        .collect::<String>()
        .to_lowercase();
    stripped
        .split(|c: char| c.is_whitespace() || c == '-' || c == '.' || c == '_')
        .filter(|w| !w.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Mean Earth radius in metres.
const EARTH_RADIUS_M: f64 = 6_371_008.8;

impl Planner {
    /// Purpose: compile a timetable (exact trips plus expanded frequency patterns) for routing.
    /// Output: the planner; problems that make data unusable (unknown stops or routes) are warnings.
    pub fn new(tt: &Timetable, settings: Settings) -> Planner {
        let mut warnings = Vec::new();
        let lat0 = if tt.stops.is_empty() {
            0.0
        } else {
            tt.stops.iter().map(|s| s.stop_lat).sum::<f64>() / tt.stops.len() as f64
        };
        let k_lat = EARTH_RADIUS_M * std::f64::consts::PI / 180.0;
        let k_lon = k_lat * lat0.to_radians().cos();
        let mut stop_index = HashMap::new();
        let mut stops = Vec::with_capacity(tt.stops.len());
        let mut parent: Vec<Option<&String>> = Vec::with_capacity(tt.stops.len());
        for s in &tt.stops {
            if stop_index.contains_key(&s.stop_id) {
                warnings.push(format!(
                    "Stop {} is listed twice; the first entry is used.",
                    s.stop_id
                ));
                continue;
            }
            stop_index.insert(s.stop_id.clone(), stops.len());
            parent.push(s.parent_station.as_ref());
            stops.push(StopData {
                place: Place {
                    name: s.stop_name.clone(),
                    stop_id: Some(s.stop_id.clone()),
                    platform_code: s.platform_code.clone(),
                    lon: s.stop_lon,
                    lat: s.stop_lat,
                },
                x: s.stop_lon * k_lon,
                y: s.stop_lat * k_lat,
                change_s: settings.min_change_s,
                change_guaranteed: false,
            });
        }
        let mut lines = tt.routes.clone();
        let mut line_index: HashMap<String, usize> = lines
            .iter()
            .enumerate()
            .map(|(i, r)| (r.route_id.clone(), i))
            .collect();

        // Exact trips, then frequency patterns expanded into trips.
        let mut all_trips = tt.trips.clone();
        for p in &tt.frequency_patterns {
            all_trips.extend(p.expand());
        }
        let mut by_seq: HashMap<Vec<usize>, Vec<TripData>> = HashMap::new();
        let mut n_trips = 0;
        let (mut first, mut last) = (INF, 0u32);
        for t in &all_trips {
            if let Some(sid) = &settings.service_id {
                if &t.service_id != sid {
                    continue;
                }
            }
            let route = *line_index.entry(t.route_id.clone()).or_insert_with(|| {
                warnings.push(format!(
                    "Route {} is not listed; shown by its id.",
                    t.route_id
                ));
                lines.push(RouteInfo {
                    route_id: t.route_id.clone(),
                    route_short_name: t.route_id.clone(),
                    mode: "bus".into(),
                    route_color: None,
                });
                lines.len() - 1
            });
            let mut st: Vec<_> = t.stop_times.iter().collect();
            st.sort_by_key(|s| s.stop_sequence);
            let mut seq = Vec::with_capacity(st.len());
            let mut ok = st.len() >= 2;
            for s in &st {
                match stop_index.get(&s.stop_id) {
                    Some(&i) => seq.push(i),
                    None => {
                        warnings.push(format!(
                            "Trip {} calls at unknown stop {}; skipped.",
                            t.trip_id, s.stop_id
                        ));
                        ok = false;
                        break;
                    }
                }
            }
            let arr: Vec<u32> = st.iter().map(|s| s.arrival_time).collect();
            let dep: Vec<u32> = st
                .iter()
                .map(|s| s.departure_time.max(s.arrival_time))
                .collect();
            if ok && (1..arr.len()).any(|i| arr[i] < dep[i - 1]) {
                warnings.push(format!("Trip {} goes back in time; skipped.", t.trip_id));
                ok = false;
            }
            if !ok {
                continue;
            }
            first = first.min(dep[0]);
            last = last.max(*arr.last().unwrap());
            n_trips += 1;
            by_seq.entry(seq).or_default().push(TripData {
                trip_id: t.trip_id.clone(),
                route,
                arr,
                dep,
                board: st.iter().map(|s| s.pickup_type != 1).collect(),
                alight: st.iter().map(|s| s.drop_off_type != 1).collect(),
            });
        }

        // FIFO routes: trips sorted by first departure, split where one would overtake another.
        let mut seqs: Vec<_> = by_seq.into_iter().collect();
        seqs.sort_by(|a, b| a.0.cmp(&b.0));
        let mut routes: Vec<RaptorRoute> = Vec::new();
        for (seq, mut trips) in seqs {
            trips.sort_by(|a, b| a.dep[0].cmp(&b.dep[0]).then(a.arr.cmp(&b.arr)));
            let mut groups: Vec<Vec<TripData>> = Vec::new();
            for t in trips {
                let fits = |g: &Vec<TripData>| {
                    let p = g.last().unwrap();
                    (0..t.arr.len()).all(|i| t.arr[i] >= p.arr[i] && t.dep[i] >= p.dep[i])
                };
                match groups.iter_mut().find(|g| fits(g)) {
                    Some(g) => g.push(t),
                    None => groups.push(vec![t]),
                }
            }
            for g in groups {
                routes.push(RaptorRoute {
                    stops: seq.clone(),
                    trips: g,
                });
            }
        }
        let mut stop_routes = vec![Vec::new(); stops.len()];
        for (r, route) in routes.iter().enumerate() {
            for (i, &s) in route.stops.iter().enumerate() {
                stop_routes[s].push((r, i));
            }
        }

        // Stations: stops sharing a `parent_station`, and stops with the same name close to each other
        // (a street line's stop named like the railway station beside it), are one station. Every pair of
        // stops of one station gets a walk with the level change, whatever the distance.
        let mut station = Stations::new(stops.len());
        let mut by_parent: HashMap<&String, usize> = HashMap::new();
        for (i, p) in parent.iter().enumerate() {
            if let Some(p) = p {
                match by_parent.get(p) {
                    Some(&j) => station.union(i, j),
                    None => {
                        by_parent.insert(p, i);
                    }
                }
            }
        }
        let mut by_name: HashMap<String, Vec<usize>> = HashMap::new();
        for (i, s) in stops.iter().enumerate() {
            let key = normalise_name(&s.place.name);
            if !key.is_empty() {
                by_name.entry(key).or_default().push(i);
            }
        }
        let mut joined_by_name = 0usize;
        for members in by_name.values() {
            for (n, &a) in members.iter().enumerate() {
                for &b in &members[n + 1..] {
                    let d = ((stops[a].x - stops[b].x).powi(2) + (stops[a].y - stops[b].y).powi(2))
                        .sqrt();
                    if d <= settings.same_name_station_m && station.find(a) != station.find(b) {
                        station.union(a, b);
                        joined_by_name += 1;
                    }
                }
            }
        }
        let root: Vec<usize> = (0..stops.len()).map(|i| station.find(i)).collect();

        // Footpaths: walks within reach, the stops of one station, then explicit transfer rules.
        let mut foot: HashMap<(usize, usize), Foot> = HashMap::new();
        let mut order: Vec<usize> = (0..stops.len()).collect();
        order.sort_by(|&a, &b| stops[a].x.total_cmp(&stops[b].x));
        let estimate = |a: usize, b: usize, stops: &Vec<StopData>| {
            let d = ((stops[a].x - stops[b].x).powi(2) + (stops[a].y - stops[b].y).powi(2)).sqrt();
            let same_station = root[a] == root[b];
            let dur = settings.walk_s(d)
                + if same_station {
                    settings.level_change_s
                } else {
                    0
                };
            Foot {
                to: b,
                dur,
                straight_m: d,
                guaranteed: false,
            }
        };
        for (n, &a) in order.iter().enumerate() {
            for &b in &order[n + 1..] {
                if stops[b].x - stops[a].x > settings.max_transfer_m {
                    break;
                }
                let f = estimate(a, b, &stops);
                if f.straight_m <= settings.max_transfer_m {
                    foot.insert((a, b), f);
                    foot.insert((b, a), Foot { to: a, ..f });
                }
            }
        }
        let mut groups: HashMap<usize, Vec<usize>> = HashMap::new();
        for (i, &r) in root.iter().enumerate() {
            groups.entry(r).or_default().push(i);
        }
        for members in groups.values().filter(|m| m.len() > 1) {
            for &a in members {
                for &b in members {
                    if a != b {
                        foot.entry((a, b)).or_insert_with(|| estimate(a, b, &stops));
                    }
                }
            }
        }
        let stations = groups.values().filter(|m| m.len() > 1).count();
        for t in &tt.transfers {
            let (Some(&a), Some(&b)) = (
                stop_index.get(&t.from_stop_id),
                stop_index.get(&t.to_stop_id),
            ) else {
                warnings.push(format!(
                    "Transfer {} → {} names an unknown stop; ignored.",
                    t.from_stop_id, t.to_stop_id
                ));
                continue;
            };
            let guaranteed = t.transfer_type == 1;
            if a == b {
                match t.transfer_type {
                    3 => stops[a].change_s = INF,
                    _ => {
                        stops[a].change_s = t.min_transfer_time.unwrap_or(if guaranteed {
                            0
                        } else {
                            settings.min_change_s
                        });
                        stops[a].change_guaranteed = guaranteed;
                    }
                }
                continue;
            }
            if t.transfer_type == 3 {
                foot.remove(&(a, b));
                continue;
            }
            let mut f = estimate(a, b, &stops);
            if let Some(m) = t.min_transfer_time {
                f.dur = m;
            }
            f.guaranteed = guaranteed;
            foot.insert((a, b), f);
        }
        let mut footpaths = vec![Vec::new(); stops.len()];
        let n_foot = foot.len();
        let mut fl: Vec<_> = foot.into_iter().collect();
        fl.sort_by_key(|((a, b), _)| (*a, *b));
        for ((a, _), f) in fl {
            footpaths[a].push(f);
        }

        let summary = NetworkSummary {
            stops: stops.len(),
            routes: lines.len(),
            trips: n_trips,
            raptor_routes: routes.len(),
            footpaths: n_foot,
            stations,
            joined_by_name,
            first_departure_s: (first != INF).then_some(first),
            last_arrival_s: (n_trips > 0).then_some(last),
            warnings,
        };
        Planner {
            settings,
            stops,
            lines,
            routes,
            stop_routes,
            footpaths,
            summary,
            k_lat,
            k_lon,
        }
    }

    pub fn summary(&self) -> &NetworkSummary {
        &self.summary
    }

    pub fn settings(&self) -> &Settings {
        &self.settings
    }

    /// Purpose: answer one question.
    /// Output: journeys (fastest first); empty when B cannot be reached.
    pub fn plan(&self, q: &Query) -> Plan {
        let journeys = match q.mode {
            TimeMode::DepartAt => {
                let mut js = self.depart_at(q.from, q.to, q.time_s);
                js.reverse();
                js
            }
            TimeMode::ArriveBy => self.arrive_by(q.from, q.to, q.time_s),
        };
        Plan {
            query: q.clone(),
            journeys,
        }
    }

    /// Purpose: the fastest journey for each time of a profile query.
    pub fn profile(&self, q: &ProfileQuery) -> Vec<ProfilePoint> {
        let step = q.step_s.max(60);
        let mut out = Vec::new();
        let mut t = q.start_s;
        while t <= q.end_s {
            let query = Query {
                from: q.from,
                to: q.to,
                time_s: t,
                mode: q.mode,
            };
            out.push(ProfilePoint {
                time_s: t,
                journey: self.plan(&query).journeys.into_iter().next(),
            });
            t += step;
        }
        out
    }

    fn xy(&self, p: [f64; 2]) -> (f64, f64) {
        (p[0] * self.k_lon, p[1] * self.k_lat)
    }

    fn dist(&self, a: (f64, f64), b: (f64, f64)) -> f64 {
        ((a.0 - b.0).powi(2) + (a.1 - b.1).powi(2)).sqrt()
    }

    /// Purpose: latest departure that still arrives by `target`, then the journeys from it.
    fn arrive_by(&self, from: [f64; 2], to: [f64; 2], target: u32) -> Vec<Journey> {
        let arrival = |t: u32| self.depart_at(from, to, t).last().map(|j| j.arrive_s);
        let mut lo = target.saturating_sub(self.settings.arrive_by_window_s);
        if !arrival(lo).is_some_and(|a| a <= target) {
            return Vec::new();
        }
        let mut hi = target;
        // Invariant: arrival(lo) <= target; find the largest such lo.
        while lo < hi {
            let mid = lo + (hi - lo).div_ceil(2);
            if arrival(mid).is_some_and(|a| a <= target) {
                lo = mid;
            } else {
                hi = mid - 1;
            }
        }
        let mut js: Vec<Journey> = self
            .depart_at(from, to, lo)
            .into_iter()
            .filter(|j| j.arrive_s <= target)
            .map(|mut j| {
                j.query_s = target;
                j.breakdown.early_arrival_s = target - j.arrive_s;
                j.total_s = target - j.depart_s;
                j
            })
            .collect();
        js.reverse();
        js
    }

    /// Purpose: RAPTOR from `from` leaving at `t0`.
    /// Output: Pareto-optimal journeys by number of vehicles, fewest vehicles first (each strictly faster).
    pub fn depart_at(&self, from: [f64; 2], to: [f64; 2], t0: u32) -> Vec<Journey> {
        let n = self.stops.len();
        let (oxy, dxy) = (self.xy(from), self.xy(to));
        let origin = Place {
            name: "A".into(),
            stop_id: None,
            platform_code: None,
            lon: from[0],
            lat: from[1],
        };
        let dest = Place {
            name: "B".into(),
            stop_id: None,
            platform_code: None,
            lon: to[0],
            lat: to[1],
        };
        let mut result = Vec::new();
        let direct_m = self.dist(oxy, dxy);
        let mut best_dest = INF;
        if direct_m <= self.settings.max_walk_only_m {
            let dur = self.settings.walk_s(direct_m);
            best_dest = t0 + dur;
            result.push(Journey::from_legs(
                t0,
                t0,
                vec![Leg::Walk {
                    kind: WalkKind::Direct,
                    from: origin.clone(),
                    to: dest.clone(),
                    start_s: t0,
                    end_s: t0 + dur,
                    distance_m: self.settings.walk_m(direct_m),
                }],
            ));
        }
        if n == 0 {
            return result;
        }
        let egress: Vec<Option<(u32, f64)>> = self
            .stops
            .iter()
            .map(|s| {
                let d = self.dist((s.x, s.y), dxy);
                (d <= self.settings.max_access_m).then(|| (self.settings.walk_s(d), d))
            })
            .collect();
        let k_max = self.settings.max_rides.max(1);
        let mut tau_v = vec![vec![INF; n]; k_max + 1];
        let mut tau_f = vec![vec![INF; n]; k_max + 1];
        let mut lab_v = vec![vec![VLabel::None; n]; k_max + 1];
        let mut lab_f = vec![vec![FLabel::None; n]; k_max + 1];
        let mut best_v = vec![INF; n];
        let mut best_f = vec![INF; n];
        let mut marked = vec![false; n];
        for (i, s) in self.stops.iter().enumerate() {
            let d = self.dist((s.x, s.y), oxy);
            if d <= self.settings.max_access_m {
                let dur = self.settings.walk_s(d);
                tau_f[0][i] = t0 + dur;
                best_f[i] = t0 + dur;
                lab_f[0][i] = FLabel::Access { dur, straight_m: d };
                marked[i] = true;
            }
        }
        for k in 1..=k_max {
            // Routes to scan, from the earliest marked stop on each.
            let mut scan: HashMap<usize, usize> = HashMap::new();
            for p in (0..n).filter(|&p| marked[p]) {
                for &(r, i) in &self.stop_routes[p] {
                    scan.entry(r).and_modify(|e| *e = (*e).min(i)).or_insert(i);
                }
            }
            marked.iter_mut().for_each(|m| *m = false);
            let mut improved = Vec::new();
            let mut scan: Vec<_> = scan.into_iter().collect();
            scan.sort_unstable();
            for (r, start) in scan {
                let route = &self.routes[r];
                let mut cur: Option<(usize, usize, bool)> = None; // (trip, board pos, from_foot)
                for i in start..route.stops.len() {
                    let p = route.stops[i];
                    if let Some((t, b, ff)) = cur {
                        let trip = &route.trips[t];
                        let a = trip.arr[i];
                        if trip.alight[i] && a < best_v[p] && a < best_dest {
                            tau_v[k][p] = a;
                            best_v[p] = a;
                            lab_v[k][p] = VLabel::Ride {
                                route: r as u32,
                                trip: t as u32,
                                board: b as u32,
                                alight: i as u32,
                                from_foot: ff,
                            };
                            improved.push(p);
                        }
                    }
                    let from_vehicle =
                        if k > 1 && tau_v[k - 1][p] != INF && self.stops[p].change_s != INF {
                            tau_v[k - 1][p].saturating_add(self.stops[p].change_s)
                        } else {
                            INF
                        };
                    let from_foot = tau_f[k - 1][p];
                    let (ready, ff) = if from_foot <= from_vehicle {
                        (from_foot, true)
                    } else {
                        (from_vehicle, false)
                    };
                    if ready == INF {
                        continue;
                    }
                    if let Some((t, _, _)) = cur {
                        if route.trips[t].dep[i] < ready {
                            continue;
                        }
                    }
                    let mut j = route.trips.partition_point(|t| t.dep[i] < ready);
                    while j < route.trips.len() && !route.trips[j].board[i] {
                        j += 1;
                    }
                    if j < route.trips.len() && cur.map_or(true, |(t, _, _)| j < t) {
                        cur = Some((j, i, ff));
                    }
                }
            }
            improved.sort_unstable();
            improved.dedup();
            // Destination reached with k vehicles?
            let mut cand: Option<(u32, usize)> = None;
            for &p in &improved {
                if let Some((w, _)) = egress[p] {
                    let a = tau_v[k][p] + w;
                    if a < best_dest && cand.map_or(true, |(c, _)| a < c) {
                        cand = Some((a, p));
                    }
                }
            }
            if let Some((a, p)) = cand {
                best_dest = a;
                let mut legs = self.reconstruct(k, p, &tau_v, &lab_v, &lab_f, &origin);
                let (w, d) = egress[p].unwrap();
                let arr = tau_v[k][p];
                legs.push(Leg::Walk {
                    kind: WalkKind::Egress,
                    from: self.stops[p].place.clone(),
                    to: dest.clone(),
                    start_s: arr,
                    end_s: arr + w,
                    distance_m: self.settings.walk_m(d),
                });
                result.push(self.timed(t0, legs));
            }
            // Walks from stops reached by vehicle in this round.
            for &p in &improved {
                marked[p] = true;
                for (fi, f) in self.footpaths[p].iter().enumerate() {
                    let a = tau_v[k][p].saturating_add(f.dur);
                    if a < best_f[f.to]
                        && a < best_v[f.to].saturating_add(self.stops[f.to].change_s)
                        && a < best_dest
                    {
                        tau_f[k][f.to] = a;
                        best_f[f.to] = a;
                        lab_f[k][f.to] = FLabel::Walk { from: p, foot: fi };
                        marked[f.to] = true;
                    }
                }
            }
            if !marked.iter().any(|&m| m) {
                break;
            }
        }
        result
    }

    /// Purpose: walk back from a vehicle arrival at `p` in round `k` to the origin.
    /// Output: legs without waits, in travel order (times of walks are filled by `timed`).
    fn reconstruct(
        &self,
        mut k: usize,
        mut p: usize,
        tau_v: &[Vec<u32>],
        lab_v: &[Vec<VLabel>],
        lab_f: &[Vec<FLabel>],
        origin: &Place,
    ) -> Vec<Leg> {
        let mut legs = Vec::new();
        let mut on_foot = false;
        let mut guaranteed_next = false;
        loop {
            if on_foot {
                match lab_f[k][p] {
                    FLabel::Access { dur, straight_m } => {
                        legs.push(Leg::Walk {
                            kind: WalkKind::Access,
                            from: origin.clone(),
                            to: self.stops[p].place.clone(),
                            start_s: 0,
                            end_s: dur,
                            distance_m: self.settings.walk_m(straight_m),
                        });
                        break;
                    }
                    FLabel::Walk { from, foot } => {
                        let f = self.footpaths[from][foot];
                        let start = tau_v[k][from];
                        legs.push(Leg::Walk {
                            kind: WalkKind::Transfer,
                            from: self.stops[from].place.clone(),
                            to: self.stops[p].place.clone(),
                            start_s: start,
                            end_s: start + f.dur,
                            distance_m: self.settings.walk_m(f.straight_m),
                        });
                        guaranteed_next = f.guaranteed;
                        p = from;
                        on_foot = false;
                    }
                    FLabel::None => break,
                }
                continue;
            }
            let VLabel::Ride {
                route,
                trip,
                board,
                alight,
                from_foot,
            } = lab_v[k][p]
            else {
                break;
            };
            let r = &self.routes[route as usize];
            let t = &r.trips[trip as usize];
            let line = &self.lines[t.route];
            let (b, a) = (board as usize, alight as usize);
            let bp = r.stops[b];
            // Patch the guarantee of the ride boarded after this one (legs are pushed backwards).
            if let Some(Leg::Ride { guaranteed, .. }) = legs
                .iter_mut()
                .rev()
                .find(|l| matches!(l, Leg::Ride { .. }))
            {
                *guaranteed = *guaranteed || guaranteed_next;
            }
            guaranteed_next = false;
            legs.push(Leg::Ride {
                route_id: line.route_id.clone(),
                route_short_name: line.route_short_name.clone(),
                mode: line.mode.clone(),
                route_color: line.route_color.clone(),
                trip_id: t.trip_id.clone(),
                from: self.stops[bp].place.clone(),
                to: self.stops[p].place.clone(),
                start_s: t.dep[b],
                end_s: t.arr[a],
                intermediate_stops: (a - b - 1) as u32,
                guaranteed: false,
            });
            if !from_foot {
                guaranteed_next = self.stops[bp].change_guaranteed;
            }
            k -= 1;
            p = bp;
            on_foot = from_foot;
        }
        if let Some(Leg::Ride { guaranteed, .. }) = legs
            .iter_mut()
            .rev()
            .find(|l| matches!(l, Leg::Ride { .. }))
        {
            *guaranteed = *guaranteed || guaranteed_next;
        }
        legs.reverse();
        // The first ride is never "guaranteed": there is no feeder.
        if let Some(Leg::Ride { guaranteed, .. }) =
            legs.iter_mut().find(|l| matches!(l, Leg::Ride { .. }))
        {
            *guaranteed = false;
        }
        legs
    }

    /// Purpose: give the access walk its real times and insert the waits before each ride.
    fn timed(&self, t0: u32, legs: Vec<Leg>) -> Journey {
        let mut out: Vec<Leg> = Vec::with_capacity(legs.len() * 2);
        let mut clock = t0;
        let mut rides = 0;
        for mut l in legs {
            if let Leg::Walk {
                kind: WalkKind::Access,
                start_s,
                end_s,
                ..
            } = &mut l
            {
                let d = *end_s - *start_s;
                *start_s = clock;
                *end_s = clock + d;
            }
            if let Leg::Ride { start_s, from, .. } = &l {
                if *start_s > clock {
                    out.push(Leg::Wait {
                        kind: if rides == 0 {
                            WaitKind::Initial
                        } else {
                            WaitKind::Transfer
                        },
                        at: from.clone(),
                        start_s: clock,
                        end_s: *start_s,
                    });
                }
                rides += 1;
            }
            clock = l.end_s();
            out.push(l);
        }
        Journey::from_legs(t0, t0, out)
    }
}
