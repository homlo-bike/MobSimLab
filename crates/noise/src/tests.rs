use crate::emission::{rail_passby_db, road_vehicle_lw, total, RoadCategory};
use crate::estimate::*;
use crate::params::*;
use crate::propagation::{absorption, ground};

fn straight(len: f64) -> Vec<[f64; 2]> {
    vec![[0.0, 0.0], [len, 0.0]]
}

fn line(mode: Mode, points: Vec<[f64; 2]>, flows: Flows, v: f64, length: f64) -> LineInput {
    LineInput {
        id: "1".into(),
        label: String::new(),
        mode,
        electric: false,
        vehicle_length_m: length,
        flows,
        points,
        speed: vec![],
        speed_kmh: Some(v),
        ranges: vec![],
        stops_m: vec![],
    }
}

fn run(lines: Vec<LineInput>) -> Estimate {
    estimate(&EstimateInput {
        lines,
        grid: false,
        ..Default::default()
    })
}

const F: Flows = Flows {
    day: 6.0,
    evening: 4.0,
    night: 1.0,
};

#[test]
fn every_key_the_crate_reads_exists() {
    let lib = Library::builtin();
    for k in [
        "noise.receiver_height_m",
        "noise.day_start_h",
        "noise.evening_start_h",
        "noise.night_start_h",
        "noise.evening_penalty_db",
        "noise.night_penalty_db",
        "noise.band_lden_db",
        "noise.band_lnight_db",
        "noise.air_temperature_c",
        "noise.relative_humidity_pct",
        "noise.ground_factor_default",
        "noise.max_source_distance_m",
        "noise.grid_spacing_m",
        "noise.road_source_height_m",
        "noise.rail_source_height_m",
        "noise.road_stop_zone_m",
        "noise.electric_road_propulsion_delta_db",
        "noise.rail_passby_db",
        "noise.rail_passby_ref_speed_kmh",
        "noise.rail_rolling_speed_exponent",
        "noise.rail_squeal_r300_db",
        "noise.rail_squeal_r500_db",
        "noise.tram_squeal_r200_db",
        "noise.squeal_min_length_m",
        "noise.rail_switch_db",
        "noise.rail_bridge_db",
        "noise.tram_embedded_track_db",
    ] {
        let r = lib.range(k, Some(Mode::Tram));
        assert!(r[0] <= r[1] && r[1] <= r[2], "{k}");
    }
    assert_eq!(
        lib.range("noise.rail_passby_ref_speed_kmh", Some(Mode::Tram))[1],
        40.0
    );
    assert_eq!(
        lib.range("noise.rail_passby_ref_speed_kmh", Some(Mode::RegionalRail))[1],
        80.0
    );
}

#[test]
fn absorption_matches_iso_9613_1() {
    // ISO 9613-1 tables: 20 °C, 70 %: about 5.0 dB/km at 1 kHz and 22.9 dB/km at 4 kHz.
    let a = absorption(20.0, 70.0);
    assert!((a[4] * 1000.0 - 4.98).abs() < 0.3, "{}", a[4] * 1000.0);
    assert!((a[6] * 1000.0 - 22.9).abs() < 1.5, "{}", a[6] * 1000.0);
    assert!(a.windows(2).all(|w| w[0] < w[1]));
}

#[test]
fn hard_ground_reflects_and_soft_ground_attenuates() {
    let hard = ground(100.0, 0.05, 4.0, 0.0);
    let soft = ground(100.0, 0.05, 4.0, 1.0);
    assert!(hard.iter().all(|&a| a < 0.0));
    assert!(soft[3] > 0.0 && soft[3] > hard[3] + 3.0);
}

#[test]
fn bus_sound_power_is_plausible() {
    // A two-axle bus at 50 km/h radiates about 100 dB(A); an articulated one more.
    let b2 = total(&road_vehicle_lw(RoadCategory::MediumHeavy, 50.0, 0.0, 0.0));
    let b3 = total(&road_vehicle_lw(RoadCategory::Heavy, 50.0, 0.0, 0.0));
    assert!((95.0..106.0).contains(&b2), "{b2}");
    assert!(b3 > b2);
    // Accelerating away from a stop is louder.
    assert!(
        total(&road_vehicle_lw(RoadCategory::MediumHeavy, 30.0, 0.0, 1.0))
            > total(&road_vehicle_lw(RoadCategory::MediumHeavy, 30.0, 0.0, 0.0)) + 2.0
    );
}

