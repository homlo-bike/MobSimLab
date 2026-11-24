//! The capacity run (ADR-0032 §3 step 8) and the kernel cases its frequency sweep found.

use rail_model::{examples, Model};
use rail_plan::examples::metro_m1;
use rail_plan::{plan, Band, PlanParams};
use rail_sim::capacity::{
    bottleneck_section, capacity_run, practical_maximum, replay, sweep_headways, sweep_point,
    CapacityParams, SectionKind, Verdict,
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
    // Each way: every 5 minutes from 06:30 to 09:00 (the period and its warm-up), then every
    // 10 minutes in the half-hour after it.
    assert_eq!(pt.trips, 2 * (30 + 3));
    assert!(pt.problems.is_empty(), "{:?}", pt.problems);
    assert!(pt.punctuality > 0.99);
    assert!(pt.stable, "residual {} s", pt.residual_delay_s);
    // The Westpark terminal platforms are the bottleneck, at about 85 %.
    assert_eq!(pt.terminal, "Westpark");
    assert!(pt.terminal_share > 0.8 && pt.terminal_share < 0.9);
    assert!(pt.theoretical_per_hour > 12.0 && pt.theoretical_per_hour < 16.0);
    assert_eq!(run.verdict, Verdict::NearLimit);
    // The busiest section is described for the advice: what it is, how long, and the block length.
    let sec = pt.bottleneck_section.as_ref().expect("bottleneck section");
    assert!(sec.length_m > 0.0 && sec.to_m > sec.from_m);
    assert!(sec.speed_kmh > 0.0 && sec.block_m > 0.0);
}

#[test]
fn a_bottleneck_section_is_told_apart_as_platform_switch_area_or_plain_line() {
    let m = model();
    let line = metro_m1();
    let kinds: Vec<SectionKind> = m
        .tds
        .iter()
        .filter_map(|t| bottleneck_section(&m, &t.id, &line, 150.0).map(|s| s.kind))
        .collect();
    assert_eq!(kinds.len(), m.tds.len());
    for k in [
        SectionKind::Platform,
        SectionKind::Switches,
        SectionKind::Plain,
    ] {
        assert!(kinds.contains(&k), "no {k:?} section in {kinds:?}");
    }
    // A block is the train's braking distance at line speed plus the sighting distance.
    let plain = m
        .tds
        .iter()
        .filter_map(|t| bottleneck_section(&m, &t.id, &line, 150.0))
        .find(|s| s.kind == SectionKind::Plain)
        .unwrap();
    let v = plain.speed_kmh / 3.6;
    let expect = v * v / (2.0 * line.train.service_decel_mps2) + 150.0;
    assert!((plain.block_m - expect).abs() < 1e-6);
    assert!(bottleneck_section(&m, "no such section", &line, 150.0).is_none());
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
    // Every 4 minutes still fits; every 3 minutes no longer fits the Westpark turn-backs. (Every
    // 4 minutes used to lose a trip only because the ramp into the peak put two trains five
    // seconds apart, Damascus test, bug 25.)
    let four = sweep_point(&m, &lines, &p, 0, 240.0).unwrap();
    assert_eq!(four.verdict, Verdict::NearLimit);
    assert_eq!(four.unplaced, 0);
    let three = sweep_point(&m, &lines, &p, 0, 180.0).unwrap();
    assert_eq!(three.verdict, Verdict::NotEnoughCapacity);
    assert!(three.unplaced > 0);
    // The trips that ran and the ones left out are both counted, so the on-time share can be
    // read against the trips that ran.
    assert!(
        three.trips > four.trips / 2,
        "{} ran, {} left out",
        three.trips,
        three.unplaced
    );
    let points = [&run.lines[0].planned, &four, &three];
    assert_eq!(practical_maximum(&points), Some(15.0));
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
    // Every 3.5 minutes the plan stables trains on both Eastgate sidings behind switch ess.
    let (m, p) = cut_plan(210.0);
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

#[test]
fn the_projects_signalling_values_reach_the_planner_and_kernel() {
    use rail_sim::capacity::Signalling;
    let p: CapacityParams = serde_json::from_str(
        r#"{"signalling": {"route_setting_s": 8, "sighting_m": 200, "supervision_tolerance_kmh": 3.6, "terminal_separation_s": 120}}"#,
    )
    .unwrap();
    let pp = p.signalling.plan(rail_plan::PlanParams::default());
    assert_eq!(pp.blocking.route_setting_s, 8.0);
    assert_eq!(pp.blocking.sighting_m, 200.0);
    assert_eq!(pp.terminal_separation_s, 120.0);
    let np = p.signalling.net(rail_sim::network::NetParams::default());
    assert_eq!(np.interlocking.route_setting_s, 8.0);
    assert_eq!(np.request_margin_m, 200.0);
    assert!((np.supervision_tol_mps - 1.0).abs() < 1e-9);
    // Left out, the defaults stay, and the run's settings serialise as before.
    assert!(Signalling::default().is_empty());
    let out = serde_json::to_value(CapacityParams::default()).unwrap();
    assert!(out.get("signalling").is_none());
}

#[test]
fn the_replay_moves_every_train_along_the_track_through_the_period() {
    let m = model();
    let p = CapacityParams::default();
    let r = replay(&m, &[metro_m1()], &p, 10.0).unwrap();
    assert!(r.stopped.is_none(), "{:?}", r.stopped);
    assert_eq!(r.begin, p.from_s - p.warmup_s);
    assert_eq!(
        r.frames,
        ((p.to_s + p.recovery_s - r.begin) / 10.0) as usize + 1
    );
    assert_eq!(r.lines, vec![("M1".to_string(), "M1".to_string())]);
    assert!(!r.trains.is_empty());
    let track_ids: Vec<&str> = m.tracks.iter().map(|t| t.id.as_str()).collect();
    assert!(r
        .tracks
        .iter()
        .all(|(t, from)| track_ids.contains(&t.as_str()) && *from == 0.0));
    for tr in &r.trains {
        assert_eq!(tr.s.len(), r.frames * 3);
        assert_eq!(tr.st.len() % 4, 0);
    }
    // Trains move: some train is somewhere else at the end of the period than at its start.
    let at = |tr: &rail_sim::capacity::ReplayTrain, k: usize| (tr.s[k * 3], tr.s[k * 3 + 1]);
    assert!(r.trains.iter().any(|tr| at(tr, 0) != at(tr, r.frames / 2)));
    assert!(r
        .trains
        .iter()
        .any(|tr| tr.s.chunks(3).any(|x| x[2] > 30.0)));
    // A train with passenger calls ends its day with a last call, and arrives at its stops.
    let busy = r.trains.iter().find(|tr| !tr.st.is_empty()).unwrap();
    assert_eq!(busy.st[busy.st.len() - 1], 2.0);
    assert!(busy.st.chunks(4).filter(|c| c[1] >= 0.0).count() > 1);
}
