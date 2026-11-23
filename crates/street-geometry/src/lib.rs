//! MobSimLab lane and junction shapes for the GIS map (ADR-0047).
//!
//! The street tiles the editor already loads (OSM XML, merged as [`OsmData`]) and the planner's street
//! setups (applied with [`street_routing::apply_setups`]) go through
//! [osm2streets](https://github.com/a-b-street/osm2streets): each road becomes a list of lanes from left to
//! right (type, direction, width) and each junction a polygon. This crate only draws: routing stays in
//! `street-routing` (ADR-0009, ADR-0031).
//!
//! The three setup values that are not OSM tags are added to the lane lists here, the way the GIS tab's
//! cross-section draws them:
//!
//! - `mobsimlab:tram=own_lane`: a tram lane (3.1 m) per direction of travel in the middle of the street;
//!   on a one-way street one tram lane on the inner side (left where traffic drives on the right);
//! - `mobsimlab:tram=mixed`: rails along the traffic lane next to the centre in each direction;
//! - `mobsimlab:separated=yes`: a kerb between the bus lane and the traffic, and on both sides of a tram
//!   lane. A separated bike lane is already a `cycleway=track` after the setup.
//!
//! A street the planner laid out section by section (`StreetSetup::sections`) is drawn exactly as laid out:
//! its sections replace osm2streets' lanes, in their order and widths, with traffic islands and green
//! strips as kinds of their own.
//!
//! Rails come only from track. A setup's tram lane on a street without tram rails in OpenStreetMap is
//! drawn as an empty strip ([`LaneKind::TramSpace`]) and a tram in mixed traffic gets no rails there: the
//! railway editor's tracks are drawn over the lanes instead, so a street never shows two sets of rails.
//!
//! The output is compact for the browser: rings and paths as flat `[lon, lat, lon, lat, …]` arrays,
//! rounded to 1e-6° (about 0.1 m), and only the markings a planner reads (lane lines and centre lines),
//! not the hundred thousand arrows and pavement edges osm2streets can draw for one tile.
//!
//! Data © OpenStreetMap contributors, ODbL. Geometry: osm2streets (Apache-2.0).
#![warn(missing_docs)]

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::fmt::Write as _;

use geom::{Distance, PolyLine, Pt2D};
pub use osm2streets::DrivingSide;
use osm2streets::{
    BufferType, Direction, IntersectionControl, IntersectionID, IntersectionKind, LaneSpec,
    LaneType, MapConfig, Road, StreetNetwork, Transformation,
};
use serde::Serialize;
use street_routing::osm::{OsmData, Tags};
use street_routing::setup::osm_bus_lane;
use street_routing::{apply_setups, RoadUser, Section, SectionDir, SectionKind, StreetSetup};

/// Width of a tram lane for one track, m (half the 6.2 m double-track lane of the cross-section).
pub const TRAM_LANE_M: f64 = 3.1;
/// Width of a kerb between a bus or tram lane and the traffic, m.
pub const KERB_M: f64 = 0.5;

/// What a lane is, for its colour on the map.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LaneKind {
    /// General traffic.
    Traffic,
    /// Bus lane.
    Bus,
    /// Bike lane or track.
    Bike,
    /// Tram lane (track in its own lane) where OpenStreetMap maps tram rails.
    Tram,
    /// A tram lane from the planner's setup on a street without tram rails in OpenStreetMap: space kept
    /// for a tram, drawn empty. Rails come only from track (OSM's, or drawn in the railway editor), so a
    /// layout never draws rails of its own. Lane shapes only; the street's lane list keeps `Tram`.
    TramSpace,
    /// Pavement.
    Pavement,
    /// Footway, or a shoulder people walk on.
    Footway,
    /// Shared footway and cycleway.
    SharedUse,
    /// Parking along the street.
    Parking,
    /// Kerb, barrier or other separation.
    Kerb,
    /// Painted buffer or centre turning lane.
    Buffer,
    /// Under construction.
    Construction,
    /// A traffic island or median (custom layouts).
    Island,
    /// A green strip of trees, grass or shrubs (custom layouts).
    Green,
}

