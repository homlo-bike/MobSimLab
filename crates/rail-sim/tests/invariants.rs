//! Safety property tests for the interlocking and dynamics.

use proptest::prelude::*;
use rail_sim::scenarios::{generic_emu, loop_network, LoopNetworkParams};
use rail_sim::{RailSim, SimConfig, StopSpec, TdsSpec, TrainStatus};

fn small_params(lines: usize, trains: usize, blocks: usize, block_len: f64) -> LoopNetworkParams {
    LoopNetworkParams {
        lines,
        trains_per_line: trains,
        blocks_per_line: blocks,
        block_len_m: block_len,
        ..LoopNetworkParams::default()
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(24))]
    /// No two trains ever occupy the same section and no train passes its authority,
    /// for random densities, block lengths and step sizes.
    #[test]
    fn invariants_hold_on_random_loops(
        lines in 1usize..5,
        blocks in 12usize..40,
        trains_frac in 0.1f64..0.5,
        block_len in 500.0f64..1500.0,
        dt in prop_oneof![Just(0.5f64), Just(1.0), Just(2.0)],
    ) {
        let trains = ((blocks as f64 * trains_frac) as usize).max(1);
        let net = loop_network(&small_params(lines, trains, blocks, block_len));
        let mut sim = RailSim::new(net.sections, SimConfig::default()).unwrap();
        for t in net.trains { sim.add_train(t).unwrap(); }
        for _ in 0..(1800.0 / dt) as usize {
            sim.step(dt);
            prop_assert!(sim.check_invariants().is_ok(), "{:?}", sim.check_invariants());
        }
        prop_assert!(sim.stats().train_km > 0.0);
        prop_assert_eq!(sim.stats().deadlocks, 0);
    }
}

fn line(n: usize, len: f64, v: f64) -> Vec<TdsSpec> {
    (0..n)
        .map(|_| TdsSpec {
            length_m: len,
            speed_limit_mps: v,
            gradient: 0.0,
        })
        .collect()
}

#[test]
fn placement_on_occupied_section_is_rejected() {
    let mut sim = RailSim::new(line(4, 500.0, 30.0), SimConfig::default()).unwrap();
    let a = generic_emu(
        "a".into(),
        vec![0, 1, 2, 3],
        vec![0, 1, 2, 3],
        vec![],
        300.0,
    );
    let mut b = a.clone();
    b.name = "b".into();
    sim.add_train(a).unwrap();
    assert!(sim.add_train(b).is_err());
}

#[test]
fn train_stops_at_end_of_authority_behind_blocked_section() {
    let mut sim = RailSim::new(line(6, 800.0, 40.0), SimConfig::default()).unwrap();
    sim.set_blocked(4, true);
    let mut spec = generic_emu(
        "a".into(),
        (0..6).collect(),
        (0..6).collect(),
        vec![],
        300.0,
    );
    spec.cyclic = false;
    let id = sim.add_train(spec).unwrap();
    sim.advance_to(600.0, 0.5);
    let s = sim.train_state(id);
    assert!(s.speed_mps < 1e-6, "train must be stopped");
    assert!(
        (s.head_m - 3200.0).abs() < 1.0,
        "train stops at signal before block 4, head {}",
        s.head_m
    );
    sim.check_invariants().unwrap();
    sim.set_blocked(4, false);
    sim.advance_to(1200.0, 0.5);
    assert_eq!(sim.train_state(id).status, TrainStatus::Terminated);
}

#[test]
fn train_stops_at_station_and_dwells() {
    let mut sim = RailSim::new(
        line(4, 1000.0, 30.0),
        SimConfig {
            record_events: true,
            ..SimConfig::default()
        },
    )
    .unwrap();
    let mut spec = generic_emu(
        "a".into(),
        (0..4).collect(),
        (0..4).collect(),
        vec![StopSpec {
            path_index: 2,
            offset_m: 500.0,
            dwell_s: 40.0,
        }],
        300.0,
    );
    spec.cyclic = false;
    let id = sim.add_train(spec).unwrap();
    let mut arrival = None;
    let mut departure = None;
    while sim.time() < 600.0 {
        sim.step(1.0);
        for e in sim.drain_events() {
            match e {
                rail_sim::Event::StopArrival { t, .. } => {
                    arrival = Some((t, sim.train_state(id).head_m))
                }
                rail_sim::Event::StopDeparture { t, .. } => departure = Some(t),
                _ => {}
            }
        }
    }
    let (ta, pos) = arrival.expect("arrived");
    assert!((pos - 2500.0).abs() < 1e-6);
    assert!(departure.expect("departed") - ta >= 40.0 - 1e-9);
}

#[test]
fn exit_portal_releases_track_after_tail_clears() {
    let mut sim = RailSim::new(line(3, 500.0, 20.0), SimConfig::default()).unwrap();
    let mut spec = generic_emu("a".into(), vec![0, 1, 2], vec![0, 1, 2], vec![], 300.0);
    spec.cyclic = false;
    let id = sim.add_train(spec).unwrap();
    sim.set_exit_open(id, true);
    let mut exiting_seen = false;
    for _ in 0..600 {
        sim.step(1.0);
        if sim.train_state(id).status == TrainStatus::Exiting {
            exiting_seen = true;
            sim.set_external_speed(id, 10.0);
        }
        sim.check_invariants().unwrap();
    }
    assert!(exiting_seen);
    assert_eq!(sim.train_state(id).status, TrainStatus::Exited);
    assert!((0..3).all(|s| sim.reserved_by(s).is_none()));
}

#[test]
fn following_trains_keep_separation_on_single_line() {
    let mut sim = RailSim::new(line(20, 400.0, 40.0), SimConfig::default()).unwrap();
    for i in 0..5u32 {
        let mut spec = generic_emu(
            format!("t{i}"),
            (0..20).collect(),
            (0..20).collect(),
            vec![],
            400.0 * (4 - i) as f64 + 300.0,
        );
        spec.cyclic = true;
        sim.add_train(spec).unwrap();
    }
    for _ in 0..3600 {
        sim.step(1.0);
        sim.check_invariants().unwrap();
    }
    assert_eq!(sim.stats().deadlocks, 0);
}
