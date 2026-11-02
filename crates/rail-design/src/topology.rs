//! Track topology for railway operations (ADR-0032, ADR-0033): the built design as a graph of
//! physical track sections, nodes and the movements allowed through them, with switches,
//! platform edges, crossings as conflicts and depot groups. The JSON form is defined by
//! `contracts/rail-topology.schema.json`.
//!
//! Ids are derived from the document's ids, so they stay the same while the elements they
//! come from stay:
//!
//! - sections: `t{track}.{line}.{piece}` (a line of an alignment between switch points, line 0
//!   the left track of a double track), `s{station}.{track}` (a station track) and
//!   `w{switch}.{leg}` (a diverging leg of a switch);
//! - nodes: `w{switch}.{toe}` at switch points, else the first section end that meets there
//!   (`s{station}.{track}.a`, `t{track}.{line}.a`, …; `a` is the start, `b` the end);
//! - platform edges: `p{station}.{track}.l` or `.r`;
//! - crossings: the design's crossing id (`x{trackA}-{trackB}-{n}`);
//! - level crossings: `lc{track}-{osm way}-{n}` (street-level track crossing a street);
//! - depot groups: `d{lowest storage track id}`.

use crate::design::{CrossingKind, Design};
use crate::geom::{nearest, simplify, slice, with_headings, Sample, P2};
use crate::issue::Severity;
use crate::model::{Level, TrackUse};
use crate::params::RailMode;
use serde::Serialize;
use std::collections::BTreeMap;

/// Schema id of the export.
pub const SCHEMA: &str = "mobsimlab.rail-topology/1";
/// Section ends closer than this are one node, m.
const JOIN_M: f64 = 0.5;

/// The whole export.
#[derive(Debug, Clone, Serialize)]
pub struct Topology {
    /// Schema id ([`SCHEMA`]).
    pub schema: &'static str,
    /// Origin of the local metres, `[lon, lat]`.
    pub origin: [f64; 2],
    /// The network's mode.
    pub mode: RailMode,
    /// Railway systems in the drawing.
    pub modes: Vec<RailMode>,
    /// No design errors: the topology can be used for operations.
    pub valid: bool,
    /// Design errors, if any.
    pub errors: Vec<String>,
    /// Nodes.
    pub nodes: Vec<Node>,
    /// Physical track sections.
    pub sections: Vec<Section>,
    /// Movements a train may make through a node, in both directions.
    pub links: Vec<Link>,
    /// Switches.
    pub switches: Vec<SwitchOut>,
    /// Platform edges.
    pub platform_edges: Vec<PlatformEdge>,
    /// Crossings of two alignments.
    pub crossings: Vec<CrossingOut>,
    /// Level crossings with streets.
    pub level_crossings: Vec<LevelCrossingOut>,
    /// Groups of connected storage sections (stabling and depot).
    pub depot_groups: Vec<DepotGroup>,
}

/// Where section ends meet.
#[derive(Debug, Clone, Serialize)]
pub struct Node {
    /// Id.
    pub id: String,
    /// `end` (one section: buffer stop or unconnected end), `join` or `switch`.
    pub kind: &'static str,
    /// Switch at this node.
    pub switch: Option<u32>,
    /// Position, m east and north of the origin.
    pub x: f64,
    /// Position, m north.
    pub y: f64,
}

/// A value over a stretch of a section, offsets from the section's `from` node.
#[derive(Debug, Clone, Serialize)]
pub struct Range<T> {
    /// Start, m.
    pub from_m: f64,
    /// End, m.
    pub to_m: f64,
    /// Value.
    pub value: T,
}

/// Electrification of a section.
#[derive(Debug, Clone, Serialize)]
pub struct Power {
    /// `overhead`, `third_rail` or `none`.
    pub kind: &'static str,
    /// Supply system id from the assumption library, if electrified.
    pub system: Option<String>,
}

/// What a section is part of.
#[derive(Debug, Clone, Serialize)]
pub struct Source {
    /// `track`, `station` or `switch`.
    pub kind: &'static str,
    /// Document id of the track, station or switch.
    #[serde(rename = "ref")]
    pub id: u32,
    /// Line of a double track (0 left, 1 right), station track index or switch leg.
    pub index: usize,
    /// Chainage range on the track's centre line (track sections only), m.
    pub chainage_m: Option<[f64; 2]>,
}

/// A physical track between two nodes.
#[derive(Debug, Clone, Serialize)]
pub struct Section {
    /// Id.
    pub id: String,
    /// Where it comes from.
    pub source: Source,
    /// Node at its start.
    pub from: String,
    /// Node at its end.
    pub to: String,
    /// Length, m.
    pub length_m: f64,
    /// Railway system.
    pub mode: RailMode,
    /// Gauge, mm.
    pub gauge_mm: f64,
    /// `running` or `storage`.
    #[serde(rename = "use")]
    pub usage: &'static str,
    /// Electrification.
    pub power: Power,
    /// Levels along it (`ramp` between levels).
    pub levels: Vec<Range<String>>,
    /// Permitted speed, km/h.
    pub speed_kmh: Vec<Range<f64>>,
    /// Gradient, ‰ (positive rising from `from` to `to`); the ramp's maximum gradient.
    pub gradient_permille: Vec<Range<f64>>,
    /// Horizontal radius of the centre line in curves, m.
    pub radius_m: Vec<Range<f64>>,
    /// Platform edges along it.
    pub platform_edges: Vec<String>,
    /// Polyline, m east and north of the origin (within 2 cm of the fitted line).
    pub geometry: Vec<[f64; 2]>,
}

