//! Existing railways from OpenStreetMap: the railway lines already built around the design, which
//! new track can join.
//!
//! Like streets ([`crate::street`]), existing railways are not part of the railway document. They
//! come from OSM railway tiles and are passed to [`crate::design::build_with_osm`]. The design:
//!
//! - draws them under the new track, by kind and status;
//! - treats a free end of a new track that lies on an existing railway as a **join** (no "open
//!   track" warning), and checks it: gauge (an error when the gauges differ), railway system and
//!   electrification (warnings), and the angle at which it meets the existing track;
//! - warns where new track crosses an existing railway on the same level, which needs a diamond in
//!   the existing track and interlocking with it, and where new track is drawn on top of an
//!   existing one;
//! - lists the joins in the topology export, where the design meets the existing network.
//!
//! Joins are found by position, with tolerances that are geometric, not design values: an end within
//! [`JOIN_M`] of an existing track centre line joins it.

use crate::design::Design;
use crate::geom::{at_s, poly_cross, BBox, P2};
use crate::issue::Issue;
use crate::model::{Anchor, Level};
use crate::params::RailMode;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// An end of new track this close to an existing track's centre line joins it, m.
pub const JOIN_M: f64 = 2.5;
/// New track within this distance of an existing track, running the same way, lies on top of it, m.
const ON_TOP_M: f64 = 1.5;
/// Shortest stretch on top of an existing track that is reported, m.
const ON_TOP_MIN_M: f64 = 40.0;
/// A join within this distance of an existing way's end continues it (no new turnout needed), m.
const WAY_END_M: f64 = 5.0;
/// A join meeting the existing track at a larger angle needs a curve or a diamond, degrees.
const JOIN_ANGLE_DEG: f64 = 15.0;

/// An existing railway track from OpenStreetMap (one OSM way).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExistingRail {
    /// OSM way id.
    pub way: i64,
    /// OSM `railway` value: `rail`, `light_rail`, `tram`, `subway`, `narrow_gauge`, `monorail` or
    /// `funicular` (for a line under construction, disused or preserved, the kind it has or had).
    pub kind: String,
    /// `active`, `construction`, `disused` or `preserved`.
    pub status: String,
    /// Line name (`name`, else `ref`), empty when unnamed.
    #[serde(default)]
    pub name: String,
    /// Track gauges, mm (`gauge`; dual gauge track has two).
    #[serde(default)]
    pub gauge_mm: Vec<f64>,
    /// Electrification (`electrified`): `contact_line`, `rail`, `4th_rail`, `no`, or empty.
    #[serde(default)]
    pub electrified: String,
    /// Line voltage (`voltage`), V.
    #[serde(default)]
    pub voltage_v: Option<f64>,
    /// Speed limit (`maxspeed`), km/h.
    #[serde(default)]
    pub maxspeed_kmh: Option<f64>,
    /// `service`: `siding`, `yard`, `spur` or `crossover`, empty for a running line.
    #[serde(default)]
    pub service: String,
    /// Height layer: 0 at ground; positive on a bridge, negative in a tunnel.
    #[serde(default)]
    pub layer: i8,
    /// Shape, `[lon, lat]` degrees.
    pub coords: Vec<[f64; 2]>,
}

/// Railway kinds read from OSM.
const KINDS: [&str; 7] = [
    "rail",
    "light_rail",
    "tram",
    "subway",
    "narrow_gauge",
    "monorail",
    "funicular",
];

fn numbers(v: Option<&String>) -> Vec<f64> {
    v.map(|v| {
        v.split(';')
            .filter_map(|x| x.trim().parse::<f64>().ok())
            .filter(|x| *x > 0.0)
            .collect()
    })
    .unwrap_or_default()
}

