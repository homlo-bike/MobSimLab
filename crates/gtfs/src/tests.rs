use super::*;

fn feed() -> BTreeMap<String, String> {
    let mut f = BTreeMap::new();
    let mut put = |k: &str, v: &str| {
        f.insert(k.to_string(), v.to_string());
    };
    put("agency.txt", "agency_id,agency_name,agency_url,agency_timezone\nA,City Transit,https://example.org,Europe/Berlin\n");
    put(
        "stops.txt",
        "stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station\n\
         S,Central,52.0,13.0,1,\n\
         s1,Central,52.0,13.0,0,S\n\
         s2,Market,52.01,13.01,0,\n\
         s3,Park,52.02,13.02,0,\n\
         far,Far away,48.0,11.0,0,\n",
    );
    put(
        "routes.txt",
        "route_id,agency_id,route_short_name,route_long_name,route_type,route_color\n\
         R1,A,1,,3,FF0000\n\
         T,A,,Tramway,900,\n\
         X,A,X,,9999,\n",
    );
    put(
        "trips.txt",
        "route_id,service_id,trip_id,direction_id\n\
         R1,WD,t1,0\n\
         R1,WE,t2,0\n\
         T,WD,f1,1\n\
         X,WD,x1,0\n\
         R1,WD,out,0\n",
    );
    put(
        "stop_times.txt",
        "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n\
         t1,07:00:00,07:00:00,s1,1\n\
         t1,,,s2,2\n\
         t1,07:10:00,07:10:30,s3,3\n\
         t2,08:00:00,08:00:00,s1,1\n\
         t2,08:05:00,08:05:00,s2,2\n\
         f1,06:00:00,06:00:00,s3,1\n\
         f1,06:04:00,06:04:30,s2,2\n\
         f1,06:09:00,06:09:00,s1,3\n\
         x1,25:00:00,25:00:00,s1,1\n\
         x1,25:03:00,25:03:00,s3,2\n\
         out,09:00:00,09:00:00,far,1\n\
         out,09:30:00,09:30:00,far,2\n",
    );
    put(
        "calendar.txt",
        "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n\
         WD,1,1,1,1,1,0,0,20260105,20261231\n\
         WE,0,0,0,0,0,1,1,20260105,20261231\n",
    );
    put(
        "calendar_dates.txt",
        "service_id,date,exception_type\nWE,20260107,1\n",
    );
    put(
        "frequencies.txt",
        "trip_id,start_time,end_time,headway_secs\nf1,06:00:00,09:00:00,600\n",
    );
    put(
        "transfers.txt",
        "from_stop_id,to_stop_id,transfer_type,min_transfer_time\ns1,s2,2,120\ns1,far,2,60\n",
    );
    f
}

#[test]
fn times_and_dates() {
    assert_eq!(parse_time("25:03:07"), Some(90_187));
    assert_eq!(parse_time(" 7:00:00"), Some(25_200));
    assert_eq!(parse_time(""), None);
    assert_eq!(fmt_time(90_187), "25:03:07");
    assert_eq!(date_of(day_of("20261115").unwrap()), "20261115");
    // 2026-11-15 is a Sunday, 2026-01-07 a Wednesday.
    assert_eq!(weekday_col(day_of("20261115").unwrap()), "sunday");
    assert_eq!(weekday_col(day_of("20260107").unwrap()), "wednesday");
    assert_eq!(day_of("2026-11-15"), None);
}

