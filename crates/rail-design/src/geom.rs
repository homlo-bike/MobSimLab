//! Planar geometry in the project's local metric frame (x east, y north, metres).
//!
//! Headings are angles from +x, counter-clockwise, in radians. "Left" is the left side looking
//! along the heading; offsets to the left are positive.

use serde::{Deserialize, Serialize};
use std::f64::consts::PI;

/// A point or vector in metres.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct P2 {
    /// East, metres.
    pub x: f64,
    /// North, metres.
    pub y: f64,
}

// Named methods rather than operator traits keep long geometry expressions readable as chains.
#[allow(clippy::should_implement_trait)]
impl P2 {
    /// Purpose: build a point.
    pub const fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }
    /// Purpose: unit vector for a heading.
    pub fn dir(h: f64) -> Self {
        Self::new(h.cos(), h.sin())
    }
    /// Purpose: vector sum.
    pub fn add(self, o: P2) -> P2 {
        P2::new(self.x + o.x, self.y + o.y)
    }
    /// Purpose: vector difference.
    pub fn sub(self, o: P2) -> P2 {
        P2::new(self.x - o.x, self.y - o.y)
    }
    /// Purpose: scale by `k`.
    pub fn mul(self, k: f64) -> P2 {
        P2::new(self.x * k, self.y * k)
    }
    /// Purpose: dot product.
    pub fn dot(self, o: P2) -> f64 {
        self.x * o.x + self.y * o.y
    }
    /// Purpose: z component of the cross product (positive when `o` is to the left of `self`).
    pub fn cross(self, o: P2) -> f64 {
        self.x * o.y - self.y * o.x
    }
    /// Purpose: length.
    pub fn len(self) -> f64 {
        self.x.hypot(self.y)
    }
    /// Purpose: distance to another point.
    pub fn dist(self, o: P2) -> f64 {
        self.sub(o).len()
    }
    /// Purpose: unit vector in the same direction (zero stays zero).
    pub fn unit(self) -> P2 {
        let l = self.len();
        if l > 0.0 {
            self.mul(1.0 / l)
        } else {
            self
        }
    }
    /// Purpose: the vector turned 90° to the left.
    pub fn left(self) -> P2 {
        P2::new(-self.y, self.x)
    }
    /// Purpose: heading of this vector.
    pub fn heading(self) -> f64 {
        self.y.atan2(self.x)
    }
}

/// A point on a centre line with heading, signed curvature and chainage.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct Sample {
    /// Position.
    pub p: P2,
    /// Heading in radians.
    pub h: f64,
    /// Signed curvature 1/R in 1/m (positive turning left).
    pub k: f64,
    /// Chainage along the centre line in metres.
    pub s: f64,
}

impl Sample {
    /// Purpose: the point `o` metres to the left (negative: right).
    pub fn offset(&self, o: f64) -> P2 {
        self.p.add(P2::dir(self.h).left().mul(o))
    }
}

/// Purpose: wrap an angle into (−π, π].
pub fn wrap(a: f64) -> f64 {
    let mut a = a % (2.0 * PI);
    if a > PI {
        a -= 2.0 * PI;
    }
    if a <= -PI {
        a += 2.0 * PI;
    }
    a
}

/// Purpose: index of the last sample with chainage ≤ `s` (binary search on sorted chainages).
pub fn index_at(samples: &[Sample], s: f64) -> usize {
    if samples.is_empty() {
        return 0;
    }
    let i = samples.partition_point(|q| q.s <= s);
    i.saturating_sub(1).min(samples.len() - 1)
}

/// Purpose: interpolated sample at chainage `s` (clamped to the line).
pub fn at_s(samples: &[Sample], s: f64) -> Sample {
    let n = samples.len();
    if n == 0 {
        return Sample::default();
    }
    if n == 1 || s <= samples[0].s {
        return samples[0];
    }
    if s >= samples[n - 1].s {
        return samples[n - 1];
    }
    let i = index_at(samples, s);
    let (a, b) = (samples[i], samples[(i + 1).min(n - 1)]);
    let l = b.s - a.s;
    let t = if l > 0.0 { (s - a.s) / l } else { 0.0 };
    Sample {
        p: a.p.add(b.p.sub(a.p).mul(t)),
        h: a.h + wrap(b.h - a.h) * t,
        k: a.k + (b.k - a.k) * t,
        s,
    }
}

/// Purpose: the part of a line between chainages `s0` and `s1`, with interpolated ends.
pub fn slice(samples: &[Sample], s0: f64, s1: f64) -> Vec<Sample> {
    if samples.is_empty() || s1 < s0 {
        return vec![];
    }
    let mut out = vec![at_s(samples, s0)];
    out.extend(
        samples
            .iter()
            .filter(|q| q.s > s0 + 1e-6 && q.s < s1 - 1e-6)
            .copied(),
    );
    out.push(at_s(samples, s1));
    out
}

