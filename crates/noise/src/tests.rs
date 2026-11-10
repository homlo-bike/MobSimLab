use crate::emission::{road_vehicle_lw, total, RoadCategory};
use crate::estimate::*;
use crate::params::*;
use crate::propagation::{absorption, ground};
use crate::rail::*;

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
        "noise.building_storey_height_m",
        "noise.building_default_height_m",
        "noise.road_source_height_m",
        "noise.rail_source_height_a_m",
        "noise.rail_source_height_b_m",
        "noise.road_stop_zone_m",
        "noise.electric_road_propulsion_delta_db",
        "noise.rail_min_roughness_speed_kmh",
        "noise.rail_aero_from_kmh",
        "noise.rail_vehicle_length_m",
        "noise.rail_axles_per_vehicle",
        "noise.rail_powered_vehicle_share",
        "noise.rail_locomotives_per_train",
        "noise.rail_impact_extent_m",
        "noise.rail_squeal_r300_db",
        "noise.rail_squeal_r500_db",
        "noise.tram_squeal_r200_db",
        "noise.squeal_min_length_m",
        "noise.tram_embedded_track_db",
    ] {
        let r = lib.range(k, Some(Mode::Tram));
        assert!(r[0] <= r[1] && r[1] <= r[2], "{k}");
    }
    assert_eq!(
        lib.range("noise.rail_min_roughness_speed_kmh", Some(Mode::Tram))[1],
        30.0
    );
    assert_eq!(
        lib.range(
            "noise.rail_min_roughness_speed_kmh",
            Some(Mode::RegionalRail)
        )[1],
        50.0
    );
    // Every enum choice names an entry of the CNOSSOS-EU tables, for every rail mode and variant.
    for m in [
        Mode::Tram,
        Mode::LightRail,
        Mode::Metro,
        Mode::CommuterRail,
        Mode::RegionalRail,
        Mode::LongDistanceRail,
        Mode::HighSpeedRail,
    ] {
        for v in [Variant::Low, Variant::Central, Variant::High] {
            let src = RailSource::new(lib, m, 100.0, v);
            assert!(src.vehicles >= 1.0 && src.axles >= 4.0, "{m:?}");
        }
    }
}

#[test]
fn rail_tables_hold_the_2021_amendments() {
    let t = RailTables::builtin();
    assert_eq!(t.wavelengths_mm.len(), NW);
    assert_eq!(t.wavelengths_mm[0], 2000.0);
    // Rail roughness M (2021/1226 (20)(a)): 35.0 at 2 000 mm, -19.0 at 0.8 mm.
    assert_eq!(t.rail_roughness["m"][0], 35.0);
    assert_eq!(t.rail_roughness["m"][NW - 1], -19.0);
    // Table G-5, 2 200 kW diesel locomotive at 6 300 Hz, corrected by (20)(f).
    let i = t.frequencies_hz.iter().position(|&f| f == 6300.0).unwrap();
    assert_eq!(t.traction["diesel_loco_2200kw"].a[i], 81.4);
    assert_eq!(t.traction["diesel_loco_2200kw"].b[i], 80.7);
    // Direct fastening on bridges is the new eighth track transfer function.
    assert_eq!(t.track_transfer["direct_fastening_bridge"][0], 75.4);
    assert_eq!(t.bridge_transfer["plus15"][N3 - 1], 74.7);
}

#[test]
fn roughness_wavelengths_map_to_frequency_with_speed() {
    let t = RailTables::builtin();
    let spec = &t.rail_roughness["m"];
    // 36 km/h = 10 m/s: 100 Hz is the 100 mm band, 1 kHz the 10 mm band.
    let f = to_frequency(spec, 36.0);
    let w = |mm: f64| spec[t.wavelengths_mm.iter().position(|&x| x == mm).unwrap()];
    let i100 = t.frequencies_hz.iter().position(|&f| f == 100.0).unwrap();
    let i1k = t.frequencies_hz.iter().position(|&f| f == 1000.0).unwrap();
    assert!((f[i100] - w(100.0)).abs() < 1e-9);
    assert!((f[i1k] - w(10.0)).abs() < 1e-9);
    // Beyond the table the end values hold.
    assert_eq!(to_frequency(spec, 2000.0)[0], spec[0]);
}