/// A line drawn on the street.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LineKind {
    /// Between two lanes of the same direction (dashed).
    Lane,
    /// Between the two directions (solid).
    Centre,
    /// Tram rails in a traffic lane (a tram in mixed traffic).
    Rails,
}

/// One lane of one road, as a polygon.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LaneShape {
    /// What the lane is.
    pub kind: LaneKind,
    /// OSM way the road comes from (the first one, when osm2streets joined several).
    pub way: i64,
    /// OSM `layer` (bridges above, tunnels below).
    pub layer: i32,
    /// Outer ring, `[lon, lat, …]`.
    pub ring: Vec<f64>,
}

/// One junction, as a polygon.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct JunctionShape {
    /// Outer ring, `[lon, lat, …]`.
    pub ring: Vec<f64>,
    /// The OSM nodes the junction is made of (more than one where osm2streets joined a cluster).
    pub nodes: Vec<i64>,
    /// The OSM ways that meet here, to name the junction by its streets.
    pub ways: Vec<i64>,
    /// Whether traffic crosses or gives way here (at least three roads meet): the junctions a planner
    /// may give or take traffic lights.
    pub crossing: bool,
    /// Whether OpenStreetMap maps traffic lights at the junction (`highway=traffic_signals`).
    pub signals: bool,
}

/// One marking line.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LineShape {
    /// What the line is.
    pub kind: LineKind,
    /// OSM `layer` of its road.
    pub layer: i32,
    /// Path, `[lon, lat, …]`.
    pub path: Vec<f64>,
}

/// Which way a lane runs, along the OSM way's node order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LaneDir {
    /// In the way's direction.
    Forward,
    /// Against it.
    Backward,
}

/// One lane of a street's cross-section.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LaneProfile {
    /// What the lane is.
    pub kind: LaneKind,
    /// Which way it runs.
    pub dir: LaneDir,
    /// Width, m (from OSM `width` tags or osm2lanes' typical width for the lane type).
    pub width: f64,
    /// Whether tram rails run along it (a tram lane, or the traffic lane a tram in mixed traffic uses).
    pub rails: bool,
}

/// The lanes of one OSM way, left to right looking along the way, for the cross-section panel.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RoadLanes {
    /// OSM way id.
    pub way: i64,
    /// Lanes, left to right.
    pub lanes: Vec<LaneProfile>,
}

/// Everything the map draws.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct Geometry {
    /// Lane polygons, lowest layer first.
    pub lanes: Vec<LaneShape>,
    /// Junction polygons.
    pub junctions: Vec<JunctionShape>,
    /// Lane lines, centre lines and rails.
    pub lines: Vec<LineShape>,
    /// The lanes of each way, from its longest road (a way split at junctions has one road per piece).
    pub roads: Vec<RoadLanes>,
    /// `right` or `left`: the side traffic drives on (the project's, else from the country of the area).
    pub driving_side: &'static str,
}

/// Purpose: lane and junction shapes for the streets in `data`, with the planner's setups applied.
/// Inputs: merged OSM street tiles; the project's street setups; the side traffic drives on (Project
/// preferences, `street.driving_side`), or `None` to take it from the country of the area.
/// Output: the shapes, or osm2streets' error text when the streets cannot be built.
/// Side effects: none (works on a copy of `data`).
pub fn build(
    data: &OsmData,
    setups: &[StreetSetup],
    driving_side: Option<DrivingSide>,
) -> Result<Geometry, String> {
    let mut data = streets_only(data);
    let setups = keep_traffic_lanes(&data, setups);
    apply_setups(&mut data, &setups);
    let tags: HashMap<i64, Tags> = data.ways.iter().map(|w| (w.id, w.tags.clone())).collect();
    let xml = to_osm_xml(&data);

    let cfg = MapConfig {
        inferred_sidewalks: true,
        override_driving_side: driving_side,
        ..MapConfig::default()
    };
    let mut timer = abstutil::Timer::throwaway();
    let (mut net, _) = streets_reader::osm_to_street_network(xml.as_bytes(), None, cfg, &mut timer)
        .map_err(|e| e.to_string())?;
    let custom: HashMap<i64, Vec<CustomLane>> = setups
        .iter()
        .filter_map(|s| s.sections.as_ref().map(|x| (s.way, custom_lanes(x))))
        .filter(|(_, l)| !l.is_empty())
        .collect();
    apply_setup_lanes(&mut net, &tags, &custom);
    net.apply_transformations(Transformation::standard_for_clipped_areas(), &mut timer);
    Ok(shapes(&net, &tags, &custom))
}

