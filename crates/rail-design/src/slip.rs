//! Slips: a diamond crossing with switches that also let trains turn from one track to the other.
//!
//! The planner turns a diamond crossing of two single tracks into a single slip (one turning
//! route) or a double slip (both) from the switches and crossings catalogue
//! (`assumptions/switches.yaml`, elements `single_slip` and `double_slip`). A slip is built at a
//! fixed angle, so the two tracks must cross at the element's crossing ratio and be straight over
//! its length.
//!
//! In a slip, a train coming along one track from behind the crossing can leave on the other
//! track ahead of it: the slip curves link the arms that form an acute angle across the crossing.
//! With the tracks' directions turned the same way, route 0 runs from the first track behind the
//! crossing to the second track ahead of it, and route 1 from the second track behind it to the
//! first track ahead. A single slip has the route its `side` names; a double slip has both.
//!
//! Values come from the catalogue: crossing ratio, a and b lengths, diverging and through speeds.
//! The angle tolerance [`ANGLE_TOL_DEG`] is a drawing tolerance, not a design value.

use crate::design::{CrossingKind, Design};
use crate::geom::{at_s, P2};
use crate::issue::Issue;
use crate::params::{defaults, Element};
use serde::{Deserialize, Serialize};

/// The tracks must cross within this angle of the element's crossing angle, degrees.
pub const ANGLE_TOL_DEG: f64 = 0.5;

/// A slip in a diamond crossing (document element).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Slip {
    /// The design's crossing id (`x{trackA}-{trackB}-{n}`).
    pub crossing: String,
    /// Catalogue element (a `single_slip` or `double_slip`).
    pub element: String,
    /// Single slip: which route it has (0 or 1, see the module notes).
    #[serde(default)]
    pub side: u8,
}

/// One end of a slip route: a track and the side of the crossing.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct SlipEnd {
    /// Track (alignment) id.
    pub track: u32,
    /// `true`: ahead of the crossing (higher chainage on that track); `false`: behind it.
    pub ahead: bool,
}

/// A slip as built.
#[derive(Debug, Clone, PartialEq)]
pub struct SlipGeo {
    /// The crossing id.
    pub crossing: String,
    /// Catalogue element id.
    pub element: String,
    /// `single_slip` or `double_slip`.
    pub kind: Element,
    /// The two tracks.
    pub tracks: [u32; 2],
    /// Chainage of the crossing point on each track, m.
    pub s: [f64; 2],
    /// Length of the slip from its centre to each end along either track, m.
    pub half_length_m: f64,
    /// Turning routes, each from one track to the other.
    pub routes: Vec<(SlipEnd, SlipEnd)>,
    /// Shape of each route's slip curve.
    pub curves: Vec<Vec<P2>>,
    /// Permitted speed on the turning routes, km/h.
    pub diverging_speed_kmh: Option<f64>,
    /// Permitted speed straight through, km/h.
    pub through_speed_kmh: Option<f64>,
    /// Built: the checks passed.
    pub ok: bool,
}

fn cubic(p0: P2, d0: P2, p1: P2, d1: P2, k: f64) -> Vec<P2> {
    let (c0, c1) = (p0.add(d0.mul(k)), p1.sub(d1.mul(k)));
    (0..=16)
        .map(|i| {
            let t = f64::from(i) / 16.0;
            let u = 1.0 - t;
            p0.mul(u * u * u)
                .add(c0.mul(3.0 * u * u * t))
                .add(c1.mul(3.0 * u * t * t))
                .add(p1.mul(t * t * t))
        })
        .collect()
}

