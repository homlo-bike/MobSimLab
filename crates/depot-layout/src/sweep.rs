//! Swept-path check: drive a vehicle body along a path made of straights and one arc, and test that no
//! unit comes closer than the clearance to a parked vehicle or leaves the depot.

use crate::geom::{bbox, boxes_near, inside_margin, line_meet, ring_distance, V2};
use crate::vehicle::{Body, Pose};

/// Step along the path between poses, m.
const STEP: f64 = 0.4;

/// A turn from one straight line onto another with a circular arc (fillet).
#[derive(Debug, Clone, Copy)]
pub struct Turn {
    /// Where the arc starts on the first line.
    pub a: V2,
    /// Where the arc ends on the second line.
    pub b: V2,
    /// Centre of the arc.
    pub centre: V2,
    /// Radius, m.
    pub r: f64,
    /// Heading at the start, rad.
    pub h0: f64,
    /// Signed turn, rad (positive = left).
    pub phi: f64,
}

/// Purpose: the fillet of radius `r` from the line through `p1` heading `d1` onto the line through `p2`
/// heading `d2`. Output: None when the lines are parallel.
pub fn fillet(p1: V2, d1: V2, p2: V2, d2: V2, r: f64) -> Option<Turn> {
    let phi = d1.cross(d2).atan2(d1.dot(d2));
    if phi.abs() < 1e-6 {
        return None;
    }
    let x = line_meet(p1, d1, p2, d2)?;
    let t = r * (phi.abs() / 2.0).tan();
    let a = x.sub(d1.mul(t));
    let b = x.add(d2.mul(t));
    let centre = a.add(d1.perp().mul(r * phi.signum()));
    Some(Turn {
        a,
        b,
        centre,
        r,
        h0: d1.angle(),
        phi,
    })
}

/// A rear-axle path: positions with headings, every [`STEP`] metres.
#[derive(Debug, Clone, Default)]
pub struct Path {
    /// (position, heading) of the first unit's rear axle.
    pub pts: Vec<(V2, f64)>,
    /// Index of the first point of the arc (where the boundary check starts).
    pub arc_from: usize,
    /// Index after the last point of the arc.
    pub arc_to: usize,
}

fn straight(out: &mut Vec<(V2, f64)>, from: V2, to: V2) {
    let d = to.sub(from);
    let l = d.len();
    if l < 1e-9 {
        return;
    }
    let h = d.angle();
    let n = (l / STEP).ceil() as usize;
    for i in 1..=n {
        out.push((from.add(d.mul(i as f64 / n as f64)), h));
    }
}

/// Purpose: a path that drives `lead_in` metres straight onto the turn, round the arc, and on to `end`
/// along the second line.
pub fn turn_path(t: &Turn, lead_in: f64, end: V2) -> Path {
    let d1 = V2::dir(t.h0);
    let start = t.a.sub(d1.mul(lead_in));
    let mut pts = vec![(start, t.h0)];
    straight(&mut pts, start, t.a);
    let arc_from = pts.len();
    let n = ((t.r * t.phi.abs()) / STEP).ceil().max(2.0) as usize;
    let rel = t.a.sub(t.centre);
    for i in 1..=n {
        let a = t.phi * i as f64 / n as f64;
        pts.push((t.centre.add(rel.rot(a)), t.h0 + a));
    }
    let arc_to = pts.len();
    straight(&mut pts, t.b, end);
    Path {
        pts,
        arc_from,
        arc_to,
    }
}

/// What stands in the way of a manoeuvre.
pub struct Scene<'a> {
    /// Parked vehicles and other solid things (rings).
    pub obstacles: Vec<&'a [V2]>,
    /// The depot outline the vehicle must stay inside from the arc on (None: no outline check).
    pub boundary: Option<&'a [V2]>,
    /// Smallest gap to an obstacle or the outline, m.
    pub clearance: f64,
}

