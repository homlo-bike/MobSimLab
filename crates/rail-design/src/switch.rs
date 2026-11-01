//! Catalogue switches placed on a track (ADR-0030 point 5): turnouts, double junctions,
//! crossovers and scissors crossovers, built from a catalogue turnout's real angle, radius and
//! lengths (`assumptions/switches.yaml`, geometry model in `assumptions/README.md`).
//!
//! Each switch is laid out in a local frame at its start: x along the track (in the switch's
//! facing direction), y to the left of the track's drawing direction.

use crate::alignment::{ResolvedAnchor, TrackGeo};
use crate::geom::{at_s, with_headings, Sample, P2};
use crate::model::{Switch, SwitchKind};
use crate::params::{ModeParams, SwitchSpec, TurnoutGeometry};

/// Derived switch geometry.
#[derive(Debug, Clone, PartialEq)]
pub struct SwitchGeo {
    /// Switch id.
    pub id: u32,
    /// Kind.
    pub kind: SwitchKind,
    /// Track it sits on.
    pub track: u32,
    /// Diverging centre lines (the through track is the parent track itself).
    pub paths: Vec<Vec<Sample>>,
    /// Blade tips.
    pub toes: Vec<P2>,
    /// Legs a new track can start from.
    pub anchors: Vec<ResolvedAnchor>,
    /// Chainage range it occupies on its track.
    pub s0: f64,
    /// End of the range.
    pub s1: f64,
    /// Diamond crossings inside the element.
    pub diamonds: Vec<P2>,
    /// The turnout it is built from.
    pub turnout: TurnoutGeometry,
    /// Catalogue id of the turnout.
    pub element: String,
    /// Display name.
    pub label: String,
    /// Built from the catalogue values without changes (false when the track spacing is too
    /// small for the legs to meet).
    pub fits: bool,
}

/// Purpose: diverging centre line of one turnout with its toe at `(x0, y0)`, diverging to side
/// `sg` (+1 left): lead straight, arc, straight leg to `b` past the intersection point.
fn turnout_path(t: &TurnoutGeometry, x0: f64, y0: f64, sg: f64) -> Vec<P2> {
    let mut v = vec![P2::new(x0, y0)];
    if t.lead > 1e-6 {
        v.push(P2::new(x0 + t.lead, y0));
    }
    let n = 24;
    for i in 1..=n {
        let f = t.alpha * i as f64 / n as f64;
        v.push(P2::new(
            x0 + t.lead + t.radius * f.sin(),
            y0 + sg * t.radius * (1.0 - f.cos()),
        ));
    }
    v.push(P2::new(
        x0 + t.a + t.b * t.alpha.cos(),
        y0 + sg * t.b * t.alpha.sin(),
    ));
    v
}

/// Purpose: half of a crossover: from the toe at `(0, −e/2)` up to the middle `(xm, 0)`. When
/// the tracks are too close for the catalogue angle, the curve stops at a smaller angle.
fn crossover_half(t: &TurnoutGeometry, e: f64) -> (Vec<P2>, f64) {
    let need = t.radius * (1.0 - t.alpha.cos());
    let mut v = vec![P2::new(0.0, -e / 2.0)];
    if t.lead > 1e-6 {
        v.push(P2::new(t.lead, -e / 2.0));
    }
    let n = 16;
    if 2.0 * need >= e {
        let a = (1.0 - e / (2.0 * t.radius)).acos();
        for i in 1..=n {
            let f = a * i as f64 / n as f64;
            v.push(P2::new(
                t.lead + t.radius * f.sin(),
                -e / 2.0 + t.radius * (1.0 - f.cos()),
            ));
        }
        // two arcs of radius R turning by `a` rise exactly e: the arc ends in the middle
        let last = *v.last().unwrap();
        return (v, last.x);
    }
    for i in 1..=n {
        let f = t.alpha * i as f64 / n as f64;
        v.push(P2::new(
            t.lead + t.radius * f.sin(),
            -e / 2.0 + t.radius * (1.0 - f.cos()),
        ));
    }
    let xm = t.a + e / 2.0 * t.n;
    v.push(P2::new(xm, 0.0));
    (v, xm)
}

