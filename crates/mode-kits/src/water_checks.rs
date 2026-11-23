//! Route checks of the water route kit (ADR-0036 §6): whether a ferry leg crosses land, passes under a
//! bridge lower than the vessel or one that opens, goes through a lock, or crosses open water shallower than
//! the vessel needs.
//!
//! Land, bridges and locks come from OpenStreetMap: the app fetches the water areas, sea, rivers, bridges and
//! locks around the line and hands them in as [`Surroundings`]. Depth comes from GEBCO (a global grid of about
//! 450 m) and is only asked for on open sea away from the piers, where that grid means something: the kit
//! lists those points ([`depth_points`]), the app fetches their depths and builds again with them. Rivers,
//! lakes and harbours are not checked for depth.

use crate::geo::{self, LonLat, Xy};
use crate::issue::{Issue, Level};
use engine_msg::{msg, Arg};
use serde::{Deserialize, Serialize};

/// Spacing of the samples along a leg for the land check, metres.
const LAND_STEP_M: f64 = 25.0;
/// Land shorter than this along a leg is left out (simplified shorelines, a pier's own quay).
const LAND_MIN_M: f64 = 100.0;
/// Around a pier the leg leaves or reaches the shore, so the land check starts this far out.
const PIER_SHORE_M: f64 = 150.0;
/// A river mapped only as a centre line is taken as this wide on each side, metres.
const RIVER_HALF_WIDTH_M: f64 = 40.0;
/// A leg passes a lock when it comes this close to its gate or chamber, metres.
const LOCK_NEAR_M: f64 = 30.0;
/// Spacing of the depth points along a leg, metres (GEBCO's grid is about 450 m).
const DEPTH_STEP_M: f64 = 250.0;
/// Depth is only asked this far from the leg's piers: harbours and their approaches are left out.
const HARBOUR_M: f64 = 1_000.0;
/// Most depth points asked for one line.
const MAX_DEPTH_POINTS: usize = 400;

/// A bridge from OpenStreetMap.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Bridge {
    #[serde(default)]
    pub name: String,
    /// The bridge's way.
    pub line: Vec<LonLat>,
    /// Height above the water a vessel can pass under (closed, for a bridge that opens), metres; `None` when
    /// OpenStreetMap does not give it.
    #[serde(default)]
    pub clearance_m: Option<f64>,
    /// Whether the bridge opens for vessels.
    #[serde(default)]
    pub movable: bool,
}

/// A lock (its gates or chamber) from OpenStreetMap.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Lock {
    #[serde(default)]
    pub name: String,
    /// The lock's way, or its gate as a single point.
    pub line: Vec<LonLat>,
}

/// The depth at one of the points the kit asked for.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct DepthAt {
    pub lonlat: LonLat,
    /// Metres below sea level (GEBCO); `None` where the grid has no value. Land in the grid is a negative
    /// depth.
    pub depth_m: Option<f64>,
}

/// What lies around the line, for the route checks.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Surroundings {
    /// `[west, south, east, north]` the data covers; the route outside it is not checked.
    pub bbox: [f64; 4],
    /// Lakes, reservoirs and river areas: closed rings, islands as further rings (even-odd).
    #[serde(default)]
    pub areas: Vec<Vec<LonLat>>,
    /// The sea: closed rings, islands as further rings (even-odd).
    #[serde(default)]
    pub sea: Vec<Vec<LonLat>>,
    /// Rivers and canals mapped as centre lines only.
    #[serde(default)]
    pub rivers: Vec<Vec<LonLat>>,
    #[serde(default)]
    pub bridges: Vec<Bridge>,
    #[serde(default)]
    pub locks: Vec<Lock>,
    /// Depths at the points the kit asked for (`WaterView::depth_points`); points without one are not checked.
    #[serde(default)]
    pub depths: Vec<DepthAt>,
}

/// A point on open water whose depth the kit wants.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct DepthPoint {
    /// Index of the leg.
    pub leg: usize,
    pub lonlat: LonLat,
}

/// The vessel's sizes the checks need; absent ones leave their check out.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Sizes {
    pub air_draft_m: Option<f64>,
    pub draught_m: Option<f64>,
    pub under_keel_m: Option<f64>,
}

/// The surroundings in local metres.
struct Local {
    origin: LonLat,
    bbox: [f64; 4],
    areas: Vec<Vec<Xy>>,
    sea: Vec<Vec<Xy>>,
    rivers: Vec<Vec<Xy>>,
}

