//! Street service line drawn as a closed circuit of route points (ADR-0029).
//!
//! The planner adds points in order; each leg is routed to the next point and
//! the last point routes back to the first. Points are via points, stops or end
//! stops. Editing a point re-routes only its two adjacent legs.

use crate::geo::dist;
use crate::graph::RoadGraph;
use crate::profile::{RoutingRules, TrafficSide, VehicleProfile};
use crate::router::{route, Anchor, Path, SearchOptions};
use serde::{Deserialize, Serialize};

/// Role of a route point.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PointKind {
    /// Shapes the path; no passengers.
    Via,
    /// Passenger stop on the sidewalk; served only from the door side.
    Stop,
    /// Stop where the vehicle lays over; splits the circuit into directions.
    EndStop,
}

impl PointKind {
    fn is_stop(self) -> bool {
        self != PointKind::Via
    }
}

/// Severity of a leg or point problem.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    /// No problem.
    Ok,
    /// Works, but the planner should look at it.
    Warning,
    /// Not drivable as drawn.
    Error,
}

/// A point the planner placed.
#[derive(Debug, Clone)]
pub struct RoutePoint {
    /// Stable id for the UI.
    pub id: u32,
    /// Where the planner clicked or dropped it (local metres).
    pub click: (f64, f64),
    /// Role.
    pub kind: PointKind,
    /// Name set by the planner (stops); otherwise derived from the street.
    pub name: Option<String>,
    candidates: Vec<Anchor>,
    anchor: Option<Anchor>,
    error: Option<String>,
    side: Option<f64>,
}

/// Depot gate where vehicles start and end their day.
#[derive(Debug, Clone)]
struct Depot {
    click: (f64, f64),
    candidates: Vec<Anchor>,
    error: Option<String>,
}

/// One routed leg from point `i` to the next point.
#[derive(Debug, Clone)]
struct Leg {
    path: Option<Path>,
    direct_m: Option<f64>,
    status: Status,
    message: Option<String>,
}

/// A street line being drawn.
#[derive(Debug, Clone)]
pub struct StreetLine {
    /// Vehicle used for routing.
    pub profile: VehicleProfile,
    /// Project rules.
    pub rules: RoutingRules,
    points: Vec<RoutePoint>,
    legs: Vec<Leg>,
    depot: Option<Depot>,
    next_id: u32,
    /// Number of legs routed so far (lets tests check that edits stay local).
    pub legs_routed: usize,
}

/// Point as reported to the UI.
#[derive(Debug, Clone, Serialize)]
pub struct PointView {
    /// Id.
    pub id: u32,
    /// Position in the circuit (0-based).
    pub seq: usize,
    /// Role.
    pub kind: PointKind,
    /// Display name (planner's name or the street name).
    pub name: String,
    /// Where it is drawn: on the centreline for via points, on the sidewalk for stops.
    pub lonlat: [f64; 2],
    /// Problem with this point, if any.
    pub status: Status,
    /// Explanation.
    pub message: Option<String>,
    /// Direction of travel through the point, degrees clockwise from north.
    pub bearing_deg: Option<f64>,
    /// Stops: the bus bay on the kerb (vehicle length + 3 m by 3 m), as a closed ring in degrees.
    pub bay: Option<Vec<[f64; 2]>>,
}

/// Leg as reported to the UI.
#[derive(Debug, Clone, Serialize)]
pub struct LegView {
    /// Index in the circuit; leg `i` runs from point `i` to point `i + 1` (the last one closes the loop).
    pub index: usize,
    /// From point id.
    pub from: u32,
    /// To point id.
    pub to: u32,
    /// Polyline in degrees; a straight line when the leg failed.
    pub coords: Vec<[f64; 2]>,
    /// Length in metres.
    pub length_m: f64,
    /// Running time in seconds.
    pub time_s: f64,
    /// Shortest length if U-turns were allowed (for the detour warning).
    pub direct_m: Option<f64>,
    /// Problem level.
    pub status: Status,
    /// Explanation.
    pub message: Option<String>,
    /// OSM way ids driven, in order, without repeats (for exports and checks).
    pub ways: Vec<i64>,
}

