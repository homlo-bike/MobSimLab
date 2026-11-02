mod common;

use std::collections::BTreeMap;
use std::sync::OnceLock;

use rail_model::{examples, Model};
use rail_plan::{
    find_path, plan, publish, report, resolve, Call, Pick, Place, Plan, PlanParams, RunKind,
};

fn model() -> &'static Model {
    static M: OnceLock<Model> = OnceLock::new();
    M.get_or_init(|| Model::compile(&examples::metro_line()).unwrap())
}

fn day() -> &'static Plan {
    static P: OnceLock<Plan> = OnceLock::new();
    P.get_or_init(|| plan(model(), &[common::metro_m1()], &PlanParams::default()).unwrap())
}

fn ids() -> Vec<String> {
    vec!["M1".to_string()]
}

#[test]
fn stations_with_the_same_name_are_one_pick() {
    let m = model();
    let alder = resolve(m, &Call::at("alder").pick).unwrap();
    assert_eq!(alder.len(), 2, "both Alder platforms");
    let one = resolve(m, &Pick::Platforms(vec!["alder-2".into()])).unwrap();
    assert_eq!(one.len(), 1);
    assert!(resolve(m, &Call::at("Nowhere").pick).is_err());
}

#[test]
fn path_runs_through_one_platform_per_call_in_the_running_direction() {
    let m = model();
    let cand = |name: &str| -> Vec<(Place, f64)> {
        resolve(m, &Call::at(name).pick)
            .unwrap()
            .into_iter()
            .map(|p| (Place::Platform(p), 0.0))
            .collect()
    };
    let start = vec![
        m.route("S_WP1>E0B").unwrap(),
        m.route("S_WP1>E0B#1").unwrap(),
    ];
    let calls: Vec<_> = ["Alder", "Birch", "Cedar", "Eastgate"]
        .iter()
        .map(|s| cand(s))
        .collect();
    let p = find_path(m, &start, &calls, 64).expect("a path");
    let names: Vec<String> = p.places.iter().map(|pl| pl.id(m)).collect();
    assert_eq!(&names[..3], &["alder-1", "birch-1", "cedar-1"]);
    assert!(names[3].starts_with("eastgate-"), "{names:?}");
    // The direct starter route is shorter than the one via the crossover.
    assert_eq!(p.routes[0], start[0]);
}

#[test]
fn a_day_is_planned_without_conflicts_or_issues() {
    let m = model();
    let p = day();
    assert!(p.issues.is_empty(), "{:?}", p.issues);
    let r = report(m, p, &ids(), PlanParams::default().min_buffer_s, 0.15, 0.85);
    assert!(
        r.conflicts.is_empty(),
        "{:?}",
        &r.conflicts[..r.conflicts.len().min(3)]
    );
    // 05:00-24:00, every 10 min plus every 5 min in 5.5 peak hours, both ways.
    let per_dir = 19 * 6 + 55 / 10 * 6 + 3;
    assert!(r.trips >= 2 * (per_dir - 3), "{} trips", r.trips);
    assert_eq!(r.trips, 294);
    // A 5 min service on a ~19 min round trip needs four trains.
    assert_eq!(p.vehicles, 4);
    assert_eq!(r.peak_out, 4);
    assert_eq!(r.reserve, 1);
}

#[test]
fn every_train_runs_a_consistent_chain_from_stabling_to_stabling() {
    let p = day();
    let mut by_vehicle: BTreeMap<usize, Vec<&rail_plan::PlannedRun>> = BTreeMap::new();
    for r in &p.runs {
        by_vehicle.entry(r.vehicle).or_default().push(r);
    }
    for (v, runs) in &mut by_vehicle {
        runs.sort_by(|a, b| a.depart_s().partial_cmp(&b.depart_s()).unwrap());
        assert_eq!(runs.first().unwrap().kind, RunKind::PullOut, "train {v}");
        assert_eq!(runs.last().unwrap().kind, RunKind::PullIn, "train {v}");
        for w in runs.windows(2) {
            let (a, b) = (w[0], w[1]);
            assert_eq!(
                a.calls.last().unwrap().id,
                b.calls.first().unwrap().id,
                "train {v}: {} ends where {} starts",
                a.name,
                b.name
            );
            assert!(b.depart_s() >= a.arrive_s(), "{} after {}", b.name, a.name);
            if a.kind == RunKind::Service && b.kind == RunKind::Service {
                assert!(b.depart_s() - a.arrive_s() >= 179.0, "turn-back {}", b.name);
            }
        }
    }
}