impl Local {
    fn new(s: &Surroundings, origin: LonLat) -> Self {
        let conv = |rings: &[Vec<LonLat>]| -> Vec<Vec<Xy>> {
            rings
                .iter()
                .map(|r| r.iter().map(|&p| geo::to_local(origin, p)).collect())
                .collect()
        };
        Self {
            origin,
            bbox: s.bbox,
            areas: conv(&s.areas),
            sea: conv(&s.sea),
            rivers: conv(&s.rivers),
        }
    }

    fn in_box(&self, p: Xy) -> bool {
        let [lon, lat] = geo::to_lonlat(self.origin, p);
        let [w, s, e, n] = self.bbox;
        lon >= w && lon <= e && lat >= s && lat <= n
    }

    fn in_sea(&self, p: Xy) -> bool {
        even_odd(p, &self.sea)
    }

    fn on_water(&self, p: Xy) -> bool {
        even_odd(p, &self.areas)
            || self.in_sea(p)
            || self
                .rivers
                .iter()
                .any(|l| dist_to_line(p, l) <= RIVER_HALF_WIDTH_M)
    }
}

/// Purpose: whether `p` lies inside an odd number of the rings (water with its islands cut out).
fn even_odd(p: Xy, rings: &[Vec<Xy>]) -> bool {
    rings.iter().filter(|r| geo::inside(p, r)).count() % 2 == 1
}