/// One direction of the line between end stops (or the whole circuit).
#[derive(Debug, Clone, Serialize)]
pub struct DirectionView {
    /// 0 or 1 (GTFS `direction_id`).
    pub direction: u8,
    /// Point ids of the stops served, in order.
    pub stops: Vec<u32>,
    /// Leg indices in order.
    pub legs: Vec<usize>,
    /// Length in metres.
    pub length_m: f64,
    /// Running time in seconds (without dwell).
    pub time_s: f64,
}

/// Stops shown to passengers as one station.
#[derive(Debug, Clone, Serialize)]
pub struct StationGroupView {
    /// Name, from the first stop in the group.
    pub name: String,
    /// Stop point ids.
    pub stops: Vec<u32>,
}

/// Non-revenue trip between the depot and a terminal stop.
#[derive(Debug, Clone, Serialize)]
pub struct DepotTripView {
    /// `pull_out` (depot to first stop) or `pull_in` (last stop to depot).
    pub kind: &'static str,
    /// Terminal stop id.
    pub stop: u32,
    /// Polyline in degrees (empty when no legal path).
    pub coords: Vec<[f64; 2]>,
    /// Length in metres.
    pub length_m: f64,
    /// Running time in seconds.
    pub time_s: f64,
    /// Problem level.
    pub status: Status,
    /// Explanation.
    pub message: Option<String>,
}

/// Everything the editor shows.
#[derive(Debug, Clone, Serialize)]
pub struct LineView {
    /// Points in circuit order.
    pub points: Vec<PointView>,
    /// Legs in circuit order.
    pub legs: Vec<LegView>,
    /// Directions for timetables and GTFS.
    pub directions: Vec<DirectionView>,
    /// Station groups.
    pub station_groups: Vec<StationGroupView>,
    /// Depot position in degrees.
    pub depot: Option<[f64; 2]>,
    /// Pull-out and pull-in trips.
    pub depot_trips: Vec<DepotTripView>,
    /// Line-level problems.
    pub issues: Vec<String>,
    /// Circuit length in metres.
    pub length_m: f64,
    /// Circuit running time in seconds.
    pub time_s: f64,
}

impl StreetLine {
    /// Purpose: empty line for a vehicle and project rules.
    pub fn new(profile: VehicleProfile, rules: RoutingRules) -> Self {
        Self {
            profile,
            rules,
            points: Vec::new(),
            legs: Vec::new(),
            depot: None,
            next_id: 1,
            legs_routed: 0,
        }
    }

    /// Purpose: number of points.
    pub fn len(&self) -> usize {
        self.points.len()
    }

    /// Purpose: whether the line has no points.
    pub fn is_empty(&self) -> bool {
        self.points.is_empty()
    }

    /// Purpose: the arc and position a point is routed through (`None` when it is not on a usable road).
    pub fn anchor(&self, id: u32) -> Option<Anchor> {
        self.points
            .iter()
            .find(|p| p.id == id)
            .and_then(|p| p.anchor)
    }

    fn index_of(&self, id: u32) -> Result<usize, String> {
        self.points
            .iter()
            .position(|p| p.id == id)
            .ok_or_else(|| format!("No point with id {id}"))
    }

    /// Purpose: append a point after the last one (before the loop closes).
    /// Output: the new point id. Side effects: routes the two legs touching it.
    pub fn add_point(&mut self, g: &RoadGraph, lon: f64, lat: f64, kind: PointKind) -> u32 {
        self.insert_point(g, self.points.len(), lon, lat, kind)
    }

    /// Purpose: insert a point at circuit position `seq` (0 = first; `len()` = append).
    /// Output: the new point id. Side effects: routes the two legs touching it.
    pub fn insert_point(
        &mut self,
        g: &RoadGraph,
        seq: usize,
        lon: f64,
        lat: f64,
        kind: PointKind,
    ) -> u32 {
        let seq = seq.min(self.points.len());
        let id = self.next_id;
        self.next_id += 1;
        let p = RoutePoint {
            id,
            click: g.proj.to_xy(lon, lat),
            kind,
            name: None,
            candidates: Vec::new(),
            anchor: None,
            error: None,
            side: None,
        };
        self.points.insert(seq, p);
        self.legs.insert(seq, Leg::empty());
        self.resnap(g, seq);
        self.reroute_around(g, seq);
        id
    }

