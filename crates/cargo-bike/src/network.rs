//! The streets a cargo bike may ride, from OpenStreetMap, sorted into four kinds of street, and the route
//! between two points that prefers bike lanes.
//!
//! The ways come from the walk tiles of the API (`/api/street-network/walk-tiles`): every road a person
//! may use plus cycleways, paths, tracks and footways. The planner's street setups from the GIS tab are
//! applied first (`street_routing::apply_setups`), so a bike lane added there counts here too.

use crate::params::Bike;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap};
use street_routing::osm::{OsmData, Tags};
use street_routing::setup::osm_bike_lane;

/// What kind of street the bike rides on; it sets the cruising speed, the stops and the route choice.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Class {
    /// A cycle track separated from traffic, a cycleway or a path signed for bikes.
    Separated,
    /// A painted bike lane on the carriageway, or a bicycle street.
    Lane,
    /// A quiet street without a bike lane: residential, service, living street, track or shared path.
    Quiet,
    /// A main road without a bike lane: the bike rides in general traffic.
    Mixed,
}

impl Class {
    /// All classes, in the order of the per-class parameter arrays.
    pub const ALL: [Class; 4] = [Class::Separated, Class::Lane, Class::Quiet, Class::Mixed];

    /// Purpose: index into the per-class arrays of [`Bike`].
    pub fn index(self) -> usize {
        self as usize
    }
}

const EARTH_R: f64 = 6_371_008.8;

/// Purpose: great-circle distance in metres between two `[lon, lat]` points.
pub fn haversine(a: [f64; 2], b: [f64; 2]) -> f64 {
    let (la1, la2) = (a[1].to_radians(), b[1].to_radians());
    let dla = la2 - la1;
    let dlo = (b[0] - a[0]).to_radians();
    let h = (dla / 2.0).sin().powi(2) + la1.cos() * la2.cos() * (dlo / 2.0).sin().powi(2);
    2.0 * EARTH_R * h.sqrt().min(1.0).asin()
}

fn tag<'a>(t: &'a Tags, k: &str) -> &'a str {
    t.get(k).map_or("", String::as_str)
}

fn allowed(v: &str) -> bool {
    matches!(v, "yes" | "designated" | "permissive" | "destination")
}

/// Purpose: whether a bike may ride a way, and on what kind of street.
/// Output: the class, or `None` where bikes may not ride (motorways, steps, footways not open to bikes,
/// `bicycle=no`, private ways, roads with `bicycle=use_sidepath` whose cycle track is mapped separately).
pub fn classify(t: &Tags) -> Option<Class> {
    let hw = tag(t, "highway");
    let bicycle = tag(t, "bicycle");
    if matches!(bicycle, "no" | "use_sidepath" | "dismount") {
        return None;
    }
    if matches!(tag(t, "access"), "no" | "private") && !allowed(bicycle) {
        return None;
    }
    if tag(t, "area") == "yes" {
        return None;
    }
    let track = [
        "cycleway",
        "cycleway:both",
        "cycleway:left",
        "cycleway:right",
    ]
    .iter()
    .any(|k| matches!(tag(t, k), "track" | "opposite_track"))
        || (osm_bike_lane(t) && tag(t, "mobsimlab:separated") == "yes");
    match hw {
        "motorway" | "motorway_link" | "steps" | "construction" | "proposed" | "platform" => None,
        "trunk" | "trunk_link" if !allowed(bicycle) => None,
        "cycleway" => Some(Class::Separated),
        "path" | "footway" | "pedestrian" | "bridleway" | "corridor" => match bicycle {
            "designated" => Some(Class::Separated),
            "yes" | "permissive" => Some(Class::Quiet),
            // A path without a bicycle tag is usually open to bikes; a footway or a pedestrian street is not.
            "" if hw == "path" => Some(Class::Quiet),
            _ => None,
        },
        "track" | "residential" | "living_street" | "service" | "unclassified" | "road" => {
            Some(if track {
                Class::Separated
            } else if osm_bike_lane(t) {
                Class::Lane
            } else {
                Class::Quiet
            })
        }
        "trunk" | "trunk_link" | "primary" | "primary_link" | "secondary" | "secondary_link"
        | "tertiary" | "tertiary_link" => Some(if track {
            Class::Separated
        } else if osm_bike_lane(t) {
            Class::Lane
        } else {
            Class::Mixed
        }),
        _ => None,
    }
}