/// One end of a section at a node.
#[derive(Debug, Clone, Serialize)]
pub struct End {
    /// Section id.
    pub section: String,
    /// `from` or `to`.
    pub end: &'static str,
}

/// A train may pass from `a` into `b` (and back) at `node`.
#[derive(Debug, Clone, Serialize)]
pub struct Link {
    /// Node id.
    pub node: String,
    /// One section end.
    pub a: End,
    /// The other.
    pub b: End,
}

/// A switch and its conflict area.
#[derive(Debug, Clone, Serialize)]
pub struct SwitchOut {
    /// Document id.
    pub id: u32,
    /// `turnout`, `double_junction`, `crossover` or `scissors`.
    pub kind: crate::model::SwitchKind,
    /// Catalogue element.
    pub element: String,
    /// Display name.
    pub label: String,
    /// Track it sits on.
    pub track: u32,
    /// Chainage range on that track, m.
    pub chainage_m: [f64; 2],
    /// Nodes at its switch points (blade tips).
    pub nodes: Vec<String>,
    /// Its diverging legs.
    pub legs: Vec<String>,
    /// Every section a train in the switch occupies or fouls: legs and the parent's line
    /// sections over its length. One train at a time.
    pub conflict_sections: Vec<String>,
    /// Diverging speed, km/h.
    pub diverging_speed_kmh: f64,
    /// Diverging radius, m.
    pub radius_m: f64,
    /// Crossing ratio 1:n.
    pub crossing_ratio_n: f64,
    /// Fouling points: for each section attached at one of its switch points, where a train on
    /// it stands clear of the switch's other routes (clearance marker). Detection and
    /// reservation of the switch need only the part of each section up to this point.
    pub fouling_points: Vec<FoulingPoint>,
}

/// Where a section leaving a switch point is clear of the switch's other routes: the track
/// centres there are the clearance marker distance apart.
#[derive(Debug, Clone, Serialize)]
pub struct FoulingPoint {
    /// Switch point node.
    pub node: String,
    /// Section attached at that node.
    pub section: String,
    /// Distance from the node along the section, and on through joins if the point lies beyond
    /// the section's end, m.
    pub distance_m: f64,
    /// Section the fouling point lies on (`section`, or one joined to it beyond its end).
    pub at_section: String,
    /// Offset of the fouling point from that section's `from` end, m.
    pub at_offset_m: f64,
}

/// A platform edge.
#[derive(Debug, Clone, Serialize)]
pub struct PlatformEdge {
    /// Id.
    pub id: String,
    /// Station id.
    pub station: u32,
    /// Station name (stations with the same name are one station, ADR-0032).
    pub station_name: String,
    /// Station track index.
    pub track: usize,
    /// `left` or `right` of the track, looking along the station's rotation.
    pub side: &'static str,
    /// Section of the station track.
    pub section: String,
    /// Start on the section, m.
    pub from_m: f64,
    /// End on the section, m.
    pub to_m: f64,
    /// Length, m.
    pub length_m: f64,
    /// Platform height, mm.
    pub height_mm: f64,
    /// Railway system.
    pub mode: RailMode,
}

/// Where one track of a crossing is.
#[derive(Debug, Clone, Serialize)]
pub struct CrossingTrack {
    /// Track id.
    pub track: u32,
    /// Chainage of the crossing on its centre line, m.
    pub chainage_m: f64,
    /// Distance from the crossing back to the fouling point (clearance marker), m.
    pub fouling_before_m: f64,
    /// Distance from the crossing ahead to the fouling point, m.
    pub fouling_after_m: f64,
    /// Line sections within the fouling points.
    pub sections: Vec<String>,
}

/// Two alignments crossing.
#[derive(Debug, Clone, Serialize)]
pub struct CrossingOut {
    /// Id.
    pub id: String,
    /// `diamond` (same level), `grade_separated` or `clash` (an error).
    pub kind: &'static str,
    /// Same-level crossing: one train at a time on all its sections between the fouling points.
    pub conflict: bool,
    /// The two railway systems.
    pub modes: [RailMode; 2],
    /// Crossing angle, degrees.
    pub angle_deg: f64,
    /// Position, m east.
    pub x: f64,
    /// Position, m north.
    pub y: f64,
    /// The two tracks.
    pub tracks: [CrossingTrack; 2],
}

/// The street at a level crossing.
#[derive(Debug, Clone, Serialize)]
pub struct LevelCrossingStreet {
    /// OSM way id.
    pub way: i64,
    /// Name, empty when unnamed.
    pub name: String,
    /// OSM `highway` class.
    pub class: String,
    /// Distance along the OSM way from its first node to the crossing point, m.
    pub offset_m: f64,
    /// Carriageway width, m.
    pub width_m: f64,
    /// From the crossing point to each stop line along the street, m.
    pub keep_clear_m: f64,
    /// Buses use the street.
    pub bus: bool,
    /// A trolleybus wire runs along the street.
    pub trolley_wire: bool,
}

