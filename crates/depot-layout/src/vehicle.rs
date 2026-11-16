//! Vehicle bodies for the swept-path check: rigid and articulated buses as a chain of units, each with a
//! rear axle, moved along a path by the single-track (bicycle) model with trailers following their hitch
//! (ADR-0008, 07-simulation §6).

use crate::geom::{rect, V2};
use serde::{Deserialize, Serialize};

/// A vehicle the depot must hold, as the line tool knows it (catalogue values where it has them).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VehicleSpec {
    /// Catalogue id, or `mode:<mode>` for the mode's typical vehicle.
    pub key: String,
    /// Display name.
    #[serde(default)]
    pub name: String,
    /// Overall length, m.
    pub length_m: f64,
    /// Body width, m (2.55 m when the catalogue has none).
    #[serde(default = "default_width")]
    pub width_m: f64,
    /// Number of articulation joints (0 rigid, 1 articulated, 2 double articulated).
    #[serde(default)]
    pub articulations: u32,
    /// Axle positions from the front, m, when the catalogue has them.
    #[serde(default)]
    pub axles_m: Option<Vec<f64>>,
    /// Kerb-to-kerb turning circle (diameter), m, when the catalogue has it.
    #[serde(default)]
    pub turning_circle_m: Option<f64>,
}

fn default_width() -> f64 {
    2.55
}

/// The body as the kinematic model uses it. Positions are metres from the front of the vehicle.
#[derive(Debug, Clone)]
pub struct Body {
    /// Body width, m.
    pub width: f64,
    /// Overall length, m.
    pub length: f64,
    /// `axles[0]` front axle, `axles[1]` rear axle of the first unit, `axles[k + 1]` axle of unit `k`.
    pub axles: Vec<f64>,
    /// Hitch (joint) between unit `k − 1` and unit `k`, for k = 1..: `hitches[k − 1]`.
    pub hitches: Vec<f64>,
    /// Smallest radius of the first unit's rear-axle path, m.
    pub r_min: f64,
}

/// Purpose: the body of a vehicle, filling what the catalogue lacks with typical proportions.
/// Inputs: the vehicle and the turning circle to use when it has none (`depot.turning_circle_m`).
pub fn body(v: &VehicleSpec, default_turning_circle_m: f64) -> Body {
    let l = v.length_m.max(3.0);
    let w = v.width_m.clamp(1.5, 3.0);
    let n = v.articulations.min(3) as usize;
    let given = v
        .axles_m
        .as_ref()
        .filter(|a| a.len() >= 2 && a.windows(2).all(|p| p[1] > p[0] && p[0] >= 0.0))
        .filter(|a| a.last().is_some_and(|x| *x <= l));
    let axles: Vec<f64> = match given {
        // Rigid with a tandem: the rear axles act together about their middle.
        Some(a) if n == 0 => vec![a[0], a[1..].iter().sum::<f64>() / (a.len() - 1) as f64],
        Some(a) if a.len() == n + 2 => a.clone(),
        _ => {
            let front = (0.22 * l).min(2.7);
            let rear_overhang = if n == 0 {
                (0.27 * l).min(3.3)
            } else {
                (0.15 * l).min(2.6)
            };
            let last = l - rear_overhang;
            (0..n + 2)
                .map(|k| front + (last - front) * k as f64 / (n + 1) as f64)
                .collect()
        }
    };
    let hitches: Vec<f64> = (1..=n)
        .map(|k| axles[k] + (0.3 * (axles[k + 1] - axles[k])).min(1.6))
        .collect();
    let tc = v
        .turning_circle_m
        .filter(|x| x.is_finite() && *x > 5.0)
        .unwrap_or(default_turning_circle_m);
    let ro = tc / 2.0;
    let wb = axles[1];
    let r = if ro > wb + 0.5 {
        (ro * ro - wb * wb).sqrt() - w / 2.0
    } else {
        ro
    };
    Body {
        width: w,
        length: l,
        axles,
        hitches,
        r_min: r.max(w / 2.0 + 1.0),
    }
}

