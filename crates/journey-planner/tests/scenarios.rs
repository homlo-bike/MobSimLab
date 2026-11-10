//! Journey planner scenarios on a small made-up network around (8.0 E, 47.0 N).
//!
//! Metro M1 runs west–east S1 – Central – S3; tram T1 runs from Central (another platform, 50 m away) north
//! to North. A slow bus B9 runs from S1 directly to North. Times are seconds after midnight.

use journey_planner::timetable::{
    FrequencyPattern, PatternStop, Period, PeriodKind, Route, Stop, StopTime, Transfer, Trip,
};
use journey_planner::{
    Journey, Leg, Planner, ProfileQuery, Query, Settings, TimeMode, Timetable, WaitKind,
};

const H: u32 = 3600;
const M: u32 = 60;

fn ll(x: f64, y: f64) -> [f64; 2] {
    let k = 111_320.0;
    [8.0 + x / (k * 47f64.to_radians().cos()), 47.0 + y / k]
}

fn stop(id: &str, name: &str, x: f64, y: f64, parent: Option<&str>) -> Stop {
    let p = ll(x, y);
    Stop {
        stop_id: id.into(),
        stop_name: name.into(),
        stop_lon: p[0],
        stop_lat: p[1],
        parent_station: parent.map(Into::into),
        platform_code: None,
    }
}

fn route(id: &str, mode: &str) -> Route {
    Route {
        route_id: id.into(),
        route_short_name: id.into(),
        mode: mode.into(),
        route_color: None,
    }
}

fn period(from: u32, to: u32, headway: u32, kind: PeriodKind) -> Period {
    Period {
        start_time: from,
        end_time: to,
        headway_secs: headway,
        offset_secs: Some(0),
        kind,
    }
}

fn pattern(id: &str, route: &str, stops: &[(&str, u32)], periods: Vec<Period>) -> FrequencyPattern {
    FrequencyPattern {
        pattern_id: id.into(),
        route_id: route.into(),
        direction_id: 0,
        service_id: "weekday".into(),
        stops: stops
            .iter()
            .map(|(s, run)| PatternStop {
                stop_id: (*s).into(),
                run_time: *run,
                dwell_time: if *run == 0 { 0 } else { 30 },
            })
            .collect(),
        periods,
    }
}

/// Peak 07:00–09:00, off-peak 06:00–07:00 and 09:00–22:00, no service otherwise.
fn day(peak: u32, off_peak: u32) -> Vec<Period> {
    vec![
        period(6 * H, 7 * H, off_peak, PeriodKind::OffPeak),
        period(7 * H, 9 * H, peak, PeriodKind::Peak),
        period(9 * H, 22 * H, off_peak, PeriodKind::OffPeak),
    ]
}

fn network() -> Timetable {
    Timetable {
        stops: vec![
            stop("s1", "West", 0.0, 0.0, None),
            stop("c_m", "Central", 2000.0, 0.0, Some("central")),
            stop("s3", "East", 4000.0, 0.0, None),
            stop("c_t", "Central", 2000.0, 50.0, Some("central")),
            stop("n", "North", 2000.0, 3000.0, None),
        ],
        routes: vec![
            route("M1", "metro"),
            route("T1", "tram"),
            route("B9", "bus"),
        ],
        trips: vec![],
        transfers: vec![],
        frequency_patterns: vec![
            pattern(
                "m1",
                "M1",
                &[("s1", 0), ("c_m", 120), ("s3", 120)],
                day(5 * M, 10 * M),
            ),
            pattern("t1", "T1", &[("c_t", 0), ("n", 420)], day(5 * M, 15 * M)),
            pattern("b9", "B9", &[("s1", 0), ("n", 1800)], day(30 * M, 60 * M)),
        ],
    }
}

fn depart(p: &Planner, from: [f64; 2], to: [f64; 2], t: u32) -> Vec<Journey> {
    p.plan(&Query {
        from,
        to,
        time_s: t,
        mode: TimeMode::DepartAt,
    })
    .journeys
}