/// Purpose: a bus lane set up on a street keeps its traffic lanes, as the street setup panel counts them
/// (`osmTrafficLanes` in the web app): OSM `lanes` counts bus lanes too, so adding `busway` alone would turn
/// traffic lanes into bus lanes in osm2lanes.
/// Output: the setups, with the way's OSM traffic lane count filled in where a bus lane changes and the
/// planner set no lane count.
fn keep_traffic_lanes(data: &OsmData, setups: &[StreetSetup]) -> Vec<StreetSetup> {
    let tags: HashMap<i64, &Tags> = data.ways.iter().map(|w| (w.id, &w.tags)).collect();
    setups
        .iter()
        .map(|s| {
            let mut s = s.clone();
            if s.bus_lane.is_some() && s.traffic_lanes.is_none() {
                if let Some(t) = tags.get(&s.way) {
                    let oneway = matches!(
                        tag(Some(t), "oneway"),
                        Some("yes" | "true" | "1" | "-1" | "reverse")
                    );
                    let bus = if !osm_bus_lane(t) {
                        0
                    } else if oneway {
                        1
                    } else {
                        2
                    };
                    let lanes = tag(Some(t), "lanes").and_then(|v| v.trim().parse::<f64>().ok());
                    let n = match lanes {
                        Some(l) => (l.round() as i64 - bus).max(1),
                        None if oneway => 1,
                        None => 2,
                    };
                    s.traffic_lanes = u8::try_from(n).ok();
                }
            }
            s
        })
        .collect()
}

/// Purpose: keep the ways that are streets or paths (`highway`, not an area) and their nodes. Railway ways
/// are the railway editor's; osm2streets would draw them as roads of their own.
fn streets_only(data: &OsmData) -> OsmData {
    let ways: Vec<_> = data
        .ways
        .iter()
        .filter(|w| {
            w.tags.contains_key("highway")
                && w.nodes.len() >= 2
                && w.tags.get("area").map(String::as_str) != Some("yes")
        })
        .cloned()
        .collect();
    let used: HashSet<i64> = ways.iter().flat_map(|w| w.nodes.iter().copied()).collect();
    OsmData {
        nodes: data
            .nodes
            .iter()
            .filter(|n| used.contains(&n.id))
            .cloned()
            .collect(),
        ways,
        restrictions: Vec::new(),
    }
}

/// Purpose: write OSM data as OSM XML, the input osm2streets reads.
pub fn to_osm_xml(data: &OsmData) -> String {
    let mut s = String::with_capacity(64 * (data.nodes.len() + data.ways.len()));
    s.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<osm version=\"0.6\">\n");
    for n in &data.nodes {
        let _ = write!(
            s,
            "<node id=\"{}\" lat=\"{}\" lon=\"{}\"",
            n.id, n.lat, n.lon
        );
        if n.tags.is_empty() {
            s.push_str("/>\n");
        } else {
            s.push_str(">\n");
            write_tags(&mut s, &n.tags);
            s.push_str("</node>\n");
        }
    }
    for w in &data.ways {
        let _ = writeln!(s, "<way id=\"{}\">", w.id);
        for nd in &w.nodes {
            let _ = writeln!(s, "<nd ref=\"{nd}\"/>");
        }
        write_tags(&mut s, &w.tags);
        s.push_str("</way>\n");
    }
    s.push_str("</osm>\n");
    s
}

fn write_tags(s: &mut String, tags: &Tags) {
    for (k, v) in tags {
        let _ = writeln!(s, "<tag k=\"{}\" v=\"{}\"/>", escape(k), escape(v));
    }
}

