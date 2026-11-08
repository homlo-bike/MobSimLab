//! Local planar coordinates around an origin, good to a few metres over the tens of kilometres a ropeway
//! or a ferry line spans (equirectangular projection, the same as the journey planner's example city).

/// Metres per degree of latitude.
const M_PER_DEG: f64 = 111_320.0;

/// Longitude and latitude in degrees (WGS 84).
pub type LonLat = [f64; 2];

/// A point in metres east and north of the origin.
pub type Xy = [f64; 2];

/// Purpose: metres east and north of `origin` for `p`.
pub fn to_local(origin: LonLat, p: LonLat) -> Xy {
    let k = (origin[1].to_radians()).cos();
    [
        (p[0] - origin[0]) * M_PER_DEG * k,
        (p[1] - origin[1]) * M_PER_DEG,
    ]
}

/// Purpose: the longitude and latitude of a point `xy` metres from `origin` (inverse of [`to_local`]).
pub fn to_lonlat(origin: LonLat, xy: Xy) -> LonLat {
    let k = (origin[1].to_radians()).cos();
    [
        origin[0] + xy[0] / (M_PER_DEG * k),
        origin[1] + xy[1] / M_PER_DEG,
    ]
}

/// Purpose: straight-line distance in metres between two points.
pub fn dist(a: Xy, b: Xy) -> f64 {
    (b[0] - a[0]).hypot(b[1] - a[1])
}

/// Purpose: the point a share `t` (0..1) of the way from `a` to `b`.
pub fn lerp(a: Xy, b: Xy, t: f64) -> Xy {
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

/// Purpose: the deflection in degrees at `b` when going `a` → `b` → `c` (0 = straight on).
pub fn deflection_deg(a: Xy, b: Xy, c: Xy) -> f64 {
    let h1 = (b[1] - a[1]).atan2(b[0] - a[0]);
    let h2 = (c[1] - b[1]).atan2(c[0] - b[0]);
    let mut d = (h2 - h1).to_degrees().abs() % 360.0;
    if d > 180.0 {
        d = 360.0 - d;
    }
    d
}

/// Purpose: whether `p` lies inside the polygon `ring` (even-odd rule; the ring need not be closed).
pub fn inside(p: Xy, ring: &[Xy]) -> bool {
    let mut c = false;
    let n = ring.len();
    if n < 3 {
        return false;
    }
    let mut j = n - 1;
    for i in 0..n {
        let (a, b) = (ring[i], ring[j]);
        if (a[1] > p[1]) != (b[1] > p[1])
            && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]
        {
            c = !c;
        }
        j = i;
    }
    c
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_distance() {
        let o = [7.59, 50.36];
        let p = [7.60, 50.37];
        let xy = to_local(o, p);
        let back = to_lonlat(o, xy);
        assert!((back[0] - p[0]).abs() < 1e-12 && (back[1] - p[1]).abs() < 1e-12);
        // 0.01° of latitude is about 1113 m.
        assert!((xy[1] - 1113.2).abs() < 0.1);
    }

    #[test]
    fn deflection() {
        assert!(deflection_deg([0.0, 0.0], [1.0, 0.0], [2.0, 0.0]) < 1e-9);
        assert!((deflection_deg([0.0, 0.0], [1.0, 0.0], [1.0, 1.0]) - 90.0).abs() < 1e-9);
        assert!((deflection_deg([0.0, 0.0], [1.0, 0.0], [0.0, 0.0]) - 180.0).abs() < 1e-9);
    }

    #[test]
    fn point_in_polygon() {
        let sq = [[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0]];
        assert!(inside([5.0, 5.0], &sq));
        assert!(!inside([15.0, 5.0], &sq));
    }
}
