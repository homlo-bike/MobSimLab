//! Shared fixtures: the example metro line M1 and its train.
#![allow(dead_code)]

use rail_dynamics::TrainParams;
use rail_plan::{Band, Call, LineSpec};

/// Purpose: a 120 m metro train (three cars, 80 km/h, 1.0 m/s² service braking).
pub fn metro_train() -> TrainParams {
    TrainParams {
        length_m: 120.0,
        mass_kg: 200_000.0,
        rotating_mass_factor: 1.08,
        max_tractive_effort_n: 260_000.0,
        power_w: 3.0e6,
        davis_a_n: 2_000.0,
        davis_b_n_per_mps: 25.0,
        davis_c_n_per_mps2: 5.0,
        service_decel_mps2: 1.0,
        max_speed_mps: 80.0 / 3.6,
    }
}

/// Purpose: line M1 Westpark – Eastgate on the example metro line, 05:00–24:00:
/// every 10 min, every 5 min in the peaks 06:30–09:00 and 16:00–19:00.
pub fn metro_m1() -> LineSpec {
    let h = |x: f64| x * 3600.0;
    let band = |a: f64, b: f64, hw: f64| Band {
        from_s: h(a),
        to_s: h(b),
        headway_s: hw,
    };
    LineSpec {
        id: "M1".into(),
        name: "M1".into(),
        calls: ["Westpark", "Alder", "Birch", "Cedar", "Eastgate"]
            .iter()
            .map(|s| Call::at(s))
            .collect(),
        train: metro_train(),
        dwell_s: 30.0,
        turnback_s: 180.0,
        supplement_share: 0.05,
        stabling: ["wd1", "wd2", "wd3", "es1", "es2"]
            .iter()
            .map(|s| s.to_string())
            .collect(),
        bands: vec![
            band(5.0, 6.5, 600.0),
            band(6.5, 9.0, 300.0),
            band(9.0, 16.0, 600.0),
            band(16.0, 19.0, 300.0),
            band(19.0, 24.0, 600.0),
        ],
        return_offset_s: None,
    }
}
