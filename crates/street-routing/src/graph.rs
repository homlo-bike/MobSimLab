//! Directed road graph for street-based transit, built from OSM data.
//!
//! Every pair of consecutive way nodes is one segment with up to two directed
//! arcs. Keeping segments unsimplified makes turn restrictions, stop snapping and
//! "no U-turn" checks exact. In production this view is built from the unified
//! graph in PostGIS (ADR-0009); the OSM builder is the same tag mapping.

use crate::geo::{dist, heading, project_on_segment, LocalProjection, SegmentProjection};
use crate::osm::{OsmData, RestrictionKind, Tags};
use crate::profile::{Mode, VehicleProfile};
use std::collections::{HashMap, HashSet};

/// Road graph node (an OSM node used by a road way).
#[derive(Debug, Clone)]
pub struct Node {
    /// OSM id.
    pub osm_id: i64,
    /// Local metres.
    pub xy: (f64, f64),
    /// Turning circle, turning loop or mini roundabout: buses may turn round here.
    pub turn_round: bool,
    /// Barrier that stops buses (bollard, gate without bus access...).
    pub blocked: bool,
}

/// Directed road arc between two consecutive way nodes.
#[derive(Debug, Clone)]
pub struct Arc {
    /// Start node.
    pub from: u32,
    /// End node.
    pub to: u32,
    /// Undirected segment this arc runs along.
    pub segment: u32,
    /// OSM way id.
    pub way: i64,
    /// Street name (or `ref` when unnamed).
    pub name: Option<String>,
    /// Length in metres.
    pub length_m: f64,
    /// Legal speed in km/h (from `maxspeed` or the road class).
    pub speed_kmh: f64,
    /// Heading in radians.
    pub heading: f64,
    /// Motorway or motorway link (intercity buses only).
    pub motorway: bool,
    /// Guided busway (BRT only).
    pub guideway: bool,
    /// Bus lane or busway (BRT prefers these).
    pub bus_lane: bool,
    /// Overhead trolleybus wire present in this direction.
    pub wire: bool,
    /// Limits from `maxheight`, `maxweight`, `maxlength`.
    pub max_height_m: Option<f64>,
    /// See `max_height_m`.
    pub max_weight_t: Option<f64>,
    /// See `max_height_m`.
    pub max_length_m: Option<f64>,
}

/// Undirected segment with its directed arcs (`fwd` runs `a → b`).
#[derive(Debug, Clone)]
pub struct Segment {
    /// First node in way order.
    pub a: u32,
    /// Second node in way order.
    pub b: u32,
    /// Arc `a → b` when buses may use it.
    pub fwd: Option<u32>,
    /// Arc `b → a` when buses may use it.
    pub bwd: Option<u32>,
    /// Carriageway width in metres, used to place stops on the sidewalk.
    pub width_m: f64,
    /// Service road, living street or pedestrian street: clicks prefer other roads nearby.
    pub minor: bool,
}

/// Directed road graph with turn bans and a grid index for snapping.
#[derive(Debug, Clone)]
pub struct RoadGraph {
    /// Projection between degrees and local metres.
    pub proj: LocalProjection,
    /// Nodes.
    pub nodes: Vec<Node>,
    /// Directed arcs.
    pub arcs: Vec<Arc>,
    /// Segments.
    pub segments: Vec<Segment>,
    /// Outgoing arcs per node.
    pub out: Vec<Vec<u32>>,
    /// Incoming arcs per node.
    pub inc: Vec<Vec<u32>>,
    /// Banned `(from arc, to arc)` turns.
    pub banned: HashSet<(u32, u32)>,
    grid: HashMap<(i32, i32), Vec<u32>>,
    bounds: [f64; 4],
}

const CELL_M: f64 = 100.0;
/// A click must be this much closer to a minor road than to a main road to snap to it.
const MINOR_SNAP_PENALTY_M: f64 = 15.0;

