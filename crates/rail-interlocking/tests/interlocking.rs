use std::collections::BTreeSet;

use rail_interlocking::{CrossingState, Interlocking, Params, Refusal, RouteState};
use rail_model::{examples, Model, SwitchPosition};

fn model() -> Model {
    Model::compile(&examples::metro_line()).unwrap()
}

#[test]
fn route_locks_after_switch_throw_and_refuses_conflicts() {
    let m = model();
    let mut il = Interlocking::new(&m, Params::default());
    let r1 = m.route("H_W>wp1.end").unwrap();
    let r2 = m.route("H_W>wp2.end").unwrap();
    let h = il.request(0.0, r1, 1).unwrap();
    assert!(matches!(il.active(h).state, RouteState::Setting { .. }));
    assert_eq!(
        il.request(0.0, r2, 2),
        Err(Refusal::Locked(m.routes[r2 as usize].tds[0]))
    );
    il.update(1.0);
    assert!(!il.usable(h), "switches still moving");
    il.update(30.0);
    assert!(il.usable(h));
    for &(sw, pos) in &m.routes[r1 as usize].switches {
        assert_eq!(il.switch(sw), (pos, false));
    }
    il.check_invariants().unwrap();
    // The same request again returns the same route.
    assert_eq!(il.request(31.0, r1, 1), Ok(h));
}

#[test]
fn crossover_gets_flank_protection() {
    let m = model();
    let mut il = Interlocking::new(&m, Params::default());
    let wsb = m.switches.iter().position(|s| s.id == "wsb").unwrap() as u32;
    il.preset_switch(wsb, SwitchPosition::Diverging);
    // Westpark platform 1 straight out: wsa straight; its unused leg is the
    // crossover, whose far switch wsb must lead away from it.
    let r = m.route("S_WP1>E0B").unwrap();
    let h = il.request(0.0, r, 1).unwrap();
    il.update(60.0);
    assert!(il.usable(h));
    assert_eq!(il.switch(wsb), (SwitchPosition::Straight, false));
    // wsb is now flank-locked: a route that needs it diverging is refused.
    let via = m.routes.iter().position(|x| {
        x.switches.contains(&(wsb, SwitchPosition::Diverging))
            && !m.routes_conflict(r, m.route(&x.id).unwrap())
    });
    if let Some(v) = via {
        assert!(il.request(60.0, v as u32, 2).is_err());
    }
    il.check_invariants().unwrap();
}

#[test]
fn sections_release_behind_the_train_and_the_overlap_after_standing() {
    let m = model();
    let mut il = Interlocking::new(&m, Params::default());
    let r = m.route("E0B>SE1").unwrap();
    let route = m.routes[r as usize].clone();
    let h = il.request(0.0, r, 7).unwrap();
    il.update(10.0);
    assert!(il.usable(h));
    // The train runs through the route section by section.
    for (i, &s) in route.tds.iter().enumerate() {
        let mut occ = BTreeSet::from([s]);
        if i > 0 {
            occ.insert(route.tds[i - 1]);
        }
        il.occupy(7, &occ);
        il.check_invariants().unwrap();
        il.occupy(7, &BTreeSet::from([s]));
        assert_eq!(il.active(h).released, i, "sections before {i} released");
    }
    // Stands at the exit signal: the overlap is released after the time-out.
    il.standing_at_signal(100.0, 7);
    il.update(100.0 + Params::default().overlap_release_s - 1.0);
    assert!(il.active(h).overlap_held);
    il.update(100.0 + Params::default().overlap_release_s);
    assert!(!il.active(h).overlap_held);
    il.check_invariants().unwrap();
}

#[test]
fn next_route_of_the_same_train_takes_over_its_overlap() {
    let m = model();
    let mut il = Interlocking::new(&m, Params::default());
    let a = il.request(0.0, m.route("E0B>SE1").unwrap(), 1).unwrap();
    il.update(10.0);
    let b = il.request(10.0, m.route("SE1>E1B").unwrap(), 1).unwrap();
    assert!(!il.active(a).overlap_held);
    il.update(20.0);
    assert!(il.usable(b));
    il.check_invariants().unwrap();
}

#[test]
fn approach_locked_route_is_released_late() {
    let m = model();
    let mut il = Interlocking::new(&m, Params::default());
    let r = m.route("E1B>SE2").unwrap();
    let h = il.request(0.0, r, 1).unwrap();
    il.update(5.0);
    il.cancel(5.0, h, true);
    il.update(60.0);
    assert!(il.request(60.0, r, 2).is_err());
    il.update(5.0 + Params::default().approach_release_s);
    assert!(il.request(130.0, r, 2).is_ok());
}

#[test]
fn level_crossing_closes_and_opens() {
    let mut spec = examples::metro_line();
    spec.level_crossings.push(rail_model::LevelCrossingSpec {
        id: "lc1".into(),
        track: "e1".into(),
        position_m: 600.0,
        rail_zone_m: 5.0,
        approach_m: 700.0,
        warning_time_s: 30.0,
        protection: "barriers".into(),
        street_way: 1,
        street_name: "Mill Lane".into(),
        keep_clear_m: 3.0,
        bus: false,
        special_measures: vec!["line_speed".into()],
        reopen_s: None,
    });
    let m = Model::compile(&spec).unwrap();
    let mut il = Interlocking::new(&m, Params::default());
    let r = m.route("E1B>SE2").unwrap();
    assert_eq!(il.crossings_on(r), &[0]);
    il.trigger_crossing(0.0, 0, 1);
    assert!(matches!(
        il.crossing_state(0),
        CrossingState::Closing { .. }
    ));
    il.update(14.0);
    assert!(!il.crossing_safe(0));
    il.update(15.0);
    assert!(il.crossing_safe(0));
    // Obstacle detection: a vehicle in the road zone makes it unsafe.
    il.set_road_zone_clear(0, false);
    assert!(!il.crossing_safe(0));
    il.set_road_zone_clear(0, true);
    il.clear_crossing(40.0, 0, 1);
    assert_eq!(il.crossing_state(0), CrossingState::Open);
    assert_eq!(il.closures.len(), 1);
    assert_eq!(il.closures[0].to_s - il.closures[0].from_s, 40.0);
}