#[test]
fn electric_bus_benefit_fades_with_speed() {
    let gain = |v| {
        total(&road_vehicle_lw(RoadCategory::MediumHeavy, v, 0.0, 0.0))
            - total(&road_vehicle_lw(RoadCategory::MediumHeavy, v, -8.0, 0.0))
    };
    assert!(gain(20.0) > gain(50.0));
    assert!(gain(20.0) > 2.0, "{}", gain(20.0));
}

#[test]
fn rail_passby_scales_with_speed() {
    let lib = Library::builtin();
    let p40 = rail_passby_db(lib, Mode::Tram, 40.0, Variant::Central);
    assert!((p40 - 75.0).abs() < 0.6, "{p40}");
    let p80 = rail_passby_db(lib, Mode::Tram, 80.0, Variant::Central);
    assert!((p80 - p40 - 9.0).abs() < 0.5);
    // Aerodynamic noise above 200 km/h makes high speed grow faster than 30 lg v.
    let h250 = rail_passby_db(lib, Mode::HighSpeedRail, 250.0, Variant::Central);
    let h320 = rail_passby_db(lib, Mode::HighSpeedRail, 320.0, Variant::Central);
    assert!(h320 - h250 > 30.0 * (320.0f64 / 250.0).log10() + 0.3);
}

#[test]
fn quieter_low_and_louder_high_variants() {
    let e = run(vec![line(
        Mode::RegionalRail,
        straight(2000.0),
        F,
        100.0,
        150.0,
    )]);
    let t = e.lden.typical_m;
    assert!(t[0] < t[1] && t[1] < t[2], "{t:?}");
    assert!(e.lden.typical_m[1] > 10.0, "{:?}", e.lden);
    assert!(e.lnight.typical_m[1] > 0.0);
}

#[test]
fn more_trains_widen_the_band() {
    let a = run(vec![line(Mode::Tram, straight(1000.0), F, 40.0, 30.0)]);
    let f2 = Flows {
        day: 24.0,
        evening: 16.0,
        night: 4.0,
    };
    let b = run(vec![line(Mode::Tram, straight(1000.0), f2, 40.0, 30.0)]);
    assert!(
        b.lden.typical_m[1] > a.lden.typical_m[1] * 1.3,
        "{} {}",
        a.lden.typical_m[1],
        b.lden.typical_m[1]
    );
}

#[test]
fn ten_times_the_flow_adds_ten_db() {
    let base = line(Mode::Bus, straight(1000.0), F, 30.0, 12.0);
    let mut e1 = EstimateInput {
        lines: vec![base],
        grid: true,
        ..Default::default()
    };
    // Band edges out of reach keep the grid extent the same for both runs.
    e1.overrides.insert("noise.band_lden_db".into(), 200.0);
    e1.overrides.insert("noise.band_lnight_db".into(), 200.0);
    let g1 = estimate(&e1).grid.unwrap();
    e1.lines[0].flows = Flows {
        day: 60.0,
        evening: 40.0,
        night: 10.0,
    };
    let g2 = estimate(&e1).grid.unwrap();
    assert_eq!((g1.nx, g1.ny), (g2.nx, g2.ny));
    let k = g1.lden.iter().position(|x| x.is_finite()).unwrap();
    assert!((g2.lden[k] - g1.lden[k] - 10.0).abs() < 0.01);
}

#[test]
fn tight_curve_squeals_and_widens_the_band() {
    // A regional line with a 150 m radius curve of about 240 m.
    let r = 150.0;
    let mut pts = vec![[-500.0, 0.0], [0.0, 0.0]];
    for i in 1..=32 {
        let a = i as f64 / 32.0 * 1.6;
        pts.push([r * a.sin(), r - r * a.cos()]);
    }
    let last = *pts.last().unwrap();
    pts.push([
        last[0] + 500.0 * 1.6f64.cos(),
        last[1] + 500.0 * 1.6f64.sin(),
    ]);
    let e = run(vec![line(Mode::RegionalRail, pts, F, 60.0, 100.0)]);
    let squeal: Vec<_> = e
        .checks
        .iter()
        .filter(|c| c.text.contains("squeal"))
        .collect();
    assert_eq!(squeal.len(), 1, "{:?}", e.checks);
    assert!(squeal[0].text.contains("+8 dB"), "{}", squeal[0].text);
    assert!(squeal[0].text.contains("R 15"), "{}", squeal[0].text);
    assert_eq!(e.checks[0].severity, Severity::Warning);
    // Trams squeal only below 200 m: a 300 m tram curve gets nothing.
    let mut pts = vec![[0.0, 0.0]];
    for i in 1..=32 {
        let a = i as f64 / 32.0 * 1.0;
        pts.push([300.0 * a.sin(), 300.0 - 300.0 * a.cos()]);
    }
    let t = run(vec![line(Mode::Tram, pts, F, 30.0, 30.0)]);
    assert!(!t.checks.iter().any(|c| c.text.contains("squeal")));
}