fn kinds(j: &Journey) -> Vec<&'static str> {
    j.legs
        .iter()
        .map(|l| match l {
            Leg::Walk { .. } => "walk",
            Leg::Wait {
                kind: WaitKind::Initial,
                ..
            } => "wait",
            Leg::Wait {
                kind: WaitKind::Transfer,
                ..
            } => "change_wait",
            Leg::Ride { .. } => "ride",
        })
        .collect()
}

fn assert_consistent(j: &Journey) {
    assert_eq!(j.breakdown.total(), j.total_s, "parts add up: {j:?}");
    for w in j.legs.windows(2) {
        assert_eq!(
            w[0].end_s(),
            w[1].start_s(),
            "legs are contiguous: {:?}",
            j.legs
        );
    }
    assert_eq!(j.legs.first().unwrap().start_s(), j.depart_s);
    assert_eq!(j.legs.last().unwrap().end_s(), j.arrive_s);
}

#[test]
fn metro_then_tram_with_every_part_of_the_time() {
    let p = Planner::new(&network(), Settings::default());
    // 200 m south of West, to 200 m north of North, leaving 10:02.
    let js = depart(&p, ll(0.0, -200.0), ll(2000.0, 3200.0), 10 * H + 2 * M);
    let j = &js[0];
    assert_consistent(j);
    assert_eq!(
        kinds(j),
        [
            "walk",
            "wait",
            "ride",
            "walk",
            "change_wait",
            "ride",
            "walk"
        ]
    );
    assert_eq!(j.transfers, 1);
    // Walk 200 m × 1.3 at 1.25 m/s = 208 s, then the 10:10 metro, 2 min to Central.
    assert_eq!(j.breakdown.walk_s, 208 * 2);
    assert_eq!(j.breakdown.wait_s, 10 * H + 10 * M - (10 * H + 2 * M + 208));
    // 50 m between platforms: 52 s walk + 60 s level change; the 10:15 tram.
    assert_eq!(j.breakdown.transfer_walk_s, 112);
    let Leg::Ride {
        start_s, route_id, ..
    } = &j.legs[5]
    else {
        panic!()
    };
    assert_eq!((route_id.as_str(), *start_s), ("T1", 10 * H + 15 * M));
    assert_eq!(j.breakdown.in_vehicle_s, 120 + 420);
    // Leaving later avoids the wait at the first stop.
    assert_eq!(j.leave_s, 10 * H + 10 * M - 208);
    assert_eq!(j.door_to_door_s, j.arrive_s - j.leave_s);
}

#[test]
fn fewer_changes_offered_when_slower() {
    let p = Planner::new(&network(), Settings::default());
    let js = depart(&p, ll(0.0, -200.0), ll(2000.0, 3200.0), 10 * H + 2 * M);
    assert!(js.len() >= 2, "{js:?}");
    assert_eq!(js[0].rides, 2);
    let direct = js
        .iter()
        .find(|j| j.rides == 1)
        .expect("bus B9 without change");
    assert!(direct.arrive_s > js[0].arrive_s);
    assert_consistent(direct);
}

#[test]
fn arrive_by_finds_the_latest_departure() {
    let p = Planner::new(&network(), Settings::default());
    let (a, b) = (ll(0.0, -200.0), ll(2000.0, 3200.0));
    let target = 12 * H;
    let js = p
        .plan(&Query {
            from: a,
            to: b,
            time_s: target,
            mode: TimeMode::ArriveBy,
        })
        .journeys;
    let j = &js[0];
    assert!(j.arrive_s <= target);
    assert_eq!(j.breakdown.early_arrival_s, target - j.arrive_s);
    assert_eq!(j.breakdown.total(), j.total_s);
    assert_eq!(j.total_s, target - j.depart_s);
    // One second later no longer makes it.
    let later = depart(&p, a, b, j.depart_s + 1);
    assert!(later[0].arrive_s > target);
}