/// Purpose: interpret one OSM way for bus-type vehicles.
/// Output: `(forward, backward)` access and the class info, or `None` when buses can never use it.
struct WayInfo {
    fwd: bool,
    bwd: bool,
    speed_kmh: f64,
    width_m: f64,
    motorway: bool,
    guideway: bool,
    bus_lane: bool,
    wire_fwd: bool,
    wire_bwd: bool,
    minor: bool,
}

fn yes(v: Option<&String>) -> bool {
    matches!(
        v.map(String::as_str),
        Some("yes" | "designated" | "permissive" | "true" | "1")
    )
}

fn no(v: Option<&String>) -> bool {
    matches!(
        v.map(String::as_str),
        Some(
            "no" | "private" | "agricultural" | "forestry" | "delivery" | "customers" | "emergency"
        )
    )
}

/// Purpose: parse a length tag (`3.5`, `3.5 m`, `12'6"`) in metres.
pub fn parse_metres(v: &str) -> Option<f64> {
    let v = v.trim();
    if let Some((ft, inch)) = v.split_once('\'') {
        let ft: f64 = ft.trim().parse().ok()?;
        let inch: f64 = inch.trim_end_matches('"').trim().parse().unwrap_or(0.0);
        return Some(ft * 0.3048 + inch * 0.0254);
    }
    v.trim_end_matches('m').trim().parse().ok()
}

/// Purpose: parse a weight tag (`7.5`, `7.5 t`, `16000 kg`) in tonnes.
pub fn parse_tonnes(v: &str) -> Option<f64> {
    let v = v.trim();
    if let Some(kg) = v.strip_suffix("kg") {
        return kg.trim().parse::<f64>().ok().map(|k| k / 1000.0);
    }
    v.trim_end_matches('t').trim().parse().ok()
}

/// Purpose: parse `maxspeed` (`50`, `30 mph`, `DE:urban`) in km/h.
pub fn parse_speed(v: &str) -> Option<f64> {
    let v = v.trim();
    if let Some(mph) = v.strip_suffix("mph") {
        return mph.trim().parse::<f64>().ok().map(|m| m * 1.609_344);
    }
    if let Ok(k) = v.parse::<f64>() {
        return Some(k);
    }
    match v.split(':').nth(1) {
        Some("urban") => Some(50.0),
        Some("rural") => Some(90.0),
        Some("living_street") => Some(10.0),
        Some("motorway") => Some(120.0),
        Some("zone30") | Some("zone:30") => Some(30.0),
        _ => None,
    }
}

