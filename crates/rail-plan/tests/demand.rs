use rail_plan::{
    bands, dwell_s, link_loads, suggest_frequency, Binding, DwellParams, FrequencyInput, Period,
    PeriodKind,
};

fn input(load: f64) -> FrequencyInput {
    FrequencyInput {
        max_load_pph: load,
        unit_capacity: 300.0,
        units: 1,
        max_units: 3,
        target_load_factor: 0.8,
        policy_headway_s: 600.0,
        min_headway_s: 120.0,
    }
}

#[test]
fn link_loads_follow_boarders_and_alighters() {
    let l = link_loads(&[100.0, 50.0, 20.0, 0.0], &[0.0, 30.0, 60.0, 80.0]);
    assert_eq!(l, vec![100.0, 120.0, 80.0]);
}

#[test]
fn light_demand_gets_the_policy_headway() {
    let s = suggest_frequency(&input(500.0));
    assert_eq!(s.binding, Binding::Policy);
    assert_eq!(s.headway_s, 600.0);
    assert_eq!(s.units, 1);
    assert_eq!(s.shortfall_pph, 0.0);
}

#[test]
fn heavy_demand_gets_a_clock_face_headway_that_carries_it() {
    // 240 pax per train at 0.8: 4000 pph needs 16.7 trains/h -> every 3 min.
    let s = suggest_frequency(&input(4000.0));
    assert_eq!(s.binding, Binding::Demand);
    assert_eq!(s.headway_s, 180.0);
    assert_eq!(s.shortfall_pph, 0.0);
    assert!(3600.0 / s.headway_s * 240.0 >= 4000.0);
}

#[test]
fn longer_trains_before_headways_the_line_cannot_run() {
    let mut i = input(9000.0);
    i.min_headway_s = 180.0;
    let s = suggest_frequency(&i);
    assert!(s.units > 1, "{s:?}");
    assert!(s.headway_s >= 180.0);
    assert_eq!(s.shortfall_pph, 0.0);
    // Beyond the longest train the shortfall is reported.
    i.max_load_pph = 20_000.0;
    let s = suggest_frequency(&i);
    assert_eq!(s.units, 3);
    assert_eq!(s.headway_s, 180.0);
    assert!(s.shortfall_pph > 0.0);
}

#[test]
fn dwell_grows_with_passengers_and_has_a_floor() {
    let p = DwellParams {
        door_open_close_s: 5.0,
        board_s: 2.0,
        alight_s: 1.5,
        door_channels: 12,
        peaking: 1.5,
        min_dwell_s: 20.0,
    };
    assert_eq!(dwell_s(0.0, 0.0, &p), 20.0);
    // 5 + 1.5 * (120*2 + 60*1.5) / 12 = 46.25 -> 47.
    assert_eq!(dwell_s(120.0, 60.0, &p), 47.0);
}

#[test]
fn bands_skip_no_service_periods() {
    let periods = [
        Period {
            kind: PeriodKind::NoService,
            from_s: 0.0,
            to_s: 18000.0,
        },
        Period {
            kind: PeriodKind::OffPeak,
            from_s: 18000.0,
            to_s: 23400.0,
        },
        Period {
            kind: PeriodKind::Peak,
            from_s: 23400.0,
            to_s: 32400.0,
        },
    ];
    let b = bands(&periods, |k| match k {
        PeriodKind::Peak => Some(300.0),
        PeriodKind::OffPeak => Some(600.0),
        PeriodKind::NoService => None,
    });
    assert_eq!(b.len(), 2);
    assert_eq!(b[0].headway_s, 600.0);
    assert_eq!(b[1].from_s, 23400.0);
}
