//! Track alignments fitted from straights, clothoids and circular arcs (ADR-0030 point 4).
//!
//! The planner gives intersection points (PIs). At every PI the tool fits a symmetric
//! clothoid–arc–clothoid curve of the PI's radius (the mode's recommended radius by default) with
//! transition curves long enough for the curve's cant and cant deficiency, so there are no sharp
//! corners. When two curves do not fit between their PIs both are tightened and the radius check
//! raises an error instead of making a corner. Tracks leave a station or a switch leg straight,
//! along the connection's direction. Level changes between PIs become ramps sized from the
//! maximum gradient and the vertical curve radius (point 3).

use crate::geom::{slice, Sample, P2};
use crate::issue::{fmt_m, Issue};
use crate::model::{Level, Track, TrackUse};
use crate::params::ModeParams;
use std::f64::consts::PI;

/// An anchor resolved to a position.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ResolvedAnchor {
    /// Position.
    pub p: P2,
    /// Direction the track must leave in (pointing away from the station or switch); free
    /// points have none.
    pub dir: Option<P2>,
    /// Track centre distance of a double-track connection (0 for one track).
    pub spacing: f64,
    /// Level at the anchor.
    pub level: Option<Level>,
}

/// What a vertex of the fitted polygon is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VertexKind {
    /// The start anchor.
    Start,
    /// End of the straight lead out of the start anchor.
    LeadStart,
    /// A planner's PI.
    Pi,
    /// Start of the straight lead into the end anchor.
    LeadEnd,
    /// The end anchor.
    End,
}

/// A fitted curve.
#[derive(Debug, Clone, PartialEq)]
pub struct Curve {
    /// Vertex index.
    pub vertex: usize,
    /// Vertex kind.
    pub kind: VertexKind,
    /// PI index for planner's points.
    pub pi: Option<usize>,
    /// Radius after fitting, m.
    pub radius: f64,
    /// Requested radius, m.
    pub nominal_radius: f64,
    /// Transition length at each end, m.
    pub transition: f64,
    /// Chainage where the curve begins, m.
    pub s0: f64,
    /// Chainage where it ends, m.
    pub s1: f64,
    /// Signed deflection, rad (positive left).
    pub deflection: f64,
    /// Permitted speed in the curve, km/h.
    pub speed_kmh: f64,
    /// Applied cant, mm.
    pub cant_mm: f64,
    /// Cant deficiency at that speed, mm.
    pub cant_deficiency_mm: f64,
}

/// A change of level.
#[derive(Debug, Clone, PartialEq)]
pub struct Ramp {
    /// Start chainage.
    pub s0: f64,
    /// End chainage.
    pub s1: f64,
    /// Level at `s0`.
    pub from: Level,
    /// Level at `s1`.
    pub to: Level,
    /// Height difference, m.
    pub dh: f64,
    /// Length needed, m.
    pub length: f64,
}

impl Ramp {
    /// Purpose: drawing order of a ramp: with the tunnel when it goes underground, else with the
    /// viaduct.
    pub fn order(&self) -> u8 {
        if self.from.underground() || self.to.underground() {
            self.from.order().min(self.to.order())
        } else {
            self.from.order().max(self.to.order())
        }
    }
}

/// A stretch of an alignment on one level, or on a ramp.
#[derive(Debug, Clone, PartialEq)]
pub struct Zone {
    /// Start chainage.
    pub s0: f64,
    /// End chainage.
    pub s1: f64,
    /// Level, or None on a ramp.
    pub level: Option<Level>,
    /// Ramp index.
    pub ramp: Option<usize>,
}