/// Where the units of a vehicle are: the first unit's rear axle and heading, then each trailer's axle
/// and heading.
#[derive(Debug, Clone)]
pub struct Pose {
    /// Axle position of each unit.
    pub axle: Vec<V2>,
    /// Heading of each unit, rad.
    pub heading: Vec<f64>,
}

impl Body {
    /// Purpose: the pose of a vehicle standing straight with its first rear axle at `p`, heading `h`.
    pub fn straight(&self, p: V2, h: f64) -> Pose {
        let d = V2::dir(h);
        let axle = (0..=self.hitches.len())
            .map(|k| p.sub(d.mul(self.axles[k + 1] - self.axles[1])))
            .collect();
        Pose {
            axle,
            heading: vec![h; self.hitches.len() + 1],
        }
    }

    /// Purpose: move the vehicle forward so the first rear axle is at `p` heading `h`; trailers follow
    /// their hitch (tractrix).
    pub fn advance(&self, pose: &mut Pose, p: V2, h: f64) {
        pose.axle[0] = p;
        pose.heading[0] = h;
        for k in 1..pose.axle.len() {
            let prev_axle = pose.axle[k - 1];
            let prev_h = pose.heading[k - 1];
            let hitch = prev_axle.add(V2::dir(prev_h).mul(self.axles[k] - self.hitches[k - 1]));
            let d = self.axles[k + 1] - self.hitches[k - 1];
            let back = hitch.sub(pose.axle[k]).unit();
            pose.axle[k] = hitch.sub(back.mul(d));
            pose.heading[k] = back.angle();
        }
    }

    /// Purpose: the outline of each unit at a pose (rectangles, the joints overlapping a little).
    pub fn outlines(&self, pose: &Pose) -> Vec<[V2; 4]> {
        let n = self.hitches.len();
        (0..=n)
            .map(|k| {
                let front = if k == 0 {
                    0.0
                } else {
                    self.hitches[k - 1] - 0.4
                };
                let back = if k == n {
                    self.length
                } else {
                    self.hitches[k] + 0.4
                };
                let d = V2::dir(pose.heading[k]);
                let ref_s = self.axles[k + 1];
                let back_mid = pose.axle[k].sub(d.mul(back - ref_s));
                rect(back_mid, d, back - front, self.width)
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bus(l: f64, n: u32) -> VehicleSpec {
        VehicleSpec {
            key: "b".into(),
            name: String::new(),
            length_m: l,
            width_m: 2.55,
            articulations: n,
            axles_m: None,
            turning_circle_m: None,
        }
    }

    #[test]
    fn rigid_bus_turns_inside_its_circle() {
        let b = body(&bus(12.0, 0), 24.0);
        // Outer front corner at r_min stays on the 12 m outer radius.
        let wb = b.axles[1];
        let outer = ((b.r_min + b.width / 2.0).powi(2) + wb * wb).sqrt();
        assert!((outer - 12.0).abs() < 1e-9, "{outer}");
        assert!(b.r_min > 5.0 && b.r_min < 10.0);
    }

    #[test]
    fn articulated_outline_spans_the_length() {
        let b = body(&bus(18.0, 1), 24.0);
        let p = b.straight(V2::new(0.0, 0.0), 0.0);
        let o = b.outlines(&p);
        assert_eq!(o.len(), 2);
        let xs: Vec<f64> = o.iter().flatten().map(|v| v.x).collect();
        let span = xs.iter().cloned().fold(f64::MIN, f64::max)
            - xs.iter().cloned().fold(f64::MAX, f64::min);
        assert!((span - 18.0).abs() < 1e-6, "{span}");
    }

    #[test]
    fn trailer_follows_inside_on_a_turn() {
        let b = body(&bus(18.0, 1), 24.0);
        let mut p = b.straight(V2::new(0.0, 0.0), 0.0);
        let r = b.r_min;
        // Quarter circle to the left about (0, r).
        for i in 1..=200 {
            let a = std::f64::consts::FRAC_PI_2 * i as f64 / 200.0;
            let q = V2::new(r * a.sin(), r - r * a.cos());
            b.advance(&mut p, q, a);
        }
        let d_trailer = p.axle[1].dist(V2::new(0.0, r));
        assert!(d_trailer < r, "trailer axle runs inside: {d_trailer} < {r}");
    }
}