fn escape(v: &str) -> String {
    let mut out = String::with_capacity(v.len());
    for c in v.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            c => out.push(c),
        }
    }
    out
}

fn tag<'a>(tags: Option<&'a Tags>, key: &str) -> Option<&'a str> {
    tags.and_then(|t| t.get(key)).map(String::as_str)
}

/// Purpose: add the tram lanes and kerbs of `mobsimlab:tram=own_lane` and `mobsimlab:separated=yes`
/// (not OSM tags, so osm2lanes does not see them), then rebuild the road and junction shapes they change.
/// Side effects: changes lane lists, centre lines and junction polygons in `net`.
fn apply_setup_lanes(
    net: &mut StreetNetwork,
    tags: &HashMap<i64, Tags>,
    custom: &HashMap<i64, Vec<CustomLane>>,
) {
    let side = net.config.driving_side;
    let mut touched: BTreeSet<IntersectionID> = BTreeSet::new();
    for road in net.roads.values_mut() {
        let way = road.osm_ids.first().map(|id| id.0);
        if let Some(lanes) = way.and_then(|w| custom.get(&w)) {
            let Some(base) = road.lane_specs_ltr.first().cloned() else {
                continue;
            };
            road.lane_specs_ltr = lanes
                .iter()
                .map(|l| spec_like(&base, l.lt, l.dir, l.width))
                .collect();
            road.update_center_line(side);
            touched.insert(road.src_i);
            touched.insert(road.dst_i);
            continue;
        }
        let t = way.and_then(|w| tags.get(&w));
        let tram = tag(t, "mobsimlab:tram") == Some("own_lane");
        let separated = tag(t, "mobsimlab:separated") == Some("yes");
        if !tram && !separated {
            continue;
        }
        if setup_lanes(&mut road.lane_specs_ltr, side, tram, separated) {
            road.update_center_line(side);
            touched.insert(road.src_i);
            touched.insert(road.dst_i);
        }
    }
    for i in touched {
        if net.intersections.contains_key(&i) {
            net.sort_roads(i);
            net.update_i(i);
        }
    }
}

/// One lane of a custom layout, as osm2streets draws it.
#[derive(Debug, Clone, Copy, PartialEq)]
struct CustomLane {
    lt: LaneType,
    kind: LaneKind,
    dir: Direction,
    width: f64,
    rails: bool,
}

/// Purpose: the lanes of a street laid out section by section (left to right along the way). A lane
/// cars may use is a traffic lane (with rails when trams share it); a lane of buses or taxis without cars
/// a bus lane; one of trams a tram lane; bikes a bike lane; pedestrians a pavement; bikes and pedestrians
/// a shared path. Sections narrower than 0.1 m are left out.
fn custom_lanes(sections: &[Section]) -> Vec<CustomLane> {
    sections
        .iter()
        .filter(|s| s.width >= 0.1)
        .map(|s| {
            let has = |u| s.has(u);
            let (lt, kind) = match s.kind {
                SectionKind::Lane if has(RoadUser::Car) => (LaneType::Driving, LaneKind::Traffic),
                SectionKind::Lane if has(RoadUser::Tram) => (LaneType::LightRail, LaneKind::Tram),
                SectionKind::Lane if has(RoadUser::Bus) || has(RoadUser::Taxi) => {
                    (LaneType::Bus, LaneKind::Bus)
                }
                SectionKind::Lane if has(RoadUser::Bike) && has(RoadUser::Walk) => {
                    (LaneType::SharedUse, LaneKind::SharedUse)
                }
                SectionKind::Lane if has(RoadUser::Bike) => (LaneType::Biking, LaneKind::Bike),
                SectionKind::Lane if has(RoadUser::Walk) => {
                    (LaneType::Sidewalk, LaneKind::Pavement)
                }
                SectionKind::Lane => (LaneType::Buffer(BufferType::Stripes), LaneKind::Buffer),
                SectionKind::Parking => (
                    LaneType::Parking(osm2streets::ParkingType::Parallel),
                    LaneKind::Parking,
                ),
                SectionKind::Island => (
                    if s.style.as_deref() == Some("painted") {
                        LaneType::Buffer(BufferType::Stripes)
                    } else {
                        LaneType::Buffer(BufferType::Curb)
                    },
                    LaneKind::Island,
                ),
                SectionKind::Green => (LaneType::Buffer(BufferType::Verge), LaneKind::Green),
                SectionKind::Protection => (
                    LaneType::Buffer(match s.style.as_deref() {
                        Some("bollards") => BufferType::FlexPosts,
                        Some("planters") => BufferType::Planters,
                        _ => BufferType::Curb,
                    }),
                    LaneKind::Kerb,
                ),
            };
            CustomLane {
                lt,
                kind,
                dir: if s.dir == Some(SectionDir::Backward) {
                    Direction::Backward
                } else {
                    Direction::Forward
                },
                width: s.width,
                rails: has(RoadUser::Tram),
            }
        })
        .collect()
}