    /// Purpose: move a point; re-routes only its two adjacent legs.
    pub fn move_point(&mut self, g: &RoadGraph, id: u32, lon: f64, lat: f64) -> Result<(), String> {
        let i = self.index_of(id)?;
        self.points[i].click = g.proj.to_xy(lon, lat);
        self.resnap(g, i);
        self.reroute_around(g, i);
        Ok(())
    }

    /// Purpose: delete a point; re-routes the leg that now joins its neighbours.
    pub fn delete_point(&mut self, g: &RoadGraph, id: u32) -> Result<(), String> {
        let i = self.index_of(id)?;
        self.points.remove(i);
        self.legs.remove(i);
        if !self.points.is_empty() {
            let prev = (i + self.points.len() - 1) % self.points.len();
            self.route_leg(g, prev);
        }
        Ok(())
    }

    /// Purpose: promote or demote a point; a stop moves to the sidewalk on the side it was placed.
    pub fn set_kind(&mut self, g: &RoadGraph, id: u32, kind: PointKind) -> Result<(), String> {
        let i = self.index_of(id)?;
        let was_stop = self.points[i].kind.is_stop();
        self.points[i].kind = kind;
        if was_stop != kind.is_stop() {
            self.resnap(g, i);
            self.reroute_around(g, i);
        }
        Ok(())
    }

    /// Purpose: set the planner's name for a point (`None` = automatic street name).
    pub fn set_name(&mut self, id: u32, name: Option<String>) -> Result<(), String> {
        let i = self.index_of(id)?;
        self.points[i].name = name.filter(|n| !n.trim().is_empty());
        Ok(())
    }

    /// Purpose: change the vehicle; every point is re-snapped and every leg re-routed.
    pub fn set_profile(&mut self, g: &RoadGraph, profile: VehicleProfile) {
        self.profile = profile;
        for i in 0..self.points.len() {
            self.resnap(g, i);
        }
        self.reroute_all(g);
    }

    /// Purpose: after the road graph was rebuilt (more area loaded), snap every point and the depot
    /// again and re-route the whole circuit. The graph must use the same projection as before.
    pub fn rebuild(&mut self, g: &RoadGraph) {
        for i in 0..self.points.len() {
            self.resnap(g, i);
        }
        if let Some(d) = &self.depot {
            let ll = g.proj.to_lonlat(d.click.0, d.click.1);
            self.set_depot(g, Some(ll));
        }
        self.reroute_all(g);
    }

    /// Purpose: place (or move) the depot gate. `None` removes it.
    pub fn set_depot(&mut self, g: &RoadGraph, lonlat: Option<(f64, f64)>) {
        self.depot = lonlat.map(|(lon, lat)| {
            let click = g.proj.to_xy(lon, lat);
            let (candidates, error) = match self.snap(g, click, false) {
                Ok((c, _)) => (c, None),
                Err(e) => (Vec::new(), Some(e)),
            };
            Depot {
                click,
                candidates,
                error,
            }
        });
    }