#[test]
fn passby_level_is_reproduced_at_7_5_m() {
    // One 100 m train per hour at 80 km/h: L_eq,1h at 7.5 m = pass-by + 10 lg(Tp / 3600).
    let lib = Library::builtin();
    let pass = rail_passby_db(lib, Mode::RegionalRail, 80.0, Variant::Central);
    let tp: f64 = 100.0 / (80.0 / 3.6);
    let want = pass + 10.0 * (tp / 3600.0).log10();
    let mut l = line(
        Mode::RegionalRail,
        vec![[-1500.0, 0.0], [1500.0, 0.0]],
        Flows {
            day: 1.0,
            evening: 1.0,
            night: 1.0,
        },
        80.0,
        100.0,
    );
    l.id = "r".into();
    let mut inp = EstimateInput {
        lines: vec![l],
        grid: true,
        ..Default::default()
    };
    inp.overrides.insert("noise.receiver_height_m".into(), 1.2);
    inp.overrides
        .insert("noise.max_source_distance_m".into(), 1000.0);
    inp.overrides.insert("noise.grid_spacing_m".into(), 2.5);
    let e = estimate(&inp);
    let g = e.grid.unwrap();
    // L_night is the plain hourly level when the flow is the same all night.
    let j = ((7.5 - g.y0) / g.cell - 0.5).round() as usize;
    let i = ((0.0 - g.x0) / g.cell - 0.5).round() as usize;
    let y = g.y0 + (j as f64 + 0.5) * g.cell;
    let got = g.lnight[j * g.nx + i] as f64;
    // Correct the grid cell's distance back to 7.5 m (line source, about 3 dB per doubling).
    let got = got + 10.0 * (y / 7.5).log10();
    assert!(
        (got - want).abs() < 0.8,
        "got {got}, want {want} (cell y {y})"
    );
}

#[test]
fn underground_and_flows_of_zero_emit_nothing() {
    let mut l = line(Mode::Metro, straight(1000.0), F, 60.0, 100.0);
    l.ranges.push(Range {
        from_m: 0.0,
        to_m: 1000.0,
        kind: RangeKind::Underground,
        height_m: 0.0,
    });
    let e = run(vec![l]);
    assert_eq!(e.lden.max_m, 0.0);
    assert!(e.checks.iter().any(|c| c.text.contains("underground")));
    let quiet = run(vec![line(
        Mode::Bus,
        straight(500.0),
        Flows::default(),
        30.0,
        12.0,
    )]);
    assert_eq!(quiet.lden.typical_m, [0.0; 3]);
    assert!(quiet
        .checks
        .iter()
        .any(|c| c.text.contains("No night service")));
}

#[test]
fn bridge_and_switch_corrections_are_listed() {
    let mut l = line(Mode::Metro, straight(1000.0), F, 60.0, 100.0);
    l.ranges.push(Range {
        from_m: 200.0,
        to_m: 600.0,
        kind: RangeKind::Bridge,
        height_m: 8.0,
    });
    l.ranges.push(Range {
        from_m: 800.0,
        to_m: 840.0,
        kind: RangeKind::Switch,
        height_m: 0.0,
    });
    let e = run(vec![l]);
    assert!(
        e.checks
            .iter()
            .any(|c| c.text.starts_with("Elevated over 400 m")),
        "{:?}",
        e.checks
    );
    assert!(
        e.checks.iter().any(|c| c.text.starts_with("1 switch:")),
        "{:?}",
        e.checks
    );
}

#[test]
fn deterministic_and_degenerate_inputs_are_safe() {
    let l = line(Mode::Bus, straight(800.0), F, 25.0, 18.0);
    let a = serde_json::to_string(&run(vec![l.clone()])).unwrap();
    let b = serde_json::to_string(&run(vec![l])).unwrap();
    assert_eq!(a, b);
    let e = run(vec![line(Mode::Bus, vec![[0.0, 0.0]], F, 30.0, 12.0)]);
    assert_eq!(e.lden.probes, 0);
    let e = estimate(&EstimateInput::default());
    assert!(e.grid.is_none());
}

#[test]
fn colours_follow_the_bands() {
    assert_eq!(crate::band_colour(54.9, 55.0), None);
    assert_eq!(crate::band_colour(57.0, 55.0), Some([0xf3, 0xc6, 0x83]));
    assert_eq!(crate::band_colour(80.0, 55.0), Some([0x75, 0x08, 0x5c]));
}