/// Purpose: whether OpenStreetMap maps tram rails along the way (`embedded_rails=tram`, `railway=tram`).
fn osm_tram_rails(tags: Option<&Tags>) -> bool {
    tag(tags, "embedded_rails").is_some_and(|v| v.contains("tram"))
        || tag(tags, "railway") == Some("tram")
}

fn carriageway(lt: LaneType) -> bool {
    matches!(
        lt,
        LaneType::Driving | LaneType::Bus | LaneType::SharedLeftTurn | LaneType::LightRail
    )
}

fn spec_like(base: &LaneSpec, lt: LaneType, dir: Direction, width_m: f64) -> LaneSpec {
    let mut s = base.clone();
    s.lt = lt;
    s.dir = dir;
    s.width = Distance::meters(width_m);
    s.allowed_turns.clear();
    s.lane = None;
    s
}

/// Purpose: insert tram lanes and kerbs into one road's lanes (left to right).
/// Inputs: the lanes; the side traffic drives on; whether the tram has its own lane; whether bus and tram
/// lanes are separated from the traffic. Output: whether anything changed.
/// Side effects: changes `lanes`.
pub fn setup_lanes(
    lanes: &mut Vec<LaneSpec>,
    side: DrivingSide,
    tram: bool,
    separated: bool,
) -> bool {
    let Some(base) = lanes.iter().find(|l| carriageway(l.lt)).cloned() else {
        return false;
    };
    let before = lanes.len();
    if separated {
        // A kerb on the traffic side of every bus lane.
        let mut i = 0;
        while i < lanes.len() {
            if lanes[i].lt == LaneType::Bus {
                let dir = lanes[i].dir;
                let left = i > 0 && lanes[i - 1].lt == LaneType::Driving;
                let right = i + 1 < lanes.len() && lanes[i + 1].lt == LaneType::Driving;
                let kerb = spec_like(&base, LaneType::Buffer(BufferType::Curb), dir, KERB_M);
                if right {
                    lanes.insert(i + 1, kerb.clone());
                }
                if left {
                    lanes.insert(i, kerb);
                    i += 1;
                }
            }
            i += 1;
        }
    }
    if tram && !lanes.iter().any(|l| l.lt == LaneType::LightRail) {
        let traffic: Vec<usize> = (0..lanes.len())
            .filter(|&i| matches!(lanes[i].lt, LaneType::Driving | LaneType::Bus))
            .collect();
        let two_way = traffic
            .windows(2)
            .find(|w| lanes[w[0]].dir != lanes[w[1]].dir);
        let mut tram_lanes = Vec::new();
        let at = if let Some(w) = two_way {
            // Between the two directions: the left lane runs the way of the lanes to its left.
            tram_lanes.push(spec_like(
                &base,
                LaneType::LightRail,
                lanes[w[0]].dir,
                TRAM_LANE_M,
            ));
            tram_lanes.push(spec_like(
                &base,
                LaneType::LightRail,
                lanes[w[1]].dir,
                TRAM_LANE_M,
            ));
            w[0] + 1
        } else if let (Some(&first), Some(&last)) = (traffic.first(), traffic.last()) {
            // One-way: on the inner side, away from the kerb where buses stop.
            let dir = lanes[first].dir;
            tram_lanes.push(spec_like(&base, LaneType::LightRail, dir, TRAM_LANE_M));
            match side {
                DrivingSide::Right => first,
                DrivingSide::Left => last + 1,
            }
        } else {
            return lanes.len() != before;
        };
        if separated {
            let dir_l = tram_lanes[0].dir;
            let dir_r = tram_lanes[tram_lanes.len() - 1].dir;
            tram_lanes.insert(
                0,
                spec_like(&base, LaneType::Buffer(BufferType::Curb), dir_l, KERB_M),
            );
            tram_lanes.push(spec_like(
                &base,
                LaneType::Buffer(BufferType::Curb),
                dir_r,
                KERB_M,
            ));
        }
        lanes.splice(at..at, tram_lanes);
    }
    lanes.len() != before
}