    /// Purpose: choose the travel direction at every point for the shortest whole circuit and route all legs.
    pub fn reroute_all(&mut self, g: &RoadGraph) {
        let n = self.points.len();
        if n < 2 {
            for i in 0..n {
                self.route_leg(g, i);
            }
            return;
        }
        // Cycle DP over candidate anchors: fix the first point's candidate, sweep forward, close the loop.
        let cands: Vec<Vec<Anchor>> = self.points.iter().map(|p| p.candidates.clone()).collect();
        let mut best: Option<(f64, Vec<usize>)> = None;
        for c0 in 0..cands[0].len() {
            // cost[k][c] = best cost to reach candidate c of point k; back[k][c] = chosen predecessor.
            let mut cost = vec![vec![f64::INFINITY; 0]; n];
            let mut back = vec![Vec::new(); n];
            cost[0] = (0..cands[0].len())
                .map(|c| if c == c0 { 0.0 } else { f64::INFINITY })
                .collect();
            back[0] = vec![0; cands[0].len()];
            for k in 1..n {
                cost[k] = vec![f64::INFINITY; cands[k].len()];
                back[k] = vec![0; cands[k].len()];
                for (cj, &to) in cands[k].iter().enumerate() {
                    for (ci, &from) in cands[k - 1].iter().enumerate() {
                        if !cost[k - 1][ci].is_finite() {
                            continue;
                        }
                        let c = cost[k - 1][ci] + self.leg_cost(g, from, to);
                        if c < cost[k][cj] {
                            cost[k][cj] = c;
                            back[k][cj] = ci;
                        }
                    }
                }
            }
            for (cl, &last) in cands[n - 1].iter().enumerate() {
                if !cost[n - 1][cl].is_finite() {
                    continue;
                }
                let total = cost[n - 1][cl] + self.leg_cost(g, last, cands[0][c0]);
                if best.as_ref().map_or(true, |b| total < b.0) {
                    let mut choice = vec![0; n];
                    choice[n - 1] = cl;
                    for k in (1..n).rev() {
                        choice[k - 1] = back[k][choice[k]];
                    }
                    best = Some((total, choice));
                }
            }
        }
        if let Some((_, choice)) = best {
            for (k, c) in choice.into_iter().enumerate() {
                self.points[k].anchor = self.points[k].candidates.get(c).copied();
            }
        }
        for i in 0..n {
            self.route_leg(g, i);
        }
    }

    fn leg_cost(&self, g: &RoadGraph, from: Anchor, to: Anchor) -> f64 {
        route(
            g,
            &self.profile,
            from,
            to,
            SearchOptions {
                allow_u_turns: false,
            },
        )
        .map_or(1e12, |p| p.time_s)
    }

    /// Snap a click to the road. Stops keep only the arc that has the click on its door side.
    fn snap(
        &self,
        g: &RoadGraph,
        click: (f64, f64),
        stop: bool,
    ) -> Result<(Vec<Anchor>, f64), String> {
        let (seg_id, pr) = g
            .nearest_segment(click, &self.profile, self.rules.max_snap_m)
            .ok_or_else(|| {
                format!(
                    "No road usable by this vehicle within {} m.",
                    self.rules.max_snap_m
                )
            })?;
        let seg = &g.segments[seg_id as usize];
        // cross > 0: click is left of a → b. For the reverse arc the sides swap.
        let mut out = Vec::new();
        for (arc, t, left) in [
            (seg.fwd, pr.t, pr.cross > 0.0),
            (seg.bwd, 1.0 - pr.t, pr.cross <= 0.0),
        ] {
            let Some(arc) = arc else { continue };
            if !g.allows(arc, &self.profile) {
                continue;
            }
            let door_side_ok = self.profile.doors_both_sides
                || match self.rules.traffic_side {
                    TrafficSide::Right => !left,
                    TrafficSide::Left => left,
                };
            if !stop || door_side_ok {
                out.push(Anchor { arc, t });
            }
        }
        if out.is_empty() {
            return Err(
                "This sidewalk cannot be served: traffic here only runs with the stop on the far side from the doors. \
                 Put the stop on the other sidewalk."
                    .into(),
            );
        }
        let side = if pr.cross > 0.0 { 1.0 } else { -1.0 };
        Ok((out, side))
    }

    fn resnap(&mut self, g: &RoadGraph, i: usize) {
        let p = &self.points[i];
        match self.snap(g, p.click, p.kind.is_stop()) {
            Ok((c, side)) => {
                let p = &mut self.points[i];
                p.anchor = c.first().copied();
                p.candidates = c;
                p.error = None;
                p.side = Some(side);
            }
            Err(e) => {
                let p = &mut self.points[i];
                p.candidates.clear();
                p.anchor = None;
                p.error = Some(e);
                p.side = None;
            }
        }
    }