/// Purpose: a whole crossover from `(0, −e/2)` to `(2·xm, e/2)`, point-symmetric about the middle.
fn crossover_path(t: &TurnoutGeometry, e: f64) -> (Vec<P2>, f64) {
    let (half, xm) = crossover_half(t, e);
    let mut v = half.clone();
    let mid = P2::new(xm, 0.0);
    for q in half.iter().rev() {
        let r = mid.mul(2.0).sub(*q);
        if v.last().map_or(true, |l| l.dist(r) > 1e-6) {
            v.push(r);
        }
    }
    (v, 2.0 * xm)
}

/// Purpose: place a switch on its track.
/// Inputs: the switch, its track's geometry, the catalogue turnout, the mode's values.
/// Output: the geometry, or a message when the switch cannot be built there.
pub fn place(
    sw: &Switch,
    parent: &TrackGeo,
    spec: &SwitchSpec,
    p: &ModeParams,
) -> Result<SwitchGeo, String> {
    let t = spec
        .turnout_geometry()
        .ok_or_else(|| format!("{} is not a turnout with complete geometry.", spec.id))?;
    let q = at_s(&parent.centre, sw.s);
    let d = if sw.direction < 0 { -1.0 } else { 1.0 };
    let ux = P2::dir(q.h);
    let uy = ux.left();
    let world = |l: P2| q.p.add(ux.mul(d * l.x)).add(uy.mul(l.y));
    let world_dir = |l: P2| ux.mul(d * l.x).add(uy.mul(l.y));
    let double = parent.ntracks == 2;
    let e = parent.spacing_at(sw.s);
    let side = if sw.side < 0 { -1.0 } else { 1.0 };
    let (ca, sa) = (t.alpha.cos(), t.alpha.sin());
    let mut paths: Vec<Vec<P2>> = Vec::new();
    let mut toes = Vec::new();
    let mut anchors = Vec::new();
    let mut diamonds = Vec::new();
    let mut fits = true;
    match sw.kind {
        SwitchKind::Turnout => {
            // On double track the turnout is on the track of the side it diverges to.
            let y0 = if double { side * e / 2.0 } else { 0.0 };
            let path = turnout_path(&t, 0.0, y0, side);
            toes.push(P2::new(0.0, y0));
            anchors.push((*path.last().unwrap(), P2::new(ca, side * sa), 0.0));
            paths.push(path);
        }
        SwitchKind::DoubleJunction => {
            if !double {
                return Err("A double junction needs a double track.".into());
            }
            // Computed for a branch to the left, then mirrored. The far turnout's leg runs
            // parallel to the near one, one track spacing behind it, and crosses the near track
            // in a diamond at the crossing angle.
            let near = turnout_path(&t, 0.0, e / 2.0, 1.0);
            let xf = e * (t.alpha / 2.0).tan();
            let far = turnout_path(&t, xf, -e / 2.0, 1.0);
            let dv = P2::new(ca, sa);
            let along = |v: P2| v.dot(dv);
            let ip_f = P2::new(xf + t.a, -e / 2.0);
            let clear = ip_f.add(dv.mul((e + p.clearance_marker_m) / sa));
            let (ne, fe) = (*near.last().unwrap(), *far.last().unwrap());
            let a_end = along(clear).max(along(ne)).max(along(fe)) + 1.0;
            let mut near = near;
            let mut far = far;
            near.push(ne.add(dv.mul(a_end - along(ne))));
            far.push(fe.add(dv.mul(a_end - along(fe))));
            let diamond = P2::new(xf + t.a + e * t.n, e / 2.0);
            let m = |v: P2| P2::new(v.x, side * v.y);
            let (n_end, f_end) = (*near.last().unwrap(), *far.last().unwrap());
            toes.push(m(P2::new(0.0, e / 2.0)));
            toes.push(m(P2::new(xf, -e / 2.0)));
            anchors.push((m(n_end.add(f_end).mul(0.5)), P2::new(ca, side * sa), e));
            diamonds.push(m(diamond));
            paths.push(near.into_iter().map(m).collect());
            paths.push(far.into_iter().map(m).collect());
        }
        SwitchKind::Crossover | SwitchKind::Scissors => {
            if !double {
                return Err("Crossovers join the two tracks of a double track.".into());
            }
            let scissors = sw.kind == SwitchKind::Scissors;
            // Catalogue rule: the two turnout legs must meet between the tracks
            // (e·√(n²+1) ≥ b, twice that for a scissors, whose diamond sits in the middle).
            let need = if scissors { 2.0 } else { 1.0 } * t.b;
            fits = e * t.n.hypot(1.0) >= need - 1e-6;
            let (path, lx) = crossover_path(&t, e);
            let flips: &[bool] = if scissors { &[false, true] } else { &[sw.flip] };
            for &f in flips {
                let my = |v: P2| P2::new(v.x, if f { -v.y } else { v.y });
                toes.push(my(P2::new(0.0, -e / 2.0)));
                toes.push(my(P2::new(lx, e / 2.0)));
                paths.push(path.iter().map(|v| my(*v)).collect());
            }
            if scissors {
                diamonds.push(P2::new(lx / 2.0, 0.0));
            }
        }
    }
    let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
    for v in paths.iter().flatten() {
        lo = lo.min(d * v.x);
        hi = hi.max(d * v.x);
    }
    let level = parent.level_at(sw.s);
    let label = match sw.kind {
        SwitchKind::Turnout => spec.label.clone(),
        SwitchKind::DoubleJunction => format!("Double junction with {}", spec.label),
        SwitchKind::Crossover => {
            format!("Crossover with {} at {:.2} m track centres", spec.label, e)
        }
        SwitchKind::Scissors => format!(
            "Scissors crossover with {} at {:.2} m track centres",
            spec.label, e
        ),
    };
    Ok(SwitchGeo {
        id: sw.id,
        kind: sw.kind,
        track: sw.track,
        paths: paths
            .iter()
            .map(|v| with_headings(&v.iter().map(|x| world(*x)).collect::<Vec<_>>()))
            .collect(),
        toes: toes.into_iter().map(world).collect(),
        anchors: anchors
            .into_iter()
            .map(|(pt, dir, spacing)| ResolvedAnchor {
                p: world(pt),
                dir: Some(world_dir(dir).unit()),
                spacing,
                level,
            })
            .collect(),
        s0: sw.s + lo,
        s1: sw.s + hi,
        diamonds: diamonds.into_iter().map(world).collect(),
        turnout: t,
        element: spec.id.clone(),
        label,
        fits,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tg(id: &str) -> TurnoutGeometry {
        crate::params::defaults()
            .switch(id)
            .unwrap()
            .turnout_geometry()
            .unwrap()
    }

    #[test]
    fn turnout_leg_passes_through_the_intersection_point() {
        let t = tg("db-ew-300-1-9");
        let path = turnout_path(&t, 0.0, 0.0, 1.0);
        // the arc end lies on the line from IP = (a, 0) at angle α
        let arc_end = path[path.len() - 2];
        let on_line = (arc_end.x - t.a) * t.alpha.tan();
        assert!(
            (arc_end.y - on_line).abs() < 1e-6,
            "{} vs {}",
            arc_end.y,
            on_line
        );
        let end = *path.last().unwrap();
        assert!((end.dist(P2::new(t.a, 0.0)) - t.b).abs() < 1e-6);
    }

    #[test]
    fn crossover_length_is_2a_plus_e_n() {
        let t = tg("db-ew-190-1-9");
        let (path, lx) = crossover_path(&t, 4.5);
        assert!((lx - 64.944).abs() < 0.01, "{lx}");
        assert!((path.last().unwrap().y - 2.25).abs() < 1e-9);
    }
}