fn kind_of(lt: LaneType) -> LaneKind {
    match lt {
        LaneType::Driving => LaneKind::Traffic,
        LaneType::Bus => LaneKind::Bus,
        LaneType::Biking => LaneKind::Bike,
        LaneType::LightRail => LaneKind::Tram,
        LaneType::Sidewalk => LaneKind::Pavement,
        LaneType::Footway | LaneType::Shoulder => LaneKind::Footway,
        LaneType::SharedUse => LaneKind::SharedUse,
        LaneType::Parking(_) => LaneKind::Parking,
        LaneType::Buffer(BufferType::Stripes) | LaneType::SharedLeftTurn => LaneKind::Buffer,
        LaneType::Buffer(_) => LaneKind::Kerb,
        LaneType::Construction => LaneKind::Construction,
    }
}

fn round6(v: f64) -> f64 {
    (v * 1e6).round() / 1e6
}

fn flat(net: &StreetNetwork, pts: &[Pt2D]) -> Vec<f64> {
    let mut out = Vec::with_capacity(pts.len() * 2);
    for p in net.gps_bounds.convert_back(pts) {
        out.push(round6(p.x()));
        out.push(round6(p.y()));
    }
    out
}

/// The centre line of each lane, as osm2streets computes it (`Road::get_lane_center_lines` is private).
fn lane_center_lines(road: &Road) -> Vec<PolyLine> {
    let total = road.total_width();
    let mut so_far = Distance::ZERO;
    let mut out = Vec::with_capacity(road.lane_specs_ltr.len());
    for lane in &road.lane_specs_ltr {
        so_far += lane.width / 2.0;
        out.push(
            road.center_line
                .shift_from_center(total, so_far)
                .unwrap_or_else(|_| road.center_line.clone()),
        );
        so_far += lane.width / 2.0;
    }
    out
}