#[test]
fn rail_sound_power_grows_with_speed_and_aerodynamics_above_200() {
    let lib = Library::builtin();
    let p = |m, len, v| {
        let src = RailSource::new(lib, m, len, Variant::Central);
        train_power(
            &src,
            &TrackState {
                v_kmh: v,
                ..Default::default()
            },
        )
    };
    // Rolling noise: about 25–35 dB per decade of speed (CNOSSOS-EU roughness spectra).
    let k = (p(Mode::RegionalRail, 100.0, 160.0).total_db()
        - p(Mode::RegionalRail, 100.0, 80.0).total_db())
        / 2f64.log10();
    assert!((20.0..40.0).contains(&k), "{k}");
    // Below the minimum roughness speed only traction changes nothing: trams at 20 and 30 km/h.
    assert!(
        (p(Mode::Tram, 30.0, 20.0).total_db() - p(Mode::Tram, 30.0, 30.0).total_db()).abs() < 1e-9
    );
    // Aerodynamic sources appear only above 200 km/h.
    assert!(p(Mode::HighSpeedRail, 200.0, 200.0)
        .b_aero
        .iter()
        .all(|&x| x == 0.0));
    assert!(p(Mode::HighSpeedRail, 200.0, 250.0)
        .b_aero
        .iter()
        .any(|&x| x > 0.0));
    // A longer train is louder by 10 lg of its length.
    let d = p(Mode::Metro, 120.0, 60.0).total_db() - p(Mode::Metro, 60.0, 60.0).total_db();
    assert!((d - 3.0).abs() < 0.2, "{d}");
}

#[test]
fn bridges_and_switches_add_cnossos_sources() {
    let lib = Library::builtin();
    let src = RailSource::new(lib, Mode::RegionalRail, 100.0, Variant::Central);
    let base = TrackState {
        v_kmh: 80.0,
        ..Default::default()
    };
    let l0 = train_power(&src, &base).total_db();
    let br = train_power(
        &src,
        &TrackState {
            bridge: true,
            ..base
        },
    );
    assert!(br.a_bridge.iter().all(|&x| x > 0.0));
    assert!((2.0..12.0).contains(&(br.total_db() - l0)));
    let sw = |v| {
        let st = TrackState {
            v_kmh: v,
            ..Default::default()
        };
        train_power(
            &src,
            &TrackState {
                joint_density: 0.01,
                ..st
            },
        )
        .total_db()
            - train_power(&src, &st).total_db()
    };
    assert!(sw(80.0) > 2.0, "{}", sw(80.0));
    // No impact noise below the minimum speed (50 km/h).
    assert_eq!(sw(40.0), 0.0);
}

