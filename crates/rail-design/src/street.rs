//! Streets and level crossings: where street-level railway track crosses a street that road
//! vehicles use (buses, BRT, trolleybuses, depot runs, cars).
//!
//! Streets are not part of the railway document. They come from OpenStreetMap, the same tiles the
//! street line tool routes on (ADR-0031), and are passed to [`crate::design::build_with_streets`].
//! A street on a bridge, in a tunnel or on another `layer` is grade separated and never forms a
//! level crossing.
//!
//! Every level crossing gets a stable id `lc{track}-{way}-{n}` (the track id, the OSM way id and
//! its number along that track), the zone a train and a road vehicle each occupy, the stop lines
//! road vehicles must keep clear of, and the approach distance at which the crossing closes.
//! Values come from the assumption library (`level_crossing.*`, `street.*`, `crossing.clearance_m`).

use crate::design::Design;
use crate::geom::{poly_cross, BBox, Sample, P2};
use crate::issue::Issue;
use crate::model::Level;
use crate::params::defaults;
use crate::params::RailMode;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// A street from OpenStreetMap (one OSM way).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Street {
    /// OSM way id.
    pub way: i64,
    /// Street name (`name`, else `ref`), empty when unnamed.
    #[serde(default)]
    pub name: String,
    /// OSM `highway` value.
    pub class: String,
    /// Lanes (`lanes`), when tagged.
    #[serde(default)]
    pub lanes: Option<f64>,
    /// Carriageway width (`width`), m, when tagged.
    #[serde(default)]
    pub width_m: Option<f64>,
    /// One-way street.
    #[serde(default)]
    pub oneway: bool,
    /// Height layer: 0 at ground; positive on a bridge, negative in a tunnel.
    #[serde(default)]
    pub layer: i8,
    /// Trolleybus overhead wire along the street (`trolley_wire`).
    #[serde(default)]
    pub trolley_wire: bool,
    /// Bus route or bus access (`bus`/`psv` designated, `busway`), for information.
    #[serde(default)]
    pub bus: bool,
    /// Shape, `[lon, lat]` degrees.
    pub coords: Vec<[f64; 2]>,
}

/// Road classes used by motor vehicles. Footways, cycleways and paths are not included.
const ROAD_CLASSES: [&str; 18] = [
    "motorway",
    "motorway_link",
    "trunk",
    "trunk_link",
    "primary",
    "primary_link",
    "secondary",
    "secondary_link",
    "tertiary",
    "tertiary_link",
    "unclassified",
    "residential",
    "living_street",
    "service",
    "busway",
    "bus_guideway",
    "road",
    "track",
];

fn yes(v: Option<&String>) -> bool {
    v.is_some_and(|v| matches!(v.as_str(), "yes" | "true" | "1" | "designated"))
}

fn number(v: Option<&String>) -> Option<f64> {
    let v = v?.trim();
    let n: String = v
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    n.parse().ok().filter(|x: &f64| *x > 0.0)
}

/// Purpose: a street from an OSM way's tags and shape, or None when the way is not a road used
/// by motor vehicles (or is too short).
pub fn street_from_osm(
    way: i64,
    tags: &BTreeMap<String, String>,
    coords: Vec<[f64; 2]>,
) -> Option<Street> {
    let class = tags.get("highway")?;
    if !ROAD_CLASSES.contains(&class.as_str()) || coords.len() < 2 {
        return None;
    }
    if tags.get("area").is_some_and(|v| v == "yes") {
        return None;
    }
    let mut layer: i8 = tags
        .get("layer")
        .and_then(|v| v.trim().parse().ok())
        .unwrap_or(0);
    let bridge = tags.get("bridge").is_some_and(|v| v != "no");
    let tunnel = tags
        .get("tunnel")
        .is_some_and(|v| v != "no" && v != "building_passage");
    if bridge {
        layer = layer.max(1);
    }
    if tunnel {
        layer = layer.min(-1);
    }
    Some(Street {
        way,
        name: tags
            .get("name")
            .or_else(|| tags.get("ref"))
            .cloned()
            .unwrap_or_default(),
        class: class.clone(),
        lanes: number(tags.get("lanes")),
        width_m: number(tags.get("width")),
        oneway: yes(tags.get("oneway")) || class == "motorway",
        layer,
        trolley_wire: yes(tags.get("trolley_wire"))
            || yes(tags.get("trolley_wire:forward"))
            || yes(tags.get("trolley_wire:backward")),
        bus: class == "busway"
            || yes(tags.get("bus"))
            || yes(tags.get("psv"))
            || tags.get("busway").is_some(),
        coords,
    })
}