fn shapes(
    net: &StreetNetwork,
    tags: &HashMap<i64, Tags>,
    custom: &HashMap<i64, Vec<CustomLane>>,
) -> Geometry {
    let mut out = Geometry {
        driving_side: match net.config.driving_side {
            DrivingSide::Right => "right",
            DrivingSide::Left => "left",
        },
        ..Geometry::default()
    };
    // Per way: the length of the longest road seen so far and its lanes.
    let mut profiles: BTreeMap<i64, (f64, Vec<LaneProfile>)> = BTreeMap::new();
    for road in net.roads.values() {
        let way = road.osm_ids.first().map(|id| id.0).unwrap_or(0);
        let layer = i32::try_from(road.layer).unwrap_or(0);
        let centres = lane_center_lines(road);
        // A custom layout's own kinds and rails, while osm2streets kept its lanes as they were set.
        let own = custom
            .get(&way)
            .filter(|c| c.len() == road.lane_specs_ltr.len());
        let kind_at = |i: usize, lt: LaneType| own.map_or_else(|| kind_of(lt), |c| c[i].kind);
        // Tram rails mapped in OSM: real track. Elsewhere a setup's tram lane is only space for one.
        let track = osm_tram_rails(tags.get(&way));
        let drawn_kind = |i: usize, lt: LaneType| match kind_at(i, lt) {
            LaneKind::Tram if !track => LaneKind::TramSpace,
            k => k,
        };
        for (i, (lane, pl)) in road.lane_specs_ltr.iter().zip(&centres).enumerate() {
            let poly = pl.make_polygons(lane.width);
            out.lanes.push(LaneShape {
                kind: drawn_kind(i, lane.lt),
                way,
                layer,
                ring: flat(net, poly.get_outer_ring().points()),
            });
        }
        // Lines between neighbouring traffic or bus lanes, on their shared edge.
        let marked = |lt: LaneType| matches!(lt, LaneType::Driving | LaneType::Bus);
        for (pair, centre) in road.lane_specs_ltr.windows(2).zip(&centres) {
            let (a, b) = (&pair[0], &pair[1]);
            if !marked(a.lt) || !marked(b.lt) {
                continue;
            }
            if let Ok(edge) = centre.shift_right(a.width / 2.0) {
                out.lines.push(LineShape {
                    kind: if a.dir == b.dir {
                        LineKind::Lane
                    } else {
                        LineKind::Centre
                    },
                    layer,
                    path: flat(net, edge.points()),
                });
            }
        }
        // A tram in mixed traffic: rails along the traffic lane next to the centre in each direction.
        let mixed = tag(tags.get(&way), "mobsimlab:tram") == Some("mixed");
        let railed: Vec<usize> = if let Some(c) = own {
            (0..c.len())
                .filter(|&i| c[i].rails && c[i].lt != LaneType::LightRail)
                .collect()
        } else if mixed {
            inner_traffic_lanes(&road.lane_specs_ltr, net.config.driving_side)
        } else {
            Vec::new()
        };
        for &i in railed.iter().filter(|_| track) {
            out.lines.push(LineShape {
                kind: LineKind::Rails,
                layer,
                path: flat(net, centres[i].points()),
            });
        }
        let length = road.center_line.length().inner_meters();
        if profiles.get(&way).is_none_or(|(l, _)| length > *l) {
            let lanes = road
                .lane_specs_ltr
                .iter()
                .enumerate()
                .map(|(i, l)| LaneProfile {
                    kind: kind_at(i, l.lt),
                    dir: if l.dir == Direction::Forward {
                        LaneDir::Forward
                    } else {
                        LaneDir::Backward
                    },
                    width: (l.width.inner_meters() * 100.0).round() / 100.0,
                    rails: l.lt == LaneType::LightRail || railed.contains(&i),
                })
                .collect();
            profiles.insert(way, (length, lanes));
        }
    }
    out.roads = profiles
        .into_iter()
        .map(|(way, (_, lanes))| RoadLanes { way, lanes })
        .collect();
    out.lanes.sort_by_key(|l| l.layer);
    for i in net.intersections.values() {
        out.junctions.push(JunctionShape {
            ring: flat(net, i.polygon.get_outer_ring().points()),
            nodes: i.osm_ids.iter().map(|n| n.0).collect(),
            ways: {
                let mut w: Vec<i64> = i
                    .roads
                    .iter()
                    .filter_map(|r| net.roads.get(r))
                    .flat_map(|r| r.osm_ids.iter().map(|id| id.0))
                    .collect();
                w.sort_unstable();
                w.dedup();
                w
            },
            crossing: i.kind == IntersectionKind::Intersection,
            signals: i.control == IntersectionControl::Signalled,
        });
    }
    out
}

/// Purpose: the traffic lane next to the centre in each direction (where a tram in mixed traffic runs).
/// Inputs: lanes left to right; the side traffic drives on. Output: their indices (one on a one-way
/// street: the lane on the inner side, where a tram of its own would run).
pub fn inner_traffic_lanes(lanes: &[LaneSpec], side: DrivingSide) -> Vec<usize> {
    let traffic: Vec<usize> = (0..lanes.len())
        .filter(|&i| lanes[i].lt == LaneType::Driving)
        .collect();
    if let Some(w) = traffic
        .windows(2)
        .find(|w| lanes[w[0]].dir != lanes[w[1]].dir)
    {
        return vec![w[0], w[1]];
    }
    let inner = match side {
        DrivingSide::Right => traffic.first(),
        DrivingSide::Left => traffic.last(),
    };
    inner.map(|&i| vec![i]).unwrap_or_default()
}

#[cfg(test)]
mod tests;
