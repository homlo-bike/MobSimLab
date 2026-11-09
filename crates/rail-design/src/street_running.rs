//! Street running: where tram or light rail track embedded in the street runs along a street from
//! OpenStreetMap, instead of crossing it.
//!
//! Each stretch gets a stable id `sr{track}-{way}-{n}` and says how the tram shares the street:
//!
//! - `reserved`: the carriageway is wide enough for the tram's own lane (the track, or both
//!   tracks, plus the clearance marker distance) and one road lane per direction beside it;
//! - `mixed`: it is not, so cars, buses and lorries drive on the track and the tram runs in
//!   traffic;
//! - `pedestrian_zone`: a pedestrian street or zone, shared with people on foot.
//!
//! On the street the tram keeps to the road speed limit (BOStrab: track in the street follows the
//! road traffic rules): the street's `maxspeed`, else `street.speed_limit_kmh`, or walking pace
//! (`street.walking_pace_kmh`) in a living street or pedestrian zone. The cap goes into the
//! track's speed profile, and so into running times, level crossings, the topology and signals.
//!
//! Tram stops on a street-running stretch are listed with the stretch, with one line saying how
//! passengers board: from the pavement (side platforms at the kerb) or from an island platform in
//! the middle of the street, which they reach over the traffic lanes.

use crate::design::Design;
use crate::geom::{at_s, BBox, P2};
use crate::issue::Issue;
use crate::model::Level;
use crate::street::{Street, TramShare};
use serde::Serialize;

/// Spacing of the samples along the track, m.
const STEP_M: f64 = 5.0;
/// Shortest stretch reported, m (shorter ones are junctions the track turns through).
const MIN_LENGTH_M: f64 = 30.0;
/// Gaps without a street up to this length inside one stretch are bridged (a junction), m.
const MAX_GAP_M: f64 = 15.0;

/// How the tram shares the street.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Running {
    /// The tram has its own lane; road traffic passes beside it.
    Reserved,
    /// Road traffic drives on the track; the tram runs in traffic.
    Mixed,
    /// A pedestrian street or zone.
    PedestrianZone,
}

/// The street of a stretch.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RunningStreet {
    /// OSM way id.
    pub way: i64,
    /// Name, empty when unnamed.
    pub name: String,
    /// OSM `highway` class.
    pub class: String,
    /// Carriageway width used, m (OSM `width`, else lanes × lane width).
    pub width_m: f64,
    /// Lanes used.
    pub lanes: f64,
    /// One-way street.
    pub oneway: bool,
    /// Buses use the street.
    pub bus: bool,
    /// A trolleybus wire runs along the street.
    pub trolley_wire: bool,
    /// A bike lane or cycle track runs along the street.
    pub bike_lane: bool,
    /// A bus lane runs along the street.
    pub bus_lane: bool,
}

/// A stretch of track running along a street.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct StreetRunning {
    /// Stable id `sr{track}-{way}-{n}`.
    pub id: String,
    /// Track (alignment) id.
    pub track: u32,
    /// From chainage on the track's centre line, m.
    pub from_m: f64,
    /// To chainage, m.
    pub to_m: f64,
    /// Own lane, mixed traffic or pedestrian zone.
    pub running: Running,
    /// Road speed limit the tram keeps to here, km/h.
    pub speed_limit_kmh: f64,
    /// Width the tram's own lane needs (tracks plus the clearance marker distance), m.
    pub tram_lane_m: f64,
    /// Width the road traffic beside it needs (one lane per direction), m.
    pub road_lanes_m: f64,
    /// The street.
    pub street: RunningStreet,
    /// Stations (tram stops) on the stretch.
    pub stops: Vec<u32>,
    /// The tram's own lane is separated from the traffic by a kerb, barrier or track bed.
    pub separated: bool,
    /// Where the share of the street comes from: `setup` (the planner set the street up in the
    /// GIS tab) or `osm` (inferred from the street's width in OpenStreetMap).
    pub source: &'static str,
    /// Expected extra running time in traffic on the stretch, as a share of the running time at
    /// the speed limit (`street.mixed_traffic_delay_share` in a main road's traffic,
    /// `street.bus_lane_delay_share` in a painted lane of a main road, else 0).
    pub traffic_delay_share: f64,
}