/// How a level crossing is protected.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Protection {
    /// Barriers and lights close the street before a train (ballasted railway track).
    Barriers,
    /// Traffic signals stop road traffic for the tram (track embedded in the street).
    TrafficSignals,
}

/// A street-level track crossing a street.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LevelCrossing {
    /// Stable id `lc{track}-{way}-{n}`.
    pub id: String,
    /// Track (alignment) id.
    pub track: u32,
    /// Railway system of the track.
    pub mode: RailMode,
    /// Chainage on the track's centre line, m.
    #[serde(rename = "chainage_m")]
    pub s: f64,
    /// Where, local metres.
    #[serde(skip)]
    pub p: P2,
    /// Angle between track and street, rad (0..π/2).
    #[serde(skip)]
    pub angle: f64,
    /// Unit direction of the street at the crossing.
    #[serde(skip)]
    pub street_dir: P2,
    /// OSM way id of the street.
    pub way: i64,
    /// Street name.
    pub street: String,
    /// OSM `highway` class.
    pub class: String,
    /// Distance along the OSM way from its first node, m.
    pub street_offset_m: f64,
    /// Carriageway width used, m.
    pub street_width_m: f64,
    /// Barriers or traffic signals.
    pub protection: Protection,
    /// Half the length of track covered by the street, each side of the crossing point, m.
    pub rail_zone_m: f64,
    /// Distance along the street from the crossing point to each stop line, m: road vehicles
    /// wait behind it and must not stop between the stop lines.
    pub keep_clear_m: f64,
    /// Line speed over the crossing, km/h.
    pub line_speed_kmh: f64,
    /// Warning time before a train arrives, s.
    pub warning_time_s: f64,
    /// Distance before the crossing where an approaching train starts the warning, m.
    pub approach_m: f64,
    /// A trolleybus wire runs along the street.
    pub trolley_wire: bool,
    /// Buses use the street (bus lane, busway or bus access tagged).
    pub bus: bool,
    /// The crossing meets the usual rules for level crossings.
    pub standard: bool,
    /// Why it does not, and so needs special safety measures: `mode` (a railway system that
    /// normally has none), `third_rail`, `motorway`, `line_speed`.
    pub special_measures: Vec<&'static str>,
}

/// Street drawn in local metres.
struct Local<'a> {
    st: &'a Street,
    pts: Vec<P2>,
    cum: Vec<f64>,
    bbox: BBox,
}

fn coarse(c: &[Sample]) -> Vec<Sample> {
    let k = (c.len() / 600).max(1);
    let mut v: Vec<Sample> = c.iter().step_by(k).copied().collect();
    if let Some(l) = c.last() {
        if v.last() != Some(l) {
            v.push(*l);
        }
    }
    v
}