/// A street-level track crossing a street: a conflict between trains and road vehicles.
#[derive(Debug, Clone, Serialize)]
pub struct LevelCrossingOut {
    /// Id.
    pub id: String,
    /// `barriers` or `traffic_signals`.
    pub protection: crate::street::Protection,
    /// No design error at this crossing.
    pub allowed: bool,
    /// Railway system.
    pub mode: RailMode,
    /// Angle between track and street, degrees.
    pub angle_deg: f64,
    /// Position, m east.
    pub x: f64,
    /// Position, m north.
    pub y: f64,
    /// Track id.
    pub track: u32,
    /// Chainage on the track's centre line, m.
    pub chainage_m: f64,
    /// Half the length of track covered by the street, each side of the crossing point, m.
    pub rail_zone_m: f64,
    /// Line sections within the rail zone.
    pub sections: Vec<String>,
    /// Line speed over the crossing, km/h.
    pub line_speed_kmh: f64,
    /// Warning time, s.
    pub warning_time_s: f64,
    /// Distance before the crossing, in either direction, where a train starts the warning, m.
    pub approach_m: f64,
    /// The street.
    pub street: LevelCrossingStreet,
}

/// Connected storage sections.
#[derive(Debug, Clone, Serialize)]
pub struct DepotGroup {
    /// Id.
    pub id: String,
    /// Track ids.
    pub tracks: Vec<u32>,
    /// Section ids.
    pub sections: Vec<String>,
    /// Total length, m.
    pub length_m: f64,
}

struct Seg {
    id: String,
    source: Source,
    pts: Vec<Sample>,
    ends: [String; 2],
    mode: RailMode,
    /// Track whose properties apply (switch legs: the parent track).
    track: Option<u32>,
    /// Chainage on that track's centre line where the segment starts and ends.
    span: Option<[f64; 2]>,
}

type NodeAt = (String, P2, Vec<(usize, usize)>);

fn rd(v: f64) -> f64 {
    (v * 1000.0).round() / 1000.0
}

fn length(pts: &[Sample]) -> f64 {
    pts.windows(2).map(|w| w[0].p.dist(w[1].p)).sum()
}

/// Purpose: unit direction pointing out of a segment at one end, from the end to a point about
/// two metres inside.
fn outward(pts: &[Sample], at_start: bool) -> P2 {
    let n = pts.len();
    if n < 2 {
        return P2::new(0.0, 0.0);
    }
    let (e, it): (P2, Box<dyn Iterator<Item = &Sample>>) = if at_start {
        (pts[0].p, Box::new(pts.iter().skip(1)))
    } else {
        (pts[n - 1].p, Box::new(pts.iter().rev().skip(1)))
    };
    let mut last = e;
    for q in it {
        last = q.p;
        if q.p.dist(e) >= 2.0 {
            break;
        }
    }
    e.sub(last).unit()
}

/// Purpose: values that change along a track, cut to a segment's chainage span, as ranges from
/// the segment's start.
fn ranges<T: Clone + PartialEq>(span: [f64; 2], items: &[(f64, f64, T)]) -> Vec<Range<T>> {
    let (s0, s1) = (span[0], span[1]);
    let mut out: Vec<Range<T>> = Vec::new();
    for (a, b, v) in items {
        let (a, b) = (a.max(s0), b.min(s1));
        if b - a < 1e-6 {
            continue;
        }
        if let Some(l) = out.last_mut() {
            if l.value == *v && (l.to_m - (a - s0)).abs() < 0.01 {
                l.to_m = rd(b - s0);
                continue;
            }
        }
        out.push(Range {
            from_m: rd(a - s0),
            to_m: rd(b - s0),
            value: v.clone(),
        });
    }
    out
}

/// How far a fouling point is searched along a route from a switch point, m.
const FOULING_SEARCH_M: f64 = 400.0;

/// Purpose: shortest distance from a point to a polyline.
fn dist_to_polyline(q: P2, pts: &[P2]) -> f64 {
    pts.windows(2)
        .map(|w| {
            let (a, b) = (w[0], w[1]);
            let ab = b.sub(a);
            let l2 = ab.dot(ab);
            let t = if l2 < 1e-12 {
                0.0
            } else {
                (q.sub(a).dot(ab) / l2).clamp(0.0, 1.0)
            };
            q.dist(a.add(ab.mul(t)))
        })
        .fold(f64::INFINITY, f64::min)
}

/// A section on a walked route: (segment, distance where the route enters it, walked from the
/// segment's `to` end, length).
type Piece = (usize, f64, bool, f64);

/// A route walked from a node: its points and the sections it passes.
struct Walk {
    pts: Vec<P2>,
    pieces: Vec<Piece>,
}