/// Purpose: distance from `p` to the segment `a`–`b`.
fn dist_to_segment(p: Xy, a: Xy, b: Xy) -> f64 {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let len2 = dx * dx + dy * dy;
    let t = if len2 > 0.0 {
        (((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2).clamp(0.0, 1.0)
    } else {
        0.0
    };
    geo::dist(p, geo::lerp(a, b, t))
}

/// Purpose: distance from `p` to a polyline (to its point when it has one).
fn dist_to_line(p: Xy, line: &[Xy]) -> f64 {
    match line.len() {
        0 => f64::INFINITY,
        1 => geo::dist(p, line[0]),
        _ => line
            .windows(2)
            .map(|w| dist_to_segment(p, w[0], w[1]))
            .fold(f64::INFINITY, f64::min),
    }
}

/// Purpose: whether segments `a`–`b` and `c`–`d` cross.
fn crosses(a: Xy, b: Xy, c: Xy, d: Xy) -> bool {
    let side = |p: Xy, q: Xy, r: Xy| (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    let (d1, d2) = (side(c, d, a), side(c, d, b));
    let (d3, d4) = (side(a, b, c), side(a, b, d));
    ((d1 > 0.0) != (d2 > 0.0)) && ((d3 > 0.0) != (d4 > 0.0))
}

/// Purpose: whether two polylines cross anywhere.
fn lines_cross(p: &[Xy], q: &[Xy]) -> bool {
    p.windows(2)
        .any(|a| q.windows(2).any(|b| crosses(a[0], a[1], b[0], b[1])))
}

/// Purpose: points every `step` metres along a path, with the distance of each from the start.
fn samples(path: &[Xy], step: f64) -> Vec<(f64, Xy)> {
    let mut out = Vec::new();
    let mut at = 0.0;
    for w in path.windows(2) {
        let len = geo::dist(w[0], w[1]);
        let n = (len / step).ceil().max(1.0) as usize;
        for k in 0..n {
            let t = k as f64 / n as f64;
            out.push((at + len * t, geo::lerp(w[0], w[1], t)));
        }
        at += len;
    }
    if let Some(&last) = path.last() {
        out.push((at, last));
    }
    out
}

fn named(name: &str, unnamed: engine_msg::Msg) -> Arg {
    if name.is_empty() {
        unnamed.into()
    } else {
        Arg::from(name)
    }
}

fn fmt_m(x: f64) -> String {
    if x < 10.0 {
        format!("{:.1} m", x)
    } else {
        format!("{:.0} m", x)
    }
}

/// Purpose: the points on open sea, away from the piers, whose depth the depth check needs.
/// Inputs: the legs' paths (lon/lat), the surroundings, the origin of the local metres.
pub fn depth_points(legs: &[Vec<LonLat>], s: &Surroundings, origin: LonLat) -> Vec<DepthPoint> {
    let loc = Local::new(s, origin);
    let mut out = Vec::new();
    for (i, path) in legs.iter().enumerate() {
        let xy: Vec<Xy> = path.iter().map(|&p| geo::to_local(origin, p)).collect();
        let (Some(&a), Some(&b)) = (xy.first(), xy.last()) else {
            continue;
        };
        for (_, p) in samples(&xy, DEPTH_STEP_M) {
            if out.len() >= MAX_DEPTH_POINTS {
                return out;
            }
            if geo::dist(p, a) < HARBOUR_M || geo::dist(p, b) < HARBOUR_M {
                continue;
            }
            if loc.in_box(p) && loc.in_sea(p) {
                let ll = geo::to_lonlat(origin, p);
                out.push(DepthPoint {
                    leg: i,
                    lonlat: [round6(ll[0]), round6(ll[1])],
                });
            }
        }
    }
    out
}

fn round6(v: f64) -> f64 {
    (v * 1e6).round() / 1e6
}

/// Purpose: the route checks of the legs.
/// Inputs: the legs' paths (lon/lat, first and last point at the piers), the surroundings, the vessel's sizes,
/// the depth points asked for, the origin of the local metres.
/// Output: the findings, each on its leg.
pub fn check(
    legs: &[Vec<LonLat>],
    s: &Surroundings,
    sizes: Sizes,
    asked: &[DepthPoint],
    origin: LonLat,
) -> Vec<Issue> {
    let loc = Local::new(s, origin);
    let local =
        |line: &[LonLat]| -> Vec<Xy> { line.iter().map(|&p| geo::to_local(origin, p)).collect() };
    let bridges: Vec<(&Bridge, Vec<Xy>)> = s.bridges.iter().map(|b| (b, local(&b.line))).collect();
    let locks: Vec<(&Lock, Vec<Xy>)> = s.locks.iter().map(|l| (l, local(&l.line))).collect();
    let has_water = !(s.areas.is_empty() && s.sea.is_empty() && s.rivers.is_empty());
    let mut issues = Vec::new();
    for (i, path) in legs.iter().enumerate() {
        let xy = local(path);
        let (Some(&a), Some(&b)) = (xy.first(), xy.last()) else {
            continue;
        };
        let leg = (i + 1).to_string();

        // Land: the samples outside every water, away from the piers' shores.
        if has_water {
            let mut land = 0.0;
            for (_, p) in samples(&xy, LAND_STEP_M) {
                if geo::dist(p, a) < PIER_SHORE_M || geo::dist(p, b) < PIER_SHORE_M {
                    continue;
                }
                if loc.in_box(p) && !loc.on_water(p) {
                    land += LAND_STEP_M;
                }
            }
            if land >= LAND_MIN_M {
                issues.push(
                    Issue::new(
                        Level::Warning,
                        "route.land",
                        msg!("kits.route.land", leg = leg.clone(), length = fmt_m(land)),
                    )
                    .at_section(i),
                );
            }
        }

        // Bridges the leg passes under.
        for (br, line) in &bridges {
            if !lines_cross(&xy, line) {
                continue;
            }
            let bridge = || named(&br.name, msg!("kits.route.a_bridge"));
            let found = if br.movable {
                Some(Issue::new(
                    Level::Info,
                    "route.bridge_opens",
                    msg!(
                        "kits.route.bridge_opens",
                        leg = leg.clone(),
                        bridge = bridge()
                    ),
                ))
            } else {
                match (br.clearance_m, sizes.air_draft_m) {
                    (Some(c), Some(air)) if c < air => Some(
                        Issue::new(
                            Level::Warning,
                            "route.low_bridge",
                            msg!(
                                "kits.route.low_bridge",
                                leg = leg.clone(),
                                bridge = bridge(),
                                clearance = fmt_m(c),
                                air = fmt_m(air)
                            ),
                        )
                        .param("ferry.air_draft_m"),
                    ),
                    (Some(_), _) => None,
                    (None, _) => Some(Issue::new(
                        Level::Info,
                        "route.bridge_unknown",
                        msg!(
                            "kits.route.bridge_unknown",
                            leg = leg.clone(),
                            bridge = bridge()
                        ),
                    )),
                }
            };
            if let Some(f) = found {
                issues.push(f.at_section(i));
            }
        }

        // Locks the leg goes through.
        for (lk, line) in &locks {
            let near = if line.len() >= 2 {
                lines_cross(&xy, line) || xy.iter().any(|&p| dist_to_line(p, line) <= LOCK_NEAR_M)
            } else {
                line.first()
                    .is_some_and(|&g| dist_to_line(g, &xy) <= LOCK_NEAR_M)
            };
            if near {
                issues.push(
                    Issue::new(
                        Level::Warning,
                        "route.lock",
                        msg!(
                            "kits.route.lock",
                            leg = leg.clone(),
                            lock = named(&lk.name, msg!("kits.route.a_lock"))
                        ),
                    )
                    .at_section(i),
                );
            }
        }
    }
    // A lock mapped as gates gives one finding per gate: keep one per leg and name.
    issues.dedup_by(|x, y| x.code == "route.lock" && x.code == y.code && x.msg == y.msg);

    // Depth on open water: the shallowest point of each leg below what the vessel needs.
    if let (Some(draught), Some(keel)) = (sizes.draught_m, sizes.under_keel_m) {
        let need = draught + keel;
        let key = |p: LonLat| (round6(p[0]).to_bits(), round6(p[1]).to_bits());
        let mut shallowest: Vec<Option<f64>> = vec![None; legs.len()];
        for d in &s.depths {
            let Some(depth) = d.depth_m else { continue };
            let Some(q) = asked.iter().find(|q| key(q.lonlat) == key(d.lonlat)) else {
                continue;
            };
            if q.leg < legs.len() && depth < need {
                let m = &mut shallowest[q.leg];
                *m = Some(m.map_or(depth, |x: f64| x.min(depth)));
            }
        }
        for (i, d) in shallowest.iter().enumerate() {
            if let Some(d) = d {
                issues.push(
                    Issue::new(
                        Level::Warning,
                        "route.shallow",
                        msg!(
                            "kits.route.shallow",
                            leg = (i + 1).to_string(),
                            depth = fmt_m(d.max(0.0)),
                            need = fmt_m(need)
                        ),
                    )
                    .at_section(i)
                    .param("ferry.draught_m"),
                );
            }
        }
    }
    issues
}

#[cfg(test)]
mod tests {
    use super::*;

    const O: LonLat = [10.0, 54.0];

    /// A point `x`, `y` metres east and north of the origin.
    fn ll(x: f64, y: f64) -> LonLat {
        geo::to_lonlat(O, [x, y])
    }

    fn square(x0: f64, y0: f64, x1: f64, y1: f64) -> Vec<LonLat> {
        vec![ll(x0, y0), ll(x1, y0), ll(x1, y1), ll(x0, y1), ll(x0, y0)]
    }

    /// Sea over the whole box with an island from x 2 to 3 km.
    fn sea_with_island() -> Surroundings {
        let w = ll(-5_000.0, -5_000.0);
        let e = ll(15_000.0, 5_000.0);
        Surroundings {
            bbox: [w[0], w[1], e[0], e[1]],
            sea: vec![
                square(-5_000.0, -5_000.0, 15_000.0, 5_000.0),
                square(2_000.0, -500.0, 3_000.0, 500.0),
            ],
            ..Default::default()
        }
    }

    fn codes(v: &[Issue]) -> Vec<&str> {
        v.iter().map(|i| i.code.as_str()).collect()
    }

    #[test]
    fn a_leg_across_an_island_crosses_land() {
        let s = sea_with_island();
        let leg = vec![ll(0.0, 0.0), ll(5_000.0, 0.0)];
        let out = check(&[leg], &s, Sizes::default(), &[], O);
        assert_eq!(codes(&out), vec!["route.land"]);
        assert_eq!(out[0].section, Some(0));
        // Round the island: no land.
        let round = vec![ll(0.0, 0.0), ll(2_500.0, 1_000.0), ll(5_000.0, 0.0)];
        assert!(check(&[round], &s, Sizes::default(), &[], O).is_empty());
    }

    #[test]
    fn a_river_mapped_as_a_line_is_water() {
        let w = ll(-1_000.0, -1_000.0);
        let e = ll(6_000.0, 1_000.0);
        let s = Surroundings {
            bbox: [w[0], w[1], e[0], e[1]],
            rivers: vec![vec![ll(-1_000.0, 10.0), ll(6_000.0, 10.0)]],
            ..Default::default()
        };
        let along = vec![ll(0.0, 0.0), ll(5_000.0, 0.0)];
        assert!(check(&[along], &s, Sizes::default(), &[], O).is_empty());
        let off = vec![ll(0.0, 0.0), ll(2_500.0, 500.0), ll(5_000.0, 0.0)];
        assert_eq!(
            codes(&check(&[off], &s, Sizes::default(), &[], O)),
            vec!["route.land"]
        );
    }

    #[test]
    fn bridges_lower_than_the_vessel_unknown_or_opening() {
        let mut s = sea_with_island();
        s.sea.truncate(1);
        let deck = |x: f64| vec![ll(x, -300.0), ll(x, 300.0)];
        s.bridges = vec![
            Bridge {
                name: "Low".into(),
                line: deck(1_000.0),
                clearance_m: Some(8.0),
                movable: false,
            },
            Bridge {
                name: "High".into(),
                line: deck(2_000.0),
                clearance_m: Some(40.0),
                movable: false,
            },
            Bridge {
                name: String::new(),
                line: deck(3_000.0),
                clearance_m: None,
                movable: false,
            },
            Bridge {
                name: "Bascule".into(),
                line: deck(4_000.0),
                clearance_m: Some(3.0),
                movable: true,
            },
            Bridge {
                name: "Elsewhere".into(),
                line: deck(9_000.0),
                clearance_m: Some(1.0),
                movable: false,
            },
        ];
        let sizes = Sizes {
            air_draft_m: Some(12.0),
            ..Default::default()
        };
        let out = check(&[vec![ll(0.0, 0.0), ll(5_000.0, 0.0)]], &s, sizes, &[], O);
        assert_eq!(
            codes(&out),
            vec![
                "route.low_bridge",
                "route.bridge_unknown",
                "route.bridge_opens"
            ]
        );
        assert!(out[0].message.contains("Low") && out[0].message.contains("8.0 m"));
        assert!(out[1].message.contains("a bridge"));
    }

    #[test]
    fn a_leg_through_a_lock() {
        let mut s = sea_with_island();
        s.sea.truncate(1);
        s.locks = vec![
            Lock {
                name: "Kiel-Holtenau".into(),
                line: vec![ll(1_000.0, 10.0)],
            },
            Lock {
                name: "Far".into(),
                line: vec![ll(1_000.0, 900.0), ll(1_200.0, 900.0)],
            },
        ];
        let out = check(
            &[vec![ll(0.0, 0.0), ll(5_000.0, 0.0)]],
            &s,
            Sizes::default(),
            &[],
            O,
        );
        assert_eq!(codes(&out), vec!["route.lock"]);
        assert!(out[0].message.contains("Kiel-Holtenau"));
    }

    #[test]
    fn depth_is_asked_on_open_sea_away_from_the_piers_only() {
        let mut s = sea_with_island();
        s.sea.truncate(1);
        let leg = vec![ll(0.0, 0.0), ll(5_000.0, 0.0)];
        let pts = depth_points(std::slice::from_ref(&leg), &s, O);
        assert!(!pts.is_empty());
        let a = geo::to_local(O, leg[0]);
        let b = geo::to_local(O, leg[1]);
        for p in &pts {
            let x = geo::to_local(O, p.lonlat);
            assert!(geo::dist(x, a) >= HARBOUR_M - 1.0 && geo::dist(x, b) >= HARBOUR_M - 1.0);
        }
        // A lake is not open sea.
        let lake = Surroundings {
            areas: s.sea.clone(),
            sea: vec![],
            ..s.clone()
        };
        assert!(depth_points(&[leg], &lake, O).is_empty());
    }

    #[test]
    fn shallow_water_needs_the_draught_and_keel_clearance() {
        let mut s = sea_with_island();
        s.sea.truncate(1);
        let leg = vec![ll(0.0, 0.0), ll(5_000.0, 0.0)];
        let pts = depth_points(std::slice::from_ref(&leg), &s, O);
        let sizes = Sizes {
            draught_m: Some(2.5),
            under_keel_m: Some(1.0),
            ..Default::default()
        };
        s.depths = pts
            .iter()
            .enumerate()
            .map(|(k, p)| DepthAt {
                lonlat: p.lonlat,
                depth_m: Some(if k == 1 { 2.0 } else { 20.0 }),
            })
            .collect();
        let out = check(std::slice::from_ref(&leg), &s, sizes, &pts, O);
        assert_eq!(codes(&out), vec!["route.shallow"]);
        assert!(out[0].message.contains("2.0 m") && out[0].message.contains("3.5 m"));
        // Deep enough everywhere: nothing.
        s.depths.iter_mut().for_each(|d| d.depth_m = Some(20.0));
        assert!(check(&[leg], &s, sizes, &pts, O).is_empty());
    }
}