/// Purpose: an existing railway from an OSM way's tags and shape, or None when the way is not a
/// railway track (platforms, abandoned or razed lines, too short).
pub fn rail_from_osm(
    way: i64,
    tags: &BTreeMap<String, String>,
    coords: Vec<[f64; 2]>,
) -> Option<ExistingRail> {
    let r = tags.get("railway")?;
    if coords.len() < 2 {
        return None;
    }
    let (kind, status) = if KINDS.contains(&r.as_str()) {
        (r.clone(), "active")
    } else if matches!(r.as_str(), "construction" | "disused" | "preserved") {
        let k = tags
            .get(r.as_str())
            .filter(|k| KINDS.contains(&k.as_str()))
            .cloned()
            .unwrap_or_else(|| "rail".into());
        (k, r.as_str())
    } else {
        return None;
    };
    let mut layer: i8 = tags
        .get("layer")
        .and_then(|v| v.trim().parse().ok())
        .unwrap_or(0);
    if tags.get("bridge").is_some_and(|v| v != "no") {
        layer = layer.max(1);
    }
    if tags.get("tunnel").is_some_and(|v| v != "no") {
        layer = layer.min(-1);
    }
    Some(ExistingRail {
        way,
        kind,
        status: status.into(),
        name: tags
            .get("name")
            .or_else(|| tags.get("ref"))
            .cloned()
            .unwrap_or_default(),
        gauge_mm: numbers(tags.get("gauge")),
        electrified: tags.get("electrified").cloned().unwrap_or_default(),
        voltage_v: numbers(tags.get("voltage")).first().copied(),
        maxspeed_kmh: numbers(tags.get("maxspeed")).first().copied(),
        service: tags.get("service").cloned().unwrap_or_default(),
        layer,
        coords,
    })
}

impl ExistingRail {
    /// Purpose: the railway system this track most likely belongs to.
    pub fn mode(&self) -> RailMode {
        match self.kind.as_str() {
            "tram" => RailMode::Tram,
            "light_rail" => RailMode::LightRail,
            "subway" => RailMode::Metro,
            _ if self.maxspeed_kmh.is_some_and(|v| v >= 250.0) => RailMode::HighSpeedRail,
            _ => RailMode::RegionalRail,
        }
    }

    /// Purpose: a name for messages.
    pub fn label(&self) -> String {
        let what = match self.kind.as_str() {
            "tram" => "tram line",
            "light_rail" => "light rail line",
            "subway" => "metro line",
            "narrow_gauge" => "narrow gauge railway",
            _ if !self.service.is_empty() => "siding",
            _ => "railway",
        };
        if self.name.is_empty() {
            format!("the existing {what}")
        } else {
            format!("the existing {what} {}", self.name)
        }
    }

    /// Purpose: the level the track lies on (a bridge or tunnel is above or below the street).
    pub fn level(&self) -> Level {
        match self.layer {
            l if l >= 2 => Level::Elevated2,
            1 => Level::Elevated,
            0 => Level::Street,
            -1 => Level::Underground,
            _ => Level::Underground2,
        }
    }
}

/// An existing railway in local metres.
#[derive(Debug, Clone, PartialEq)]
pub struct ExistingGeo {
    /// The OSM railway.
    pub rail: ExistingRail,
    /// Shape, local metres.
    pub pts: Vec<P2>,
    /// Bounding box.
    pub bbox: BBox,
}

/// Where a free end of a new track meets an existing railway.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Join {
    /// Track (alignment) id.
    pub track: u32,
    /// 0 the track's start, 1 its end.
    pub end: u8,
    /// OSM way id of the existing track.
    pub way: i64,
    /// Existing railway's name.
    pub name: String,
    /// Its OSM `railway` kind.
    pub kind: String,
    /// The end continues the existing way at one of its ends (otherwise a new turnout goes into the
    /// existing track).
    pub continues: bool,
    /// Angle between the new and the existing track, degrees.
    pub angle_deg: f64,
    /// Where, local metres.
    #[serde(skip)]
    pub p: P2,
}

/// Purpose: existing railways in the design's local frame.
pub fn locate(dz: &Design, rails: &[ExistingRail]) -> Vec<ExistingGeo> {
    rails
        .iter()
        .map(|r| {
            let pts: Vec<P2> = r.coords.iter().map(|c| dz.proj.to_xy(c[0], c[1])).collect();
            let bbox = BBox::of(pts.iter().copied());
            ExistingGeo {
                rail: r.clone(),
                pts,
                bbox,
            }
        })
        .collect()
}

/// Purpose: nearest point on a polyline: distance, the point, the unit direction there, and the
/// distance along the polyline.
pub fn nearest_on(pts: &[P2], q: P2) -> Option<(f64, P2, P2, f64)> {
    let mut best: Option<(f64, P2, P2, f64)> = None;
    let mut along = 0.0;
    for w in pts.windows(2) {
        let ab = w[1].sub(w[0]);
        let l2 = ab.dot(ab);
        if l2 > 1e-9 {
            let t = (q.sub(w[0]).dot(ab) / l2).clamp(0.0, 1.0);
            let p = w[0].add(ab.mul(t));
            let d = p.dist(q);
            if best.map_or(true, |b| d < b.0) {
                best = Some((d, p, ab.unit(), along + t * l2.sqrt()));
            }
        }
        along += l2.sqrt();
    }
    best
}