/// Purpose: the directions a bike may ride a way: (forward, backward).
fn directions(t: &Tags) -> (bool, bool) {
    let contraflow = matches!(tag(t, "oneway:bicycle"), "no")
        || [
            "cycleway",
            "cycleway:left",
            "cycleway:right",
            "cycleway:both",
        ]
        .iter()
        .any(|k| tag(t, k).starts_with("opposite"));
    let oneway = match tag(t, "oneway:bicycle") {
        "yes" | "1" | "true" => "yes",
        "-1" => "-1",
        _ => match tag(t, "oneway") {
            "yes" | "1" | "true" => "yes",
            "-1" | "reverse" => "-1",
            "no" => "no",
            _ if tag(t, "junction") == "roundabout" => "yes",
            _ => "no",
        },
    };
    match oneway {
        "yes" => (true, contraflow),
        "-1" => (contraflow, true),
        _ => (true, true),
    }
}

#[derive(Debug, Clone, Copy)]
struct Edge {
    to: u32,
    len_m: f64,
    class: Class,
}

/// The bike network: nodes with their position and stop signs, and directed edges.
#[derive(Debug, Default)]
pub struct BikeGraph {
    pos: Vec<[f64; 2]>,
    /// 0 none, 1 traffic signal, 2 stop sign.
    control: Vec<u8>,
    adj: Vec<Vec<Edge>>,
}

/// A route one way: its line, the street class of each segment and the signals and stop signs on it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Route {
    /// `[lon, lat]` from start to end.
    pub coords: Vec<[f64; 2]>,
    /// Street class of each segment (`coords.len() - 1` entries).
    pub classes: Vec<Class>,
    /// Length, m.
    pub length_m: f64,
    /// Traffic signals passed.
    pub signals: u32,
    /// Stop signs passed.
    pub stop_signs: u32,
}

#[derive(Copy, Clone, PartialEq)]
struct Item(f64, u32);
impl Eq for Item {}
impl Ord for Item {
    fn cmp(&self, o: &Self) -> Ordering {
        o.0.total_cmp(&self.0).then(o.1.cmp(&self.1))
    }
}
impl PartialOrd for Item {
    fn partial_cmp(&self, o: &Self) -> Option<Ordering> {
        Some(self.cmp(o))
    }
}

impl BikeGraph {
    /// Purpose: the bike network of an OSM extract.
    pub fn from_osm(data: &OsmData) -> Self {
        let mut g = BikeGraph::default();
        let nodes: HashMap<i64, &street_routing::osm::RawNode> =
            data.nodes.iter().map(|n| (n.id, n)).collect();
        let mut index: HashMap<i64, u32> = HashMap::new();
        let mut node = |g: &mut BikeGraph, id: i64| -> Option<u32> {
            if let Some(i) = index.get(&id) {
                return Some(*i);
            }
            let n = nodes.get(&id)?;
            let i = g.pos.len() as u32;
            g.pos.push([n.lon, n.lat]);
            let ctl = match (tag(&n.tags, "highway"), tag(&n.tags, "crossing")) {
                ("traffic_signals", _) | (_, "traffic_signals") => 1,
                ("stop", _) => 2,
                _ => 0,
            };
            g.control.push(ctl);
            g.adj.push(Vec::new());
            index.insert(id, i);
            Some(i)
        };
        for w in &data.ways {
            let Some(class) = classify(&w.tags) else {
                continue;
            };
            let (fwd, bwd) = directions(&w.tags);
            let mut prev: Option<u32> = None;
            for id in &w.nodes {
                let Some(b) = node(&mut g, *id) else {
                    prev = None;
                    continue;
                };
                if let Some(a) = prev {
                    let len_m = haversine(g.pos[a as usize], g.pos[b as usize]);
                    if fwd {
                        g.adj[a as usize].push(Edge {
                            to: b,
                            len_m,
                            class,
                        });
                    }
                    if bwd {
                        g.adj[b as usize].push(Edge {
                            to: a,
                            len_m,
                            class,
                        });
                    }
                }
                prev = Some(b);
            }
        }
        g
    }

    /// Purpose: number of nodes (0 when no street could be ridden).
    pub fn len(&self) -> usize {
        self.pos.len()
    }

    /// Purpose: whether the graph has no nodes.
    pub fn is_empty(&self) -> bool {
        self.pos.is_empty()
    }

    /// Purpose: the node nearest to a point that has an edge, and its distance in metres.
    pub fn nearest(&self, p: [f64; 2]) -> Option<(u32, f64)> {
        let mut has_edge = vec![false; self.pos.len()];
        for (a, es) in self.adj.iter().enumerate() {
            if !es.is_empty() {
                has_edge[a] = true;
            }
            for e in es {
                has_edge[e.to as usize] = true;
            }
        }
        self.pos
            .iter()
            .enumerate()
            .filter(|(i, _)| has_edge[*i])
            .map(|(i, q)| (i as u32, haversine(p, *q)))
            .min_by(|a, b| a.1.total_cmp(&b.1))
    }