/// Purpose: walk away from a node into section end `start` and on through joins (nodes with
/// two ends that a train passes), up to `max` metres.
fn walk(
    segs: &[Seg],
    start: (usize, usize),
    next_at: &BTreeMap<(usize, usize), (usize, usize)>,
    max: f64,
) -> Walk {
    let (mut pts, mut pieces): (Vec<P2>, Vec<Piece>) = (vec![], vec![]);
    let (mut cur, mut acc) = (start, 0.0);
    loop {
        let s = &segs[cur.0];
        let mut p: Vec<P2> = s.pts.iter().map(|q| q.p).collect();
        let rev = cur.1 == 1;
        if rev {
            p.reverse();
        }
        let l = length(&s.pts);
        pieces.push((cur.0, acc, rev, l));
        if pts.is_empty() {
            pts = p;
        } else {
            pts.extend(p.into_iter().skip(1));
        }
        acc += l;
        let far = (cur.0, 1 - cur.1);
        match next_at.get(&far) {
            Some(n) if acc < max && !pieces.iter().any(|x| x.0 == n.0) => cur = *n,
            _ => break,
        }
    }
    Walk { pts, pieces }
}

/// Purpose: the topology of a built design (pure).
pub fn topology(dz: &Design) -> Topology {
    let net = &dz.network;
    let mut segs: Vec<Seg> = Vec::new();

    // Station tracks.
    for (st, doc) in dz.stations.iter().zip(&net.stations) {
        let mode = dz.station_mode(doc);
        for (i, t) in st.tracks.iter().enumerate() {
            let pts = with_headings(&[st.point(-st.half_len, t.n), st.point(st.half_len, t.n)]);
            segs.push(Seg {
                id: format!("s{}.{i}", st.id),
                source: Source {
                    kind: "station",
                    id: st.id,
                    index: i,
                    chainage_m: None,
                },
                pts,
                ends: [format!("s{}.{i}.a", st.id), format!("s{}.{i}.b", st.id)],
                mode,
                track: None,
                span: None,
            });
        }
    }
    // Alignment lines, cut at the switch points on them.
    for g in &dz.tracks {
        let mode = dz.track_mode(g.id);
        for (li, line) in g.lines.iter().enumerate() {
            let mut cuts: Vec<(f64, String)> = vec![
                (0.0, format!("t{}.{li}.a", g.id)),
                (g.length, format!("t{}.{li}.b", g.id)),
            ];
            for sw in dz.switches.iter().filter(|s| s.track == g.id) {
                for (k, toe) in sw.toes.iter().enumerate() {
                    if let Some(n) = nearest(line, *toe).filter(|n| n.d < JOIN_M) {
                        cuts.push((n.s, format!("w{}.{k}", sw.id)));
                    }
                }
            }
            cuts.sort_by(|a, b| a.0.total_cmp(&b.0));
            cuts.dedup_by(|b, a| (b.0 - a.0).abs() < 0.05);
            for (k, w) in cuts.windows(2).enumerate() {
                let pts = slice(line, w[0].0, w[1].0);
                if pts.len() < 2 {
                    continue;
                }
                segs.push(Seg {
                    id: format!("t{}.{li}.{k}", g.id),
                    source: Source {
                        kind: "track",
                        id: g.id,
                        index: li,
                        chainage_m: Some([rd(w[0].0), rd(w[1].0)]),
                    },
                    pts,
                    ends: [w[0].1.clone(), w[1].1.clone()],
                    mode,
                    track: Some(g.id),
                    span: Some([w[0].0, w[1].0]),
                });
            }
        }
    }
    // Switch legs.
    for sw in &dz.switches {
        let mode = dz.track_mode(sw.track);
        for (k, path) in sw.paths.iter().enumerate() {
            segs.push(Seg {
                id: format!("w{}.{k}", sw.id),
                source: Source {
                    kind: "switch",
                    id: sw.id,
                    index: k,
                    chainage_m: None,
                },
                pts: path.clone(),
                ends: [format!("w{}.p{k}.a", sw.id), format!("w{}.p{k}.b", sw.id)],
                mode,
                track: Some(sw.track),
                span: None,
            });
        }
    }

    // Nodes: section ends that meet. Switch points name their node first.
    let mut ends: Vec<(usize, usize, P2, &String)> = Vec::new();
    for (i, s) in segs.iter().enumerate() {
        ends.push((i, 0, s.pts[0].p, &s.ends[0]));
        ends.push((i, 1, s.pts[s.pts.len() - 1].p, &s.ends[1]));
    }
    let rank = |l: &str| match l.as_bytes()[0] {
        b'w' if !l.contains(".p") => 0,
        b's' => 1,
        b't' => 2,
        _ => 3,
    };
    ends.sort_by(|a, b| rank(a.3).cmp(&rank(b.3)).then(a.3.cmp(b.3)));
    // (id, position, section ends: (segment, 0 start / 1 end))
    let mut nodes: Vec<NodeAt> = Vec::new();
    for (i, e, p, label) in ends {
        match nodes.iter_mut().find(|n| n.1.dist(p) < JOIN_M) {
            Some(n) => n.2.push((i, e)),
            None => nodes.push((label.clone(), p, vec![(i, e)])),
        }
    }
    let mut node_of: BTreeMap<(usize, usize), String> = BTreeMap::new();
    for n in &nodes {
        for k in &n.2 {
            node_of.insert(*k, n.0.clone());
        }
    }

    // Movements: two ends at a node pass into each other when they leave it in roughly opposite
    // directions (so a train cannot run from one leg of a switch into the other).
    let end_name = |e: usize| if e == 0 { "from" } else { "to" };
    let mut links = Vec::new();
    let mut adj: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for n in &nodes {
        for x in 0..n.2.len() {
            for y in x + 1..n.2.len() {
                let (a, b) = (n.2[x], n.2[y]);
                let (da, db) = (
                    outward(&segs[a.0].pts, a.1 == 0),
                    outward(&segs[b.0].pts, b.1 == 0),
                );
                if da.dot(db) < -0.5 {
                    links.push(Link {
                        node: n.0.clone(),
                        a: End {
                            section: segs[a.0].id.clone(),
                            end: end_name(a.1),
                        },
                        b: End {
                            section: segs[b.0].id.clone(),
                            end: end_name(b.1),
                        },
                    });
                    adj.entry(a.0).or_default().push(b.0);
                    adj.entry(b.0).or_default().push(a.0);
                }
            }
        }
    }
    let node_out: Vec<Node> = nodes
        .iter()
        .map(|n| Node {
            id: n.0.clone(),
            kind: match n.2.len() {
                1 => "end",
                2 => "join",
                _ => "switch",
            },
            switch: n
                .0
                .strip_prefix('w')
                .and_then(|r| r.split('.').next())
                .and_then(|v| v.parse().ok())
                .filter(|_| n.2.len() > 2),
            x: rd(n.1.x),
            y: rd(n.1.y),
        })
        .collect();

    // Platform edges.
    let mut platforms = Vec::new();
    for (st, doc) in dz.stations.iter().zip(&net.stations) {
        let p = dz.params_for(dz.station_mode(doc));
        for (i, t) in st.tracks.iter().enumerate() {
            for (on, side) in [(t.platform_left, "left"), (t.platform_right, "right")] {
                if on {
                    platforms.push(PlatformEdge {
                        id: format!("p{}.{i}.{}", st.id, &side[..1]),
                        station: st.id,
                        station_name: doc.name.clone(),
                        track: i,
                        side,
                        section: format!("s{}.{i}", st.id),
                        from_m: rd(st.half_len - st.platform_half),
                        to_m: rd(st.half_len + st.platform_half),
                        length_m: rd(2.0 * st.platform_half),
                        height_mm: p.platform_height_mm,
                        mode: dz.station_mode(doc),
                    });
                }
            }
        }
    }

    // Sections with their properties.
    let mut sections = Vec::new();
    for (i, s) in segs.iter().enumerate() {
        let p = dz.params_for(s.mode);
        let doc = s.track.and_then(|t| dz.doc_track(t));
        let g = s.track.and_then(|t| dz.track(t));
        let len = length(&s.pts);
        let station = match s.source.kind {
            "station" => dz.stations.iter().find(|st| st.id == s.source.id),
            _ => None,
        };
        let sw = match s.source.kind {
            "switch" => dz.switch(s.source.id),
            _ => None,
        };
        let usage = if doc.is_some_and(|t| t.usage == TrackUse::Storage) {
            "storage"
        } else {
            "running"
        };
        let (overhead, third) = match (doc, station) {
            (Some(t), _) => (dz.overhead(t), dz.third_rail(t)),
            _ => (
                !p.third_rail_default() && p.electrification != "none",
                p.third_rail_default(),
            ),
        };
        let power = Power {
            kind: if third {
                "third_rail"
            } else if overhead {
                "overhead"
            } else {
                "none"
            },
            system: (third || overhead).then(|| p.electrification.clone()),
        };
        let name =
            |l: Option<Level>| l.map_or("ramp".to_string(), |l| format!("{l:?}").to_lowercase());
        let level_name = |l: Level| {
            serde_json::to_value(l)
                .ok()
                .and_then(|v| v.as_str().map(String::from))
                .unwrap_or_else(|| name(Some(l)))
        };
        let (levels, speed, gradient, radius) = match (s.span, g) {
            (Some(span), Some(g)) => {
                let zl: Vec<(f64, f64, String)> = g
                    .zones
                    .iter()
                    .map(|z| (z.s0, z.s1, z.level.map_or("ramp".into(), level_name)))
                    .collect();
                let sp: Vec<(f64, f64, f64)> = dz.speeds.get(&g.id).map_or(vec![], |sp| {
                    sp.s.windows(2)
                        .zip(&sp.limit)
                        .map(|(w, l)| (w[0], w[1], rd(*l)))
                        .collect()
                });
                let gr: Vec<(f64, f64, f64)> = g
                    .ramps
                    .iter()
                    .map(|r| {
                        let up = r.to.order() > r.from.order();
                        let v = p.max_gradient_permille;
                        (r.s0, r.s1, if up { v } else { -v })
                    })
                    .collect();
                let rr: Vec<(f64, f64, f64)> = g
                    .curves
                    .iter()
                    .map(|c| (c.s0, c.s1, rd(c.radius)))
                    .collect();
                // Chainage ranges are the centre line's; scale them to this line's length.
                let k = len / (span[1] - span[0]).max(1e-9);
                let sc = |v: Vec<Range<f64>>| {
                    v.into_iter()
                        .map(|r| Range {
                            from_m: rd(r.from_m * k),
                            to_m: rd(r.to_m * k),
                            value: r.value,
                        })
                        .collect::<Vec<_>>()
                };
                let lv = ranges(span, &zl)
                    .into_iter()
                    .map(|r| Range {
                        from_m: rd(r.from_m * k),
                        to_m: rd(r.to_m * k),
                        value: r.value,
                    })
                    .collect();
                (
                    lv,
                    sc(ranges(span, &sp)),
                    sc(ranges(span, &gr)),
                    sc(ranges(span, &rr)),
                )
            }
            _ => {
                let lvl = station.map(|st| st.level).or_else(|| {
                    let (sw, g) = (sw?, g?);
                    g.level_at((sw.s0 + sw.s1) / 2.0)
                });
                let lv = vec![Range {
                    from_m: 0.0,
                    to_m: rd(len),
                    value: lvl.map_or("ramp".into(), level_name),
                }];
                let v = sw.map_or(p.design_speed_kmh, |w| {
                    w.turnout.diverging_kmh.min(p.design_speed_kmh)
                });
                let r = sw.map_or(vec![], |w| {
                    vec![Range {
                        from_m: 0.0,
                        to_m: rd(len),
                        value: rd(w.turnout.radius),
                    }]
                });
                let sp = vec![Range {
                    from_m: 0.0,
                    to_m: rd(len),
                    value: rd(v),
                }];
                (lv, sp, vec![], r)
            }
        };
        sections.push(Section {
            id: s.id.clone(),
            source: s.source.clone(),
            from: node_of[&(i, 0)].clone(),
            to: node_of[&(i, 1)].clone(),
            length_m: rd(len),
            mode: s.mode,
            gauge_mm: p.gauge_mm,
            usage,
            power,
            levels,
            speed_kmh: speed,
            gradient_permille: gradient,
            radius_m: radius,
            platform_edges: platforms
                .iter()
                .filter(|e| e.section == s.id)
                .map(|e| e.id.clone())
                .collect(),
            geometry: simplify(&s.pts.iter().map(|q| q.p).collect::<Vec<_>>(), 0.02)
                .iter()
                .map(|q| [rd(q.x), rd(q.y)])
                .collect(),
        });
    }

    // Joins a train runs straight through: the other end at a node with exactly two ends.
    let mut next_at: BTreeMap<(usize, usize), (usize, usize)> = BTreeMap::new();
    for n in nodes.iter().filter(|n| n.2.len() == 2) {
        let (a, b) = (n.2[0], n.2[1]);
        if adj.get(&a.0).is_some_and(|v| v.contains(&b.0)) {
            next_at.insert(a, b);
            next_at.insert(b, a);
        }
    }
    // Fouling points: along each section leaving a switch point, the last place within the
    // clearance marker distance of the switch point's other routes.
    let fouling_of = |sw: &crate::switch::SwitchGeo| -> Vec<FoulingPoint> {
        let cm = dz.track_params(sw.track).clearance_marker_m;
        let prefix = format!("w{}.", sw.id);
        let mut out = Vec::new();
        for n in nodes
            .iter()
            .filter(|n| n.2.len() > 2 && n.0.starts_with(&prefix) && !n.0.contains(".p"))
        {
            let walks: Vec<Walk> =
                n.2.iter()
                    .map(|e| walk(&segs, *e, &next_at, FOULING_SEARCH_M))
                    .collect();
            // Routes a train passes from one into the other are the same track, not a
            // conflict: the approach to a switch point fouls neither of its legs.
            let dirs: Vec<P2> =
                n.2.iter()
                    .map(|e| outward(&segs[e.0].pts, e.1 == 0))
                    .collect();
            let through: Vec<Vec<bool>> = dirs
                .iter()
                .map(|a| dirs.iter().map(|b| a.dot(*b) < -0.5).collect())
                .collect();
            for (i, w) in walks.iter().enumerate() {
                let (mut d, mut last, step) = (0.0, 0.0, 0.5);
                let line = with_headings(&w.pts);
                let total = length(&line);
                while d <= total {
                    let q = crate::geom::at_s(&line, d).p;
                    let near = walks
                        .iter()
                        .enumerate()
                        .filter(|(j, _)| *j != i && !through[i][*j])
                        .map(|(_, o)| dist_to_polyline(q, &o.pts))
                        .fold(f64::INFINITY, f64::min);
                    if near < cm - 1e-6 {
                        last = d;
                    }
                    d += step;
                }
                let at = w
                    .pieces
                    .iter()
                    .rev()
                    .find(|p| p.1 <= last + 1e-9)
                    .copied()
                    .unwrap_or(w.pieces[0]);
                let local = (last - at.1).min(at.3);
                out.push(FoulingPoint {
                    node: n.0.clone(),
                    section: segs[n.2[i].0].id.clone(),
                    distance_m: rd(last),
                    at_section: segs[at.0].id.clone(),
                    at_offset_m: rd(if at.2 { at.3 - local } else { local }),
                });
            }
        }
        out
    };

    // Line sections of a track over a chainage range.
    let over = |track: u32, a: f64, b: f64| -> Vec<String> {
        segs.iter()
            .filter(|s| s.source.kind == "track" && s.source.id == track)
            .filter(|s| s.span.is_some_and(|sp| sp[0] < b && sp[1] > a))
            .map(|s| s.id.clone())
            .collect()
    };

    let switches = dz
        .switches
        .iter()
        .map(|sw| {
            let legs: Vec<String> = (0..sw.paths.len())
                .map(|k| format!("w{}.{k}", sw.id))
                .collect();
            let mut conflict = legs.clone();
            conflict.extend(over(sw.track, sw.s0, sw.s1));
            SwitchOut {
                id: sw.id,
                kind: sw.kind,
                element: sw.element.clone(),
                label: sw.label.clone(),
                track: sw.track,
                chainage_m: [rd(sw.s0), rd(sw.s1)],
                nodes: node_out
                    .iter()
                    .filter(|n| n.switch == Some(sw.id))
                    .map(|n| n.id.clone())
                    .collect(),
                legs,
                conflict_sections: conflict,
                diverging_speed_kmh: sw.turnout.diverging_kmh,
                radius_m: rd(sw.turnout.radius),
                crossing_ratio_n: sw.turnout.n,
                fouling_points: fouling_of(sw),
            }
        })
        .collect();

    // Crossings: fouling points where the other alignment's nearest track comes within the
    // clearance marker distance (the larger of the two systems').
    let crossings = dz
        .crossings
        .iter()
        .filter_map(|c| {
            let (ga, gb) = (dz.track(c.tracks[0])?, dz.track(c.tracks[1])?);
            let sa = nearest(&ga.centre, c.p)?.s;
            let sb = nearest(&gb.centre, c.p)?.s;
            let cm = dz
                .track_params(ga.id)
                .clearance_marker_m
                .max(dz.track_params(gb.id).clearance_marker_m);
            let (sin, cos) = (c.angle.sin().max(0.05), c.angle.cos().abs());
            let (ea, eb) = (ga.spacing_at(sa), gb.spacing_at(sb));
            let foul = |own: f64, other: f64| rd((cm + other / 2.0) / sin + own / 2.0 * cos / sin);
            let (fa, fb) = (foul(ea, eb), foul(eb, ea));
            let conflict = c.kind == CrossingKind::Diamond;
            let side = |g: &crate::alignment::TrackGeo, s: f64, f: f64| CrossingTrack {
                track: g.id,
                chainage_m: rd(s),
                fouling_before_m: rd(f.min(s)),
                fouling_after_m: rd(f.min(g.length - s)),
                sections: if conflict {
                    over(g.id, s - f, s + f)
                } else {
                    vec![]
                },
            };
            Some(CrossingOut {
                id: c.id.clone(),
                kind: match c.kind {
                    CrossingKind::Diamond => "diamond",
                    CrossingKind::GradeSeparated => "grade_separated",
                    CrossingKind::Clash => "clash",
                },
                conflict,
                modes: c.modes,
                angle_deg: rd(c.angle.to_degrees()),
                x: rd(c.p.x),
                y: rd(c.p.y),
                tracks: [side(ga, sa, fa), side(gb, sb, fb)],
            })
        })
        .collect();

    let level_crossings = dz
        .level_crossings
        .iter()
        .map(|x| LevelCrossingOut {
            id: x.id.clone(),
            protection: x.protection,
            allowed: x.allowed,
            mode: x.mode,
            angle_deg: rd(x.angle.to_degrees()),
            x: rd(x.p.x),
            y: rd(x.p.y),
            track: x.track,
            chainage_m: rd(x.s),
            rail_zone_m: rd(x.rail_zone_m),
            sections: over(x.track, x.s - x.rail_zone_m, x.s + x.rail_zone_m),
            line_speed_kmh: rd(x.line_speed_kmh),
            warning_time_s: x.warning_time_s,
            approach_m: rd(x.approach_m),
            street: LevelCrossingStreet {
                way: x.way,
                name: x.street.clone(),
                class: x.class.clone(),
                offset_m: rd(x.street_offset_m),
                width_m: rd(x.street_width_m),
                keep_clear_m: rd(x.keep_clear_m),
                bus: x.bus,
                trolley_wire: x.trolley_wire,
            },
        })
        .collect();

    // Depot groups: storage sections joined by movements.
    let storage: Vec<bool> = sections.iter().map(|s| s.usage == "storage").collect();
    let mut seen = vec![false; segs.len()];
    let mut depot_groups = Vec::new();
    for i in 0..segs.len() {
        if !storage[i] || seen[i] {
            continue;
        }
        let (mut stack, mut members) = (vec![i], vec![]);
        seen[i] = true;
        while let Some(x) = stack.pop() {
            members.push(x);
            for &y in adj.get(&x).into_iter().flatten() {
                if storage[y] && !seen[y] {
                    seen[y] = true;
                    stack.push(y);
                }
            }
        }
        let mut tracks: Vec<u32> = members.iter().filter_map(|m| segs[*m].track).collect();
        tracks.sort_unstable();
        tracks.dedup();
        let mut ids: Vec<String> = members.iter().map(|m| segs[*m].id.clone()).collect();
        ids.sort();
        depot_groups.push(DepotGroup {
            id: format!("d{}", tracks.first().copied().unwrap_or(0)),
            tracks,
            sections: ids,
            length_m: rd(members.iter().map(|m| sections[*m].length_m).sum()),
        });
    }

    let errors: Vec<String> = dz
        .issues
        .iter()
        .filter(|i| i.severity == Severity::Error)
        .map(|i| i.text.clone())
        .collect();
    Topology {
        schema: SCHEMA,
        origin: net.origin,
        mode: dz.mode,
        modes: dz.modes.keys().copied().collect(),
        valid: errors.is_empty(),
        errors,
        nodes: node_out,
        sections,
        links,
        switches,
        platform_edges: platforms,
        crossings,
        level_crossings,
        depot_groups,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::design::build;
    use crate::sample::sample;

    #[test]
    fn every_example_is_one_connected_graph_with_switch_movements() {
        for m in RailMode::ALL {
            let t = topology(&build(&sample(m, 7.0, 50.9), None));
            assert!(t.valid, "{m:?}: {:?}", t.errors);
            // A switch point joins three sections and allows two movements: through and
            // diverging, never from one leg into the other.
            for n in t.nodes.iter().filter(|n| n.kind == "switch") {
                let links = t.links.iter().filter(|l| l.node == n.id).count();
                assert_eq!(links, 2, "{m:?} node {}", n.id);
            }
            // The main line runs from one station to the other through the switches.
            let find = |id: &str| t.sections.iter().position(|s| s.id == id).unwrap();
            let mut seen = vec![false; t.sections.len()];
            let mut stack = vec![find("s1.0")];
            while let Some(i) = stack.pop() {
                if std::mem::replace(&mut seen[i], true) {
                    continue;
                }
                let id = &t.sections[i].id;
                for l in &t.links {
                    if &l.a.section == id {
                        stack.push(find(&l.b.section));
                    } else if &l.b.section == id {
                        stack.push(find(&l.a.section));
                    }
                }
            }
            for s in ["s2.0", "s2.1", "s1.1", "w4.0"] {
                assert!(seen[find(s)], "{m:?}: {s} not reachable from s1.0");
            }
            assert_eq!(t.platform_edges.len(), 4, "{m:?}");
            assert_eq!(t.depot_groups.len(), 1, "{m:?}");
            assert_eq!(t.depot_groups[0].tracks, vec![6]);
        }
    }

    #[test]
    fn a_same_level_crossing_between_systems_is_a_conflict_with_fouling_points() {
        let t = topology(&build(&sample(RailMode::RegionalRail, 7.0, 50.9), None));
        let x = t.crossings.iter().find(|c| c.id == "x3-7-0").unwrap();
        assert!(x.conflict);
        assert_eq!(x.modes, [RailMode::RegionalRail, RailMode::Tram]);
        for tr in &x.tracks {
            assert!(tr.fouling_before_m > 3.0 && tr.fouling_after_m > 3.0);
            assert_eq!(tr.sections.len(), 2, "both lines of the double track");
        }
    }

    #[test]
    fn switches_give_fouling_points_short_of_the_whole_line_section() {
        let t = topology(&build(&sample(RailMode::RegionalRail, 7.0, 50.9), None));
        let sw = t.switches.iter().find(|s| s.id == 5).unwrap();
        let get = |sec: &str| sw.fouling_points.iter().find(|f| f.section == sec).unwrap();
        // The approach to the switch point is the same track as both routes: no fouling.
        assert_eq!(get("t3.0.1").distance_m, 0.0);
        // A 1:9 turnout with a = 12.2 m: the routes are 3.5 m apart about a + 3.5 · 9 ≈ 44 m
        // from the switch point (a little more, because the diverging track starts curved).
        for sec in ["t3.0.2", "w5.0"] {
            let f = get(sec);
            assert!(f.distance_m > 43.0 && f.distance_m < 55.0, "{sec}: {f:?}");
        }
        // The leg is shorter than that, so its fouling point lies on the siding beyond it.
        assert_eq!(get("w5.0").at_section, "t6.0.0");
        let main = t.sections.iter().find(|s| s.id == "t3.0.2").unwrap();
        assert!(get("t3.0.2").distance_m < main.length_m / 10.0);
    }

    #[test]
    fn a_level_crossing_lists_both_lines_and_the_street() {
        let net = sample(RailMode::RegionalRail, 7.0, 50.9);
        let streets = crate::sample::sample_streets(&build(&net, None));
        let t = topology(&crate::design::build_with_streets(&net, None, &streets));
        let x = &t.level_crossings[0];
        assert_eq!(x.id, "lc3-1001-0");
        assert!(x.allowed && t.valid);
        assert_eq!(x.sections.len(), 2, "both lines of the double track");
        assert_eq!(x.street.name, "Station Road");
        assert!(x.approach_m > 500.0);
    }
}