#[test]
fn night_without_service_waits_for_the_first_train() {
    let p = Planner::new(&network(), Settings::default());
    let js = depart(&p, ll(0.0, -200.0), ll(4000.0, 200.0), 2 * H);
    let j = &js[0];
    assert_eq!(j.rides, 1);
    let Leg::Ride { start_s, .. } = &j.legs[2] else {
        panic!()
    };
    assert_eq!(*start_s, 6 * H);
    assert!(j.breakdown.wait_s > 3 * H);
}

#[test]
fn peak_is_faster_than_off_peak_on_average() {
    let p = Planner::new(&network(), Settings::default());
    let prof = |start, end| {
        let pts = p.profile(&ProfileQuery {
            from: ll(0.0, -200.0),
            to: ll(2000.0, 3200.0),
            mode: TimeMode::DepartAt,
            start_s: start,
            end_s: end,
            step_s: 60,
        });
        let totals: Vec<u32> = pts
            .iter()
            .map(|pt| pt.journey.as_ref().unwrap().total_s)
            .collect();
        totals.iter().sum::<u32>() as f64 / totals.len() as f64
    };
    let peak = prof(7 * H, 8 * H + 30 * M);
    let off = prof(10 * H, 11 * H + 30 * M);
    assert!(peak + 180.0 < off, "peak {peak} off-peak {off}");
}

#[test]
fn short_trip_is_walked() {
    let p = Planner::new(&network(), Settings::default());
    let js = depart(&p, ll(0.0, 0.0), ll(300.0, 0.0), 10 * H);
    assert_eq!(js[0].rides, 0);
    assert_eq!(js[0].breakdown.walk_s, js[0].total_s);
}

#[test]
fn guaranteed_connection_uses_planned_change_time() {
    let mut tt = network();
    tt.transfers.push(Transfer {
        from_stop_id: "c_m".into(),
        to_stop_id: "c_t".into(),
        transfer_type: 1,
        min_transfer_time: Some(30),
        max_wait_s: Some(120),
        estimated: false,
    });
    // A tram timed to leave 1 minute after the 10:10 metro reaches Central (10:12).
    tt.trips.push(Trip {
        trip_id: "t1-timed".into(),
        route_id: "T1".into(),
        direction_id: 0,
        service_id: "weekday".into(),
        block_id: None,
        stop_times: vec![
            st("c_t", 0, 10 * H + 13 * M, 10 * H + 13 * M),
            st("n", 1, 10 * H + 20 * M, 10 * H + 20 * M),
        ],
    });
    let p = Planner::new(&tt, Settings::default());
    let j = &depart(&p, ll(0.0, -200.0), ll(2000.0, 3200.0), 10 * H + 2 * M)[0];
    let Leg::Ride {
        trip_id,
        guaranteed,
        ..
    } = &j.legs[5]
    else {
        panic!("{:?}", j.legs)
    };
    assert_eq!(trip_id, "t1-timed");
    assert!(*guaranteed);
    assert_consistent(j);
}

#[test]
fn forbidden_transfer_and_no_pickup_are_respected() {
    let mut tt = network();
    tt.transfers.push(Transfer {
        from_stop_id: "c_m".into(),
        to_stop_id: "c_t".into(),
        transfer_type: 3,
        min_transfer_time: None,
        max_wait_s: None,
        estimated: false,
    });
    let p = Planner::new(&tt, Settings::default());
    let js = depart(&p, ll(0.0, -200.0), ll(2000.0, 3200.0), 10 * H + 2 * M);
    assert!(
        js.iter().all(|j| j.rides <= 1),
        "only the bus remains: {js:?}"
    );

    // A trip that does not pick up at its first stop cannot be boarded there.
    let mut tt = network();
    tt.frequency_patterns.clear();
    let mut first = st("s1", 0, 10 * H, 10 * H);
    first.pickup_type = 1;
    tt.trips.push(Trip {
        trip_id: "x".into(),
        route_id: "M1".into(),
        direction_id: 0,
        service_id: "weekday".into(),
        block_id: None,
        stop_times: vec![first, st("s3", 1, 10 * H + 300, 10 * H + 300)],
    });
    let p = Planner::new(&tt, Settings::default());
    assert!(depart(&p, ll(0.0, 0.0), ll(4000.0, 0.0), 9 * H)
        .iter()
        .all(|j| j.rides == 0));
}

