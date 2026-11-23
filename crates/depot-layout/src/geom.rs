//! Plane geometry in local metres: points, polygons, rectangles and the tests the layout needs
//! (point in polygon, segment crossings, polygon overlap and clearance).

use serde::{Deserialize, Serialize};

/// A point or vector in local metres (x east, y north).
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
pub struct V2 {
    /// East, m.
    pub x: f64,
    /// North, m.
    pub y: f64,
}

#[allow(clippy::should_implement_trait)]
impl V2 {
    /// Purpose: a point from its coordinates.
    pub const fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }
    /// Purpose: the unit vector at `a` radians from the x axis.
    pub fn dir(a: f64) -> Self {
        Self::new(a.cos(), a.sin())
    }
    /// Purpose: sum.
    pub fn add(self, o: V2) -> V2 {
        V2::new(self.x + o.x, self.y + o.y)
    }
    /// Purpose: difference.
    pub fn sub(self, o: V2) -> V2 {
        V2::new(self.x - o.x, self.y - o.y)
    }
    /// Purpose: scaled vector.
    pub fn mul(self, k: f64) -> V2 {
        V2::new(self.x * k, self.y * k)
    }
    /// Purpose: dot product.
    pub fn dot(self, o: V2) -> f64 {
        self.x * o.x + self.y * o.y
    }
    /// Purpose: z of the cross product.
    pub fn cross(self, o: V2) -> f64 {
        self.x * o.y - self.y * o.x
    }
    /// Purpose: length.
    pub fn len(self) -> f64 {
        self.x.hypot(self.y)
    }
    /// Purpose: the vector turned 90° anticlockwise.
    pub fn perp(self) -> V2 {
        V2::new(-self.y, self.x)
    }
    /// Purpose: unit vector in the same direction (zero stays zero).
    pub fn unit(self) -> V2 {
        let l = self.len();
        if l < 1e-12 {
            self
        } else {
            self.mul(1.0 / l)
        }
    }
    /// Purpose: distance to another point.
    pub fn dist(self, o: V2) -> f64 {
        self.sub(o).len()
    }
    /// Purpose: angle from the x axis, rad.
    pub fn angle(self) -> f64 {
        self.y.atan2(self.x)
    }
    /// Purpose: the point turned by `a` radians about the origin.
    pub fn rot(self, a: f64) -> V2 {
        let (s, c) = a.sin_cos();
        V2::new(self.x * c - self.y * s, self.x * s + self.y * c)
    }
}

/// Purpose: the four corners of a rectangle, anticlockwise.
/// Inputs: the middle of its back edge, the unit direction along it, its length and width.
pub fn rect(back_mid: V2, along: V2, length: f64, width: f64) -> [V2; 4] {
    let n = along.perp().mul(width / 2.0);
    let f = along.mul(length);
    [
        back_mid.sub(n),
        back_mid.sub(n).add(f),
        back_mid.add(n).add(f),
        back_mid.add(n),
    ]
}

/// Purpose: signed area of a ring (anticlockwise positive), m².
pub fn signed_area(ring: &[V2]) -> f64 {
    let n = ring.len();
    (0..n)
        .map(|i| ring[i].cross(ring[(i + 1) % n]))
        .sum::<f64>()
        / 2.0
}

/// Purpose: area of a ring, m².
pub fn area(ring: &[V2]) -> f64 {
    signed_area(ring).abs()
}

/// Purpose: centroid of a ring (the mean of its corners when it has no area).
pub fn centroid(ring: &[V2]) -> V2 {
    let a = signed_area(ring);
    let n = ring.len();
    if a.abs() < 1e-9 || n < 3 {
        let s = ring.iter().fold(V2::default(), |s, p| s.add(*p));
        return s.mul(1.0 / n.max(1) as f64);
    }
    let mut c = V2::default();
    for i in 0..n {
        let (p, q) = (ring[i], ring[(i + 1) % n]);
        let k = p.cross(q);
        c = c.add(p.add(q).mul(k));
    }
    c.mul(1.0 / (6.0 * a))
}