/// Purpose: find the level crossings between the design's tracks and the streets, add them to
/// the design with their checks (errors, warnings and one line of information each).
/// Side effects: fills `dz.level_crossings` and appends to `dz.issues`.
pub fn level_crossings(dz: &mut Design, streets: &[Street]) {
    let local: Vec<Local> = streets
        .iter()
        .filter(|s| s.layer == 0)
        .map(|st| {
            let pts: Vec<P2> = st
                .coords
                .iter()
                .map(|c| dz.proj.to_xy(c[0], c[1]))
                .collect();
            let mut cum = vec![0.0];
            for w in pts.windows(2) {
                cum.push(cum.last().unwrap() + w[0].dist(w[1]));
            }
            let bbox = BBox::of(pts.iter().copied());
            Local { st, pts, cum, bbox }
        })
        .collect();
    let mut out: Vec<LevelCrossing> = Vec::new();
    let mut iss: Vec<Issue> = Vec::new();
    let supply = &defaults().supply_systems;
    for g in &dz.tracks {
        let Some(t) = dz.doc_track(g.id) else {
            continue;
        };
        let mode = dz.track_mode(g.id);
        let p = dz.params_for(mode);
        let embedded = dz.embedded(t);
        let (third_rail, overhead) = (dz.third_rail(t), dz.overhead(t));
        let c = coarse(&g.centre);
        let cp: Vec<P2> = c.iter().map(|q| q.p).collect();
        let tb = BBox::of(cp.iter().copied());
        let min_angle = p.level_crossing_min_angle_deg.to_radians();
        let speeds = dz.speeds.get(&g.id);
        for l in &local {
            if !tb.overlaps(&l.bbox, 1.0) {
                continue;
            }
            let st = l.st;
            let mut hits = Vec::new();
            poly_cross(&cp, &l.pts, |h, i, j| hits.push((h, i, j)));
            for (h, i, j) in hits {
                let s = c[i].s + (c[i + 1].s - c[i].s) * h.t;
                if s < 0.5 || s > g.length - 0.5 {
                    continue;
                }
                // A street split into two ways at the crossing gives the same point twice.
                if out.iter().any(|x| x.track == g.id && x.p.dist(h.p) < 2.0) {
                    continue;
                }
                let order = g.order_at(s);
                let level = g.level_at(s);
                let name = if st.name.is_empty() {
                    format!("an unnamed {} street", st.class.replace('_', " "))
                } else {
                    st.name.clone()
                };
                if level.is_none() && order == Level::Street.order() {
                    iss.push(Issue::error(
                        format!(
                            "{name} crosses the track on its ramp, where the track is neither at street level nor deep or high enough to pass under or over the street. Move the ramp away from the street."
                        ),
                        Some(h.p),
                        g.id,
                    ));
                    continue;
                }
                if level.is_none() {
                    // On the part of a ramp that belongs to a tunnel or a bridge.
                    continue;
                }
                if level != Some(Level::Street) {
                    continue;
                }
                // A tram embedded in the street and meeting it at a flat angle runs along it.
                if mode.street_running() && embedded && h.angle < min_angle {
                    continue;
                }
                let deg = h.angle.to_degrees();
                let (sin, cos) = (h.angle.sin().max(0.05), h.angle.cos());
                let lanes = st.lanes.unwrap_or(if st.oneway {
                    (p.street_lanes / 2.0).max(1.0)
                } else {
                    p.street_lanes
                });
                let width = st.width_m.unwrap_or(lanes * p.street_lane_width_m);
                // The track's swept zone: both lines of a double track plus half the clearance
                // marker distance outside each.
                let ext = g.spacing_at(s) / 2.0 + p.clearance_marker_m / 2.0;
                let rail_zone = width / 2.0 / sin + ext * cos / sin;
                let keep_clear = (ext + p.road_stop_clearance_m) / sin + width / 2.0 * cos / sin;
                let line_speed = speeds
                    .and_then(|sp| {
                        let k = sp.s.iter().position(|x| *x >= s)?;
                        sp.limit.get(k).copied()
                    })
                    .unwrap_or(p.design_speed_kmh);
                let warning = p.level_crossing_warning_time_s;
                let protection = if embedded {
                    Protection::TrafficSignals
                } else {
                    Protection::Barriers
                };
                // Crossings outside the usual rules are possible with special safety measures,
                // so they are warnings that say which measures, not errors.
                let mut special: Vec<(&'static str, String)> = Vec::new();
                if p.level_crossing_permitted == "no" {
                    special.push(("mode", format!(
                        "{} track crosses {name} on the level. {} lines normally have no level crossings. This one needs full barriers, obstacle detection and train protection that stops trains while the crossing is not clear. Consider taking the track under or over the street.",
                        p.label, p.label
                    )));
                }
                if third_rail {
                    special.push(("third_rail", format!(
                        "This track crosses {name} on the level with a third rail, which would be live where road vehicles and people cross. It needs a gap in the third rail across the crossing (trains coast over it) with insulated ends and fencing, or overhead line on this stretch."
                    )));
                }
                if matches!(st.class.as_str(), "motorway" | "motorway_link") {
                    special.push(("motorway", format!(
                        "{name} is a motorway, and motorways normally have no level crossings. This one needs full barriers across every lane, obstacle detection and advance warning signs and signals well before the crossing. Consider a bridge."
                    )));
                }
                if line_speed > p.level_crossing_max_speed_kmh + 0.5 {
                    special.push(("line_speed", format!(
                        "The line speed over the level crossing with {name} is {line_speed:.0} km/h, above the usual limit of {:.0} km/h. It needs full barriers with obstacle detection tied to the signals, so trains stop while the crossing is not clear, or a lower speed there.",
                        p.level_crossing_max_speed_kmh
                    )));
                }
                let standard = special.is_empty();
                let special_measures: Vec<&'static str> = special.iter().map(|x| x.0).collect();
                iss.extend(
                    special
                        .into_iter()
                        .map(|(_, text)| Issue::warning(text, Some(h.p), g.id)),
                );
                if !(mode.street_running() && embedded) && h.angle < min_angle {
                    iss.push(Issue::warning(
                        format!(
                            "{name} crosses the track at {deg:.0}°, flatter than {:.0}°: the crossing is long and drivers cannot see along the line. Cross nearer to a right angle.",
                            p.level_crossing_min_angle_deg
                        ),
                        Some(h.p),
                        g.id,
                    ));
                }
                if st.trolley_wire && overhead {
                    let sys = supply.get(&p.electrification);
                    let label = sys.map_or(p.electrification.clone(), |s| s.label.clone());
                    if sys.is_some_and(|s| s.current == "ac") {
                        iss.push(Issue::warning(
                            format!(
                                "The trolleybus wires on {name} cannot cross the railway's overhead line ({label}): trolleybuses lower their poles and cross on battery here."
                            ),
                            Some(h.p),
                            g.id,
                        ));
                    } else {
                        iss.push(Issue::warning(
                            format!(
                                "The trolleybus wires on {name} cross the railway's overhead line ({label}): this needs an insulated crossing of the trolleybus and railway wires."
                            ),
                            Some(h.p),
                            g.id,
                        ));
                    }
                }
                {
                    let how = match protection {
                        Protection::Barriers => format!(
                            "barriers close the street {warning:.0} s before a train ({:.0} m before the crossing at {line_speed:.0} km/h)",
                            warning * line_speed / 3.6
                        ),
                        Protection::TrafficSignals => {
                            "traffic signals stop road traffic for the tram".to_string()
                        }
                    };
                    iss.push(Issue::info(
                        format!(
                            "Level crossing with {name} at {deg:.0}°: {how}. Buses and other road vehicles wait {keep_clear:.1} m from the crossing point and never stop on the track."
                        ),
                        Some(h.p),
                        Some(g.id),
                    ));
                }
                let n = out
                    .iter()
                    .filter(|x| x.track == g.id && x.way == st.way)
                    .count();
                let off = l.cum[j] + l.pts[j].dist(h.p);
                out.push(LevelCrossing {
                    id: format!("lc{}-{}-{n}", g.id, st.way),
                    track: g.id,
                    mode,
                    s,
                    p: h.p,
                    angle: h.angle,
                    street_dir: l.pts[j + 1].sub(l.pts[j]).unit(),
                    way: st.way,
                    street: st.name.clone(),
                    class: st.class.clone(),
                    street_offset_m: off,
                    street_width_m: width,
                    protection,
                    rail_zone_m: rail_zone,
                    keep_clear_m: keep_clear,
                    line_speed_kmh: line_speed,
                    warning_time_s: warning,
                    approach_m: warning * line_speed / 3.6,
                    trolley_wire: st.trolley_wire,
                    bus: st.bus,
                    standard,
                    special_measures,
                });
            }
        }
    }
    out.sort_by(|a, b| a.track.cmp(&b.track).then(a.s.total_cmp(&b.s)));
    dz.level_crossings = out;
    dz.issues.extend(iss);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::design::build_with_streets;
    use crate::issue::Severity;
    use crate::model::{Anchor, Bed, Network, Power, Track, TrackUse};
    use crate::proj::LocalTm;

    const ORIGIN: [f64; 2] = [7.0, 50.9];

    fn line(mode: RailMode, level: Level) -> Network {
        let mut net = Network::new(mode, ORIGIN);
        net.tracks.push(Track {
            id: 1,
            name: String::new(),
            start: Anchor::Free {
                x: -400.0,
                y: 0.0,
                level: None,
            },
            end: Some(Anchor::Free {
                x: 400.0,
                y: 0.0,
                level: None,
            }),
            points: vec![],
            tracks: 1,
            level,
            power: Power::Auto,
            usage: TrackUse::Storage,
            bed: Bed::Auto,
            lead_start_m: 30.0,
            lead_end_m: 30.0,
            radius_start_m: None,
            radius_end_m: None,
            directions: vec![],
            mode: None,
        });
        net
    }

    /// A street through the origin at `deg` degrees to the track.
    fn street(class: &str, deg: f64, tags: &[(&str, &str)]) -> Street {
        let proj = LocalTm::new(ORIGIN[0], ORIGIN[1]);
        let d = P2::dir(deg.to_radians());
        let mut t: BTreeMap<String, String> = tags
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        t.insert("highway".into(), class.into());
        t.insert("name".into(), "Mill Lane".into());
        let coords = vec![proj.to_lonlat(d.mul(-80.0)), proj.to_lonlat(d.mul(80.0))];
        street_from_osm(42, &t, coords).expect("a road")
    }

    fn errors(dz: &Design) -> Vec<&str> {
        issues(dz, Severity::Error)
    }

    fn issues(dz: &Design, sev: Severity) -> Vec<&str> {
        dz.issues
            .iter()
            .filter(|i| i.severity == sev)
            .map(|i| i.text.as_str())
            .collect()
    }

    #[test]
    fn a_regional_line_crossing_a_street_gets_a_level_crossing_with_barriers() {
        let dz = build_with_streets(
            &line(RailMode::RegionalRail, Level::Street),
            None,
            &[street("residential", 90.0, &[])],
        );
        assert!(errors(&dz).is_empty(), "{:?}", errors(&dz));
        let x = &dz.level_crossings[0];
        assert_eq!(x.id, "lc1-42-0");
        assert_eq!(x.protection, Protection::Barriers);
        assert!((x.s - 400.0).abs() < 1.0, "{}", x.s);
        assert!((x.street_offset_m - 80.0).abs() < 0.5);
        // Storage track runs at 25 km/h: 25 s of warning start about 174 m before.
        assert!(
            (x.approach_m - 25.0 * 25.0 / 3.6).abs() < 1.0,
            "{}",
            x.approach_m
        );
        assert!(x.keep_clear_m > x.street_width_m / 2.0);
    }

    #[test]
    fn metro_motorways_and_streets_on_bridges() {
        let dz = build_with_streets(
            &line(RailMode::Metro, Level::Street),
            None,
            &[street("residential", 90.0, &[])],
        );
        // Possible with special safety measures: a warning that says which, not an error.
        assert!(errors(&dz).is_empty(), "{:?}", errors(&dz));
        assert!(issues(&dz, Severity::Warning)
            .iter()
            .any(|e| e.contains("normally have no level crossings")));
        let x = &dz.level_crossings[0];
        assert!(!x.standard);
        assert!(x.special_measures.contains(&"mode"));
        let dz = build_with_streets(
            &line(RailMode::RegionalRail, Level::Street),
            None,
            &[street("motorway", 90.0, &[])],
        );
        assert!(issues(&dz, Severity::Warning)
            .iter()
            .any(|e| e.contains("motorway")));
        assert_eq!(dz.level_crossings[0].special_measures, vec!["motorway"]);
        let dz = build_with_streets(
            &line(RailMode::RegionalRail, Level::Street),
            None,
            &[street("primary", 90.0, &[("bridge", "yes")])],
        );
        assert!(dz.level_crossings.is_empty());
        let dz = build_with_streets(
            &line(RailMode::RegionalRail, Level::Underground),
            None,
            &[street("primary", 90.0, &[])],
        );
        assert!(dz.level_crossings.is_empty());
        let mut fast = line(RailMode::LongDistanceRail, Level::Street);
        fast.tracks[0].usage = TrackUse::Running;
        let dz = build_with_streets(&fast, None, &[street("residential", 90.0, &[])]);
        assert!(
            issues(&dz, Severity::Warning)
                .iter()
                .any(|e| e.contains("above the usual limit of 160 km/h")),
            "{:?}",
            dz.issues
        );
        assert!(dz.level_crossings[0]
            .special_measures
            .contains(&"line_speed"));
        assert!(street_from_osm(
            1,
            &BTreeMap::from([("highway".into(), "footway".into())]),
            vec![[0.0, 0.0], [0.0, 1.0]]
        )
        .is_none());
    }

    #[test]
    fn skewed_crossings_warn_and_trams_running_along_a_street_do_not_cross_it() {
        let dz = build_with_streets(
            &line(RailMode::RegionalRail, Level::Street),
            None,
            &[street("tertiary", 30.0, &[("lanes", "2")])],
        );
        assert!(dz
            .issues
            .iter()
            .any(|i| i.severity == Severity::Warning && i.text.contains("30°")));
        let x = &dz.level_crossings[0];
        // A 30° crossing covers twice the street's half width of track, plus the skew.
        assert!(x.rail_zone_m > x.street_width_m, "{}", x.rail_zone_m);
        let dz = build_with_streets(
            &line(RailMode::Tram, Level::Street),
            None,
            &[street("tertiary", 10.0, &[])],
        );
        assert!(dz.level_crossings.is_empty());
        let dz = build_with_streets(
            &line(RailMode::Tram, Level::Street),
            None,
            &[street("tertiary", 80.0, &[])],
        );
        assert_eq!(dz.level_crossings[0].protection, Protection::TrafficSignals);
    }
}