fn way_info(tags: &Tags) -> Option<WayInfo> {
    let hw = tags.get("highway")?.as_str();
    if tags.get("area").map(String::as_str) == Some("yes") {
        return None;
    }
    let bus_yes = yes(tags.get("bus")) || yes(tags.get("psv"));
    let (default_speed, default_width, bus_by_default) = match hw {
        "motorway" | "motorway_link" => (100.0, 11.0, true),
        "trunk" | "trunk_link" => (80.0, 10.0, true),
        "primary" | "primary_link" => (50.0, 10.0, true),
        "secondary" | "secondary_link" => (50.0, 8.0, true),
        "tertiary" | "tertiary_link" => (40.0, 7.0, true),
        "unclassified" | "road" => (40.0, 6.0, true),
        "residential" => (30.0, 6.0, true),
        "living_street" => (10.0, 5.0, true),
        "busway" | "bus_guideway" => (50.0, 4.0, true),
        "service" => (
            15.0,
            4.0,
            !matches!(
                tags.get("service").map(String::as_str),
                Some("parking_aisle" | "drive-through")
            ),
        ),
        "pedestrian" => (10.0, 5.0, false),
        _ => return None,
    };
    let allowed = if bus_yes {
        true
    } else if no(tags.get("bus")) || no(tags.get("psv")) || !bus_by_default {
        false
    } else {
        !(no(tags.get("motor_vehicle")) || no(tags.get("vehicle")) || no(tags.get("access")))
    };
    if !allowed {
        return None;
    }
    let motorway = hw.starts_with("motorway");
    let oneway_tag = tags.get("oneway").map(String::as_str);
    let roundabout = matches!(
        tags.get("junction").map(String::as_str),
        Some("roundabout" | "circular")
    );
    let (mut fwd, mut bwd) = match oneway_tag {
        Some("yes" | "true" | "1") => (true, false),
        Some("-1" | "reverse") => (false, true),
        Some("no" | "false" | "0") => (true, true),
        _ if roundabout || motorway => (true, false),
        _ => (true, true),
    };
    let contra_bus = ["oneway:bus", "oneway:psv"]
        .iter()
        .any(|k| tags.get(*k).map(String::as_str) == Some("no"))
        || ["busway", "busway:left", "busway:right", "busway:both"]
            .iter()
            .any(|k| tags.get(*k).map(String::as_str) == Some("opposite_lane"));
    if contra_bus {
        fwd = true;
        bwd = true;
    }
    let bus_lane = matches!(hw, "busway" | "bus_guideway")
        || ["busway", "busway:left", "busway:right", "busway:both"]
            .iter()
            .any(|k| {
                matches!(
                    tags.get(*k).map(String::as_str),
                    Some("lane" | "opposite_lane")
                )
            })
        || tags.keys().any(|k| {
            k.starts_with("bus:lanes") || k.starts_with("lanes:bus") || k.starts_with("lanes:psv")
        });
    let wire_all = yes(tags.get("trolley_wire"));
    let width_m = tags
        .get("width")
        .and_then(|w| parse_metres(w))
        .or_else(|| {
            tags.get("lanes")
                .and_then(|l| l.parse::<f64>().ok())
                .map(|l| l * 3.25)
        })
        .unwrap_or(default_width);
    Some(WayInfo {
        fwd,
        bwd,
        speed_kmh: tags
            .get("maxspeed")
            .and_then(|s| parse_speed(s))
            .unwrap_or(default_speed),
        width_m,
        motorway,
        guideway: hw == "bus_guideway",
        bus_lane,
        wire_fwd: wire_all || yes(tags.get("trolley_wire:forward")),
        wire_bwd: wire_all || yes(tags.get("trolley_wire:backward")),
        minor: matches!(hw, "service" | "living_street" | "pedestrian"),
    })
}

fn node_blocked(tags: &Tags) -> bool {
    let Some(b) = tags.get("barrier").map(String::as_str) else {
        return false;
    };
    let blocking = matches!(
        b,
        "bollard"
            | "block"
            | "chain"
            | "jersey_barrier"
            | "lift_gate"
            | "swing_gate"
            | "gate"
            | "sump_buster"
            | "debris"
    );
    blocking
        && !(yes(tags.get("bus"))
            || yes(tags.get("psv"))
            || yes(tags.get("motor_vehicle"))
            || yes(tags.get("access")))
}

impl RoadGraph {
    /// Purpose: build the graph from parsed OSM data.
    /// Output: an error when the data contains no road usable by buses.
    pub fn from_osm(data: &OsmData) -> Result<Self, String> {
        Self::from_osm_with(data, None)
    }