fn polyline_len(pts: &[P2]) -> f64 {
    pts.windows(2).map(|w| w[0].dist(w[1])).sum()
}

/// Purpose: find the free ends of new track that lie on an existing railway (in use or under
/// construction). Used before the checks, so a joined end is not reported as open.
pub fn joins(dz: &Design) -> Vec<Join> {
    let mut out = Vec::new();
    for t in &dz.network.tracks {
        let Some(g) = dz.track(t.id) else {
            continue;
        };
        let ends = [
            (
                0u8,
                matches!(t.start, Anchor::Free { .. }),
                g.centre.first(),
            ),
            (
                1u8,
                matches!(t.end, Some(Anchor::Free { .. })),
                g.centre.last(),
            ),
        ];
        for (end, free, q) in ends {
            let Some(q) = q.filter(|_| free) else {
                continue;
            };
            let mut best: Option<(f64, &ExistingGeo, P2, P2, f64)> = None;
            for e in dz.existing.iter().filter(|e| {
                matches!(e.rail.status.as_str(), "active" | "construction")
                    && e.bbox.overlaps(&BBox::of([q.p]), JOIN_M + 1.0)
            }) {
                if let Some((d, p, dir, along)) = nearest_on(&e.pts, q.p) {
                    if d <= JOIN_M && best.as_ref().map_or(true, |b| d < b.0) {
                        best = Some((d, e, p, dir, along));
                    }
                }
            }
            let Some((_, e, p, dir, along)) = best else {
                continue;
            };
            let len = polyline_len(&e.pts);
            let angle = P2::dir(q.h)
                .cross(dir)
                .abs()
                .atan2(P2::dir(q.h).dot(dir).abs());
            out.push(Join {
                track: t.id,
                end,
                way: e.rail.way,
                name: e.rail.name.clone(),
                kind: e.rail.kind.clone(),
                continues: along <= WAY_END_M || along >= len - WAY_END_M,
                angle_deg: angle.to_degrees(),
                p,
            });
        }
    }
    out
}

/// Purpose: the electrification voltage in a supply system id such as `ocl-25kv-50hz` or
/// `third-rail-750v-dc`, V.
fn system_voltage(id: &str) -> Option<f64> {
    id.split('-').find_map(|part| {
        let p = part.to_ascii_lowercase();
        if let Some(n) = p.strip_suffix("kv") {
            n.parse::<f64>().ok().map(|v| v * 1000.0)
        } else if let Some(n) = p.strip_suffix('v') {
            n.parse::<f64>().ok()
        } else {
            None
        }
    })
}

