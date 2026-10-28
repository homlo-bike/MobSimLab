//! Planar geometry helpers in a local metric frame.

/// Mean Earth radius in metres.
const EARTH_RADIUS_M: f64 = 6_371_008.8;

/// Equirectangular projection around a reference point.
///
/// Accurate to well under 0.5 % within ~50 km of the reference, which is enough
/// for snapping clicks and measuring street lengths inside one study area.
#[derive(Debug, Clone, Copy)]
pub struct LocalProjection {
    lon0: f64,
    lat0: f64,
    kx: f64,
    ky: f64,
}

impl LocalProjection {
    /// Purpose: build a projection centred on `(lon0, lat0)` in degrees.
    pub fn new(lon0: f64, lat0: f64) -> Self {
        let ky = EARTH_RADIUS_M * std::f64::consts::PI / 180.0;
        Self {
            lon0,
            lat0,
            kx: ky * lat0.to_radians().cos(),
            ky,
        }
    }

    /// Purpose: degrees to local metres (x east, y north).
    pub fn to_xy(&self, lon: f64, lat: f64) -> (f64, f64) {
        ((lon - self.lon0) * self.kx, (lat - self.lat0) * self.ky)
    }

    /// Purpose: local metres back to degrees `(lon, lat)`.
    pub fn to_lonlat(&self, x: f64, y: f64) -> (f64, f64) {
        (self.lon0 + x / self.kx, self.lat0 + y / self.ky)
    }
}

/// Result of projecting a point on a segment.
#[derive(Debug, Clone, Copy)]
pub struct SegmentProjection {
    /// Position along the segment, 0 at `a`, 1 at `b`.
    pub t: f64,
    /// The closest point on the segment.
    pub q: (f64, f64),
    /// Distance from the point to `q` in metres.
    pub dist: f64,
    /// Signed side: positive when the point is left of the direction `a → b`.
    pub cross: f64,
}

/// Purpose: project `p` on the segment `a → b`.
pub fn project_on_segment(p: (f64, f64), a: (f64, f64), b: (f64, f64)) -> SegmentProjection {
    let (dx, dy) = (b.0 - a.0, b.1 - a.1);
    let len2 = dx * dx + dy * dy;
    let t = if len2 > 0.0 {
        (((p.0 - a.0) * dx + (p.1 - a.1) * dy) / len2).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let q = (a.0 + t * dx, a.1 + t * dy);
    let cross = dx * (p.1 - a.1) - dy * (p.0 - a.0);
    SegmentProjection {
        t,
        q,
        dist: dist(p, q),
        cross,
    }
}

/// Purpose: Euclidean distance in metres.
pub fn dist(a: (f64, f64), b: (f64, f64)) -> f64 {
    (a.0 - b.0).hypot(a.1 - b.1)
}

/// Purpose: heading of `a → b` in radians, counter-clockwise from east.
pub fn heading(a: (f64, f64), b: (f64, f64)) -> f64 {
    (b.1 - a.1).atan2(b.0 - a.0)
}

/// Purpose: absolute change of direction between two headings, in degrees (0–180).
pub fn deflection_deg(h1: f64, h2: f64) -> f64 {
    let mut d = (h2 - h1).to_degrees() % 360.0;
    if d > 180.0 {
        d -= 360.0;
    } else if d < -180.0 {
        d += 360.0;
    }
    d.abs()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn projection_round_trips() {
        let p = LocalProjection::new(6.96, 50.94);
        let (x, y) = p.to_xy(6.97, 50.95);
        let (lon, lat) = p.to_lonlat(x, y);
        assert!((lon - 6.97).abs() < 1e-12 && (lat - 50.95).abs() < 1e-12);
        // One hundredth of a degree of latitude is about 1.11 km.
        assert!((y - 1112.0).abs() < 2.0);
    }

    #[test]
    fn side_of_segment() {
        let left = project_on_segment((5.0, 1.0), (0.0, 0.0), (10.0, 0.0));
        let right = project_on_segment((5.0, -1.0), (0.0, 0.0), (10.0, 0.0));
        assert!(left.cross > 0.0 && right.cross < 0.0);
        assert!((left.t - 0.5).abs() < 1e-12 && (left.dist - 1.0).abs() < 1e-12);
    }

    #[test]
    fn deflection_wraps() {
        assert!((deflection_deg(0.0, std::f64::consts::PI) - 180.0).abs() < 1e-9);
        assert!((deflection_deg(3.0, -3.0) - (360.0 - 6.0f64.to_degrees())).abs() < 1e-6);
    }
}