    /// Purpose: build the graph with a fixed projection, so positions stay comparable when the
    /// network is rebuilt with more data. `None` centres the projection on the data.
    pub fn from_osm_with(data: &OsmData, proj: Option<LocalProjection>) -> Result<Self, String> {
        let node_by_id: HashMap<i64, usize> = data
            .nodes
            .iter()
            .enumerate()
            .map(|(i, n)| (n.id, i))
            .collect();
        let road_ways: Vec<(&crate::osm::RawWay, WayInfo)> = data
            .ways
            .iter()
            .filter_map(|w| way_info(&w.tags).map(|i| (w, i)))
            .collect();
        let (mut lon_sum, mut lat_sum, mut count) = (0.0, 0.0, 0.0);
        for (w, _) in &road_ways {
            for n in w.nodes.iter().filter_map(|id| node_by_id.get(id)) {
                lon_sum += data.nodes[*n].lon;
                lat_sum += data.nodes[*n].lat;
                count += 1.0;
            }
        }
        if count == 0.0 {
            return Err("No roads that buses may use in this area.".into());
        }
        let proj = proj.unwrap_or_else(|| LocalProjection::new(lon_sum / count, lat_sum / count));
        let mut g = RoadGraph {
            proj,
            nodes: Vec::new(),
            arcs: Vec::new(),
            segments: Vec::new(),
            out: Vec::new(),
            inc: Vec::new(),
            banned: HashSet::new(),
            grid: HashMap::new(),
            bounds: [f64::MAX, f64::MAX, f64::MIN, f64::MIN],
        };
        let mut index: HashMap<i64, u32> = HashMap::new();
        for (w, info) in &road_ways {
            let name = w.tags.get("name").or_else(|| w.tags.get("ref")).cloned();
            let lim = |k: &str, f: fn(&str) -> Option<f64>| w.tags.get(k).and_then(|v| f(v));
            let (mh, mw, ml) = (
                lim("maxheight", parse_metres),
                lim("maxweight", parse_tonnes),
                lim("maxlength", parse_metres),
            );
            let ids: Vec<u32> = w
                .nodes
                .iter()
                .filter_map(|id| node_by_id.get(id).map(|i| (*id, *i)))
                .map(|(id, i)| {
                    *index.entry(id).or_insert_with(|| {
                        let n = &data.nodes[i];
                        let hw = n.tags.get("highway").map(String::as_str);
                        g.nodes.push(Node {
                            osm_id: id,
                            xy: proj.to_xy(n.lon, n.lat),
                            turn_round: matches!(
                                hw,
                                Some("turning_circle" | "turning_loop" | "mini_roundabout")
                            ),
                            blocked: node_blocked(&n.tags),
                        });
                        (g.nodes.len() - 1) as u32
                    })
                })
                .collect();
            for pair in ids.windows(2) {
                let (a, b) = (pair[0], pair[1]);
                if a == b {
                    continue;
                }
                let seg = g.segments.len() as u32;
                let (pa, pb) = (g.nodes[a as usize].xy, g.nodes[b as usize].xy);
                let mut mk = |from: u32, to: u32, wire: bool| {
                    let (p, q) = (g.nodes[from as usize].xy, g.nodes[to as usize].xy);
                    g.arcs.push(Arc {
                        from,
                        to,
                        segment: seg,
                        way: w.id,
                        name: name.clone(),
                        length_m: dist(p, q).max(0.01),
                        speed_kmh: info.speed_kmh.max(5.0),
                        heading: heading(p, q),
                        motorway: info.motorway,
                        guideway: info.guideway,
                        bus_lane: info.bus_lane,
                        wire,
                        max_height_m: mh,
                        max_weight_t: mw,
                        max_length_m: ml,
                    });
                    (g.arcs.len() - 1) as u32
                };
                let fwd = info.fwd.then(|| mk(a, b, info.wire_fwd));
                let bwd = info.bwd.then(|| mk(b, a, info.wire_bwd));
                g.segments.push(Segment {
                    a,
                    b,
                    fwd,
                    bwd,
                    width_m: info.width_m,
                    minor: info.minor,
                });
                g.bounds = [
                    g.bounds[0].min(pa.0.min(pb.0)),
                    g.bounds[1].min(pa.1.min(pb.1)),
                    g.bounds[2].max(pa.0.max(pb.0)),
                    g.bounds[3].max(pa.1.max(pb.1)),
                ];
            }
        }
        g.out = vec![Vec::new(); g.nodes.len()];
        g.inc = vec![Vec::new(); g.nodes.len()];
        for (i, a) in g.arcs.iter().enumerate() {
            g.out[a.from as usize].push(i as u32);
            g.inc[a.to as usize].push(i as u32);
        }
        for r in &data.restrictions {
            let Some(&via) = index.get(&r.via_node) else {
                continue;
            };
            for &ia in &g.inc[via as usize] {
                if g.arcs[ia as usize].way != r.from_way {
                    continue;
                }
                for &oa in &g.out[via as usize] {
                    let to_way = g.arcs[oa as usize].way == r.to_way;
                    if (r.kind == RestrictionKind::No && to_way)
                        || (r.kind == RestrictionKind::Only && !to_way)
                    {
                        g.banned.insert((ia, oa));
                    }
                }
            }
        }
        for s in 0..g.segments.len() {
            let seg = &g.segments[s];
            let (pa, pb) = (g.nodes[seg.a as usize].xy, g.nodes[seg.b as usize].xy);
            let (c0, c1) = (
                cell(pa.0.min(pb.0), pa.1.min(pb.1)),
                cell(pa.0.max(pb.0), pa.1.max(pb.1)),
            );
            for cx in c0.0..=c1.0 {
                for cy in c0.1..=c1.1 {
                    g.grid.entry((cx, cy)).or_default().push(s as u32);
                }
            }
        }
        Ok(g)
    }