#[test]
fn imports_the_busiest_wednesday_with_box() {
    let got = import(&ImportInput {
        files: feed(),
        date: None,
        bbox: Some([12.9, 51.9, 13.1, 52.1]),
    })
    .unwrap();
    let s = &got.summary;
    // 2026-01-07 is the first Wednesday and has the weekend service added: the busiest.
    assert_eq!(s.date, "20260107");
    assert_eq!(s.agencies, vec!["City Transit".to_string()]);
    assert_eq!((s.trips, s.patterns, s.outside), (3, 1, 1));
    assert!(s.warnings.iter().any(|w| w.contains("9999")));
    let tt = &got.timetable;
    let t1 = tt.trips.iter().find(|t| t.trip_id == "t1").unwrap();
    // The empty time is interpolated halfway.
    assert_eq!(t1.stop_times[1].departure_time, 7 * 3600 + 300);
    assert_eq!(t1.stop_times[2].arrival_time, 7 * 3600 + 600);
    assert_eq!(t1.stop_times[2].departure_time, 7 * 3600 + 630);
    let p = &tt.frequency_patterns[0];
    assert_eq!(p.pattern_id, "f1");
    assert_eq!(p.stops[1].run_time, 240);
    assert_eq!(p.stops[1].dwell_time, 30);
    assert_eq!(p.stops[2].run_time, 270);
    assert_eq!(p.periods[0].headway_secs, 600);
    let tram = tt.routes.iter().find(|r| r.route_id == "T").unwrap();
    assert_eq!(
        (tram.mode.as_str(), tram.route_short_name.as_str()),
        ("tram", "Tramway")
    );
    let bus = tt.routes.iter().find(|r| r.route_id == "R1").unwrap();
    assert_eq!(bus.route_color.as_deref(), Some("ff0000"));
    assert!(tt
        .stops
        .iter()
        .all(|s| s.stop_id != "far" && s.stop_id != "S"));
    assert_eq!(
        tt.stops
            .iter()
            .find(|s| s.stop_id == "s1")
            .unwrap()
            .parent_station
            .as_deref(),
        Some("S")
    );
    assert_eq!(tt.transfers.len(), 1);
}

#[test]
fn a_given_date_and_errors() {
    let got = import(&ImportInput {
        files: feed(),
        date: Some("20260110".into()),
        bbox: None,
    })
    .unwrap();
    assert_eq!(got.summary.trips, 1);
    assert_eq!(got.timetable.trips[0].trip_id, "t2");
    let none = import(&ImportInput {
        files: feed(),
        date: Some("20250101".into()),
        bbox: None,
    });
    assert!(none.unwrap_err().english().contains("20250101"));
    let mut f = feed();
    f.remove("stops.txt");
    assert!(import(&ImportInput {
        files: f,
        date: None,
        bbox: None
    })
    .unwrap_err()
    .english()
    .contains("stops.txt"));
    let boxed = import(&ImportInput {
        files: feed(),
        date: None,
        bbox: Some([0.0, 0.0, 1.0, 1.0]),
    });
    assert!(boxed.unwrap_err().english().contains("map view"));
}

#[test]
fn files_in_a_folder_are_found() {
    let f: BTreeMap<String, String> = feed()
        .into_iter()
        .map(|(k, v)| (format!("feed/{k}"), v))
        .collect();
    assert!(import(&ImportInput {
        files: f,
        date: None,
        bbox: None
    })
    .is_ok());
}