/// Purpose: check the design against the existing railways: the joins (gauge, railway system,
/// electrification, angle), crossings on the same level, and new track drawn on top of existing
/// track. Side effects: appends to `dz.issues`.
pub fn check(dz: &mut Design) {
    let mut iss: Vec<Issue> = Vec::new();
    // Joins.
    for j in &dz.joins {
        let Some(e) = dz.existing.iter().find(|e| e.rail.way == j.way) else {
            continue;
        };
        let Some(t) = dz.doc_track(j.track) else {
            continue;
        };
        let mode = dz.track_mode(j.track);
        let p = dz.params_for(mode);
        let r = &e.rail;
        let what = r.label();
        let where_ = if j.end == 0 { "start" } else { "end" };
        if !r.gauge_mm.is_empty() && !r.gauge_mm.iter().any(|g| (g - p.gauge_mm).abs() < 1.0) {
            let gauges: Vec<String> = r.gauge_mm.iter().map(|g| format!("{g:.0} mm")).collect();
            iss.push(Issue::error(
                format!(
                    "The track {where_} joins {what}, but its gauge ({:.0} mm) differs from the existing track ({}). Trains cannot run from one to the other: use the existing gauge, dual gauge track, or keep the lines apart.",
                    p.gauge_mm,
                    gauges.join(" and ")
                ),
                Some(j.p),
                j.track,
            ));
        }
        let theirs = r.mode();
        let compatible = theirs == mode
            || matches!(
                (mode, theirs),
                (RailMode::Tram, RailMode::LightRail) | (RailMode::LightRail, RailMode::Tram)
            )
            || (!mode.street_running()
                && mode != RailMode::Metro
                && !theirs.street_running()
                && theirs != RailMode::Metro);
        if !compatible {
            iss.push(Issue::warning(
                format!(
                    "The track {where_} joins {what}, a different railway system ({} track joining {}). Through running needs vehicles built for both, such as tram-trains, and matching platforms and signalling.",
                    p.label,
                    theirs.id().replace('_', " ")
                ),
                Some(j.p),
                j.track,
            ));
        }
        let overhead = dz.overhead(t);
        let third = dz.third_rail(t);
        let theirs_power = r.electrified.as_str();
        let power_differs = match theirs_power {
            "contact_line" => !overhead,
            "rail" | "4th_rail" => !third,
            "no" => overhead || third,
            _ => false,
        };
        let mine_v = system_voltage(&p.electrification);
        let volt_differs = !power_differs
            && (overhead || third)
            && mine_v
                .zip(r.voltage_v)
                .is_some_and(|(a, b)| (a - b).abs() > 1.0);
        if power_differs || volt_differs {
            let theirs_text = match (theirs_power, r.voltage_v) {
                ("no", _) => "not electrified".to_string(),
                (k, Some(v)) => format!(
                    "{} at {}",
                    if k == "contact_line" {
                        "overhead line"
                    } else {
                        "conductor rail"
                    },
                    if v >= 1000.0 {
                        format!("{:.0} kV", v / 1000.0)
                    } else {
                        format!("{v:.0} V")
                    }
                ),
                (k, None) => (if k == "contact_line" {
                    "overhead line"
                } else {
                    "conductor rail"
                })
                .to_string(),
            };
            iss.push(Issue::warning(
                format!(
                    "The track {where_} joins {what}, which is {theirs_text}, unlike this track. Trains running through need to change power system (dual-system or battery vehicles), and the join needs a system separation section."
                ),
                Some(j.p),
                j.track,
            ));
        }
        if j.angle_deg > JOIN_ANGLE_DEG && !j.continues {
            iss.push(Issue::warning(
                format!(
                    "The track {where_} meets {what} at {:.0}°. A turnout leaves the existing track at a few degrees: draw the new track so it runs alongside the existing one where it joins.",
                    j.angle_deg
                ),
                Some(j.p),
                j.track,
            ));
        }
        iss.push(Issue::info(
            if j.continues {
                format!("The track {where_} continues {what}.")
            } else {
                format!(
                    "The track {where_} joins {what}: a new turnout goes into the existing track there."
                )
            },
            Some(j.p),
            Some(j.track),
        ));
    }
    // Crossings and track on top of existing track.
    let joined: Vec<(u32, P2)> = dz.joins.iter().map(|j| (j.track, j.p)).collect();
    for g in &dz.tracks {
        let cp: Vec<P2> = g.centre.iter().map(|q| q.p).collect();
        let tb = BBox::of(cp.iter().copied());
        for e in dz
            .existing
            .iter()
            .filter(|e| e.rail.status == "active" && e.bbox.overlaps(&tb, 5.0))
        {
            let what = e.rail.label();
            let their_level = e.rail.level();
            let mut hits = Vec::new();
            poly_cross(&cp, &e.pts, |h, i, _| hits.push((h, i)));
            let trams = dz.track_mode(g.id).street_running() && e.rail.mode().street_running();
            let mut seen: Vec<P2> = Vec::new();
            for (h, i) in hits {
                let s = g.centre[i].s + (g.centre[i + 1].s - g.centre[i].s) * h.t;
                // A join is not a crossing, and one crossing is reported once.
                if joined
                    .iter()
                    .any(|(t, p)| *t == g.id && p.dist(h.p) < JOIN_M * 4.0)
                    || seen.iter().any(|p| p.dist(h.p) < 20.0)
                    || h.angle.to_degrees() < JOIN_ANGLE_DEG
                {
                    continue;
                }
                seen.push(h.p);
                let mine = g.level_at(s);
                if mine != Some(their_level) && !(mine.is_none() && their_level == Level::Street) {
                    continue;
                }
                let angle = h.angle.to_degrees();
                // Trams cross trams on sight, as at any street junction: a diamond in the
                // existing track, no interlocking.
                iss.push(if trams {
                    Issue::info(
                        format!(
                            "This track crosses {what} on the level, at {angle:.0}°: a diamond crossing goes into the existing track."
                        ),
                        Some(h.p),
                        Some(g.id),
                    )
                } else {
                    Issue::warning(
                        format!(
                            "This track crosses {what} on the same level, at {angle:.0}°. That needs a diamond crossing built into the existing track and an interlocking shared with its operator. Take the new track over or under it."
                        ),
                        Some(h.p),
                        g.id,
                    )
                });
            }
            // On top: samples every 10 m within ON_TOP_M of the existing track, running alongside.
            let step = 10.0;
            let mut run: Option<(f64, f64)> = None;
            let report = |a: f64, b: f64, iss: &mut Vec<Issue>| {
                if b - a >= ON_TOP_MIN_M {
                    iss.push(Issue::warning(
                        format!(
                            "This track lies on top of {what} for {:.0} m. The track is already there: join the existing track instead of drawing it again, or move the new track beside it.",
                            b - a
                        ),
                        Some(at_s(&g.centre, (a + b) / 2.0).p),
                        g.id,
                    ));
                }
            };
            let mut s = 0.0;
            while s <= g.length {
                let q = at_s(&g.centre, s);
                let on = nearest_on(&e.pts, q.p).is_some_and(|(d, _, dir, _)| {
                    d <= ON_TOP_M + g.spacing_at(s) * f64::from(g.ntracks.max(1) - 1) / 2.0
                        && P2::dir(q.h).cross(dir).abs() < (JOIN_ANGLE_DEG.to_radians()).sin()
                }) && g.level_at(s).is_none_or_same(their_level);
                run = match (run, on) {
                    (Some((a, _)), true) => Some((a, s)),
                    (None, true) => Some((s, s)),
                    (Some((a, b)), false) => {
                        report(a, b, &mut iss);
                        None
                    }
                    (None, false) => None,
                };
                s += step;
            }
            if let Some((a, b)) = run {
                report(a, b, &mut iss);
            }
        }
    }
    dz.issues.extend(iss);
}