    /// Purpose: whether a vehicle may drive along `arc` (mode access, limits, wire, barriers).
    pub fn allows(&self, arc: u32, v: &VehicleProfile) -> bool {
        let a = &self.arcs[arc as usize];
        if self.nodes[a.to as usize].blocked || self.nodes[a.from as usize].blocked {
            return false;
        }
        if a.motorway && v.mode != Mode::IntercityBus {
            return false;
        }
        if a.guideway && v.mode != Mode::Brt {
            return false;
        }
        if v.mode == Mode::Trolleybus && !a.wire && v.battery_range_m <= 0.0 {
            return false;
        }
        let over = |lim: Option<f64>, val: f64| lim.is_some_and(|l| val > l);
        !(over(a.max_height_m, v.height_m)
            || over(a.max_weight_t, v.weight_t)
            || over(a.max_length_m, v.length_m))
    }

    /// Purpose: nearest segment with at least one arc usable by the vehicle.
    /// Output: segment id and the projection, or `None` beyond `max_m`.
    pub fn nearest_segment(
        &self,
        p: (f64, f64),
        v: &VehicleProfile,
        max_m: f64,
    ) -> Option<(u32, SegmentProjection)> {
        let c = cell(p.0, p.1);
        let reach = (max_m / CELL_M).ceil() as i32;
        let mut best: Option<(u32, SegmentProjection, f64)> = None;
        for cx in c.0 - reach..=c.0 + reach {
            for cy in c.1 - reach..=c.1 + reach {
                for &s in self.grid.get(&(cx, cy)).map(Vec::as_slice).unwrap_or(&[]) {
                    let seg = &self.segments[s as usize];
                    if !seg
                        .fwd
                        .into_iter()
                        .chain(seg.bwd)
                        .any(|a| self.allows(a, v))
                    {
                        continue;
                    }
                    let pr = project_on_segment(
                        p,
                        self.nodes[seg.a as usize].xy,
                        self.nodes[seg.b as usize].xy,
                    );
                    let score = pr.dist + if seg.minor { MINOR_SNAP_PENALTY_M } else { 0.0 };
                    if pr.dist <= max_m && best.as_ref().map_or(true, |b| score < b.2) {
                        best = Some((s, pr, score));
                    }
                }
            }
        }
        best.map(|(s, pr, _)| (s, pr))
    }