#[test]
fn export_round_trips() {
    let got = import(&ImportInput {
        files: feed(),
        date: None,
        bbox: Some([12.9, 51.9, 13.1, 52.1]),
    })
    .unwrap();
    let mut tt = got.timetable.clone();
    tt.routes.push(Route {
        route_id: "G".into(),
        route_short_name: "Gondola".into(),
        mode: "aerial_tramway".into(),
        route_color: None,
    });
    let files = export(&ExportInput {
        timetable: tt,
        agency_name: "Study, \"A\"".into(),
        agency_url: "https://example.org".into(),
        agency_timezone: "Europe/Berlin".into(),
        lang: "en".into(),
        start_date: "20270101".into(),
        end_date: "20271231".into(),
        route_types: BTreeMap::from([("aerial_tramway".to_string(), 6)]),
        feed_version: "v1".into(),
        holidays: Vec::new(),
        weekend: None,
    });
    for f in [
        "agency.txt",
        "stops.txt",
        "routes.txt",
        "calendar.txt",
        "trips.txt",
        "stop_times.txt",
        "frequencies.txt",
        "transfers.txt",
        "feed_info.txt",
    ] {
        assert!(files.contains_key(f), "{f}");
    }
    let routes = csv::parse(&files["routes.txt"]);
    let g = routes
        .rows
        .iter()
        .find(|r| routes.get(r, "route_id") == "G")
        .unwrap();
    assert_eq!(routes.get(g, "route_type"), "6");
    let t = routes
        .rows
        .iter()
        .find(|r| routes.get(r, "route_id") == "T")
        .unwrap();
    assert_eq!(routes.get(t, "route_type"), "0");
    let stops = csv::parse(&files["stops.txt"]);
    let station = stops
        .rows
        .iter()
        .find(|r| stops.get(r, "stop_id") == "S")
        .unwrap();
    assert_eq!(stops.get(station, "location_type"), "1");
    let agency = csv::parse(&files["agency.txt"]);
    assert_eq!(agency.get(&agency.rows[0], "agency_name"), "Study, \"A\"");

    // Read back: the same trips and the pattern with its headway.
    let back = import(&ImportInput {
        files,
        date: Some("20270106".into()),
        bbox: None,
    })
    .unwrap();
    assert_eq!(back.summary.trips, got.summary.trips);
    assert_eq!(back.summary.patterns, 1);
    let t1a = got
        .timetable
        .trips
        .iter()
        .find(|t| t.trip_id == "t1")
        .unwrap();
    let t1b = back
        .timetable
        .trips
        .iter()
        .find(|t| t.trip_id == "t1")
        .unwrap();
    assert_eq!(
        serde_json::to_value(&t1a.stop_times).unwrap(),
        serde_json::to_value(&t1b.stop_times).unwrap()
    );
    assert_eq!(
        serde_json::to_value(&back.timetable.frequency_patterns[0].stops).unwrap(),
        serde_json::to_value(&got.timetable.frequency_patterns[0].stops).unwrap()
    );
}

#[test]
fn export_runs_each_day_type_on_its_days_and_holidays_instead() {
    let got = import(&ImportInput {
        files: feed(),
        date: None,
        bbox: Some([12.9, 51.9, 13.1, 52.1]),
    })
    .unwrap();
    let mut tt = got.timetable.clone();
    let base = tt.trips[0].clone();
    for day in ["weekday", "saturday", "sunday", "holiday"] {
        let mut t = base.clone();
        t.trip_id = format!("{}~{day}", base.trip_id);
        t.service_id = day.into();
        tt.trips.push(t);
    }
    let files = export(&ExportInput {
        timetable: tt,
        agency_name: "Study".into(),
        agency_url: "https://example.org".into(),
        agency_timezone: "Europe/Berlin".into(),
        lang: "en".into(),
        start_date: "20270101".into(),
        end_date: "20271231".into(),
        route_types: BTreeMap::new(),
        feed_version: "v1".into(),
        // New Year's Day (a Friday), Easter Monday, a Saturday holiday, and one outside the validity.
        holidays: vec![
            "20270101".into(),
            "20270329".into(),
            "20271225".into(),
            "20280101".into(),
        ],
        weekend: None,
    });
    let cal = csv::parse(&files["calendar.txt"]);
    let days = |id: &str| {
        let r = cal
            .rows
            .iter()
            .find(|r| cal.get(r, "service_id") == id)
            .unwrap();
        [
            "monday",
            "tuesday",
            "wednesday",
            "thursday",
            "friday",
            "saturday",
            "sunday",
        ]
        .map(|c| cal.get(r, c).to_string())
        .concat()
    };
    assert_eq!(days("weekday"), "1111100");
    assert_eq!(days("saturday"), "0000010");
    assert_eq!(days("sunday"), "0000001");
    assert_eq!(days("holiday"), "0000000");
    let dates = csv::parse(&files["calendar_dates.txt"]);
    let rows: Vec<String> = dates
        .rows
        .iter()
        .map(|r| {
            format!(
                "{} {} {}",
                dates.get(r, "service_id"),
                dates.get(r, "date"),
                dates.get(r, "exception_type")
            )
        })
        .collect();
    assert_eq!(
        rows,
        [
            "holiday 20270101 1",
            "weekday 20270101 2",
            "holiday 20270329 1",
            "weekday 20270329 2",
            "holiday 20271225 1",
            "saturday 20271225 2",
        ]
    );
}