    /// Choose the best candidate at point `i` given its neighbours, then route the two adjacent legs.
    fn reroute_around(&mut self, g: &RoadGraph, i: usize) {
        let n = self.points.len();
        if n == 0 {
            return;
        }
        let prev = (i + n - 1) % n;
        let next = (i + 1) % n;
        if n >= 2 && self.points[i].candidates.len() > 1 {
            let (pa, na) = (self.points[prev].anchor, self.points[next].anchor);
            let best = self.points[i]
                .candidates
                .iter()
                .map(|&c| {
                    let a = pa.map_or(0.0, |p| self.leg_cost(g, p, c));
                    let b = na.map_or(0.0, |q| self.leg_cost(g, c, q));
                    (a + b, c)
                })
                .min_by(|x, y| x.0.total_cmp(&y.0));
            self.points[i].anchor = best.map(|b| b.1);
        }
        self.route_leg(g, prev);
        if next != prev || n == 2 {
            self.route_leg(g, i);
        }
    }

    fn route_leg(&mut self, g: &RoadGraph, i: usize) {
        let n = self.points.len();
        self.legs_routed += 1;
        let j = (i + 1) % n;
        if n < 2 {
            self.legs[i] = Leg::empty();
            return;
        }
        let (Some(a), Some(b)) = (self.points[i].anchor, self.points[j].anchor) else {
            self.legs[i] = Leg {
                path: None,
                direct_m: None,
                status: Status::Error,
                message: Some("A point of this leg is not on a usable road.".into()),
            };
            return;
        };
        let path = route(
            g,
            &self.profile,
            a,
            b,
            SearchOptions {
                allow_u_turns: false,
            },
        );
        self.legs[i] = self.judge(g, a, b, path);
    }

    fn judge(&self, g: &RoadGraph, a: Anchor, b: Anchor, path: Option<Path>) -> Leg {
        let Some(path) = path else {
            return Leg {
                path: None,
                direct_m: None,
                status: Status::Error,
                message: Some(
                    "No legal path: one-way streets, turn bans or vehicle limits block it, and buses may not U-turn. \
                     Move a point or put the end stop where the vehicle can turn (bus station, loop, roundabout)."
                        .into(),
                ),
            };
        };
        let direct = self.direct_m(g, a, b);
        let mut status = Status::Ok;
        let mut message = None;
        if let Some(d) = direct {
            let extra = path.length_m - d;
            if extra
                > self
                    .rules
                    .detour_warn_m
                    .max(self.rules.detour_warn_ratio * d)
            {
                status = Status::Warning;
                message = Some(format!(
                    "Turning round adds {:.0} m ({:.0} m instead of {:.0} m). Consider putting the end stop where \
                     the vehicle can turn: a bus station, turning loop, roundabout or a block it can drive round.",
                    extra, path.length_m, d
                ));
            }
        }
        if self.profile.mode == crate::profile::Mode::Trolleybus && path.max_off_wire_m > 0.0 {
            if path.max_off_wire_m > self.profile.battery_range_m {
                status = Status::Error;
                message = Some(format!(
                    "{:.0} m without overhead wire exceeds the battery range of {:.0} m.",
                    path.max_off_wire_m, self.profile.battery_range_m
                ));
            } else if status == Status::Ok {
                message = Some(format!(
                    "Runs {:.0} m on battery without overhead wire.",
                    path.max_off_wire_m
                ));
            }
        }
        Leg {
            path: Some(path),
            direct_m: direct,
            status,
            message,
        }
    }