/// Result of the nearest-point search on a polyline.
#[derive(Debug, Clone, Copy)]
pub struct Nearest {
    /// Distance in metres.
    pub d: f64,
    /// Chainage of the nearest point.
    pub s: f64,
    /// Segment index.
    pub i: usize,
    /// The nearest point.
    pub p: P2,
    /// Signed lateral offset (positive left of the line).
    pub side: f64,
}

/// Purpose: nearest point of `samples` to `q`.
pub fn nearest(samples: &[Sample], q: P2) -> Option<Nearest> {
    let mut best: Option<Nearest> = None;
    for i in 0..samples.len().saturating_sub(1) {
        let (a, b) = (samples[i], samples[i + 1]);
        let ab = b.p.sub(a.p);
        let l2 = ab.dot(ab);
        let t = if l2 > 0.0 {
            (q.sub(a.p).dot(ab) / l2).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let p = a.p.add(ab.mul(t));
        let d = q.dist(p);
        if best.map_or(true, |b| d < b.d) {
            best = Some(Nearest {
                d,
                s: a.s + (b.s - a.s) * t,
                i,
                p,
                side: ab.cross(q.sub(a.p)).signum() * d,
            });
        }
    }
    if best.is_none() && samples.len() == 1 {
        let a = samples[0];
        best = Some(Nearest {
            d: q.dist(a.p),
            s: a.s,
            i: 0,
            p: a.p,
            side: 0.0,
        });
    }
    best
}

/// Intersection of two segments.
#[derive(Debug, Clone, Copy)]
pub struct Hit {
    /// Crossing point.
    pub p: P2,
    /// Position on the first segment, 0..1.
    pub t: f64,
    /// Position on the second segment, 0..1.
    pub u: f64,
    /// Crossing angle between the segments, 0..π/2.
    pub angle: f64,
}

/// Purpose: intersection of segments `p1→p2` and `q1→q2`, if they cross.
pub fn seg_cross(p1: P2, p2: P2, q1: P2, q2: P2) -> Option<Hit> {
    let r = p2.sub(p1);
    let s = q2.sub(q1);
    let den = r.cross(s);
    if den.abs() < 1e-12 {
        return None;
    }
    let qp = q1.sub(p1);
    let t = qp.cross(s) / den;
    let u = qp.cross(r) / den;
    if !(0.0..=1.0).contains(&t) || !(0.0..=1.0).contains(&u) {
        return None;
    }
    let mut angle = den.atan2(r.dot(s)).abs();
    if angle > PI / 2.0 {
        angle = PI - angle;
    }
    Some(Hit {
        p: p1.add(r.mul(t)),
        t,
        u,
        angle,
    })
}

/// Purpose: call `f(hit, i, j)` for every crossing between polylines `a` and `b`
/// (`i`, `j` are the segment indices).
pub fn poly_cross(a: &[P2], b: &[P2], mut f: impl FnMut(Hit, usize, usize)) {
    for i in 0..a.len().saturating_sub(1) {
        let (p1, p2) = (a[i], a[i + 1]);
        let (x0, x1) = (p1.x.min(p2.x), p1.x.max(p2.x));
        let (y0, y1) = (p1.y.min(p2.y), p1.y.max(p2.y));
        for j in 0..b.len().saturating_sub(1) {
            let (q1, q2) = (b[j], b[j + 1]);
            if q1.x.max(q2.x) < x0
                || q1.x.min(q2.x) > x1
                || q1.y.max(q2.y) < y0
                || q1.y.min(q2.y) > y1
            {
                continue;
            }
            if let Some(h) = seg_cross(p1, p2, q1, q2) {
                f(h, i, j);
            }
        }
    }
}

/// Axis-aligned bounding box.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BBox {
    /// Minimum corner.
    pub min: P2,
    /// Maximum corner.
    pub max: P2,
}

impl BBox {
    /// Purpose: bounding box of points (empty input gives an inverted box).
    pub fn of(pts: impl IntoIterator<Item = P2>) -> BBox {
        let mut b = BBox {
            min: P2::new(f64::INFINITY, f64::INFINITY),
            max: P2::new(f64::NEG_INFINITY, f64::NEG_INFINITY),
        };
        for p in pts {
            b.min.x = b.min.x.min(p.x);
            b.min.y = b.min.y.min(p.y);
            b.max.x = b.max.x.max(p.x);
            b.max.y = b.max.y.max(p.y);
        }
        b
    }
    /// Purpose: whether two boxes, grown by `pad`, overlap.
    pub fn overlaps(&self, o: &BBox, pad: f64) -> bool {
        !(self.max.x + pad < o.min.x
            || o.max.x + pad < self.min.x
            || self.max.y + pad < o.min.y
            || o.max.y + pad < self.min.y)
    }
}