#[test]
fn overtaking_express_is_found() {
    let mut tt = network();
    tt.frequency_patterns.clear();
    // Slow train leaves first but arrives later than the express on the same stops.
    for (id, dep, arr) in [
        ("slow", 10 * H, 10 * H + 40 * M),
        ("fast", 10 * H + 5 * M, 10 * H + 15 * M),
    ] {
        tt.trips.push(Trip {
            trip_id: id.into(),
            route_id: "M1".into(),
            direction_id: 0,
            service_id: "weekday".into(),
            block_id: None,
            stop_times: vec![st("s1", 0, dep, dep), st("s3", 1, arr, arr)],
        });
    }
    let p = Planner::new(&tt, Settings::default());
    assert_eq!(p.summary().raptor_routes, 2);
    let j = &depart(&p, ll(0.0, 0.0), ll(4000.0, 0.0), 9 * H + 50 * M)[0];
    let Leg::Ride { trip_id, .. } = &j.legs[2] else {
        panic!()
    };
    assert_eq!(trip_id, "fast");
}

#[test]
fn service_day_filter() {
    let mut tt = network();
    for p in &mut tt.frequency_patterns {
        p.service_id = "sunday".into();
    }
    let s = Settings {
        service_id: Some("weekday".into()),
        ..Settings::default()
    };
    let p = Planner::new(&tt, s);
    assert_eq!(p.summary().trips, 0);
    assert!(depart(&p, ll(0.0, 0.0), ll(4000.0, 0.0), 10 * H).is_empty());
}

fn st(stop: &str, seq: u32, arr: u32, dep: u32) -> StopTime {
    StopTime {
        stop_id: stop.into(),
        stop_sequence: seq,
        arrival_time: arr,
        departure_time: dep,
        pickup_type: 0,
        drop_off_type: 0,
    }
}

#[test]
fn reach_matches_the_fastest_journey_to_every_stop() {
    let p = Planner::new(&network(), Settings::default());
    let t0 = 10 * H + 2 * M;
    let from = ll(0.0, 0.0);
    let ids = p.stop_ids();
    let arrive = p.reach(from, t0);
    assert_eq!(ids.len(), arrive.len());
    let at = |id: &str| arrive[ids.iter().position(|s| s == id).unwrap()];
    // West is where we stand.
    assert_eq!(at("s1"), Some(t0));
    // East: the 10:10 metro, 2 + 2 min with a 30 s dwell at Central.
    assert_eq!(at("s3"), Some(10 * H + 10 * M + 120 + 30 + 120));
    // Each stop's time equals the journey planner's arrival at that stop (destination = the stop).
    for id in ["c_m", "n", "s3"] {
        let s = network()
            .stops
            .into_iter()
            .find(|s| s.stop_id == id)
            .unwrap();
        let j = depart(&p, from, [s.stop_lon, s.stop_lat], t0);
        assert_eq!(
            at(id),
            Some(j[0].arrive_s),
            "{id}: reach and plan agree ({j:?})"
        );
    }
    // The tram platform: the change walk between the two platforms (52 s plus 60 s level change).
    assert_eq!(at("c_t"), at("c_m").map(|a| a + 112));
}

#[test]
fn reach_leaves_unreachable_stops_empty() {
    let mut tt = network();
    tt.stops.push(stop("far", "Far away", 50_000.0, 0.0, None));
    let p = Planner::new(&tt, Settings::default());
    let ids = p.stop_ids();
    let arrive = p.reach(ll(0.0, 0.0), 10 * H);
    assert_eq!(arrive[ids.iter().position(|s| s == "far").unwrap()], None);
}