    /// Shortest length with U-turns allowed and either direction at both ends.
    fn direct_m(&self, g: &RoadGraph, a: Anchor, b: Anchor) -> Option<f64> {
        let both = |x: Anchor| {
            let seg = &g.segments[g.arcs[x.arc as usize].segment as usize];
            let mut v = vec![x];
            for r in [seg.fwd, seg.bwd].into_iter().flatten() {
                if r != x.arc && g.allows(r, &self.profile) {
                    v.push(Anchor {
                        arc: r,
                        t: 1.0 - x.t,
                    });
                }
            }
            v
        };
        let mut best: Option<f64> = None;
        for s in both(a) {
            for e in both(b) {
                if let Some(p) = route(
                    g,
                    &self.profile,
                    s,
                    e,
                    SearchOptions {
                        allow_u_turns: true,
                    },
                ) {
                    best = Some(best.map_or(p.length_m, |m: f64| m.min(p.length_m)));
                }
            }
        }
        best
    }

    fn point_name(&self, g: &RoadGraph, p: &RoutePoint, seq: usize) -> String {
        if let Some(n) = &p.name {
            return n.clone();
        }
        let Some(a) = p.anchor else {
            return format!("Point {}", seq + 1);
        };
        let arc = &g.arcs[a.arc as usize];
        let Some(street) = arc.name.clone() else {
            return format!("Stop {}", seq + 1);
        };
        // Near a junction with another named street: "A / B" (06 §9.3 rule 4).
        let node = if a.t < 0.5 { arc.from } else { arc.to };
        let here = g.point_on_arc(a.arc, a.t);
        if dist(here, g.nodes[node as usize].xy) < 40.0 {
            let cross = g.out[node as usize]
                .iter()
                .filter_map(|&o| g.arcs[o as usize].name.as_ref())
                .find(|n| **n != street);
            if let Some(c) = cross {
                return format!("{street} / {c}");
            }
        }
        street
    }

    /// Bus bay rectangle beside the kerb for a stop, centred on the stop along the street.
    fn bay(&self, g: &RoadGraph, p: &RoutePoint) -> Option<Vec<[f64; 2]>> {
        let a = p.anchor.filter(|_| p.kind.is_stop())?;
        let arc = &g.arcs[a.arc as usize];
        let seg = &g.segments[arc.segment as usize];
        let on = g.point_on_arc(a.arc, a.t);
        let (ux, uy) = (arc.heading.cos(), arc.heading.sin());
        // Door side: right of travel in right-hand traffic.
        let sign = match self.rules.traffic_side {
            TrafficSide::Right => -1.0,
            TrafficSide::Left => 1.0,
        };
        let (nx, ny) = (-uy * sign, ux * sign);
        let half = (self.profile.length_m + 3.0) / 2.0;
        let outer = seg.width_m / 2.0;
        let inner = (outer - 3.0).max(0.5);
        let corner = |along: f64, off: f64| {
            let (lon, lat) = g
                .proj
                .to_lonlat(on.0 + ux * along + nx * off, on.1 + uy * along + ny * off);
            [lon, lat]
        };
        Some(vec![
            corner(-half, inner),
            corner(half, inner),
            corner(half, outer),
            corner(-half, outer),
            corner(-half, inner),
        ])
    }

    fn display_xy(&self, g: &RoadGraph, p: &RoutePoint) -> (f64, f64) {
        let Some(a) = p.anchor else { return p.click };
        let on = g.point_on_arc(a.arc, a.t);
        if !p.kind.is_stop() {
            return on;
        }
        // Stops sit on the sidewalk: half the carriageway plus 1.5 m from the centreline.
        let arc = &g.arcs[a.arc as usize];
        let seg = &g.segments[arc.segment as usize];
        let (sa, sb) = (g.nodes[seg.a as usize].xy, g.nodes[seg.b as usize].xy);
        let (dx, dy) = (sb.0 - sa.0, sb.1 - sa.1);
        let len = dx.hypot(dy).max(1e-9);
        let off = (seg.width_m / 2.0 + 1.5) * p.side.unwrap_or(-1.0);
        (on.0 - dy / len * off, on.1 + dx / len * off)
    }