/// Purpose: fill in headings of a polyline from its neighbours and chainages from its lengths.
pub fn with_headings(pts: &[P2]) -> Vec<Sample> {
    let n = pts.len();
    let mut s = 0.0;
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        if i > 0 {
            s += pts[i].dist(pts[i - 1]);
        }
        let a = pts[i.saturating_sub(1)];
        let b = pts[(i + 1).min(n - 1)];
        out.push(Sample {
            p: pts[i],
            h: b.sub(a).heading(),
            k: 0.0,
            s,
        });
    }
    out
}

/// Uniform grid over polylines for "what is near this point" queries.
pub struct Grid<'a> {
    cell: f64,
    cells: std::collections::HashMap<(i64, i64), Vec<(usize, usize)>>,
    lines: Vec<(u32, &'a [Sample])>,
}

impl<'a> Grid<'a> {
    /// Purpose: an empty grid with square cells of `cell` metres.
    pub fn new(cell: f64) -> Self {
        Self {
            cell,
            cells: Default::default(),
            lines: vec![],
        }
    }
    fn key(&self, p: P2) -> (i64, i64) {
        (
            (p.x / self.cell).floor() as i64,
            (p.y / self.cell).floor() as i64,
        )
    }
    /// Purpose: add a polyline belonging to `owner`.
    pub fn add(&mut self, owner: u32, line: &'a [Sample]) {
        let li = self.lines.len();
        self.lines.push((owner, line));
        for i in 0..line.len().saturating_sub(1) {
            let (a, b) = (self.key(line[i].p), self.key(line[i + 1].p));
            for x in a.0.min(b.0)..=a.0.max(b.0) {
                for y in a.1.min(b.1)..=a.1.max(b.1) {
                    self.cells.entry((x, y)).or_default().push((li, i));
                }
            }
        }
    }
    /// Purpose: call `f(owner, distance, chainage)` for every segment within `r` of `p`
    /// (a segment may be reported more than once).
    pub fn near(&self, p: P2, r: f64, mut f: impl FnMut(u32, f64, f64)) {
        let (a, b) = (
            self.key(p.sub(P2::new(r, r))),
            self.key(p.add(P2::new(r, r))),
        );
        for x in a.0..=b.0 {
            for y in a.1..=b.1 {
                let Some(v) = self.cells.get(&(x, y)) else {
                    continue;
                };
                for &(li, i) in v {
                    let (owner, line) = self.lines[li];
                    let (q0, q1) = (line[i], line[i + 1]);
                    let ab = q1.p.sub(q0.p);
                    let l2 = ab.dot(ab);
                    let t = if l2 > 0.0 {
                        (p.sub(q0.p).dot(ab) / l2).clamp(0.0, 1.0)
                    } else {
                        0.0
                    };
                    let d = p.dist(q0.p.add(ab.mul(t)));
                    if d <= r {
                        f(owner, d, q0.s + (q1.s - q0.s) * t);
                    }
                }
            }
        }
    }
}

/// Purpose: drop points that lie on the straight line between their neighbours (within `tol`
/// metres), for drawing.
pub fn simplify(pts: &[P2], tol: f64) -> Vec<P2> {
    if pts.len() < 3 {
        return pts.to_vec();
    }
    let mut out = vec![pts[0]];
    for i in 1..pts.len() - 1 {
        let a = *out.last().expect("not empty");
        let (p, b) = (pts[i], pts[i + 1]);
        let ab = b.sub(a);
        let l = ab.len();
        let off = if l > 0.0 {
            ab.cross(p.sub(a)).abs() / l
        } else {
            p.dist(a)
        };
        if off > tol {
            out.push(p);
        }
    }
    out.push(pts[pts.len() - 1]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crossing_angle_and_point() {
        let h = seg_cross(
            P2::new(0.0, 0.0),
            P2::new(10.0, 0.0),
            P2::new(5.0, -5.0),
            P2::new(5.0, 5.0),
        )
        .unwrap();
        assert!((h.p.x - 5.0).abs() < 1e-9 && h.p.y.abs() < 1e-9);
        assert!((h.angle - PI / 2.0).abs() < 1e-9);
    }

    #[test]
    fn interpolates_along_chainage() {
        let s = with_headings(&[P2::new(0.0, 0.0), P2::new(10.0, 0.0), P2::new(10.0, 10.0)]);
        let q = at_s(&s, 15.0);
        assert!((q.p.x - 10.0).abs() < 1e-9 && (q.p.y - 5.0).abs() < 1e-9);
        let n = nearest(&s, P2::new(4.0, 2.0)).unwrap();
        assert!((n.s - 4.0).abs() < 1e-9 && (n.side - 2.0).abs() < 1e-9);
    }
}