/// A speed cap on a stretch of chainage: from, to, km/h.
type Cap = (f64, f64, f64);

struct Local<'a> {
    st: &'a Street,
    pts: Vec<P2>,
    bbox: BBox,
}

/// Purpose: distance from `q` to a polyline and the unit direction of its nearest segment.
fn near(pts: &[P2], q: P2) -> Option<(f64, P2)> {
    let mut best: Option<(f64, P2)> = None;
    for w in pts.windows(2) {
        let ab = w[1].sub(w[0]);
        let l2 = ab.dot(ab);
        if l2 <= 1e-9 {
            continue;
        }
        let t = (q.sub(w[0]).dot(ab) / l2).clamp(0.0, 1.0);
        let d = w[0].add(ab.mul(t)).dist(q);
        if best.map_or(true, |b: (f64, P2)| d < b.0) {
            best = Some((d, ab.unit()));
        }
    }
    best
}

/// Purpose: angle between two directions, ignoring orientation (0..π/2).
fn line_angle(a: P2, b: P2) -> f64 {
    a.cross(b).abs().atan2(a.dot(b).abs())
}

/// Purpose: find where street-level tram and light rail track embedded in the street runs along
/// the streets, cap its speed at the street's limit and add one line of information per stretch
/// (a warning where the tram runs in the traffic of a main road).
/// Side effects: fills `dz.street_running`, lowers `dz.speeds` there, appends to `dz.issues`.
pub fn street_running(dz: &mut Design, streets: &[Street]) {
    let local: Vec<Local> = streets
        .iter()
        .filter(|s| s.path.is_none())
        .filter(|s| s.layer == 0)
        .map(|st| {
            let pts: Vec<P2> = st
                .coords
                .iter()
                .map(|c| dz.proj.to_xy(c[0], c[1]))
                .collect();
            let bbox = BBox::of(pts.iter().copied());
            Local { st, pts, bbox }
        })
        .collect();
    if local.is_empty() {
        return;
    }
    let mut out: Vec<StreetRunning> = Vec::new();
    let mut iss: Vec<Issue> = Vec::new();
    let mut caps: Vec<(u32, Vec<Cap>)> = Vec::new();
    for g in &dz.tracks {
        let Some(t) = dz.doc_track(g.id) else {
            continue;
        };
        let mode = dz.track_mode(g.id);
        if !mode.street_running() || !dz.embedded(t) || g.length < MIN_LENGTH_M {
            continue;
        }
        let p = dz.params_for(mode);
        let min_angle = p.level_crossing_min_angle_deg.to_radians();
        let tb = BBox::of(g.centre.iter().map(|q| q.p));
        let near_streets: Vec<usize> = (0..local.len())
            .filter(|&i| tb.overlaps(&local[i].bbox, 40.0))
            .collect();
        if near_streets.is_empty() {
            continue;
        }
        // Which street each sample runs along.
        let n = (g.length / STEP_M).ceil() as usize;
        let mut along: Vec<(f64, Option<usize>)> = Vec::with_capacity(n + 1);
        for k in 0..=n {
            let s = (k as f64 * STEP_M).min(g.length);
            if g.level_at(s) != Some(Level::Street) {
                along.push((s, None));
                continue;
            }
            let q = at_s(&g.centre, s);
            let dir = P2::dir(q.h);
            let half_track = g.spacing_at(s) * f64::from(g.ntracks.max(1) - 1) / 2.0;
            let mut best: Option<(f64, usize)> = None;
            for &i in &near_streets {
                let l = &local[i];
                let Some((d, sd)) = near(&l.pts, q.p) else {
                    continue;
                };
                let width = street_width(l.st, p);
                if d <= (width / 2.0).max(3.0) + half_track
                    && line_angle(dir, sd) < min_angle
                    && best.map_or(true, |b: (f64, usize)| d < b.0)
                {
                    best = Some((d, i));
                }
            }
            along.push((s, best.map(|b| b.1)));
        }
        // Runs along one street, bridging short gaps at junctions.
        let mut runs: Vec<(usize, f64, f64)> = Vec::new();
        for (s, who) in &along {
            let Some(i) = *who else {
                continue;
            };
            match runs.last_mut() {
                Some(r) if r.0 == i && *s - r.2 <= MAX_GAP_M + 1e-6 => r.2 = *s,
                _ => runs.push((i, *s, *s)),
            }
        }
        let mut track_caps = Vec::new();
        for (i, a, b) in runs {
            if b - a < MIN_LENGTH_M {
                continue;
            }
            let st = local[i].st;
            let width = street_width(st, p);
            let lanes = street_lanes(st, p);
            let mid = (a + b) / 2.0;
            let ntracks = f64::from(g.ntracks.max(1));
            let tram_lane = g.spacing_at(mid) * (ntracks - 1.0) + p.clearance_marker_m;
            let road_lanes = if st.oneway { 1.0 } else { 2.0 } * p.street_lane_width_m;
            let running = match st.tram {
                _ if st.class == "pedestrian" => Running::PedestrianZone,
                Some(TramShare::OwnLane) => Running::Reserved,
                Some(TramShare::Mixed) => Running::Mixed,
                None if width + 0.01 >= tram_lane + road_lanes => Running::Reserved,
                None => Running::Mixed,
            };
            let set = st.tram.is_some();
            let limit = if st.walking_pace {
                p.street_walking_pace_kmh
            } else {
                st.maxspeed_kmh.unwrap_or(p.street_speed_limit_kmh)
            };
            track_caps.push((a, b, limit));
            let stops: Vec<u32> = dz
                .stations
                .iter()
                .filter(|sg| sg.level == Level::Street)
                .filter(|sg| {
                    crate::geom::nearest(&g.centre, sg.centre)
                        .is_some_and(|r| r.d < sg.half_w + 2.0 && r.s >= a - 1.0 && r.s <= b + 1.0)
                })
                .map(|sg| sg.id)
                .collect();
            let name = if st.name.is_empty() {
                format!("an unnamed {} street", st.class.replace('_', " "))
            } else {
                st.name.clone()
            };
            let at = Some(at_s(&g.centre, mid).p);
            let len = b - a;
            let how = match running {
                Running::Reserved if set => format!(
                    "in its own lane{} (set in the GIS tab)",
                    if st.separated {
                        ", separated from the traffic"
                    } else {
                        ""
                    }
                ),
                Running::Reserved => format!(
                    "in its own lane ({tram_lane:.1} m), with a road lane each way beside it"
                ),
                Running::Mixed if set => format!(
                    "in the traffic lanes, shared with cars{} (set in the GIS tab)",
                    if st.bus { " and buses" } else { "" },
                ),
                Running::Mixed => format!(
                    "in the traffic lanes, shared with cars{}: the street is about {width:.1} m wide and a tram lane with road lanes beside it needs {:.1} m",
                    if st.bus { " and buses" } else { "" },
                    tram_lane + road_lanes
                ),
                Running::PedestrianZone => "through a pedestrian zone".to_string(),
            };
            let speed = if p.design_speed_kmh > limit + 0.5 {
                format!(", at up to {limit:.0} km/h (the street's speed limit)")
            } else {
                String::new()
            };
            let busy = matches!(
                st.class.as_str(),
                "trunk" | "primary" | "secondary" | "trunk_link" | "primary_link"
            );
            let delay = match running {
                Running::Mixed if busy => p.street_mixed_traffic_delay_share,
                Running::Reserved if busy && !st.separated => p.street_bus_lane_delay_share,
                _ => 0.0,
            };
            if running == Running::Mixed && busy {
                iss.push(Issue::warning(
                    format!(
                        "The tram runs {len:.0} m along {name} {how}. On a main road the tram is held up in traffic jams and can be stuck in gridlock, so it runs late (about {:.0} % longer here at peak). Give it its own lane, separated from the traffic, in the GIS tab (move parking or a road lane), or use traffic signals that let the tram go first.",
                        delay * 100.0
                    ),
                    at,
                    g.id,
                ));
            } else if running == Running::Reserved && busy && !st.separated {
                iss.push(Issue::info(
                    format!(
                        "The tram runs {len:.0} m along {name} {how}{speed}. The lane is only painted, so turning, parking and loading cars still get in the way (about {:.0} % longer here at peak); a kerb or separate track bed (separation in the GIS tab) keeps them out.",
                        delay * 100.0
                    ),
                    at,
                    Some(g.id),
                ));
            } else {
                iss.push(Issue::info(
                    format!("The tram runs {len:.0} m along {name} {how}{speed}."),
                    at,
                    Some(g.id),
                ));
            }
            if running == Running::Mixed && !st.bike_lane {
                let text = format!(
                    "Cyclists on {name} ride along the tram rails: a wheel caught in the groove is a common cause of falls. A bike lane beside the track (GIS tab) keeps them off the rails."
                );
                iss.push(if busy {
                    Issue::warning(text, at, g.id)
                } else {
                    Issue::info(text, at, Some(g.id))
                });
            }
            for sid in &stops {
                let (Some(sg), Some(doc)) = (
                    dz.station(*sid),
                    dz.network.stations.iter().find(|x| x.id == *sid),
                ) else {
                    continue;
                };
                let text = if doc.island_platforms > 0 && running != Running::PedestrianZone {
                    format!(
                        "Tram stop {} on {name} has an island platform in the middle of the street: passengers reach it over the road lanes, so it needs a signalled pedestrian crossing at its end.",
                        doc.name
                    )
                } else if running == Running::Mixed {
                    format!(
                        "Tram stop {} on {name}: passengers board from the pavement (a kerb stop), and road traffic waits behind the tram while it stands at the stop.",
                        doc.name
                    )
                } else {
                    format!(
                        "Tram stop {} on {name}: passengers board from platforms beside the tracks.",
                        doc.name
                    )
                };
                iss.push(Issue::info(text, Some(sg.centre), Some(*sid)));
            }
            let k = out
                .iter()
                .filter(|x| x.track == g.id && x.street.way == st.way)
                .count();
            out.push(StreetRunning {
                id: format!("sr{}-{}-{k}", g.id, st.way),
                track: g.id,
                from_m: a,
                to_m: b,
                running,
                speed_limit_kmh: limit,
                tram_lane_m: tram_lane,
                road_lanes_m: road_lanes,
                street: RunningStreet {
                    way: st.way,
                    name: st.name.clone(),
                    class: st.class.clone(),
                    width_m: width,
                    lanes,
                    oneway: st.oneway,
                    bus: st.bus,
                    trolley_wire: st.trolley_wire,
                    bike_lane: st.bike_lane,
                    bus_lane: st.bus_lane,
                },
                stops,
                separated: st.separated && running == Running::Reserved,
                source: if set { "setup" } else { "osm" },
                traffic_delay_share: delay,
            });
        }
        if !track_caps.is_empty() {
            caps.push((g.id, track_caps));
        }
    }
    for (track, c) in caps {
        crate::design::cap_speeds(dz, track, &c);
    }
    dz.street_running = out;
    dz.issues.extend(iss);
}