    fn depot_trip(
        &self,
        g: &RoadGraph,
        depot: &Depot,
        stop: &RoutePoint,
        pull_out: bool,
    ) -> DepotTripView {
        let kind = if pull_out { "pull_out" } else { "pull_in" };
        let fail = |m: String| DepotTripView {
            kind,
            stop: stop.id,
            coords: Vec::new(),
            length_m: 0.0,
            time_s: 0.0,
            status: Status::Error,
            message: Some(m),
        };
        if let Some(e) = &depot.error {
            return fail(e.clone());
        }
        let Some(s) = stop.anchor else {
            return fail("The terminal stop is not on a usable road.".into());
        };
        let best = depot
            .candidates
            .iter()
            .filter_map(|&d| {
                let (a, b) = if pull_out { (d, s) } else { (s, d) };
                route(
                    g,
                    &self.profile,
                    a,
                    b,
                    SearchOptions {
                        allow_u_turns: false,
                    },
                )
            })
            .min_by(|x, y| x.time_s.total_cmp(&y.time_s));
        match best {
            Some(p) => DepotTripView {
                kind,
                stop: stop.id,
                coords: to_lonlat(g, &p.xy),
                length_m: p.length_m,
                time_s: p.time_s,
                status: Status::Ok,
                message: None,
            },
            None => fail("No legal path between the depot and this terminal.".into()),
        }
    }

    /// Purpose: everything the editor draws and lists.
    pub fn view(&self, g: &RoadGraph) -> LineView {
        let n = self.points.len();
        let mut issues = Vec::new();
        let points: Vec<PointView> = self
            .points
            .iter()
            .enumerate()
            .map(|(seq, p)| {
                let (lon, lat) = g
                    .proj
                    .to_lonlat(self.display_xy(g, p).0, self.display_xy(g, p).1);
                let bearing_deg = p.anchor.map(|a| {
                    let h = g.arcs[a.arc as usize].heading.to_degrees();
                    (90.0 - h).rem_euclid(360.0)
                });
                PointView {
                    bearing_deg,
                    bay: self.bay(g, p),
                    id: p.id,
                    seq,
                    kind: p.kind,
                    name: self.point_name(g, p, seq),
                    lonlat: [lon, lat],
                    status: if p.error.is_some() {
                        Status::Error
                    } else {
                        Status::Ok
                    },
                    message: p.error.clone(),
                }
            })
            .collect();
        let legs: Vec<LegView> = if n < 2 {
            Vec::new()
        } else {
            self.legs
                .iter()
                .enumerate()
                .map(|(i, l)| {
                    let j = (i + 1) % n;
                    let coords = match &l.path {
                        Some(p) => to_lonlat(g, &p.xy),
                        None => vec![points[i].lonlat, points[j].lonlat],
                    };
                    let mut ways: Vec<i64> = Vec::new();
                    for a in l.path.iter().flat_map(|p| &p.arcs) {
                        let w = g.arcs[*a as usize].way;
                        if ways.last() != Some(&w) {
                            ways.push(w);
                        }
                    }
                    LegView {
                        index: i,
                        from: self.points[i].id,
                        to: self.points[j].id,
                        coords,
                        length_m: l.path.as_ref().map_or(0.0, |p| p.length_m),
                        time_s: l.path.as_ref().map_or(0.0, |p| p.time_s),
                        direct_m: l.direct_m,
                        status: l.status,
                        message: l.message.clone(),
                        ways,
                    }
                })
                .collect()
        };
        let length_m = legs.iter().map(|l| l.length_m).sum();
        let time_s = legs.iter().map(|l| l.time_s).sum();

        let stops: Vec<usize> = (0..n).filter(|&i| self.points[i].kind.is_stop()).collect();
        let ends: Vec<usize> = (0..n)
            .filter(|&i| self.points[i].kind == PointKind::EndStop)
            .collect();
        if n >= 2 && stops.len() < 2 {
            issues.push("A line needs at least two stops. Promote points to stops.".to_string());
        }
        if ends.len() > 2 {
            issues.push(
                "More than two end stops. A route has one end stop (circular line) or two (two directions); \
                 use a pattern for short turns."
                    .to_string(),
            );
        }
        if legs.iter().any(|l| l.status == Status::Error) {
            issues.push("Some legs cannot be driven; see the red legs.".to_string());
        }
        let directions = if n < 2 || stops.is_empty() || ends.len() > 2 {
            Vec::new()
        } else {
            let starts: Vec<usize> = if ends.is_empty() {
                vec![stops[0]]
            } else {
                ends.clone()
            };
            starts
                .iter()
                .enumerate()
                .map(|(d, &s)| {
                    let stop_at = starts.get((d + 1) % starts.len()).copied().unwrap_or(s);
                    let mut leg_ids = Vec::new();
                    let mut stop_ids = vec![self.points[s].id];
                    let mut k = s;
                    loop {
                        leg_ids.push(k);
                        k = (k + 1) % n;
                        if self.points[k].kind.is_stop() {
                            stop_ids.push(self.points[k].id);
                        }
                        if k == stop_at {
                            break;
                        }
                    }
                    DirectionView {
                        direction: d as u8,
                        stops: stop_ids,
                        length_m: leg_ids.iter().map(|&l| legs[l].length_m).sum(),
                        time_s: leg_ids.iter().map(|&l| legs[l].time_s).sum(),
                        legs: leg_ids,
                    }
                })
                .collect()
        };
        let station_groups = self.groups(&stops, &points);
        let terminals: Vec<usize> = if !ends.is_empty() {
            ends
        } else {
            stops.first().copied().into_iter().collect()
        };
        let depot_trips = match &self.depot {
            Some(d) => terminals
                .iter()
                .flat_map(|&t| {
                    [
                        self.depot_trip(g, d, &self.points[t], true),
                        self.depot_trip(g, d, &self.points[t], false),
                    ]
                })
                .collect(),
            None => Vec::new(),
        };
        let depot = self.depot.as_ref().map(|d| {
            let xy = d
                .candidates
                .first()
                .map_or(d.click, |a| g.point_on_arc(a.arc, a.t));
            let (lon, lat) = g.proj.to_lonlat(xy.0, xy.1);
            [lon, lat]
        });
        if let Some(e) = self.depot.as_ref().and_then(|d| d.error.clone()) {
            issues.push(format!("Depot: {e}"));
        }
        LineView {
            points,
            legs,
            directions,
            station_groups,
            depot,
            depot_trips,
            issues,
            length_m,
            time_s,
        }
    }