#[test]
fn rail_directivity_follows_cnossos() {
    // Dipole: along the track 1 % of the power, broadside all of it.
    assert!((dipole(0.0) - 0.01).abs() < 1e-12);
    assert!((dipole(1.0) - 1.0).abs() < 1e-12);
    // Source A: nothing at or below the horizon, attenuation straight up.
    assert_eq!(vertical_a_db(0.0, 1000.0), 0.0);
    assert_eq!(vertical_a_db(-0.3, 1000.0), 0.0);
    assert!(vertical_a_db(1.4, 1000.0) < -5.0);
    // Aerodynamic source B: cos² below the horizon.
    assert!((vertical_b_aero_db(-std::f64::consts::FRAC_PI_4) + 3.01).abs() < 0.01);
    assert_eq!(vertical_b_aero_db(0.2), 0.0);
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
fn quieter_low_and_louder_high_variants() {
    let busy = Flows {
        day: 6.0,
        evening: 4.0,
        night: 3.0,
    };
    let e = run(vec![line(
        Mode::RegionalRail,
        straight(2000.0),
        busy,
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
    let f1 = Flows {
        day: 24.0,
        evening: 16.0,
        night: 4.0,
    };
    let a = run(vec![line(Mode::Tram, straight(1000.0), f1, 40.0, 30.0)]);
    let f2 = Flows {
        day: 96.0,
        evening: 64.0,
        night: 16.0,
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
fn rail_passby_levels_are_plausible() {
    // One train per hour on a long straight track, receiver at 7.5 m and 1.2 m: the pass-by level
    // L_pAeq,Tp = L_eq,1h - 10 lg(Tp / 3600) should fall where ISO 3095 measurements and the
    // TSI NOI limits put modern stock on a normally maintained network.
    let passby = |mode: Mode, len: f64, v: f64| {
        let mut l = line(
            mode,
            vec![[-1500.0, 0.0], [1500.0, 0.0]],
            Flows {
                day: 1.0,
                evening: 1.0,
                night: 1.0,
            },
            v,
            len,
        );
        l.id = "r".into();
        let mut inp = EstimateInput {
            lines: vec![l],
            grid: true,
            grid_reach_m: Some(30.0),
            ..Default::default()
        };
        inp.overrides.insert("noise.receiver_height_m".into(), 1.2);
        inp.overrides
            .insert("noise.max_source_distance_m".into(), 1000.0);
        inp.overrides.insert("noise.grid_spacing_m".into(), 2.5);
        let e = estimate(&inp);
        let g = e.grid.unwrap();
        let j = ((7.5 - g.y0) / g.cell - 0.5).round() as usize;
        let i = ((0.0 - g.x0) / g.cell - 0.5).round() as usize;
        let y = g.y0 + (j as f64 + 0.5) * g.cell;
        // L_night is the plain hourly level when the flow is the same all night; correct the
        // cell's distance back to 7.5 m (line source, about 3 dB per doubling).
        let leq = g.lnight[j * g.nx + i] as f64 + 10.0 * (y / 7.5).log10();
        leq - 10.0 * (len / (v / 3.6) / 3600.0).log10()
    };
    let tram = passby(Mode::Tram, 30.0, 40.0);
    assert!((70.0..80.0).contains(&tram), "tram {tram}");
    let emu = passby(Mode::RegionalRail, 100.0, 80.0);
    assert!((74.0..83.0).contains(&emu), "regional {emu}");
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

fn grid_level(e: &Estimate, p: [f64; 2]) -> f32 {
    let g = e.grid.as_ref().expect("grid");
    let i = ((p[0] - g.x0) / g.cell).floor();
    let j = ((p[1] - g.y0) / g.cell).floor();
    assert!(
        i >= 0.0 && j >= 0.0 && (i as usize) < g.nx && (j as usize) < g.ny,
        "{p:?} outside the grid {} {} {}×{} at {} m",
        g.x0,
        g.y0,
        g.nx,
        g.ny,
        g.cell
    );
    g.lden[j as usize * g.nx + i as usize]
}

fn rect(x0: f64, y0: f64, x1: f64, y1: f64, h: f64) -> crate::screening::BuildingInput {
    crate::screening::BuildingInput {
        ring: vec![[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]],
        height_m: Some(h),
        levels: None,
        homes: None,
    }
}

#[test]
fn barrier_attenuation_follows_iso_9613_2() {
    use crate::screening::{barrier_db, Screen};
    let one = Screen {
        z: 1.0,
        e: 0.0,
        dss: 20.0,
        dsr: 20.0,
        d: 40.0,
        edges: 1,
    };
    let dz = barrier_db(&one);
    // 1 kHz: 10 lg(3 + 20/0.34 · 1 · K_met), K_met = exp(−√(20·20·40/2)/2000) ≈ 0.956.
    let k_met = (-(20.0f64 * 20.0 * 40.0 / 2.0).sqrt() / 2000.0).exp();
    assert!((dz[4] - 10.0 * (3.0 + 20.0 / 0.34 * k_met).log10()).abs() < 1e-9);
    assert!(dz.windows(2).all(|w| w[1] >= w[0]), "rises with frequency");
    assert!(dz.iter().all(|&x| x <= 20.0));
    // A thick barrier screens more than a thin one with the same path difference, up to 25 dB.
    let thick = barrier_db(&Screen {
        e: 10.0,
        edges: 2,
        z: 5.0,
        ..one
    });
    assert!(thick.iter().all(|&x| x <= 25.0));
    assert!(thick[7] > 20.0);
}

#[test]
fn a_row_of_buildings_screens_the_map_behind_it() {
    let mk = |buildings| {
        estimate(&EstimateInput {
            lines: vec![line(Mode::Tram, straight(600.0), F, 40.0, 30.0)],
            buildings,
            grid: true,
            grid_reach_m: Some(80.0),
            ..Default::default()
        })
    };
    let free = mk(vec![]);
    let built = mk(vec![rect(-100.0, 15.0, 700.0, 30.0, 12.0)]);
    let behind = [300.0, 45.0];
    let front = [300.0, -20.0];
    let (lf, lb) = (grid_level(&free, behind), grid_level(&built, behind));
    assert!(lf - lb > 10.0, "free {lf}, behind the row {lb}");
    // The other side has no buildings, but the row's facade reflects the line back to it.
    let gain = grid_level(&built, front) - grid_level(&free, front);
    assert!(gain > 0.3 && gain < 3.5, "reflection gain {gain}");
    // Receivers inside the building are not computed; the building takes the level beside it.
    assert!(grid_level(&built, [300.0, 22.0]).is_nan());
    let [bl, bn] = built.building_levels[0];
    assert!(
        bl > lb && bl.is_finite() && bn.is_finite() && bn < bl,
        "{bl} {bn}"
    );
    // The band distances stay free field.
    assert_eq!(free.lden.typical_m, built.lden.typical_m);
}

#[test]
fn buildings_out_of_the_way_change_nothing() {
    let mk = |buildings| {
        estimate(&EstimateInput {
            lines: vec![line(Mode::Bus, straight(300.0), F, 40.0, 12.0)],
            buildings,
            grid: true,
            grid_reach_m: Some(80.0),
            ..Default::default()
        })
    };
    let free = mk(vec![]);
    // Behind the receivers, and degenerate inputs that are dropped.
    let built = mk(vec![
        rect(0.0, 400.0, 50.0, 420.0, 20.0),
        crate::screening::BuildingInput {
            ring: vec![[0.0, 0.0], [1.0, 1.0]],
            height_m: Some(10.0),
            levels: None,
            homes: None,
        },
    ]);
    // Equal up to pairing far elements (one path for two 10 m elements beyond 80 m).
    let (a, b) = (
        &free.grid.as_ref().unwrap().lden,
        &built.grid.as_ref().unwrap().lden,
    );
    assert_eq!(a.len(), b.len());
    let worst = a
        .iter()
        .zip(b)
        .map(|(x, y)| {
            assert_eq!(x.is_nan(), y.is_nan());
            if x.is_nan() {
                0.0
            } else {
                (x - y).abs()
            }
        })
        .fold(0.0f32, f32::max);
    assert!(worst < 0.1, "{worst}");
    assert!(built.building_levels.iter().all(|b| b[0].is_nan()));
}

#[test]
fn building_height_from_osm_tags() {
    use crate::screening::{BuildingInput, HeightRule};
    let rule = HeightRule {
        level_m: 3.0,
        default_m: 9.0,
    };
    let b = |height_m, levels| BuildingInput {
        ring: vec![],
        height_m,
        levels,
        homes: None,
    };
    assert_eq!(b(Some(14.5), Some(2.0)).height(rule), 14.5);
    assert_eq!(b(None, Some(5.0)).height(rule), 15.0);
    assert_eq!(b(Some(0.0), None).height(rule), 9.0);
    assert_eq!(b(None, None).height(rule), 9.0);
}

fn with_overrides(input: EstimateInput, kv: &[(&str, f64)]) -> EstimateInput {
    EstimateInput {
        overrides: kv.iter().map(|(k, v)| (k.to_string(), *v)).collect(),
        ..input
    }
}

fn map_input(buildings: Vec<crate::screening::BuildingInput>) -> EstimateInput {
    EstimateInput {
        lines: vec![line(Mode::Tram, straight(600.0), F, 40.0, 30.0)],
        buildings,
        grid: true,
        grid_reach_m: Some(80.0),
        ..Default::default()
    }
}

#[test]
fn facade_reflections_follow_the_reflection_settings() {
    let row = || vec![rect(-100.0, 15.0, 700.0, 30.0, 12.0)];
    let front = [300.0, -20.0];
    let free = estimate(&map_input(vec![]));
    let off = estimate(&with_overrides(
        map_input(row()),
        &[("noise.reflection_order", 0.0)],
    ));
    let on = estimate(&map_input(row()));
    let hard = estimate(&with_overrides(
        map_input(row()),
        &[("noise.facade_reflection_coefficient", 1.0)],
    ));
    let (lf, l0, l1, lh) = (
        grid_level(&free, front),
        grid_level(&off, front),
        grid_level(&on, front),
        grid_level(&hard, front),
    );
    assert!(
        (lf - l0).abs() < 0.01,
        "no reflections: free field {lf}, {l0}"
    );
    assert!(l1 > l0 + 0.3 && lh > l1, "{l0} {l1} {lh}");
    // A hard wall at most doubles the energy of the paths it mirrors: under 3 dB here.
    assert!(lh - l0 < 3.0, "{l0} {lh}");
    // The building's own facade does not count in its level (the Directive's incident level).
    let (b0, b1) = (off.building_levels[0][0], on.building_levels[0][0]);
    assert!((b0 - b1).abs() < 0.05, "own reflection excluded: {b0} {b1}");
}

#[test]
fn sound_goes_round_the_ends_of_a_short_building() {
    // The same 10 m deep, 12 m high block, 20 m or 300 m long, 20 m from the line.
    let behind = [300.0, 45.0];
    let short = estimate(&map_input(vec![rect(290.0, 20.0, 310.0, 30.0, 12.0)]));
    let long = estimate(&map_input(vec![rect(150.0, 20.0, 450.0, 30.0, 12.0)]));
    let (ls, ll) = (grid_level(&short, behind), grid_level(&long, behind));
    assert!(ls > ll + 1.0, "short {ls}, long {ll}");
    let free = estimate(&map_input(vec![]));
    assert!(grid_level(&free, behind) > ls, "still screened");
}

#[test]
fn lateral_paths_go_round_the_corners() {
    use crate::screening::{HeightRule, Obstacles, RayScratch};
    let rule = HeightRule {
        level_m: 3.0,
        default_m: 8.0,
    };
    let o = Obstacles::new(&[rect(-5.0, 15.0, 5.0, 25.0, 10.0)], rule, None, 60.0);
    let mut sc = RayScratch::default();
    let (s, r) = ([0.0, 0.0], [0.0, 40.0]);
    let v = o.screen(s, r, 0.5, 4.0, &mut sc).expect("screened");
    assert!(v.buildings && v.screen.edges == 2, "{v:?}");
    let sides = o.lateral(s, r, [0.5, 4.0], None, true, &mut sc);
    let expect = 2.0 * 250f64.sqrt() + 10.0;
    for l in sides {
        let l = l.expect("both sides open");
        assert!((l.plan - expect).abs() < 1e-9, "{l:?}");
        assert_eq!(l.edges, 2);
        assert!((l.e - 10.0).abs() < 1e-9);
    }
    // A second building closing the left side is gone round as well.
    let o = Obstacles::new(
        &[
            rect(-5.0, 15.0, 5.0, 25.0, 10.0),
            rect(-8.0, 0.0, -1.0, 12.0, 10.0),
        ],
        rule,
        None,
        60.0,
    );
    o.screen(s, r, 0.5, 4.0, &mut sc).expect("screened");
    let [a, b] = o.lateral(s, r, [0.5, 4.0], None, true, &mut sc);
    let (a, b) = (a.expect("left"), b.expect("right"));
    assert!(a.plan > b.plan + 5.0, "{a:?} {b:?}");
}

/// A terrain grid from −200 m to 800 m east and −200 m to 400 m north at 10 m.
fn terrain(z: impl Fn(f64, f64) -> f64) -> crate::ground::TerrainInput {
    let (nx, ny) = (101, 61);
    let mut v = Vec::with_capacity(nx * ny);
    for j in 0..ny {
        for i in 0..nx {
            v.push(Some(z(-200.0 + i as f64 * 10.0, -200.0 + j as f64 * 10.0)));
        }
    }
    crate::ground::TerrainInput {
        x0: -200.0,
        y0: -200.0,
        dx: 10.0,
        dy: 10.0,
        nx,
        ny,
        z: v,
    }
}

#[test]
fn surface_model_filter_keeps_hills_and_drops_buildings_and_trees() {
    use crate::ground::Ground;
    // A 20 m wide tower block of 30 m on 100 m ground, and a 200 m wide plateau 10 m higher.
    let t = terrain(|x, y| {
        let tower = (x - 100.0).abs() <= 10.0 && (y - 100.0).abs() <= 10.0;
        let plateau = (x - 500.0).abs() <= 100.0 && (y - 100.0).abs() <= 100.0;
        100.0 + if tower { 30.0 } else { 0.0 } + if plateau { 10.0 } else { 0.0 }
    });
    let g = Ground::new(&t, &[], 60.0).expect("ground");
    assert!(
        (g.at([100.0, 100.0]) - 100.0).abs() < 0.01,
        "{}",
        g.at([100.0, 100.0])
    );
    assert!((g.at([500.0, 100.0]) - 110.0).abs() < 0.01);
    assert!((g.at([-100.0, -100.0]) - 100.0).abs() < 0.01);
    // A building footprint drops its samples even without the opening.
    let ring = [[85.0, 85.0], [115.0, 85.0], [115.0, 115.0], [85.0, 115.0]];
    let g = Ground::new(&t, &[&ring], 0.0).expect("ground");
    assert!((g.at([100.0, 100.0]) - 100.0).abs() < 0.01);
    // Flat or empty grids give no terrain.
    let flat = terrain(|_, _| 250.0);
    let o = crate::screening::Obstacles::new(
        &[],
        crate::screening::HeightRule {
            level_m: 3.0,
            default_m: 8.0,
        },
        Some(&flat),
        60.0,
    );
    assert!(!o.has_ground() && o.is_empty());
    let mut empty = flat.clone();
    empty.z.iter_mut().for_each(|z| *z = None);
    assert!(Ground::new(&empty, &[], 60.0).is_none());
}

#[test]
fn a_hill_screens_and_a_slope_does_not() {
    let base = || map_input(vec![]);
    let free = estimate(&EstimateInput {
        grid_reach_m: Some(200.0),
        ..base()
    });
    // A 100 m wide embankment 10 m high between the line and the receivers 160 m north.
    let ridge = estimate(&EstimateInput {
        grid_reach_m: Some(200.0),
        terrain: Some(terrain(|_, y| {
            if (30.0..=130.0).contains(&y) {
                10.0
            } else {
                0.0
            }
        })),
        ..base()
    });
    let behind = [300.0, 165.0];
    let (lf, lr) = (grid_level(&free, behind), grid_level(&ridge, behind));
    assert!(lf - lr > 5.0, "free {lf}, behind the ridge {lr}");
    // On an even 5 % slope the line of sight stays clear: the same as flat ground.
    let slope = estimate(&EstimateInput {
        grid_reach_m: Some(200.0),
        terrain: Some(terrain(|_, y| 50.0 + 0.05 * y)),
        ..base()
    });
    let worst = free
        .grid
        .as_ref()
        .unwrap()
        .lden
        .iter()
        .zip(&slope.grid.as_ref().unwrap().lden)
        .filter(|(a, _)| !a.is_nan())
        .map(|(a, b)| (a - b).abs())
        .fold(0.0f32, f32::max);
    assert!(worst < 0.01, "{worst}");
}

#[test]
fn people_from_the_building_size_skip_other_uses_and_sheds() {
    use crate::population::{residents, PeopleRule, PeopleSource};
    use crate::screening::HeightRule;
    let rule = PeopleRule {
        height: HeightRule {
            level_m: 3.0,
            default_m: 8.0,
        },
        floor_area_per_person_m2: 50.0,
        min_footprint_m2: 30.0,
    };
    let mut flats = rect(0.0, 0.0, 20.0, 10.0, 0.0);
    (flats.height_m, flats.levels) = (None, Some(5.0));
    let mut shop = rect(30.0, 0.0, 50.0, 10.0, 6.0);
    shop.homes = Some(false);
    let shed = rect(60.0, 0.0, 65.0, 4.0, 3.0);
    // No height or storeys: 8 m ÷ 3 m gives 3 storeys.
    let mut house = rect(70.0, 0.0, 80.0, 10.0, 0.0);
    house.height_m = None;
    let r = residents(&[flats, shop, shed, house], None, rule);
    assert_eq!(r.source, PeopleSource::BuildingSize);
    assert_eq!(r.people, vec![20.0, 0.0, 0.0, 6.0]);
}

#[test]
fn grid_people_are_shared_by_floor_area_within_their_cell() {
    use crate::population::{residents, PeopleRule, PeopleSource, PopulationInput};
    use crate::screening::HeightRule;
    let rule = PeopleRule {
        height: HeightRule {
            level_m: 3.0,
            default_m: 8.0,
        },
        floor_area_per_person_m2: 50.0,
        min_footprint_m2: 30.0,
    };
    // Two 100 m cells: 40 people west, 7 east. West: a one-storey and a three-storey house
    // of the same footprint and a shop; east: only a shed.
    let grid = PopulationInput {
        x0: 0.0,
        y0: 0.0,
        dx: 100.0,
        dy: 100.0,
        nx: 2,
        ny: 1,
        people: vec![40.0, 7.0],
    };
    let mut shop = rect(60.0, 10.0, 90.0, 40.0, 4.0);
    shop.homes = Some(false);
    let r = residents(
        &[
            rect(10.0, 10.0, 20.0, 20.0, 3.0),
            rect(30.0, 10.0, 40.0, 20.0, 9.0),
            shop,
            rect(150.0, 50.0, 153.0, 53.0, 3.0),
        ],
        Some(&grid),
        rule,
    );
    assert_eq!(r.source, PeopleSource::Grid);
    assert_eq!(r.people, vec![10.0, 30.0, 0.0, 0.0]);
    assert_eq!(r.unplaced, 7.0);
}