/// Why a manoeuvre failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Hit {
    /// A unit comes too close to a parked vehicle or another solid thing.
    Obstacle,
    /// A unit leaves the depot.
    Outside,
}

/// Purpose: drive the body along the path and report the first conflict, or None when it is clear.
/// Inputs: `check_outline_from` / `check_outline_to`: the path indexes between which the outline is
/// checked (the lead-in and lead-out run along aisles that leave the zone).
pub fn sweep(body: &Body, path: &Path, scene: &Scene, outline: (usize, usize)) -> Option<Hit> {
    sweep_with(body, path, scene, outline, |_| {})
}

/// Purpose: like [`sweep`], and hand every pose's unit outlines to `seen` (for drawing the envelope).
pub fn sweep_with(
    body: &Body,
    path: &Path,
    scene: &Scene,
    outline: (usize, usize),
    mut seen: impl FnMut(&[[V2; 4]]),
) -> Option<Hit> {
    let &(p0, h0) = path.pts.first()?;
    let mut pose: Pose = body.straight(p0, h0);
    let boxes: Vec<(V2, V2)> = scene.obstacles.iter().map(|o| bbox(o)).collect();
    let mut first: Option<Hit> = None;
    for (i, &(p, h)) in path.pts.iter().enumerate() {
        body.advance(&mut pose, p, h);
        let units = body.outlines(&pose);
        seen(&units);
        if first.is_some() {
            continue;
        }
        for u in &units {
            let ub = bbox(u);
            for (o, ob) in scene.obstacles.iter().zip(&boxes) {
                if boxes_near(ub, *ob, scene.clearance) && ring_distance(u, o) < scene.clearance {
                    first = Some(Hit::Obstacle);
                    break;
                }
            }
            if first.is_some() {
                break;
            }
            if let Some(b) = scene.boundary {
                if i >= outline.0
                    && i < outline.1
                    && inside_margin(u, b) < scene.clearance.min(0.05)
                {
                    first = Some(Hit::Outside);
                    break;
                }
            }
        }
    }
    first
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geom::rect;
    use crate::vehicle::{body, VehicleSpec};

    #[test]
    fn fillet_is_tangent() {
        let t = fillet(
            V2::new(0., 0.),
            V2::new(1., 0.),
            V2::new(20., -5.),
            V2::new(0., 1.),
            8.0,
        )
        .unwrap();
        assert!(t.a.dist(V2::new(12., 0.)) < 1e-9);
        assert!(t.b.dist(V2::new(20., 8.)) < 1e-9);
        assert!(t.centre.dist(V2::new(12., 8.)) < 1e-9);
        assert!((t.phi - std::f64::consts::FRAC_PI_2).abs() < 1e-9);
    }

    #[test]
    fn a_wall_in_the_way_is_hit() {
        let v = VehicleSpec {
            key: "b".into(),
            name: String::new(),
            length_m: 12.0,
            width_m: 2.55,
            articulations: 0,
            axles_m: None,
            turning_circle_m: None,
        };
        let b = body(&v, 24.0);
        let t = fillet(
            V2::new(0., 0.),
            V2::new(1., 0.),
            V2::new(40., 0.),
            V2::new(0., 1.),
            b.r_min,
        )
        .unwrap();
        let path = turn_path(&t, 15.0, t.b.add(V2::new(0., 10.)));
        let clear = Scene {
            obstacles: vec![],
            boundary: None,
            clearance: 0.3,
        };
        assert_eq!(sweep(&b, &path, &clear, (0, 0)), None);
        let wall = rect(
            V2::new(t.centre.x + 3.0, t.centre.y - 30.0),
            V2::new(0., 1.),
            60.0,
            1.0,
        );
        let blocked = Scene {
            obstacles: vec![&wall],
            boundary: None,
            clearance: 0.3,
        };
        assert_eq!(sweep(&b, &path, &blocked, (0, 0)), Some(Hit::Obstacle));
    }
}