    /// Stops within the grouping distance form one station group named after its first stop.
    fn groups(&self, stops: &[usize], points: &[PointView]) -> Vec<StationGroupView> {
        let mut parent: Vec<usize> = (0..stops.len()).collect();
        fn find(p: &mut [usize], i: usize) -> usize {
            let mut r = i;
            while p[r] != r {
                r = p[r];
            }
            p[i] = r;
            r
        }
        for x in 0..stops.len() {
            for y in x + 1..stops.len() {
                let (a, b) = (&self.points[stops[x]], &self.points[stops[y]]);
                if dist(a.click, b.click) <= self.rules.grouping_distance_m {
                    let (rx, ry) = (find(&mut parent, x), find(&mut parent, y));
                    parent[rx.max(ry)] = rx.min(ry);
                }
            }
        }
        let mut groups: Vec<StationGroupView> = Vec::new();
        let mut root_of: Vec<Option<usize>> = vec![None; stops.len()];
        for x in 0..stops.len() {
            let r = find(&mut parent, x);
            match root_of[r] {
                Some(gi) => groups[gi].stops.push(points[stops[x]].id),
                None => {
                    root_of[r] = Some(groups.len());
                    groups.push(StationGroupView {
                        name: points[stops[x]].name.clone(),
                        stops: vec![points[stops[x]].id],
                    });
                }
            }
        }
        groups
    }
}

impl Leg {
    fn empty() -> Self {
        Leg {
            path: None,
            direct_m: None,
            status: Status::Ok,
            message: None,
        }
    }
}

fn to_lonlat(g: &RoadGraph, xy: &[(f64, f64)]) -> Vec<[f64; 2]> {
    xy.iter()
        .map(|&(x, y)| {
            let (lon, lat) = g.proj.to_lonlat(x, y);
            [lon, lat]
        })
        .collect()
}
