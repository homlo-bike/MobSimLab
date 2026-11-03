//! Free-field propagation over flat ground (the editors' quick estimate, ADR-0038 §2): geometric
//! divergence from a point source, atmospheric absorption (ISO 9613-1) and the ISO 9613-2 ground
//! effect with one ground factor G. No buildings, no reflections, favourable conditions: the
//! upper bound a planner should worry about.

use crate::params::{BANDS_HZ, NB};

/// Purpose: atmospheric absorption coefficients per band, dB/m, from ISO 9613-1.
/// Inputs: air temperature °C, relative humidity %, at standard pressure.
pub fn absorption(t_c: f64, rh_pct: f64) -> [f64; NB] {
    let t = t_c + 273.15;
    let t0 = 293.15;
    let t01 = 273.16;
    let pr = 101.325;
    let pa = 101.325;
    let c = -6.8346 * (t01 / t).powf(1.261) + 4.6151;
    let psat = 10f64.powf(c);
    let h = rh_pct * psat * pr / pa;
    let fro = pa / pr * (24.0 + 4.04e4 * h * (0.02 + h) / (0.391 + h));
    let frn = pa / pr
        * (t / t0).powf(-0.5)
        * (9.0 + 280.0 * h * (-4.170 * ((t / t0).powf(-1.0 / 3.0) - 1.0)).exp());
    BANDS_HZ.map(|f| {
        8.686
            * f
            * f
            * (1.84e-11 * (pr / pa) * (t / t0).sqrt()
                + (t / t0).powf(-2.5)
                    * (0.01275 * (-2239.1 / t).exp() / (fro + f * f / fro)
                        + 0.1068 * (-3352.0 / t).exp() / (frn + f * f / frn)))
    })
}

/// Purpose: ground attenuation A_gr per band, ISO 9613-2 clause 7.3.1, one ground factor for the
/// source, middle and receiver regions. Inputs: horizontal distance, source and receiver heights
/// (m), ground factor 0 (hard) to 1 (porous). Output: dB per band (negative is a gain).
pub fn ground(dp: f64, hs: f64, hr: f64, g: f64) -> [f64; NB] {
    let e50 = 1.0 - (-dp / 50.0).exp();
    let region = |h: f64| -> [f64; NB] {
        let a = 1.5
            + 3.0 * (-0.12 * (h - 5.0).powi(2)).exp() * e50
            + 5.7 * (-0.09 * h * h).exp() * (1.0 - (-2.8e-6 * dp * dp).exp());
        let b = 1.5 + 8.6 * (-0.09 * h * h).exp() * e50;
        let c = 1.5 + 14.0 * (-0.46 * h * h).exp() * e50;
        let d = 1.5 + 5.0 * (-0.9 * h * h).exp() * e50;
        [
            -1.5,
            -1.5 + g * a,
            -1.5 + g * b,
            -1.5 + g * c,
            -1.5 + g * d,
            -1.5 * (1.0 - g),
            -1.5 * (1.0 - g),
            -1.5 * (1.0 - g),
        ]
    };
    let s = region(hs);
    let r = region(hr);
    let q = if dp <= 30.0 * (hs + hr) {
        0.0
    } else {
        1.0 - 30.0 * (hs + hr) / dp
    };
    std::array::from_fn(|i| {
        let m = if i == 0 {
            -3.0 * q
        } else {
            -3.0 * q * (1.0 - g)
        };
        s[i] + r[i] + m
    })
}

/// Fixed conditions of one estimate.
#[derive(Debug, Clone)]
pub struct Propagation {
    /// Absorption per band, dB/m.
    pub alpha: [f64; NB],
    /// Ground factor.
    pub g: f64,
}

impl Propagation {
    /// Purpose: energy transfer factor per band from a point source of unit sound power to a
    /// receiver: 10^(−A/10) with A = A_div + A_atm + A_gr. Inputs: horizontal distance m,
    /// source and receiver heights m. Output: linear factors (multiply band powers in W re 1 pW).
    pub fn transfer(&self, dp: f64, hs: f64, hr: f64) -> [f64; NB] {
        let dp = dp.max(0.5);
        let d = (dp * dp + (hr - hs).powi(2)).sqrt();
        let div = 20.0 * d.log10() + 11.0;
        let gr = ground(dp, hs, hr, self.g);
        std::array::from_fn(|i| 10f64.powf(-(div + self.alpha[i] * d + gr[i]) / 10.0))
    }
}