/// Derived alignment geometry.
#[derive(Debug, Clone, PartialEq)]
pub struct TrackGeo {
    /// Track id.
    pub id: u32,
    /// Centre line.
    pub centre: Vec<Sample>,
    /// Length, m.
    pub length: f64,
    /// Fitted polygon.
    pub verts: Vec<P2>,
    /// Vertex kinds.
    pub kinds: Vec<VertexKind>,
    /// PI index per vertex.
    pub pi_of: Vec<Option<usize>>,
    /// Level per vertex.
    pub vert_levels: Vec<Level>,
    /// Chainage of each vertex (curve middle).
    pub vert_s: Vec<f64>,
    /// Curves.
    pub curves: Vec<Curve>,
    /// Track lines: one, or left then right for double track. Chainages are the centre line's.
    pub lines: Vec<Vec<Sample>>,
    /// Number of tracks.
    pub ntracks: u8,
    /// Line track centre distance, m.
    pub spacing: f64,
    /// Spacing at the start connection, m.
    pub spacing_start: f64,
    /// Spacing at the end connection, m.
    pub spacing_end: f64,
    /// Length over which the tracks spread to the start connection's spacing, m.
    pub spread_start: f64,
    /// Same at the end, m.
    pub spread_end: f64,
    /// Ramps.
    pub ramps: Vec<Ramp>,
    /// Level zones.
    pub zones: Vec<Zone>,
    /// Start anchor.
    pub start: ResolvedAnchor,
    /// End anchor.
    pub end: Option<ResolvedAnchor>,
    /// Findings of the fitting.
    pub issues: Vec<Issue>,
}

fn blend(u: f64) -> f64 {
    if u >= 1.0 {
        0.0
    } else if u <= 0.0 {
        1.0
    } else {
        (1.0 + (PI * u).cos()) / 2.0
    }
}

impl TrackGeo {
    /// Purpose: track centre distance at a chainage (double track), including the spread to
    /// wider station spacings near the ends.
    pub fn spacing_at(&self, s: f64) -> f64 {
        if self.ntracks < 2 {
            return 0.0;
        }
        let mut e = self.spacing;
        if self.spread_start > 0.0 {
            e += (self.spacing_start - self.spacing) * blend(s / self.spread_start);
        }
        if self.spread_end > 0.0 {
            e += (self.spacing_end - self.spacing) * blend((self.length - s) / self.spread_end);
        }
        e
    }
    /// Purpose: the zone containing chainage `s`.
    pub fn zone_at(&self, s: f64) -> &Zone {
        self.zones
            .iter()
            .find(|z| s >= z.s0 - 1e-6 && s <= z.s1 + 1e-6)
            .unwrap_or_else(|| self.zones.last().expect("at least one zone"))
    }
    /// Purpose: drawing order (0 lowest) at chainage `s`.
    pub fn order_at(&self, s: f64) -> u8 {
        let z = self.zone_at(s);
        match (z.level, z.ramp) {
            (Some(l), _) => l.order(),
            (None, Some(r)) => self.ramps[r].order(),
            _ => Level::Street.order(),
        }
    }
    /// Purpose: level at `s`, None on a ramp.
    pub fn level_at(&self, s: f64) -> Option<Level> {
        self.zone_at(s).level
    }
    /// Purpose: the centre line between two chainages.
    pub fn centre_between(&self, s0: f64, s1: f64) -> Vec<Sample> {
        slice(&self.centre, s0, s1)
    }
}

/// Curve speed, cant and cant deficiency for a radius.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CurveSpeed {
    /// Permitted speed, km/h (multiple of 5).
    pub speed_kmh: f64,
    /// Applied cant, mm.
    pub cant_mm: f64,
    /// Cant deficiency at that speed, mm.
    pub deficiency_mm: f64,
}

/// Purpose: permitted speed in a curve and the cant to apply.
/// v = √((D + I)·R / 11.8) with D, I in mm, R in m, v in km/h, capped at the design speed.
/// The applied cant leaves half the permitted deficiency as margin (so slower trains do not run
/// with excessive cant); embedded street track has no cant.
pub fn curve_speed(radius: f64, p: &ModeParams, embedded: bool) -> CurveSpeed {
    let emax = if embedded { 0.0 } else { p.max_cant_mm };
    let imax = p.max_cant_deficiency_mm;
    let mut v = p
        .design_speed_kmh
        .min(((emax + imax) * radius / 11.8).sqrt());
    if v >= 5.0 {
        v = (v / 5.0).floor() * 5.0;
    }
    let eq = 11.8 * v * v / radius.max(1.0);
    let cant = ((eq - imax / 2.0).clamp(0.0, emax) / 5.0).round() * 5.0;
    CurveSpeed {
        speed_kmh: v,
        cant_mm: cant,
        deficiency_mm: (eq - cant).max(0.0),
    }
}

