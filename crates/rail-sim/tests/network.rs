//! The network kernel runs planned days through the interlocking (ADR-0032 §4).

use proptest::prelude::*;
use rail_model::{examples, InfraSpec, LevelCrossingSpec, Model, TrainProtection};
use rail_plan::{plan, Plan, PlanParams};
use rail_sim::network::{NetEvent, NetParams, NetworkSim};

#[path = "../../rail-plan/tests/common/mod.rs"]
mod common;

fn day(spec: &InfraSpec) -> (Model, Plan) {
    let m = Model::compile(spec).unwrap();
    let p = plan(&m, &[common::metro_m1()], &PlanParams::default()).unwrap();
    assert!(p.issues.is_empty());
    (m, p)
}

fn crossing(special: bool) -> InfraSpec {
    let mut spec = examples::metro_line();
    spec.level_crossings.push(LevelCrossingSpec {
        id: "mill-lane".into(),
        track: "e1".into(),
        position_m: 600.0,
        rail_zone_m: 5.0,
        approach_m: 800.0,
        warning_time_s: 30.0,
        protection: "barriers".into(),
        street_way: 1,
        street_name: "Mill Lane".into(),
        keep_clear_m: 3.0,
        bus: false,
        special_measures: if special {
            vec!["line_speed".into()]
        } else {
            vec![]
        },
    });
    spec
}

fn delays(sim: &NetworkSim) -> Vec<f64> {
    sim.calls()
        .iter()
        .filter_map(|c| Some(c.arrive_s? - c.planned_arrive_s?))
        .collect()
}

#[test]
fn a_planned_day_runs_on_time_through_the_interlocking() {
    let (m, p) = day(&examples::metro_line());
    let mut sim = NetworkSim::new(&m, &p, NetParams::default()).unwrap();
    sim.run_until(30.0 * 3600.0).unwrap();
    assert!(sim.finished());
    let calls = sim.calls();
    assert_eq!(calls.len(), 294 * 5);
    assert!(calls
        .iter()
        .all(|c| c.arrive_s.is_some() || c.planned_arrive_s.is_none()));
    assert!(calls
        .iter()
        .all(|c| c.depart_s.is_some() || c.planned_depart_s.is_none()));
    // Never early, and within seconds of the plan.
    for c in calls {
        if let (Some(a), Some(p)) = (c.depart_s, c.planned_depart_s) {
            assert!(a >= p - 0.5, "{} left {} early", c.name, p - a);
        }
    }
    let d = delays(&sim);
    let worst = d.iter().copied().fold(0.0, f64::max);
    assert!(worst < 10.0, "worst arrival delay {worst} s");
    assert!(sim.events().is_empty(), "{:?}", &sim.events()[..1]);
}

#[test]
fn level_crossing_closes_for_each_train_and_opens_between() {
    let (m, p) = day(&crossing(false));
    let mut sim = NetworkSim::new(&m, &p, NetParams::default()).unwrap();
    sim.run_until(9.0 * 3600.0).unwrap();
    let cl = &sim.interlocking().closures;
    assert!(cl.len() > 20, "{} closures", cl.len());
    for c in cl {
        let d = c.to_s - c.from_s;
        assert!(d > 15.0 && d < 120.0, "closed for {d:.0} s");
    }
    // Trains do not wait for the crossing.
    let worst = delays(&sim).into_iter().fold(0.0, f64::max);
    assert!(worst < 10.0, "worst delay {worst} s");
}

#[test]
fn obstacle_detection_holds_trains_until_the_road_zone_is_clear() {
    let (m, p) = day(&crossing(true));
    let mut sim = NetworkSim::new(&m, &p, NetParams::default()).unwrap();
    sim.run_until(6.0 * 3600.0).unwrap();
    // A vehicle stuck in the road zone for ten minutes.
    sim.set_road_zone_clear(0, false);
    sim.run_until(6.0 * 3600.0 + 600.0).unwrap();
    sim.set_road_zone_clear(0, true);
    sim.run_until(8.0 * 3600.0).unwrap();
    assert!(sim
        .events()
        .iter()
        .any(|e| matches!(e, NetEvent::HeldAtCrossing { .. })));
    let worst = delays(&sim).into_iter().fold(0.0, f64::max);
    assert!(
        worst > 60.0,
        "a train waited at the crossing (worst delay {worst} s)"
    );
}

#[test]
fn moving_block_lets_a_train_follow_a_late_one_closely() {
    let mut spec = examples::metro_line();
    for t in &mut spec.tracks {
        t.protection = TrainProtection::Cbtc;
    }
    let (m, p) = day(&spec);
    let mut sim = NetworkSim::new(&m, &p, NetParams::default()).unwrap();
    // Hold the 07:00 eastbound departure for four minutes: the next train catches up.
    let late = p
        .runs
        .iter()
        .position(|r| r.name.starts_with("M1-0-") && r.depart_s() >= 7.0 * 3600.0)
        .unwrap();
    assert!(sim.delay_departure(late, 240.0));
    sim.run_until(9.0 * 3600.0).unwrap();
    assert!(sim.interlocking().following_moves > 0);
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(6))]
    /// Random departure delays never break a safety invariant or deadlock the line.
    #[test]
    fn invariants_hold_under_random_delays(
        picks in proptest::collection::vec((0usize..80, 0.0f64..360.0), 1..5),
        cbtc in any::<bool>(),
    ) {
        let mut spec = crossing(false);
        if cbtc {
            for t in &mut spec.tracks {
                t.protection = TrainProtection::Cbtc;
            }
        }
        let (m, p) = day(&spec);
        let mut sim = NetworkSim::new(&m, &p, NetParams::default()).unwrap();
        for (i, d) in picks {
            sim.delay_departure(i, d);
        }
        let r = sim.run_until(8.0 * 3600.0);
        prop_assert!(r.is_ok(), "{:?}", r);
    }
}