trait SameLevel {
    fn is_none_or_same(&self, l: Level) -> bool;
}

impl SameLevel for Option<Level> {
    fn is_none_or_same(&self, l: Level) -> bool {
        self.map_or(true, |m| m == l)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::design::build_with_osm;
    use crate::issue::Severity;
    use crate::model::{Bed, Network, Power, Track, TrackUse};
    use crate::proj::LocalTm;

    const ORIGIN: [f64; 2] = [7.0, 50.9];

    /// A straight single track along the x axis from −400 to 400 m.
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

    /// An OSM railway way through the given points (local metres).
    fn osm(way: i64, tags: &[(&str, &str)], pts: &[(f64, f64)]) -> ExistingRail {
        let proj = LocalTm::new(ORIGIN[0], ORIGIN[1]);
        let t: BTreeMap<String, String> = tags
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        let coords = pts
            .iter()
            .map(|(x, y)| proj.to_lonlat(P2 { x: *x, y: *y }))
            .collect();
        rail_from_osm(way, &t, coords).expect("a railway")
    }

    fn texts(dz: &Design, sev: Severity) -> Vec<String> {
        dz.issues
            .iter()
            .filter(|i| i.severity == sev)
            .map(|i| i.text.clone())
            .collect()
    }

    const MAINLINE: [(&str, &str); 5] = [
        ("railway", "rail"),
        ("name", "Rhine Line"),
        ("gauge", "1435"),
        ("electrified", "contact_line"),
        ("voltage", "25000"),
    ];

    #[test]
    fn osm_tags_are_read() {
        let r = osm(
            7,
            &[
                ("railway", "disused"),
                ("disused", "light_rail"),
                ("gauge", "1435;1000"),
                ("bridge", "yes"),
                ("maxspeed", "60"),
            ],
            &[(0.0, 0.0), (10.0, 0.0)],
        );
        assert_eq!(
            (r.kind.as_str(), r.status.as_str()),
            ("light_rail", "disused")
        );
        assert_eq!(r.gauge_mm, vec![1435.0, 1000.0]);
        assert_eq!((r.layer, r.level()), (1, Level::Elevated));
        assert_eq!(r.mode(), RailMode::LightRail);
        let tags: BTreeMap<String, String> =
            [("railway".to_string(), "platform".to_string())].into();
        assert!(rail_from_osm(1, &tags, vec![[0.0, 0.0], [1.0, 1.0]]).is_none());
    }

    #[test]
    fn an_end_continuing_an_existing_line_is_a_join_not_an_open_end() {
        let net = line(RailMode::RegionalRail, Level::Street);
        let plain = build_with_osm(&net, None, &[], &[]);
        assert!(texts(&plain, Severity::Warning)
            .iter()
            .any(|t| t.starts_with("Open track end")));
        let rail = osm(5, &MAINLINE, &[(400.0, 0.0), (900.0, 0.0)]);
        let dz = build_with_osm(&net, None, &[], &[rail]);
        assert_eq!(dz.joins.len(), 1);
        let j = &dz.joins[0];
        assert!(j.continues && j.end == 1 && j.angle_deg < 1.0, "{j:?}");
        let w = texts(&dz, Severity::Warning);
        assert!(!w.iter().any(|t| t.starts_with("Open track end")), "{w:?}");
        assert!(w.iter().any(|t| t.starts_with("Open track start")), "{w:?}");
        assert!(texts(&dz, Severity::Error).is_empty());
        assert!(texts(&dz, Severity::Info)
            .iter()
            .any(|t| t.contains("continues the existing railway Rhine Line")));
    }

    #[test]
    fn a_join_checks_gauge_system_and_power() {
        // A tram line ending on a metre gauge railway with no wires, midway along it.
        let net = line(RailMode::Tram, Level::Street);
        let rail = osm(
            6,
            &[
                ("railway", "narrow_gauge"),
                ("gauge", "1000"),
                ("electrified", "no"),
            ],
            &[(400.0, -300.0), (400.0, 0.0), (420.0, 300.0)],
        );
        let dz = build_with_osm(&net, None, &[], &[rail]);
        assert_eq!(dz.joins.len(), 1);
        assert!(!dz.joins[0].continues);
        let e = texts(&dz, Severity::Error);
        assert!(
            e.iter().any(|t| t.contains("gauge (1435 mm) differs")),
            "{e:?}"
        );
        let w = texts(&dz, Severity::Warning);
        assert!(
            w.iter().any(|t| t.contains("different railway system")),
            "{w:?}"
        );
        assert!(w.iter().any(|t| t.contains("not electrified")), "{w:?}");
        assert!(w.iter().any(|t| t.contains("meets the existing")), "{w:?}");
        assert!(texts(&dz, Severity::Info)
            .iter()
            .any(|t| t.contains("a new turnout goes into the existing track")));
    }

    #[test]
    fn crossing_or_doubling_an_existing_line_is_reported() {
        let net = line(RailMode::RegionalRail, Level::Street);
        let across = osm(8, &MAINLINE, &[(0.0, -200.0), (0.0, 200.0)]);
        let dz = build_with_osm(&net, None, &[], std::slice::from_ref(&across));
        let w = texts(&dz, Severity::Warning);
        assert!(
            w.iter()
                .any(|t| t
                    .contains("crosses the existing railway Rhine Line on the same level, at 90°")),
            "{w:?}"
        );
        // On a viaduct, the crossing is grade-separated.
        let high = build_with_osm(
            &line(RailMode::RegionalRail, Level::Elevated),
            None,
            &[],
            &[across],
        );
        assert!(!texts(&high, Severity::Warning)
            .iter()
            .any(|t| t.contains("crosses the existing")));
        // Trams cross trams on the level as a matter of course.
        let tram = osm(
            10,
            &[("railway", "tram"), ("name", "Ring")],
            &[(0.0, -200.0), (0.0, 200.0)],
        );
        let dz = build_with_osm(&line(RailMode::Tram, Level::Street), None, &[], &[tram]);
        assert!(!texts(&dz, Severity::Warning)
            .iter()
            .any(|t| t.contains("crosses the existing")));
        assert_eq!(
            texts(&dz, Severity::Info)
                .iter()
                .filter(|t| t.contains("crosses the existing tram line Ring on the level, at 90°"))
                .count(),
            1
        );
        // Drawn on top of an existing line.
        let on = osm(9, &MAINLINE, &[(-200.0, 0.5), (200.0, 0.5)]);
        let dz = build_with_osm(&net, None, &[], &[on]);
        let w = texts(&dz, Severity::Warning);
        assert!(
            w.iter()
                .any(|t| t.contains("lies on top of the existing railway Rhine Line for")),
            "{w:?}"
        );
    }
}