/// Purpose: transition (clothoid) length for a curve: the longest of
/// speed·cant / rate of change of cant, speed·deficiency / rate of change of deficiency, and
/// cant / cant gradient (EN 13803 approach), rounded up to whole metres.
pub fn transition_length(radius: f64, p: &ModeParams, embedded: bool) -> f64 {
    let c = curve_speed(radius, p, embedded);
    let v = c.speed_kmh / 3.6;
    let l = (v * c.cant_mm / p.cant_change_rate_mm_s)
        .max(v * c.deficiency_mm / p.cant_deficiency_change_rate_mm_s)
        .max(c.cant_mm / p.max_cant_gradient_mm_m);
    l.ceil()
}

struct Template {
    pts: Vec<(f64, f64, f64, f64)>, // x, y, heading, curvature (turning left, unit sign)
    tangent: f64,
    transition: f64,
}

/// Clothoid–arc–clothoid turning left by `d` with radius `r` and transitions `ls`, starting at
/// the origin heading +x.
fn template(r: f64, ls: f64, d: f64) -> Template {
    let mut ls = ls.max(0.0);
    let mut th = ls / (2.0 * r);
    if 2.0 * th > d {
        ls = r * d;
        th = d / 2.0;
    }
    let lc = r * (d - 2.0 * th);
    let tot = 2.0 * ls + lc;
    let n = ((tot / (r / 40.0).clamp(0.25, 4.0)).ceil() as usize).clamp(12, 4000);
    let ds = tot / n as f64;
    let head = |s: f64| {
        if ls > 0.0 && s < ls {
            s * s / (2.0 * ls * r)
        } else if ls == 0.0 || s <= ls + lc {
            th + (s - ls) / r
        } else {
            d - (tot - s) * (tot - s) / (2.0 * ls * r)
        }
    };
    let curv = |s: f64| {
        if ls > 0.0 && s < ls {
            s / (ls * r)
        } else if ls == 0.0 || s <= ls + lc {
            1.0 / r
        } else {
            (tot - s) / (ls * r)
        }
    };
    let mut pts = vec![(0.0, 0.0, 0.0, curv(0.0))];
    let (mut x, mut y) = (0.0, 0.0);
    for i in 1..=n {
        let hm = head((i as f64 - 0.5) * ds);
        x += hm.cos() * ds;
        y += hm.sin() * ds;
        let s = i as f64 * ds;
        pts.push((x, y, head(s), curv(s)));
    }
    Template {
        tangent: x - y / d.tan(),
        pts,
        transition: ls,
    }
}

struct VertexInfo {
    a: P2,
    deflection: f64,
    radius: f64,
    transition: f64,
    tangent: f64,
    k: f64,
}

/// Inputs to fit one alignment.
pub struct FitInput<'a> {
    /// The track.
    pub track: &'a Track,
    /// Resolved start.
    pub start: ResolvedAnchor,
    /// Resolved end, if any.
    pub end: Option<ResolvedAnchor>,
    /// Mode values.
    pub params: &'a ModeParams,
    /// Default radius for storage tracks (the default turnout's radius), m.
    pub storage_radius: f64,
    /// Whether street-level stretches are embedded (no cant).
    pub embedded: bool,
}