/// Purpose: whether a point lies inside a ring (even-odd rule; points on an edge count as inside).
pub fn contains(ring: &[V2], p: V2) -> bool {
    let n = ring.len();
    if n < 3 {
        return false;
    }
    let mut inside = false;
    for i in 0..n {
        let (a, b) = (ring[i], ring[(i + 1) % n]);
        if dist_point_segment(p, a, b) < 1e-7 {
            return true;
        }
        if (a.y > p.y) != (b.y > p.y) {
            let x = a.x + (p.y - a.y) / (b.y - a.y) * (b.x - a.x);
            if p.x < x {
                inside = !inside;
            }
        }
    }
    inside
}

/// Purpose: distance from a point to a segment.
pub fn dist_point_segment(p: V2, a: V2, b: V2) -> f64 {
    let ab = b.sub(a);
    let l2 = ab.dot(ab);
    if l2 < 1e-18 {
        return p.dist(a);
    }
    let t = (p.sub(a).dot(ab) / l2).clamp(0.0, 1.0);
    p.dist(a.add(ab.mul(t)))
}

/// Purpose: whether two segments cross or touch.
pub fn segments_meet(a: V2, b: V2, c: V2, d: V2) -> bool {
    let o = |p: V2, q: V2, r: V2| q.sub(p).cross(r.sub(p));
    let (d1, d2, d3, d4) = (o(c, d, a), o(c, d, b), o(a, b, c), o(a, b, d));
    if ((d1 > 0.0 && d2 < 0.0) || (d1 < 0.0 && d2 > 0.0))
        && ((d3 > 0.0 && d4 < 0.0) || (d3 < 0.0 && d4 > 0.0))
    {
        return true;
    }
    let on = |p: V2, q: V2, r: V2| dist_point_segment(r, p, q) < 1e-9;
    on(c, d, a) || on(c, d, b) || on(a, b, c) || on(a, b, d)
}

/// Purpose: distance between two segments (zero when they meet).
pub fn dist_segments(a: V2, b: V2, c: V2, d: V2) -> f64 {
    if segments_meet(a, b, c, d) {
        return 0.0;
    }
    dist_point_segment(a, c, d)
        .min(dist_point_segment(b, c, d))
        .min(dist_point_segment(c, a, b))
        .min(dist_point_segment(d, a, b))
}

/// Purpose: the point where two infinite lines meet, or None when they are parallel.
/// Inputs: a point and a direction of each line.
pub fn line_meet(p: V2, u: V2, q: V2, v: V2) -> Option<V2> {
    let d = u.cross(v);
    if d.abs() < 1e-12 {
        return None;
    }
    let t = q.sub(p).cross(v) / d;
    Some(p.add(u.mul(t)))
}

/// Purpose: bounding box of points: (min, max).
pub fn bbox(pts: &[V2]) -> (V2, V2) {
    let mut lo = V2::new(f64::INFINITY, f64::INFINITY);
    let mut hi = V2::new(f64::NEG_INFINITY, f64::NEG_INFINITY);
    for p in pts {
        lo = V2::new(lo.x.min(p.x), lo.y.min(p.y));
        hi = V2::new(hi.x.max(p.x), hi.y.max(p.y));
    }
    (lo, hi)
}

/// Purpose: whether two bounding boxes, each grown by `pad`, overlap.
pub fn boxes_near(a: (V2, V2), b: (V2, V2), pad: f64) -> bool {
    a.0.x - pad <= b.1.x && b.0.x - pad <= a.1.x && a.0.y - pad <= b.1.y && b.0.y - pad <= a.1.y
}

/// Purpose: smallest distance between the outlines of two rings, zero when they overlap or one holds
/// the other.
pub fn ring_distance(a: &[V2], b: &[V2]) -> f64 {
    if a.iter().any(|p| contains(b, *p)) || b.iter().any(|p| contains(a, *p)) {
        return 0.0;
    }
    let mut d = f64::INFINITY;
    for i in 0..a.len() {
        let (p, q) = (a[i], a[(i + 1) % a.len()]);
        for j in 0..b.len() {
            d = d.min(dist_segments(p, q, b[j], b[(j + 1) % b.len()]));
            if d == 0.0 {
                return 0.0;
            }
        }
    }
    d
}