/// Purpose: lanes of a street (OSM `lanes`, else the assumption, halved for a one-way street).
fn street_lanes(st: &Street, p: &crate::params::ModeParams) -> f64 {
    st.lanes.unwrap_or(if st.oneway {
        (p.street_lanes / 2.0).max(1.0)
    } else {
        p.street_lanes
    })
}

/// Purpose: carriageway width of a street (OSM `width`, else lanes × lane width).
fn street_width(st: &Street, p: &crate::params::ModeParams) -> f64 {
    st.width_m
        .unwrap_or(street_lanes(st, p) * p.street_lane_width_m)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::design::build_with_streets;
    use crate::issue::Severity;
    use crate::model::{Anchor, Bed, Network, Power, Track, TrackUse};
    use crate::params::RailMode;
    use crate::proj::LocalTm;
    use crate::street::street_from_osm;
    use std::collections::BTreeMap;

    const ORIGIN: [f64; 2] = [7.0, 50.9];

    /// A straight double-track tram line along the x axis, 800 m, at street level.
    fn tram_line(mode: RailMode) -> Network {
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
            tracks: 2,
            level: Level::Street,
            power: Power::Auto,
            usage: TrackUse::Running,
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

    /// A street along the track from x = −200 to 200 m.
    fn along(class: &str, tags: &[(&str, &str)]) -> Street {
        let proj = LocalTm::new(ORIGIN[0], ORIGIN[1]);
        let mut t: BTreeMap<String, String> = tags
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        t.insert("highway".into(), class.into());
        t.insert("name".into(), "Long Street".into());
        let coords = (-4..=4)
            .map(|k| {
                proj.to_lonlat(P2 {
                    x: 50.0 * f64::from(k),
                    y: 0.0,
                })
            })
            .collect();
        street_from_osm(7, &t, coords).expect("a street")
    }

    fn limit_at(dz: &Design, s: f64) -> f64 {
        let sp = &dz.speeds[&1];
        let k = sp.s.iter().position(|x| *x >= s).unwrap();
        sp.limit[k]
    }

    #[test]
    fn a_tram_in_a_wide_street_gets_its_own_lane_at_the_street_speed_limit() {
        let dz = build_with_streets(
            &tram_line(RailMode::Tram),
            None,
            &[along("primary", &[("lanes", "4")])],
        );
        assert_eq!(dz.street_running.len(), 1);
        let r = &dz.street_running[0];
        assert_eq!(r.id, "sr1-7-0");
        assert_eq!(r.running, Running::Reserved);
        assert!(
            (r.from_m - 200.0).abs() < 6.0 && (r.to_m - 600.0).abs() < 6.0,
            "{r:?}"
        );
        assert!((r.speed_limit_kmh - 50.0).abs() < 1e-9);
        // The tram's 60 km/h drops to the street's 50 km/h on the street only.
        assert!((limit_at(&dz, 400.0) - 50.0).abs() < 1e-9);
        assert!((limit_at(&dz, 100.0) - 60.0).abs() < 1e-9);
        // It runs along the street, so the street is no level crossing.
        assert!(dz.level_crossings.is_empty());
        assert!(!dz
            .issues
            .iter()
            .any(|i| i.severity == Severity::Warning && i.text.contains("Long Street")));
    }

    #[test]
    fn a_narrow_main_road_puts_the_tram_in_traffic_and_warns() {
        let dz = build_with_streets(
            &tram_line(RailMode::Tram),
            None,
            &[along(
                "secondary",
                &[("maxspeed", "30"), ("bus", "designated")],
            )],
        );
        let r = &dz.street_running[0];
        assert_eq!(r.running, Running::Mixed);
        assert!((r.speed_limit_kmh - 30.0).abs() < 1e-9);
        assert!(dz
            .issues
            .iter()
            .any(|i| i.severity == Severity::Warning
                && i.text.contains("shared with cars and buses")));
    }

    #[test]
    fn the_gis_setup_overrides_the_width_and_resolves_the_mixed_traffic_warning() {
        let warned = |dz: &Design| {
            dz.issues.iter().any(|i| {
                i.severity == Severity::Warning && i.text.contains("held up in traffic jams")
            })
        };
        // From OSM: a narrow main road, so mixed traffic and a warning.
        let dz = build_with_streets(&tram_line(RailMode::Tram), None, &[along("secondary", &[])]);
        assert!(warned(&dz));
        let r = &dz.street_running[0];
        assert_eq!((r.source, r.running), ("osm", Running::Mixed));
        assert!(r.traffic_delay_share > 0.2);
        // The delay goes with the sections into the running times.
        let delays = |dz: &Design| {
            crate::topology::topology(dz)
                .sections
                .iter()
                .flat_map(|s| s.traffic_delay_share.iter().map(|x| x.value))
                .collect::<Vec<_>>()
        };
        let d = delays(&dz);
        assert!(!d.is_empty() && d.iter().all(|&x| (x - r.traffic_delay_share).abs() < 1e-3));
        // Cyclists ride along the rails without a bike lane.
        assert!(dz
            .issues
            .iter()
            .any(|i| i.text.contains("Cyclists on Long Street")));

        // Set up in the GIS tab: own lane, separated, with a bike lane.
        let dz = build_with_streets(
            &tram_line(RailMode::Tram),
            None,
            &[along(
                "secondary",
                &[
                    ("mobsimlab:tram", "own_lane"),
                    ("mobsimlab:separated", "yes"),
                    ("mobsimlab:setup", "yes"),
                    ("cycleway:both", "track"),
                ],
            )],
        );
        assert!(!warned(&dz), "{:?}", dz.issues);
        let r = &dz.street_running[0];
        assert_eq!((r.source, r.running), ("setup", Running::Reserved));
        assert!(r.separated && r.street.bike_lane);
        assert_eq!(r.traffic_delay_share, 0.0);
        assert!(!dz.issues.iter().any(|i| i.text.contains("Cyclists")));
        assert!(delays(&dz).is_empty());

        // Own lane but only painted: no warning, a smaller delay and a hint to separate it.
        let dz = build_with_streets(
            &tram_line(RailMode::Tram),
            None,
            &[along("secondary", &[("mobsimlab:tram", "own_lane")])],
        );
        assert!(!warned(&dz));
        let r = &dz.street_running[0];
        assert!(r.traffic_delay_share > 0.0 && r.traffic_delay_share < 0.2);
        assert!(dz.issues.iter().any(|i| i.text.contains("only painted")));

        // The planner can also say a wide street is mixed traffic.
        let dz = build_with_streets(
            &tram_line(RailMode::Tram),
            None,
            &[along(
                "primary",
                &[("lanes", "4"), ("mobsimlab:tram", "mixed")],
            )],
        );
        assert_eq!(dz.street_running[0].running, Running::Mixed);
        assert!(warned(&dz));
    }

    #[test]
    fn the_project_preferences_change_the_delay_in_traffic() {
        let streets = [along("secondary", &[])];
        let values = [("street_mixed_traffic_delay_share".to_string(), 0.4)]
            .into_iter()
            .collect();
        let dz = crate::design::build_with_values(
            &tram_line(RailMode::Tram),
            None,
            &streets,
            &[],
            &values,
        );
        assert!((dz.street_running[0].traffic_delay_share - 0.4).abs() < 1e-9);
        // Names that are not design values are ignored.
        let odd = [("no_such_value".to_string(), 1.0)].into_iter().collect();
        let p = crate::params::defaults().mode(RailMode::Tram).clone();
        assert_eq!(p.with_values(&odd), p);
    }

    #[test]
    fn a_pedestrian_zone_limits_the_tram_to_walking_pace() {
        let dz = build_with_streets(
            &tram_line(RailMode::Tram),
            None,
            &[along("pedestrian", &[])],
        );
        let r = &dz.street_running[0];
        assert_eq!(r.running, Running::PedestrianZone);
        assert!((limit_at(&dz, 400.0) - r.speed_limit_kmh).abs() < 1e-9);
        assert!(r.speed_limit_kmh < 15.0);
    }

    #[test]
    fn ballasted_or_mainline_track_never_runs_along_a_street() {
        let mut net = tram_line(RailMode::Tram);
        net.tracks[0].bed = Bed::Ballast;
        let dz = build_with_streets(&net, None, &[along("primary", &[])]);
        assert!(dz.street_running.is_empty());
        let dz = build_with_streets(
            &tram_line(RailMode::RegionalRail),
            None,
            &[along("primary", &[])],
        );
        assert!(dz.street_running.is_empty());
    }
}
