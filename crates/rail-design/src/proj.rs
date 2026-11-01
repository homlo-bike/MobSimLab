//! Local transverse Mercator projection on the WGS 84 ellipsoid.
//!
//! The railway design is stored at true size in metres (04 §4). Until projects carry their
//! working CRS, the editor uses a transverse Mercator centred on the project origin with scale
//! factor 1, so lengths, radii and clearances are true to about 1:30,000 within 50 km of the
//! origin. Formulas: Krüger series to fourth order in n (Karney 2011), accurate to a few
//! millimetres within several hundred kilometres of the central meridian.

use crate::geom::P2;

const A: f64 = 6_378_137.0;
const F: f64 = 1.0 / 298.257_223_563;

/// Transverse Mercator centred on an origin; x east and y north in metres, origin at (0, 0).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LocalTm {
    lon0: f64,
    n0: f64,
    a_hat: f64,
    alpha: [f64; 4],
    beta: [f64; 4],
    delta: [f64; 4],
    e2n: f64,
}

impl LocalTm {
    /// Purpose: projection centred on `lon0`, `lat0` (degrees).
    pub fn new(lon0: f64, lat0: f64) -> Self {
        let n = F / (2.0 - F);
        let (n2, n3, n4) = (n * n, n * n * n, n * n * n * n);
        let mut p = Self {
            lon0,
            n0: 0.0,
            a_hat: A / (1.0 + n) * (1.0 + n2 / 4.0 + n2 * n2 / 64.0),
            alpha: [
                n / 2.0 - 2.0 * n2 / 3.0 + 5.0 * n3 / 16.0 + 41.0 * n4 / 180.0,
                13.0 * n2 / 48.0 - 3.0 * n3 / 5.0 + 557.0 * n4 / 1440.0,
                61.0 * n3 / 240.0 - 103.0 * n4 / 140.0,
                49561.0 * n4 / 161280.0,
            ],
            beta: [
                n / 2.0 - 2.0 * n2 / 3.0 + 37.0 * n3 / 96.0 - n4 / 360.0,
                n2 / 48.0 + n3 / 15.0 - 437.0 * n4 / 1440.0,
                17.0 * n3 / 480.0 - 37.0 * n4 / 840.0,
                4397.0 * n4 / 161280.0,
            ],
            delta: [
                2.0 * n - 2.0 * n2 / 3.0 - 2.0 * n3 + 116.0 * n4 / 45.0,
                7.0 * n2 / 3.0 - 8.0 * n3 / 5.0 - 227.0 * n4 / 45.0,
                56.0 * n3 / 15.0 - 136.0 * n4 / 35.0,
                4279.0 * n4 / 630.0,
            ],
            e2n: 2.0 * n.sqrt() / (1.0 + n),
        };
        p.n0 = p.raw(lon0, lat0).1;
        p
    }

    fn raw(&self, lon: f64, lat: f64) -> (f64, f64) {
        let phi = lat.to_radians();
        let lam = (lon - self.lon0).to_radians();
        let t = (phi.sin().atanh() - self.e2n * (self.e2n * phi.sin()).atanh()).sinh();
        let xi = t.atan2(lam.cos());
        let eta = (lam.sin() / (1.0 + t * t).sqrt()).atanh();
        let (mut e, mut n) = (eta, xi);
        for (j, a) in self.alpha.iter().enumerate() {
            let k = 2.0 * (j + 1) as f64;
            e += a * (k * xi).cos() * (k * eta).sinh();
            n += a * (k * xi).sin() * (k * eta).cosh();
        }
        (self.a_hat * e, self.a_hat * n)
    }

    /// Purpose: degrees to local metres.
    pub fn to_xy(&self, lon: f64, lat: f64) -> P2 {
        let (e, n) = self.raw(lon, lat);
        P2::new(e, n - self.n0)
    }

    /// Purpose: local metres to degrees `[lon, lat]`.
    pub fn to_lonlat(&self, p: P2) -> [f64; 2] {
        let xi = (p.y + self.n0) / self.a_hat;
        let eta = p.x / self.a_hat;
        let (mut xi1, mut eta1) = (xi, eta);
        for (j, b) in self.beta.iter().enumerate() {
            let k = 2.0 * (j + 1) as f64;
            xi1 -= b * (k * xi).sin() * (k * eta).cosh();
            eta1 -= b * (k * xi).cos() * (k * eta).sinh();
        }
        let chi = (xi1.sin() / eta1.cosh()).asin();
        let mut phi = chi;
        for (j, d) in self.delta.iter().enumerate() {
            phi += d * (2.0 * (j + 1) as f64 * chi).sin();
        }
        let lam = eta1.sinh().atan2(xi1.cos());
        [self.lon0 + lam.to_degrees(), phi.to_degrees()]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_scale() {
        let p = LocalTm::new(6.96, 50.94);
        let o = p.to_xy(6.96, 50.94);
        assert!(o.len() < 1e-6);
        for (lon, lat) in [(7.1, 51.0), (6.5, 50.5), (7.6, 51.3)] {
            let q = p.to_xy(lon, lat);
            let [lo, la] = p.to_lonlat(q);
            assert!((lo - lon).abs() < 1e-9 && (la - lat).abs() < 1e-9, "{lo} {la} vs {lon} {lat}");
        }
        // One degree of latitude along the central meridian at 51° is about 111.25 km.
        let d = p.to_xy(6.96, 51.44).y - p.to_xy(6.96, 50.44).y;
        assert!((d - 111_250.0).abs() < 100.0, "{d}");
    }
}
