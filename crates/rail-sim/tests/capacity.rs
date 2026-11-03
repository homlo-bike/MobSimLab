//! The capacity run (ADR-0032 §3 step 8) and the kernel cases its frequency sweep found.

use rail_model::{examples, Model};
use rail_plan::examples::metro_m1;
use rail_plan::{plan, Band, PlanParams};
use rail_sim::capacity::{
    capacity_run, practical_maximum, sweep_headways, sweep_point, CapacityParams, Verdict,
};
use rail_sim::network::{NetParams, NetworkSim};

fn model() -> Model {
    Model::compile(&examples::metro_line()).unwrap()
}

#[test]
fn the_morning_peak_of_m1_runs_but_is_near_the_limit() {
    let m = model();
    let run = capacity_run(&m, &[metro_m1()], &CapacityParams::default()).unwrap();
    assert_eq!(run.lines.len(), 1);
    let pt = &run.lines[0].planned;
    assert_eq!(pt.headway_s, 300.0);
    assert_eq!(pt.unplaced, 0);
    assert!(pt.problems.is_empty(), "{:?}", pt.problems);
    assert!(pt.punctuality > 0.99);
    assert!(pt.stable, "residual {} s", pt.residual_delay_s);
    // The Westpark terminal platforms are the bottleneck, at about 85 %.
    assert_eq!(pt.terminal, "Westpark");
    assert!(pt.terminal_share > 0.8 && pt.terminal_share < 0.9);
    assert!(pt.theoretical_per_hour > 12.0 && pt.theoretical_per_hour < 16.0);
    assert_eq!(run.verdict, Verdict::NearLimit);
}

#[test]
fn the_capacity_run_is_deterministic_for_a_seed() {
    let m = model();
    let p = CapacityParams::default();
    let a = capacity_run(&m, &[metro_m1()], &p).unwrap();
    let b = capacity_run(&m, &[metro_m1()], &p).unwrap();
    assert_eq!(a, b);
    assert!(
        a.lines[0].planned.knock_on_s > 0.0,
        "primary delays were injected"
    );
}

#[test]
fn the_sweep_finds_the_practical_maximum() {
    let m = model();
    let lines = [metro_m1()];
    let p = CapacityParams::default();
    let run = capacity_run(&m, &lines, &p).unwrap();
    let hs = sweep_headways(&lines[0], &p, true);
    assert_eq!(hs, vec![240.0, 180.0, 150.0, 120.0]);
    // Every 4 minutes no longer fits the Westpark turn-backs.
    let pt = sweep_point(&m, &lines, &p, 0, 240.0).unwrap();
    assert_eq!(pt.verdict, Verdict::NotEnoughCapacity);
    assert!(pt.unplaced > 0);
    let points = [&run.lines[0].planned, &pt];
    assert_eq!(practical_maximum(&points), Some(12.0));
}

#[test]
fn a_period_without_service_is_refused() {
    let m = model();
    let p = CapacityParams {
        from_s: 1.0 * 3600.0,
        to_s: 2.0 * 3600.0,
        ..CapacityParams::default()
    };
    assert!(capacity_run(&m, &[metro_m1()], &p).is_err());
}

fn cut_plan(peak_headway_s: f64) -> (Model, rail_plan::Plan) {
    let m = model();
    let mut l = metro_m1();
    let h = |x: f64| x * 3600.0;
    l.bands = vec![
        Band {
            from_s: h(6.5),
            to_s: h(7.0),
            headway_s: 300.0,
        },
        Band {
            from_s: h(7.0),
            to_s: h(9.0),
            headway_s: peak_headway_s,
        },
        Band {
            from_s: h(9.0),
            to_s: h(9.5),
            headway_s: 600.0,
        },
    ];
    let p = plan(&m, &[l], &PlanParams::default()).unwrap();
    (m, p)
}

#[test]
fn trains_stabled_on_neighbouring_sidings_start_on_their_own_siding() {
    // Every 4 minutes the plan stables trains on both Eastgate sidings behind switch ess.
    let (m, p) = cut_plan(240.0);
    assert!(p.stabling_start["es1"].len() == 1 && p.stabling_start["es2"].len() == 1);
    let mut sim = NetworkSim::new(&m, &p, NetParams::default()).unwrap();
    sim.run_until(10.0 * 3600.0).unwrap();
}

#[test]
fn a_switch_moves_while_a_train_waits_at_the_signal_in_front_of_it() {
    // Every 6 minutes a train waits at H_E for the Eastgate platform 2 route while
    // switch esc must move; it stands on the track in front of the switch, not on it.
    let (m, p) = cut_plan(360.0);
    let mut sim = NetworkSim::new(&m, &p, NetParams::default()).unwrap();
    sim.run_until(10.0 * 3600.0).unwrap();
    assert!(sim.finished());
}
