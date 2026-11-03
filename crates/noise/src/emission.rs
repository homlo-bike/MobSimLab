//! Source emission per octave band, A-weighted, dB re 1 pW.
//!
//! - Road modes: CNOSSOS-EU rolling and propulsion terms for the bus categories, with the
//!   acceleration correction near stops and the electric propulsion change (ADR-0038 §2).
//! - Rail modes: an interim model until the CNOSSOS-EU railway database is in the crate: a
//!   pass-by level per mode at a reference speed (`noise.rail_passby_db`), scaled with speed
//!   (rolling noise, a traction floor, aerodynamic noise above 200 km/h), spread over the bands
//!   with a rolling-noise shape and converted to sound power per metre by the same propagation
//!   the corridor uses, so a receiver at 7.5 m reproduces the stated pass-by level.

use crate::params::{Coefficients, Library, Mode, RoadCoefficients, Variant, NB};

/// CNOSSOS-EU road category of a bus.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RoadCategory {
    /// Category 2: two-axle buses.
    MediumHeavy,
    /// Category 3: articulated and three-axle buses, coaches.
    Heavy,
}

impl RoadCategory {
    /// Purpose: the category of a bus of this mode and length. Buses over 13 m (articulated or
    /// three-axle) and coaches are category 3, others category 2.
    pub fn of(mode: Mode, length_m: f64) -> RoadCategory {
        if mode == Mode::IntercityBus || length_m > 13.0 {
            RoadCategory::Heavy
        } else {
            RoadCategory::MediumHeavy
        }
    }

    fn coefficients(self) -> &'static RoadCoefficients {
        let c = Coefficients::builtin();
        &c.categories[match self {
            RoadCategory::MediumHeavy => "medium_heavy",
            RoadCategory::Heavy => "heavy",
        }]
    }
}

/// Purpose: A-weighted sound power of one road vehicle per band, CNOSSOS-EU.
/// Inputs: category, speed km/h (clamped to the method's 20–130 km/h), the change to the
/// propulsion term (electric buses, negative), and `accel` 0–1, the share of the junction
/// acceleration correction (1 at a stop, fading to 0 at `noise.road_stop_zone_m`).
/// Output: dB(A) re 1 pW per band.
pub fn road_vehicle_lw(
    cat: RoadCategory,
    v_kmh: f64,
    propulsion_delta_db: f64,
    accel: f64,
) -> [f64; NB] {
    let c = cat.coefficients();
    let aw = Coefficients::builtin().a_weighting_db;
    let v = v_kmh.clamp(20.0, 130.0);
    std::array::from_fn(|i| {
        let r = c.a_r[i] + c.b_r[i] * (v / 70.0).log10() + c.c_r_junction * accel;
        let p =
            c.a_p[i] + c.b_p[i] * (v - 70.0) / 70.0 + propulsion_delta_db + c.c_p_junction * accel;
        db_sum(r, p) + aw[i]
    })
}

/// Purpose: A-weighted pass-by level L_pAeq,Tp at 7.5 m of a rail vehicle at `v_kmh`.
/// Inputs: mode, speed, variant of the assumption ranges. Output: dB(A).
pub fn rail_passby_db(lib: &Library, mode: Mode, v_kmh: f64, var: Variant) -> f64 {
    let p = lib.get("noise.rail_passby_db", Some(mode), var);
    let v0 = lib.get(
        "noise.rail_passby_ref_speed_kmh",
        Some(mode),
        Variant::Central,
    );
    let k = lib.get(
        "noise.rail_rolling_speed_exponent",
        Some(mode),
        Variant::Central,
    );
    let v = v_kmh.max(5.0);
    let rolling = p + k * (v.max(20.0) / v0).log10();
    let traction = p - 10.0;
    let mut e = pow10(rolling) + pow10(traction);
    if v > 200.0 {
        // Aerodynamic noise equals rolling noise at 300 km/h and grows 50 lg(v).
        let aero = p + k * (300.0 / v0).log10() + 50.0 * (v / 300.0).log10();
        e += pow10(aero);
    }
    10.0 * e.log10()
}

/// Purpose: energetic sum of two levels, dB.
pub fn db_sum(a: f64, b: f64) -> f64 {
    10.0 * (pow10(a) + pow10(b)).log10()
}

/// Purpose: 10^(l/10).
pub fn pow10(l: f64) -> f64 {
    10f64.powf(l / 10.0)
}

/// Purpose: total of a band spectrum, dB.
pub fn total(bands: &[f64; NB]) -> f64 {
    10.0 * bands.iter().map(|&b| pow10(b)).sum::<f64>().log10()
}
