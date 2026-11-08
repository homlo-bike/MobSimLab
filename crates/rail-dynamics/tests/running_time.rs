use rail_dynamics::{run, RunOptions, Segment, Stop, TrainParams};

/// A train with constant acceleration `a` (no power limit, no resistance).
fn ideal(a: f64, b: f64) -> TrainParams {
    TrainParams {
        length_m: 100.0,
        mass_kg: 100_000.0,
        rotating_mass_factor: 1.0,
        max_tractive_effort_n: 100_000.0 * a,
        power_w: 1e12,
        davis_a_n: 0.0,
        davis_b_n_per_mps: 0.0,
        davis_c_n_per_mps2: 0.0,
        service_decel_mps2: b,
        max_speed_mps: 100.0,
    }
}

fn flat(len: f64, v: f64) -> Vec<Segment> {
    vec![Segment {
        length_m: len,
        speed_mps: v,
        gradient: 0.0,
    }]
}

fn rel(a: f64, b: f64) -> f64 {
    (a - b).abs() / b
}

#[test]
fn triangle_run_matches_closed_form() {
    let (a, b, l) = (1.0, 0.8, 1000.0);
    let p = run(&ideal(a, b), &flat(l, 100.0), &[], &RunOptions::default()).unwrap();
    let vp = (2.0 * l * a * b / (a + b)).sqrt();
    let t = vp / a + vp / b;
    assert!(
        rel(p.total_time_s(), t) < 0.005,
        "{} vs {t}",
        p.total_time_s()
    );
    assert!(p.speed_mps.last().unwrap().abs() < 1e-9);
}

#[test]
fn cruise_run_matches_closed_form() {
    let (a, b, l, v) = (0.8, 0.6, 10_000.0, 30.0);
    let p = run(&ideal(a, b), &flat(l, v), &[], &RunOptions::default()).unwrap();
    let t = l / v + v / (2.0 * a) + v / (2.0 * b);
    assert!(
        rel(p.total_time_s(), t) < 0.002,
        "{} vs {t}",
        p.total_time_s()
    );
    assert!(p.speed_mps.iter().all(|&x| x <= v + 1e-9));
}

#[test]
fn limit_rises_only_after_the_tail_clears() {
    let segs = vec![
        Segment {
            length_m: 2000.0,
            speed_mps: 40.0,
            gradient: 0.0,
        },
        Segment {
            length_m: 300.0,
            speed_mps: 10.0,
            gradient: 0.0,
        },
        Segment {
            length_m: 2000.0,
            speed_mps: 40.0,
            gradient: 0.0,
        },
    ];
    let p = run(&ideal(1.0, 1.0), &segs, &[], &RunOptions::default()).unwrap();
    // Head 50 m past the restriction: tail (100 m train) still on it.
    assert!(p.speed_at(2350.0) <= 10.0 + 1e-6);
    // Braked down before the restriction starts.
    assert!(p.speed_at(2000.0) <= 10.0 + 1e-6);
    // Accelerating again once the tail is clear.
    assert!(p.speed_at(2450.0) > 10.5);
}

#[test]
fn dwell_is_added_at_stops() {
    let opt = RunOptions::default();
    let t0 = run(&ideal(1.0, 1.0), &flat(3000.0, 25.0), &[], &opt).unwrap();
    let st = [Stop {
        position_m: 1500.0,
        dwell_s: 30.0,
    }];
    let t1 = run(&ideal(1.0, 1.0), &flat(3000.0, 25.0), &st, &opt).unwrap();
    assert_eq!(t1.stops.len(), 1);
    let (arr, dep) = t1.stops[0];
    assert!((dep - arr - 30.0).abs() < 1e-9);
    // Stop costs dwell + braking and acceleration loss (v/2a + v/2b = 25 s here).
    let extra = t1.total_time_s() - t0.total_time_s();
    assert!((extra - 55.0).abs() < 1.0, "extra {extra}");
    assert!(t1.speed_at(1500.0).abs() < 1e-9);
    assert!(t1.time_leaving(1500.0) > t1.time_at(1500.0) + 29.0);
}

#[test]
fn power_and_resistance_slow_the_train() {
    let mut tr = ideal(1.0, 1.0);
    let base = run(&tr, &flat(5000.0, 40.0), &[], &RunOptions::default()).unwrap();
    tr.power_w = 2.0e6;
    tr.davis_a_n = 2000.0;
    tr.davis_c_n_per_mps2 = 8.0;
    let slow = run(&tr, &flat(5000.0, 40.0), &[], &RunOptions::default()).unwrap();
    // Hand check: power-limited acceleration reaches 40 m/s near 1,300 m
    // instead of 800 m, about 3 s lost; braking gains a little from resistance.
    assert!(slow.speed_at(400.0) < base.speed_at(400.0) - 1.0);
    assert!(slow.total_time_s() > base.total_time_s() + 2.0);
}

#[test]
fn stalling_on_a_gradient_is_an_error() {
    let mut tr = ideal(0.05, 1.0);
    tr.max_tractive_effort_n = 100_000.0 * 0.05;
    let segs = vec![Segment {
        length_m: 1000.0,
        speed_mps: 20.0,
        gradient: 0.04,
    }];
    assert!(run(&tr, &segs, &[], &RunOptions::default()).is_err());
}

#[test]
fn supplement_stretches_running_time_not_dwell() {
    let st = [Stop {
        position_m: 1500.0,
        dwell_s: 40.0,
    }];
    let p = run(
        &ideal(1.0, 1.0),
        &flat(3000.0, 25.0),
        &st,
        &RunOptions::default(),
    )
    .unwrap();
    let q = p.with_supplement(0.10);
    let run_p = p.total_time_s() - 40.0;
    let run_q = q.total_time_s() - 40.0;
    assert!(rel(run_q, run_p * 1.1) < 1e-9);
    assert!((q.stops[0].1 - q.stops[0].0 - 40.0).abs() < 1e-9);
}

#[test]
fn traffic_delay_lengthens_only_the_street_stretch() {
    // Start at speed, no stop: 2000 m at 20 m/s is 100 s; the middle 1000 m in traffic +25 %.
    let opt = RunOptions {
        start_speed_mps: 20.0,
        stop_at_end: false,
        step_m: 1.0,
    };
    let p = run(&ideal(1.0, 1.0), &flat(2000.0, 20.0), &[], &opt).unwrap();
    let q = p.with_delays(&[(500.0, 1500.0, 0.25)]);
    assert!((q.total_time_s() - 112.5).abs() < 1e-6);
    assert!((q.time_at(500.0) - 25.0).abs() < 1e-6);
    assert!((q.time_at(1500.0) - 87.5).abs() < 1e-6);
    assert_eq!(p.with_delays(&[]), p);
    assert!((q.with_supplement(0.1).total_time_s() - 123.75).abs() < 1e-6);
}

#[test]
fn run_out_without_stopping() {
    let opt = RunOptions {
        start_speed_mps: 20.0,
        stop_at_end: false,
        step_m: 1.0,
    };
    let p = run(&ideal(1.0, 1.0), &flat(1000.0, 20.0), &[], &opt).unwrap();
    assert!((p.total_time_s() - 50.0).abs() < 1e-6);
}