/// Purpose: fit the alignment and derive its tracks, levels and ramps.
/// Output: the geometry with the fitting's own findings (radius, sharp turns, ramps).
pub fn fit(inp: &FitInput) -> TrackGeo {
    let (t, p) = (inp.track, inp.params);
    let mut issues = Vec::new();
    let a = inp.start;
    let e_anchor = inp.end;
    let level_of_pi = |i: usize| t.points[i].level.unwrap_or(t.level);
    let first_level = if t.points.is_empty() {
        t.level
    } else {
        level_of_pi(0)
    };
    let last_level = if t.points.is_empty() {
        t.level
    } else {
        level_of_pi(t.points.len() - 1)
    };

    let mut verts = Vec::new();
    let mut radii: Vec<Option<f64>> = Vec::new();
    let mut kinds = Vec::new();
    let mut levels = Vec::new();
    let mut pis = Vec::new();
    let mut push = |v: P2, r: Option<f64>, k: VertexKind, l: Level, pi: Option<usize>| {
        verts.push(v);
        radii.push(r);
        kinds.push(k);
        levels.push(l);
        pis.push(pi);
    };
    push(
        a.p,
        None,
        VertexKind::Start,
        a.level.unwrap_or(t.level),
        None,
    );
    if let Some(d) = a.dir {
        push(
            a.p.add(d.mul(t.lead_start_m.max(1.0))),
            t.radius_start_m,
            VertexKind::LeadStart,
            first_level,
            None,
        );
    }
    for (i, q) in t.points.iter().enumerate() {
        push(
            P2::new(q.x, q.y),
            q.radius_m,
            VertexKind::Pi,
            level_of_pi(i),
            Some(i),
        );
    }
    if let Some(e) = e_anchor {
        if let Some(d) = e.dir {
            push(
                e.p.add(d.mul(t.lead_end_m.max(1.0))),
                t.radius_end_m,
                VertexKind::LeadEnd,
                last_level,
                None,
            );
        }
        push(
            e.p,
            None,
            VertexKind::End,
            e.level.unwrap_or(last_level),
            None,
        );
    }
    // drop coincident vertices
    let mut i = verts.len();
    while i > 1 {
        i -= 1;
        if verts[i].dist(verts[i - 1]) < 0.05 {
            verts.remove(i);
            radii.remove(i);
            kinds.remove(i);
            levels.remove(i);
            pis.remove(i);
        }
    }
    let n = verts.len();
    let storage = t.usage == TrackUse::Storage;
    let mut info: Vec<Option<VertexInfo>> = (0..n).map(|_| None).collect();
    for i in 1..n.saturating_sub(1) {
        let (a0, a1, a2) = (verts[i - 1], verts[i], verts[i + 1]);
        let da = a1.sub(a0).unit();
        let db = a2.sub(a1).unit();
        let d = da.cross(db).atan2(da.dot(db));
        if d.abs() < 1e-5 {
            continue;
        }
        if d.abs() > 2.6 {
            issues.push(Issue::error(
                "Turn too sharp to fit a curve. Move the point or add one more.",
                Some(a1),
                t.id,
            ));
            continue;
        }
        let r = radii[i]
            .unwrap_or(if storage {
                inp.storage_radius
            } else {
                p.recommended_radius_m
            })
            .max(1.0);
        let ls = if storage {
            0.0
        } else {
            transition_length(r, p, inp.embedded)
        };
        let tp = template(r, ls, d.abs());
        info[i] = Some(VertexInfo {
            a: da,
            deflection: d,
            radius: r,
            transition: ls,
            tangent: tp.tangent,
            k: 1.0,
        });
    }
    // Tighten curves whose tangents do not fit between their vertices.
    let seg_len: Vec<f64> = (0..n.saturating_sub(1))
        .map(|j| verts[j + 1].dist(verts[j]))
        .collect();
    for _ in 0..8 {
        for j in 0..seg_len.len() {
            let tl = info[j].as_ref().map_or(0.0, |v| v.tangent * v.k);
            let tr = info[j + 1].as_ref().map_or(0.0, |v| v.tangent * v.k);
            if tl + tr > seg_len[j] {
                let f = seg_len[j] / (tl + tr) * 0.999;
                if let Some(v) = info[j].as_mut() {
                    v.k *= f;
                }
                if let Some(v) = info[j + 1].as_mut() {
                    v.k *= f;
                }
            }
        }
    }
    let total_poly: f64 = seg_len.iter().sum();
    let step = (total_poly / 2500.0).clamp(0.5, 10.0);
    let mut centre: Vec<Sample> = Vec::new();
    let h0 = if n > 1 {
        verts[1].sub(verts[0]).heading()
    } else {
        0.0
    };
    centre.push(Sample {
        p: verts[0],
        h: h0,
        k: 0.0,
        s: 0.0,
    });
    let mut s = 0.0;
    let mut cur = verts[0];
    let straight = |to: P2, centre: &mut Vec<Sample>, s: &mut f64, cur: &mut P2| {
        let len = to.dist(*cur);
        if len < 1e-6 {
            return;
        }
        let h = to.sub(*cur).heading();
        let k = (len / step).ceil().max(1.0) as usize;
        for i in 1..=k {
            let f = i as f64 / k as f64;
            centre.push(Sample {
                p: cur.add(to.sub(*cur).mul(f)),
                h,
                k: 0.0,
                s: *s + len * f,
            });
        }
        *s += len;
        *cur = to;
    };
    let mut curves = Vec::new();
    let mut vert_s = vec![0.0; n];
    for i in 1..n.saturating_sub(1) {
        let Some(v) = info[i].as_ref() else {
            straight(verts[i], &mut centre, &mut s, &mut cur);
            vert_s[i] = s;
            continue;
        };
        let r = v.radius * v.k;
        let tp = template(r, v.transition * v.k, v.deflection.abs());
        let sg = v.deflection.signum();
        let ts = verts[i].sub(v.a.mul(tp.tangent));
        straight(ts, &mut centre, &mut s, &mut cur);
        let ha = v.a.heading();
        let pe = v.a.left();
        let s0 = s;
        for q in tp.pts.iter().skip(1) {
            let pt = ts.add(v.a.mul(q.0)).add(pe.mul(sg * q.1));
            s += pt.dist(cur);
            centre.push(Sample {
                p: pt,
                h: ha + sg * q.2,
                k: sg * q.3,
                s,
            });
            cur = pt;
        }
        vert_s[i] = (s0 + s) / 2.0;
        let cs = curve_speed(r, p, inp.embedded);
        curves.push(Curve {
            vertex: i,
            kind: kinds[i],
            pi: pis[i],
            radius: r,
            nominal_radius: v.radius,
            transition: tp.transition,
            s0,
            s1: s,
            deflection: v.deflection,
            speed_kmh: cs.speed_kmh,
            cant_mm: cs.cant_mm,
            cant_deficiency_mm: cs.deficiency_mm,
        });
        let min_r = if storage {
            inp.storage_radius
        } else {
            p.min_radius_m
        };
        if r < min_r * 0.995 {
            let what = if storage {
                "storage track".to_string()
            } else {
                format!("{} km/h", p.design_speed_kmh)
            };
            let squeezed = if v.k < 0.999 {
                " (not enough room between the points)"
            } else {
                ""
            };
            issues.push(Issue::error(
                format!(
                    "Curve radius {} is below the {} minimum for {what}{squeezed}.",
                    fmt_m(r),
                    fmt_m(min_r)
                ),
                Some(verts[i]),
                t.id,
            ));
        } else if !storage && r < p.recommended_radius_m * 0.995 {
            issues.push(Issue::warning(
                format!(
                    "Curve radius {} is below the recommended {}; trains slow to {} km/h here.",
                    fmt_m(r),
                    fmt_m(p.recommended_radius_m),
                    cs.speed_kmh
                ),
                Some(verts[i]),
                t.id,
            ));
        }
    }
    if n > 1 {
        straight(verts[n - 1], &mut centre, &mut s, &mut cur);
    }
    let length = s;
    if n > 0 {
        vert_s[n - 1] = length;
    }

    // Double track: line spacing, spreading to the wider spacing of station tracks.
    let ntracks = t.tracks.clamp(1, 2);
    let e = p.track_centre_m;
    let e_s = if ntracks == 2 && a.spacing > 0.0 {
        a.spacing
    } else {
        e
    };
    let e_e = match e_anchor {
        Some(x) if ntracks == 2 && x.spacing > 0.0 => x.spacing,
        _ => e,
    };
    let r_spread = p.min_radius_m.max(150.0);
    let spread = |de: f64| {
        if de.abs() > 0.01 {
            2.0 * (r_spread * de.abs() / 2.0).sqrt()
        } else {
            0.0
        }
    };

    // Level changes: a ramp sits against the deeper (or higher) end.
    let g = p.max_gradient().max(1e-4);
    let mut ramps: Vec<(Ramp, usize, P2)> = Vec::new();
    for i in 1..n {
        if levels[i - 1] == levels[i] {
            continue;
        }
        let (h0, h1) = (levels[i - 1].height_m(p), levels[i].height_m(p));
        let dh = (h1 - h0).abs();
        let len = dh / g + p.vertical_radius_m * g;
        let deep_prev = h0.abs() >= h1.abs();
        let (s0, s1) = if deep_prev {
            (vert_s[i - 1], vert_s[i - 1] + len)
        } else {
            (vert_s[i] - len, vert_s[i])
        };
        let at = verts[if deep_prev { i - 1 } else { i }];
        if s0 < -0.5 || s1 > length + 0.5 {
            issues.push(Issue::error(
                format!(
                    "Not enough length to go from {} to {}: the ramp needs {} at {:.1} ‰ with {} vertical curves.",
                    levels[i - 1].label(),
                    levels[i].label(),
                    fmt_m(len),
                    p.max_gradient_permille,
                    fmt_m(p.vertical_radius_m)
                ),
                Some(at),
                t.id,
            ));
        }
        ramps.push((
            Ramp {
                s0: s0.clamp(0.0, length),
                s1: s1.clamp(0.0, length),
                from: levels[i - 1],
                to: levels[i],
                dh,
                length: len,
            },
            i,
            at,
        ));
    }
    ramps.sort_by(|x, y| x.0.s0.total_cmp(&y.0.s0));
    for w in ramps.windows(2) {
        if w[1].0.s0 < w[0].0.s1 - 0.5 {
            issues.push(Issue::error(
                format!(
                    "Two level changes overlap (ramps of {} and {}). Move the points further apart.",
                    fmt_m(w[0].0.length),
                    fmt_m(w[1].0.length)
                ),
                Some(w[1].2),
                t.id,
            ));
        }
    }
    let flat_level = |x: f64| -> Level {
        for j in 0..n.saturating_sub(1) {
            if x >= vert_s[j] - 1e-6 && x <= vert_s[j + 1] + 1e-6 {
                if levels[j] == levels[j + 1] {
                    return levels[j];
                }
                return match ramps.iter().find(|r| r.1 == j + 1) {
                    Some(r) if x < r.0.s0 => levels[j],
                    _ => levels[j + 1],
                };
            }
        }
        *levels.last().unwrap_or(&t.level)
    };
    let mut bounds = vec![0.0, length];
    for r in &ramps {
        bounds.push(r.0.s0);
        bounds.push(r.0.s1);
    }
    bounds.sort_by(f64::total_cmp);
    let mut zones: Vec<Zone> = Vec::new();
    for w in bounds.windows(2) {
        let (z0, z1) = (w[0], w[1]);
        if z1 - z0 < 0.01 {
            continue;
        }
        let mid = (z0 + z1) / 2.0;
        let ramp = ramps.iter().position(|r| mid > r.0.s0 && mid < r.0.s1);
        let z = Zone {
            s0: z0,
            s1: z1,
            level: if ramp.is_some() {
                None
            } else {
                Some(flat_level(mid))
            },
            ramp,
        };
        match zones.last_mut() {
            Some(l) if l.level.is_some() && l.level == z.level => l.s1 = z1,
            Some(l) if l.ramp.is_some() && l.ramp == z.ramp => l.s1 = z1,
            _ => zones.push(z),
        }
    }
    if zones.is_empty() {
        zones.push(Zone {
            s0: 0.0,
            s1: length,
            level: Some(levels.first().copied().unwrap_or(t.level)),
            ramp: None,
        });
    }

    let mut geo = TrackGeo {
        id: t.id,
        centre,
        length,
        verts,
        kinds,
        pi_of: pis,
        vert_levels: levels,
        vert_s,
        curves,
        lines: vec![],
        ntracks,
        spacing: e,
        spacing_start: e_s,
        spacing_end: e_e,
        spread_start: spread(e_s - e),
        spread_end: spread(e_e - e),
        ramps: ramps.into_iter().map(|r| r.0).collect(),
        zones,
        start: a,
        end: e_anchor,
        issues,
    };
    geo.lines = if ntracks == 2 {
        [1.0, -1.0]
            .iter()
            .map(|sg| {
                geo.centre
                    .iter()
                    .map(|q| Sample {
                        p: q.offset(sg * geo.spacing_at(q.s) / 2.0),
                        ..*q
                    })
                    .collect()
            })
            .collect()
    } else {
        vec![geo.centre.clone()]
    };
    geo
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Anchor, Bed, Pi, Power};
    use crate::params::{defaults, RailMode};

    fn track(points: Vec<Pi>, ntracks: u8) -> Track {
        Track {
            id: 7,
            name: String::new(),
            start: Anchor::Free {
                x: 0.0,
                y: 0.0,
                level: None,
            },
            end: Some(Anchor::Free {
                x: 2000.0,
                y: 0.0,
                level: None,
            }),
            points,
            tracks: ntracks,
            level: Level::Street,
            power: Power::Auto,
            usage: TrackUse::Running,
            bed: Bed::Auto,
            lead_start_m: 30.0,
            lead_end_m: 30.0,
            radius_start_m: None,
            radius_end_m: None,
            directions: vec![],
        }
    }

    fn free(x: f64, y: f64) -> ResolvedAnchor {
        ResolvedAnchor {
            p: P2::new(x, y),
            dir: None,
            spacing: 0.0,
            level: None,
        }
    }

    fn fit_metro(t: &Track, end: P2) -> TrackGeo {
        let p = defaults().mode(RailMode::Metro);
        fit(&FitInput {
            track: t,
            start: free(0.0, 0.0),
            end: Some(free(end.x, end.y)),
            params: p,
            storage_radius: 190.0,
            embedded: false,
        })
    }

    #[test]
    fn curve_has_no_corner_and_meets_the_radius() {
        let pi = Pi {
            x: 1000.0,
            y: 0.0,
            radius_m: None,
            level: None,
        };
        let t = track(vec![pi], 1);
        let g = fit_metro(&t, P2::new(1000.0, 1000.0));
        assert_eq!(g.curves.len(), 1);
        let c = &g.curves[0];
        let p = defaults().mode(RailMode::Metro);
        assert!((c.radius - p.recommended_radius_m).abs() < 1e-6);
        assert!(c.transition > 0.0);
        // heading changes smoothly: no step bigger than the sampling allows
        for w in g.centre.windows(2) {
            let dh = crate::geom::wrap(w[1].h - w[0].h).abs();
            let ds = w[1].s - w[0].s;
            assert!(dh <= ds / c.radius * 1.01 + 1e-9, "corner at s={}", w[0].s);
        }
        // ends where it should
        let last = g.centre.last().unwrap();
        assert!(last.p.dist(P2::new(1000.0, 1000.0)) < 1e-6);
        assert!(g.issues.is_empty(), "{:?}", g.issues);
    }

    #[test]
    fn tight_points_shrink_the_radius_and_raise_an_error() {
        let pis = vec![
            Pi {
                x: 100.0,
                y: 0.0,
                radius_m: None,
                level: None,
            },
            Pi {
                x: 120.0,
                y: 100.0,
                radius_m: None,
                level: None,
            },
        ];
        let t = track(pis, 1);
        let g = fit_metro(&t, P2::new(0.0, 120.0));
        assert!(g.issues.iter().any(|i| i.text.contains("below the")));
    }

    #[test]
    fn level_change_makes_a_ramp_of_the_right_length() {
        let pis = vec![Pi {
            x: 1000.0,
            y: 0.0,
            radius_m: None,
            level: Some(Level::Underground),
        }];
        let t = track(pis, 2);
        let g = fit_metro(&t, P2::new(2000.0, 0.0));
        assert_eq!(g.ramps.len(), 1);
        assert_eq!(g.zones.len(), 3);
        let p = defaults().mode(RailMode::Metro);
        let want =
            p.underground_level_depth_m / p.max_gradient() + p.vertical_radius_m * p.max_gradient();
        assert!((g.ramps[0].length - want).abs() < 1e-6);
        assert_eq!(g.lines.len(), 2);
        let mid = crate::geom::at_s(&g.lines[0], 500.0).p;
        assert!((mid.y - p.track_centre_m / 2.0).abs() < 1e-6);
    }

    #[test]
    fn tram_curve_speed_follows_cant_and_deficiency() {
        let p = defaults().mode(RailMode::Tram);
        let c = curve_speed(50.0, p, true);
        // no cant when embedded: v = sqrt(I·R/11.8)
        let want = ((p.max_cant_deficiency_mm * 50.0 / 11.8).sqrt() / 5.0).floor() * 5.0;
        assert_eq!(c.speed_kmh, want);
        assert_eq!(c.cant_mm, 0.0);
    }
}