#[test]
fn export_runs_the_weekend_services_on_a_friday_and_saturday_weekend() {
    let got = import(&ImportInput {
        files: feed(),
        date: None,
        bbox: Some([12.9, 51.9, 13.1, 52.1]),
    })
    .unwrap();
    let mut tt = got.timetable.clone();
    let base = tt.trips[0].clone();
    for day in ["weekday", "saturday", "sunday", "holiday"] {
        let mut t = base.clone();
        t.trip_id = format!("{}~{day}", base.trip_id);
        t.service_id = day.into();
        tt.trips.push(t);
    }
    let files = export(&ExportInput {
        timetable: tt,
        agency_name: "Study".into(),
        agency_url: "https://example.org".into(),
        agency_timezone: "Asia/Damascus".into(),
        lang: "en".into(),
        start_date: "20270101".into(),
        end_date: "20271231".into(),
        route_types: BTreeMap::new(),
        feed_version: "v1".into(),
        // 1 January 2027 is a Friday, 2 January a Saturday, 4 January a Monday.
        holidays: vec!["20270101".into(), "20270102".into(), "20270104".into()],
        weekend: Some(Weekend {
            rest: 5,
            second: Some(6),
        }),
    });
    let cal = csv::parse(&files["calendar.txt"]);
    let days = |id: &str| {
        let r = cal
            .rows
            .iter()
            .find(|r| cal.get(r, "service_id") == id)
            .unwrap();
        [
            "monday",
            "tuesday",
            "wednesday",
            "thursday",
            "friday",
            "saturday",
            "sunday",
        ]
        .map(|c| cal.get(r, c).to_string())
        .concat()
    };
    assert_eq!(days("weekday"), "1111001");
    assert_eq!(days("saturday"), "0000010");
    assert_eq!(days("sunday"), "0000100");
    let dates = csv::parse(&files["calendar_dates.txt"]);
    let rows: Vec<String> = dates
        .rows
        .iter()
        .map(|r| format!("{} {}", dates.get(r, "service_id"), dates.get(r, "date")))
        .collect();
    assert_eq!(
        rows,
        [
            "holiday 20270101",
            "sunday 20270101",
            "holiday 20270102",
            "saturday 20270102",
            "holiday 20270104",
            "weekday 20270104",
        ]
    );
}

#[test]
fn export_runs_no_saturday_service_on_a_one_day_weekend() {
    let got = import(&ImportInput {
        files: feed(),
        date: None,
        bbox: Some([12.9, 51.9, 13.1, 52.1]),
    })
    .unwrap();
    let mut tt = got.timetable.clone();
    let base = tt.trips[0].clone();
    for day in ["weekday", "saturday", "sunday"] {
        let mut t = base.clone();
        t.trip_id = format!("{}~{day}", base.trip_id);
        t.service_id = day.into();
        tt.trips.push(t);
    }
    let files = export(&ExportInput {
        timetable: tt,
        agency_name: "Study".into(),
        agency_url: "https://example.org".into(),
        agency_timezone: "Asia/Tehran".into(),
        lang: "en".into(),
        start_date: "20270101".into(),
        end_date: "20271231".into(),
        route_types: BTreeMap::new(),
        feed_version: "v1".into(),
        holidays: vec![],
        weekend: Some(Weekend {
            rest: 5,
            second: None,
        }),
    });
    let cal = csv::parse(&files["calendar.txt"]);
    let days = |id: &str| {
        let r = cal
            .rows
            .iter()
            .find(|r| cal.get(r, "service_id") == id)
            .unwrap();
        [
            "monday",
            "tuesday",
            "wednesday",
            "thursday",
            "friday",
            "saturday",
            "sunday",
        ]
        .map(|c| cal.get(r, c).to_string())
        .concat()
    };
    assert_eq!(days("weekday"), "1111011");
    assert_eq!(days("saturday"), "0000000");
    assert_eq!(days("sunday"), "0000100");
}