/// Purpose: build the planner's slips into their crossings and check them. Side effects: fills
/// `dz.slips`, appends to `dz.issues` and caps the through speed over each slip.
pub fn check(dz: &mut Design) {
    let mut out = Vec::new();
    let mut iss = Vec::new();
    let mut caps: Vec<(u32, (f64, f64, f64))> = Vec::new();
    for slip in &dz.network.slips {
        let first_track = slip
            .crossing
            .trim_start_matches('x')
            .split('-')
            .next()
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(0);
        let Some(c) = dz.crossings.iter().find(|c| c.id == slip.crossing) else {
            iss.push(Issue::warning(
                "A slip lost its crossing: the tracks crossing there changed. Choose the slip again in the crossing list.",
                None,
                first_track,
            ));
            continue;
        };
        let at = Some(c.p);
        let [ta, tb] = c.tracks;
        let fail = |text: String, iss: &mut Vec<Issue>| iss.push(Issue::error(text, at, ta));
        if c.kind != CrossingKind::Diamond {
            fail(
                "A slip needs the two tracks to cross on one level.".into(),
                &mut iss,
            );
            continue;
        }
        let Some(spec) = defaults()
            .switch(&slip.element)
            .filter(|s| matches!(s.element, Element::SingleSlip | Element::DoubleSlip))
        else {
            fail(
                format!("{} is not a slip in the catalogue.", slip.element),
                &mut iss,
            );
            continue;
        };
        let (Some(ga), Some(gb)) = (dz.track(ta), dz.track(tb)) else {
            continue;
        };
        let sa = crate::geom::nearest(&ga.centre, c.p).map_or(0.0, |n| n.s);
        let sb = crate::geom::nearest(&gb.centre, c.p).map_or(0.0, |n| n.s);
        let half = spec
            .length_a_m
            .or(spec.total_length_m.map(|t| t / 2.0))
            .unwrap_or(15.0);
        let mode = dz.track_mode(ta);
        let mut ok = true;
        if ga.ntracks != 1 || gb.ntracks != 1 {
            fail(
                format!("{} joins two single tracks. Where double tracks cross, use a double junction or a crossover instead.", spec.label),
                &mut iss,
            );
            ok = false;
        }
        if dz.track_mode(tb) != mode {
            fail(
                format!(
                    "{} joins tracks of one railway system; here {} crosses {}.",
                    spec.label,
                    dz.track_params(ta).label,
                    dz.track_params(tb).label
                ),
                &mut iss,
            );
            ok = false;
        }
        if let Some(n) = spec.crossing_ratio_n {
            let want = (1.0 / n).atan();
            if (c.angle - want).abs().to_degrees() > ANGLE_TOL_DEG {
                fail(
                    format!(
                        "{} is built for tracks crossing at 1:{n:.0} ({:.1}°). These tracks cross at 1:{:.1} ({:.1}°): change the angle between them.",
                        spec.label,
                        want.to_degrees(),
                        1.0 / c.angle.tan().max(1e-6),
                        c.angle.to_degrees()
                    ),
                    &mut iss,
                );
                ok = false;
            }
        }
        let curved = |g: &crate::alignment::TrackGeo, s: f64| {
            g.curves
                .iter()
                .any(|cv| cv.s1 > s - half && cv.s0 < s + half)
        };
        if curved(ga, sa) || curved(gb, sb) {
            fail(
                format!(
                    "{} needs straight track for {:.0} m each side of the crossing. Move the curves away from it.",
                    spec.label, half
                ),
                &mut iss,
            );
            ok = false;
        }
        if ok && !spec.typical_modes.is_empty() && !spec.typical_modes.contains(&mode) {
            iss.push(Issue::warning(
                format!(
                    "{} is a main line element, not usually built for {} track.",
                    spec.label,
                    dz.track_params(ta).label
                ),
                at,
                ta,
            ));
        }
        // Directions: the second track turned to run the same way as the first.
        let (qa, qb) = (at_s(&ga.centre, sa), at_s(&gb.centre, sb));
        let da = P2::dir(qa.h);
        let flip = if P2::dir(qb.h).dot(da) < 0.0 {
            -1.0
        } else {
            1.0
        };
        let db = P2::dir(qb.h).mul(flip);
        let pa = |k: f64| at_s(&ga.centre, sa + k * half).p;
        let pb = |k: f64| at_s(&gb.centre, sb + flip * k * half).p;
        let all = [
            (
                SlipEnd {
                    track: ta,
                    ahead: false,
                },
                SlipEnd {
                    track: tb,
                    ahead: flip > 0.0,
                },
                cubic(pa(-1.0), da, pb(1.0), db, half * 0.6),
            ),
            (
                SlipEnd {
                    track: tb,
                    ahead: flip < 0.0,
                },
                SlipEnd {
                    track: ta,
                    ahead: true,
                },
                cubic(pb(-1.0), db, pa(1.0), da, half * 0.6),
            ),
        ];
        let chosen: Vec<usize> = if spec.element == Element::DoubleSlip {
            vec![0, 1]
        } else {
            vec![usize::from(slip.side.min(1))]
        };
        let routes = chosen.iter().map(|&i| (all[i].0, all[i].1)).collect();
        let curves = chosen.iter().map(|&i| all[i].2.clone()).collect();
        if ok {
            let what = if spec.element == Element::DoubleSlip {
                "Double slip"
            } else {
                "Single slip"
            };
            iss.push(Issue::info(
                format!(
                    "{what} ({}): trains can also turn between the two tracks here{}.",
                    spec.label,
                    spec.diverging_speed_kmh
                        .map_or(String::new(), |v| format!(" at up to {v:.0} km/h"))
                ),
                at,
                Some(ta),
            ));
            if let Some(v) = spec.through_speed_kmh {
                caps.push((ta, (sa - half, sa + half, v)));
                caps.push((tb, (sb - half, sb + half, v)));
            }
        }
        out.push(SlipGeo {
            crossing: slip.crossing.clone(),
            element: spec.id.clone(),
            kind: spec.element,
            tracks: [ta, tb],
            s: [sa, sb],
            half_length_m: half,
            routes,
            curves,
            diverging_speed_kmh: spec.diverging_speed_kmh,
            through_speed_kmh: spec.through_speed_kmh,
            ok,
        });
    }
    dz.slips = out;
    dz.issues.extend(iss);
    for (track, cap) in caps {
        crate::design::cap_speeds(dz, track, &[cap]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::design::build;
    use crate::issue::Severity;
    use crate::model::{Anchor, Bed, Level, Network, Power, Track, TrackUse};
    use crate::params::RailMode;

    fn straight(id: u32, a: P2, b: P2) -> Track {
        Track {
            id,
            name: String::new(),
            start: Anchor::Free {
                x: a.x,
                y: a.y,
                level: None,
            },
            end: Some(Anchor::Free {
                x: b.x,
                y: b.y,
                level: None,
            }),
            points: vec![],
            tracks: 1,
            level: Level::Street,
            power: Power::Auto,
            usage: TrackUse::Storage,
            bed: Bed::Auto,
            tunnel: Default::default(),
            structure: Default::default(),
            lead_start_m: 30.0,
            lead_end_m: 30.0,
            radius_start_m: None,
            radius_end_m: None,
            directions: vec![],
            mode: None,
        }
    }

    /// Two single tracks crossing at the origin at 1:`n`.
    fn crossing(n: f64) -> Network {
        let mut net = Network::new(RailMode::RegionalRail, [7.0, 50.9]);
        let (c, s) = (n / (1.0 + n * n).sqrt(), 1.0 / (1.0 + n * n).sqrt());
        net.tracks
            .push(straight(1, P2::new(-300.0, 0.0), P2::new(300.0, 0.0)));
        net.tracks.push(straight(
            2,
            P2::new(-300.0 * c, -300.0 * s),
            P2::new(300.0 * c, 300.0 * s),
        ));
        net
    }

    fn with_slip(mut net: Network, element: &str, side: u8) -> Network {
        let id = build(&net, None).crossings[0].id.clone();
        net.slips.push(Slip {
            crossing: id,
            element: element.into(),
            side,
        });
        net
    }

    #[test]
    fn a_double_slip_in_a_1_in_9_diamond_has_two_turning_routes() {
        let dz = build(&with_slip(crossing(9.0), "db-dkw-190-1-9", 0), None);
        assert_eq!(dz.crossings[0].kind, CrossingKind::Diamond);
        let s = &dz.slips[0];
        assert!(s.ok, "{:?}", dz.issues);
        assert_eq!(s.routes.len(), 2);
        assert_eq!(s.diverging_speed_kmh, Some(40.0));
        // Route 0: track 1 behind the crossing to track 2 ahead of it.
        assert_eq!(
            s.routes[0],
            (
                SlipEnd {
                    track: 1,
                    ahead: false
                },
                SlipEnd {
                    track: 2,
                    ahead: true
                }
            )
        );
        assert!(!dz.issues.iter().any(|i| i.severity == Severity::Error));
        // Each slip curve leaves one track at the slip's end and joins the other at its far end,
        // passing close to the crossing point.
        let c0 = &s.curves[0];
        let (first, last) = (c0[0], c0[c0.len() - 1]);
        assert!(
            (first.y).abs() < 0.01 && (first.x + s.half_length_m).abs() < 0.5,
            "{first:?}"
        );
        assert!(
            (last.dist(P2::new(0.0, 0.0)) - s.half_length_m).abs() < 0.5 && last.y > 0.0,
            "{last:?}"
        );
        let mid = c0[c0.len() / 2];
        assert!(mid.dist(P2::new(0.0, 0.0)) < 2.0, "{mid:?}");
        assert!(dz.issues.iter().any(|i| i.text.starts_with("Double slip")));
        // The through speed over the slip is capped.
        let sp = &dz.speeds[&1];
        let at = sp.s.iter().position(|x| (*x - s.s[0]).abs() < 5.0).unwrap();
        assert!(sp.limit[at] <= 100.0, "{}", sp.limit[at]);
    }

    #[test]
    fn a_single_slip_has_the_route_on_its_side() {
        let dz = build(&with_slip(crossing(9.0), "db-ekw-190-1-9", 1), None);
        let s = &dz.slips[0];
        assert!(s.ok);
        assert_eq!(s.routes.len(), 1);
        assert_eq!(s.routes[0].0.track, 2);
        assert_eq!(
            s.routes[0].1,
            SlipEnd {
                track: 1,
                ahead: true
            }
        );
    }

    #[test]
    fn a_slip_needs_the_elements_angle_and_a_real_slip() {
        let dz = build(&with_slip(crossing(6.0), "db-dkw-190-1-9", 0), None);
        assert!(!dz.slips[0].ok);
        assert!(dz.issues.iter().any(|i| i.severity == Severity::Error
            && i.text.contains("built for tracks crossing at 1:9")
            && i.text.contains("1:6.0")));
        let dz = build(&with_slip(crossing(9.0), "db-ew-190-1-9", 0), None);
        assert!(dz
            .issues
            .iter()
            .any(|i| i.text.contains("is not a slip in the catalogue")));
        // A crossing that changed: the slip is reported, not lost silently.
        let mut net = with_slip(crossing(9.0), "db-dkw-190-1-9", 0);
        net.slips[0].crossing = "x1-2-5".into();
        let dz = build(&net, None);
        assert!(dz
            .issues
            .iter()
            .any(|i| i.text.starts_with("A slip lost its crossing")));
    }
}