    /// Purpose: the preferred route between two nodes: shortest by length weighted with the route choice
    /// factor of each street class (main roads without a bike lane count longer, so the route avoids them).
    /// Output: the route, or `None` when the destination cannot be reached by bike.
    pub fn route(&self, from: u32, to: u32, bike: &Bike) -> Option<Route> {
        let n = self.pos.len();
        let mut cost = vec![f64::INFINITY; n];
        let mut prev: Vec<Option<(u32, Edge)>> = vec![None; n];
        let mut heap = BinaryHeap::new();
        cost[from as usize] = 0.0;
        heap.push(Item(0.0, from));
        while let Some(Item(c, u)) = heap.pop() {
            if u == to {
                break;
            }
            if c > cost[u as usize] {
                continue;
            }
            for e in &self.adj[u as usize] {
                let nc = c + e.len_m * bike.route_factor[e.class.index()];
                if nc < cost[e.to as usize] {
                    cost[e.to as usize] = nc;
                    prev[e.to as usize] = Some((u, *e));
                    heap.push(Item(nc, e.to));
                }
            }
        }
        if !cost[to as usize].is_finite() {
            return None;
        }
        let mut edges = Vec::new();
        let mut at = to;
        while let Some((p, e)) = prev[at as usize] {
            edges.push((p, e));
            at = p;
        }
        edges.reverse();
        let mut r = Route {
            coords: vec![self.pos[from as usize]],
            classes: Vec::new(),
            length_m: 0.0,
            signals: 0,
            stop_signs: 0,
        };
        for (_, e) in &edges {
            r.coords.push(self.pos[e.to as usize]);
            r.classes.push(e.class);
            r.length_m += e.len_m;
            match self.control[e.to as usize] {
                1 => r.signals += 1,
                2 => r.stop_signs += 1,
                _ => {}
            }
        }
        // Signals often sit on several nodes of one junction (one per carriageway); count each junction
        // once by merging signals closer than 30 m along the route.
        r.signals = merged_signals(self, &edges);
        Some(r)
    }
}

fn merged_signals(g: &BikeGraph, edges: &[(u32, Edge)]) -> u32 {
    let mut n = 0;
    let mut since = f64::INFINITY;
    for (_, e) in edges {
        since += e.len_m;
        if g.control[e.to as usize] == 1 {
            if since > 30.0 {
                n += 1;
            }
            since = 0.0;
        }
    }
    n
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tags(kv: &[(&str, &str)]) -> Tags {
        kv.iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn classes_follow_bike_infrastructure() {
        assert_eq!(
            classify(&tags(&[("highway", "cycleway")])),
            Some(Class::Separated)
        );
        assert_eq!(
            classify(&tags(&[
                ("highway", "primary"),
                ("cycleway:right", "track")
            ])),
            Some(Class::Separated)
        );
        assert_eq!(
            classify(&tags(&[("highway", "secondary"), ("cycleway", "lane")])),
            Some(Class::Lane)
        );
        assert_eq!(
            classify(&tags(&[("highway", "residential")])),
            Some(Class::Quiet)
        );
        assert_eq!(
            classify(&tags(&[("highway", "primary")])),
            Some(Class::Mixed)
        );
        assert_eq!(classify(&tags(&[("highway", "motorway")])), None);
        assert_eq!(classify(&tags(&[("highway", "footway")])), None);
        assert_eq!(
            classify(&tags(&[("highway", "footway"), ("bicycle", "designated")])),
            Some(Class::Separated)
        );
        assert_eq!(
            classify(&tags(&[
                ("highway", "primary"),
                ("bicycle", "use_sidepath")
            ])),
            None
        );
        // A bike lane the planner set up in the GIS tab, separated from traffic.
        assert_eq!(
            classify(&tags(&[
                ("highway", "primary"),
                ("cycleway:both", "lane"),
                ("mobsimlab:separated", "yes")
            ])),
            Some(Class::Separated)
        );
    }

    #[test]
    fn oneways_allow_contraflow_cycling() {
        assert_eq!(directions(&tags(&[("oneway", "yes")])), (true, false));
        assert_eq!(
            directions(&tags(&[("oneway", "yes"), ("oneway:bicycle", "no")])),
            (true, true)
        );
        assert_eq!(directions(&tags(&[("oneway", "-1")])), (false, true));
        assert_eq!(
            directions(&tags(&[("junction", "roundabout")])),
            (true, false)
        );
    }
}