#[test]
fn through_stations_use_the_same_platform_per_direction() {
    let p = day();
    let mut seen: BTreeMap<(u8, usize), String> = BTreeMap::new();
    for r in p.runs.iter().filter(|r| r.kind == RunKind::Service) {
        let n = r.calls.len();
        for (i, c) in r.calls.iter().enumerate().take(n - 1).skip(1) {
            let usual = seen.entry((r.direction, i)).or_insert_with(|| c.id.clone());
            assert_eq!(*usual, c.id, "{} at call {i}", r.name);
        }
    }
}

#[test]
fn stabling_never_exceeds_track_capacity() {
    let p = day();
    // 400 m storage tracks hold three 120 m trains with 10 m gaps.
    for (track, vs) in p.stabling_start.iter().chain(p.stabling_end.iter()) {
        assert!(vs.len() <= 3, "{track}: {vs:?}");
    }
    let morning: usize = p.stabling_start.values().map(|v| v.len()).sum();
    let night: usize = p.stabling_end.values().map(|v| v.len()).sum();
    assert_eq!(morning, p.vehicles);
    assert_eq!(night, p.vehicles);
}

#[test]
fn capacity_names_the_terminal_as_the_limit_in_the_peak() {
    let m = model();
    let r = report(
        m,
        day(),
        &ids(),
        PlanParams::default().min_buffer_s,
        0.15,
        0.85,
    );
    let peak = r
        .capacity
        .iter()
        .find(|c| c.hour == 8 && c.direction == 0)
        .unwrap();
    assert_eq!(peak.trains, 12);
    assert!(peak.consumption > 0.3 && peak.consumption < 1.0, "{peak:?}");
    assert!(peak.terminal_share > peak.consumption, "{peak:?}");
    let noon = r
        .capacity
        .iter()
        .find(|c| c.hour == 12 && c.direction == 0)
        .unwrap();
    assert_eq!(noon.trains, 6);
    assert!(noon.consumption < peak.consumption);
    for x in &r.max_capacity {
        assert_eq!(x.planned_per_hour, 12);
        assert!(x.theoretical_per_hour >= 12.0, "{x:?}");
        assert!((x.practical_per_hour - 0.85 * x.theoretical_per_hour).abs() < 1e-9);
    }
}

#[test]
fn published_timetable_is_consistent() {
    let m = model();
    let p = day();
    let t = publish(m, p, &ids());
    assert_eq!(t.trips.len(), 294);
    assert_eq!(t.stop_times.len(), 294 * 5);
    let stations: Vec<_> = t.stops.iter().filter(|s| s.location_type == 1).collect();
    assert_eq!(stations.len(), 5);
    for s in t.stops.iter().filter(|s| s.location_type == 0) {
        let parent = s.parent_station.as_ref().expect("platform has a station");
        assert!(stations.iter().any(|st| &st.stop_id == parent));
    }
    for trip in &t.trips {
        assert!(trip.block_id.starts_with("train-"));
        let st: Vec<_> = t
            .stop_times
            .iter()
            .filter(|s| s.trip_id == trip.trip_id)
            .collect();
        assert_eq!(st.len(), 5);
        assert_eq!(st[0].drop_off_type, 1);
        assert_eq!(st[4].pickup_type, 1);
        for w in st.windows(2) {
            assert!(w[1].stop_sequence > w[0].stop_sequence);
            assert!(w[1].arrival_time > w[0].departure_time, "{}", trip.trip_id);
        }
        for s in &st {
            assert!(s.departure_time >= s.arrival_time);
        }
    }
}