    /// Purpose: roads the vehicle may use, as a GeoJSON FeatureCollection of segments.
    /// Properties: `oneway` (only one direction usable), `wire` (overhead wire), `bus_lane`.
    pub fn usable_roads_geojson(&self, v: &VehicleProfile) -> String {
        let mut out = String::from(r#"{"type":"FeatureCollection","features":["#);
        let mut first = true;
        for seg in &self.segments {
            let arcs: Vec<u32> = seg
                .fwd
                .into_iter()
                .chain(seg.bwd)
                .filter(|&a| self.allows(a, v))
                .collect();
            let Some(&a0) = arcs.first() else { continue };
            let (pa, pb) = (self.nodes[seg.a as usize].xy, self.nodes[seg.b as usize].xy);
            let (la, lb) = (
                self.proj.to_lonlat(pa.0, pa.1),
                self.proj.to_lonlat(pb.0, pb.1),
            );
            let arc = &self.arcs[a0 as usize];
            let wire = arcs.iter().any(|&a| self.arcs[a as usize].wire);
            if !first {
                out.push(',');
            }
            first = false;
            out.push_str(&format!(
                r#"{{"type":"Feature","properties":{{"oneway":{},"wire":{},"bus_lane":{}}},"geometry":{{"type":"LineString","coordinates":[[{:.7},{:.7}],[{:.7},{:.7}]]}}}}"#,
                arcs.len() == 1,
                wire,
                arc.bus_lane,
                la.0,
                la.1,
                lb.0,
                lb.1
            ));
        }
        out.push_str("]}");
        out
    }

    /// Purpose: bounding box of the network as `[west, south, east, north]` in degrees.
    pub fn bounds_lonlat(&self) -> [f64; 4] {
        let (w, s) = self.proj.to_lonlat(self.bounds[0], self.bounds[1]);
        let (e, n) = self.proj.to_lonlat(self.bounds[2], self.bounds[3]);
        [w, s, e, n]
    }

    /// Purpose: point on `arc` at fraction `t` in local metres.
    pub fn point_on_arc(&self, arc: u32, t: f64) -> (f64, f64) {
        let a = &self.arcs[arc as usize];
        let (p, q) = (self.nodes[a.from as usize].xy, self.nodes[a.to as usize].xy);
        (p.0 + (q.0 - p.0) * t, p.1 + (q.1 - p.1) * t)
    }
}

fn cell(x: f64, y: f64) -> (i32, i32) {
    ((x / CELL_M).floor() as i32, (y / CELL_M).floor() as i32)
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
    fn parses_limits() {
        assert_eq!(parse_metres("3.5 m"), Some(3.5));
        assert!((parse_metres("12'6\"").unwrap() - 3.81).abs() < 0.01);
        assert_eq!(parse_tonnes("16000 kg"), Some(16.0));
        assert_eq!(parse_speed("DE:urban"), Some(50.0));
        assert!((parse_speed("30 mph").unwrap() - 48.28).abs() < 0.01);
    }

    #[test]
    fn access_and_oneway_rules() {
        assert!(way_info(&tags(&[("highway", "footway")])).is_none());
        assert!(way_info(&tags(&[("highway", "pedestrian")])).is_none());
        assert!(way_info(&tags(&[("highway", "pedestrian"), ("bus", "yes")])).is_some());
        assert!(way_info(&tags(&[
            ("highway", "residential"),
            ("motor_vehicle", "no")
        ]))
        .is_none());
        assert!(way_info(&tags(&[
            ("highway", "residential"),
            ("motor_vehicle", "no"),
            ("psv", "yes")
        ]))
        .is_some());
        let one = way_info(&tags(&[("highway", "primary"), ("oneway", "yes")])).unwrap();
        assert!(one.fwd && !one.bwd);
        let contra = way_info(&tags(&[
            ("highway", "primary"),
            ("oneway", "yes"),
            ("oneway:bus", "no"),
        ]))
        .unwrap();
        assert!(contra.fwd && contra.bwd);
        let round = way_info(&tags(&[
            ("highway", "tertiary"),
            ("junction", "roundabout"),
        ]))
        .unwrap();
        assert!(round.fwd && !round.bwd);
        let rev = way_info(&tags(&[("highway", "secondary"), ("oneway", "-1")])).unwrap();
        assert!(!rev.fwd && rev.bwd);
    }
}