/// Purpose: how far a ring stays inside another: the smallest distance from its corners and edges to the
/// outline of `outer`, negative (−1) when any part of it is outside.
pub fn inside_margin(inner: &[V2], outer: &[V2]) -> f64 {
    if !inner.iter().all(|p| contains(outer, *p)) {
        return -1.0;
    }
    let mut d = f64::INFINITY;
    for i in 0..inner.len() {
        let (p, q) = (inner[i], inner[(i + 1) % inner.len()]);
        for j in 0..outer.len() {
            let e = dist_segments(p, q, outer[j], outer[(j + 1) % outer.len()]);
            if e == 0.0 {
                // Touching the outline counts as inside with no margin; crossing it puts a part outside.
                let mid = p.add(q).mul(0.5);
                return if contains(outer, mid) { 0.0 } else { -1.0 };
            }
            d = d.min(e);
        }
    }
    d
}

/// Purpose: the ring with consecutive duplicates and a closing repeat of the first corner removed.
pub fn clean_ring(ring: &[V2]) -> Vec<V2> {
    let mut out: Vec<V2> = Vec::with_capacity(ring.len());
    for p in ring {
        if out.last().is_none_or(|q| q.dist(*p) > 1e-6) {
            out.push(*p);
        }
    }
    while out.len() > 1 && out[0].dist(out[out.len() - 1]) < 1e-6 {
        out.pop();
    }
    out
}

/// Purpose: the interval of the line `p + t·u` inside a ring that holds the parameter `t0`, or None
/// when `p + t0·u` is outside.
pub fn line_span(ring: &[V2], p: V2, u: V2, t0: f64) -> Option<(f64, f64)> {
    let mut ts: Vec<f64> = Vec::new();
    let n = ring.len();
    for i in 0..n {
        let (a, b) = (ring[i], ring[(i + 1) % n]);
        let e = b.sub(a);
        let d = u.cross(e);
        if d.abs() < 1e-12 {
            continue;
        }
        let t = a.sub(p).cross(e) / d;
        let s = a.sub(p).cross(u) / d;
        if (-1e-9..=1.0 + 1e-9).contains(&s) {
            ts.push(t);
        }
    }
    ts.sort_by(f64::total_cmp);
    ts.dedup_by(|a, b| (*a - *b).abs() < 1e-7);
    let lo = ts
        .iter()
        .copied()
        .filter(|t| *t <= t0)
        .fold(f64::NEG_INFINITY, f64::max);
    let hi = ts
        .iter()
        .copied()
        .filter(|t| *t >= t0)
        .fold(f64::INFINITY, f64::min);
    if lo.is_finite() && hi.is_finite() && contains(ring, p.add(u.mul(t0))) {
        Some((lo, hi))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sq(s: f64) -> Vec<V2> {
        vec![
            V2::new(0., 0.),
            V2::new(s, 0.),
            V2::new(s, s),
            V2::new(0., s),
        ]
    }

    #[test]
    fn contains_and_area() {
        let r = sq(10.0);
        assert!(contains(&r, V2::new(5., 5.)));
        assert!(contains(&r, V2::new(0., 5.)));
        assert!(!contains(&r, V2::new(11., 5.)));
        assert!((area(&r) - 100.0).abs() < 1e-9);
        assert!(centroid(&r).dist(V2::new(5., 5.)) < 1e-9);
    }

    #[test]
    fn margins() {
        let outer = sq(10.0);
        let inner = rect(V2::new(5., 2.), V2::new(0., 1.), 4.0, 2.0);
        assert!((inside_margin(&inner, &outer) - 2.0).abs() < 1e-9);
        let out = rect(V2::new(9.5, 2.), V2::new(0., 1.), 4.0, 2.0);
        assert!(inside_margin(&out, &outer) < 0.0);
        let far = rect(V2::new(20., 2.), V2::new(0., 1.), 4.0, 2.0);
        assert!((ring_distance(&far, &outer) - 9.0).abs() < 1e-9);
    }

    #[test]
    fn span_of_a_line() {
        let r = sq(10.0);
        let (lo, hi) = line_span(&r, V2::new(0., 5.), V2::new(1., 0.), 3.0).unwrap();
        assert!(lo.abs() < 1e-9 && (hi - 10.0).abs() < 1e-9);
        assert!(line_span(&r, V2::new(0., 15.), V2::new(1., 0.), 3.0).is_none());
    }
}
