//! GTFS importer and exporter (GTFS plugin, ADR-0036 §3 `importers` and `exporters`).
//!
//! - [`import`] reads a GTFS feed's text files into the published timetable
//!   (`contracts/published-timetable.schema.json`) for **one service day**: a date the planner gives, or
//!   the Wednesday with the most trips. Trips repeated by `frequencies.txt` become frequency patterns.
//!   An optional bounding box keeps only the trips that stop inside it, so a national feed can be cut
//!   down to the study area. GTFS route types become MobSimLab modes.
//! - [`export`] writes a published timetable as GTFS text files: exact trips as `trips.txt` and
//!   `stop_times.txt`, frequency patterns as a template trip with `frequencies.txt`, one weekday service
//!   in `calendar.txt`, and stations for the stop groups.
//!
//! The app unzips and zips the feed; this crate only sees text.

pub mod csv;
pub mod modes;

use csv::Table;
use engine_msg::{msg, Msg};
use journey_planner::timetable::{
    FrequencyPattern, PatternStop, Period, PeriodKind, Route, Stop, StopTime, Timetable, Transfer,
    Trip,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

/// The most trips a feed may bring into a project (the project drawing's limit).
pub const MAX_TRIPS: usize = 100_000;

/// What the importer reads and how.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ImportInput {
    /// File name (such as `stops.txt`) → text.
    pub files: BTreeMap<String, String>,
    /// Service day as `YYYYMMDD`; the Wednesday with the most trips when absent.
    #[serde(default)]
    pub date: Option<String>,
    /// Keep only trips that stop inside `[west, south, east, north]`.
    #[serde(default)]
    pub bbox: Option<[f64; 4]>,
}

/// What a feed brought in.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ImportSummary {
    pub agencies: Vec<String>,
    /// The service day read, `YYYYMMDD`.
    pub date: String,
    pub routes: usize,
    pub stops: usize,
    pub trips: usize,
    pub patterns: usize,
    /// Trips of the day left out because they do not stop inside the bounding box.
    pub outside: usize,
    /// In English.
    pub warnings: Vec<String>,
    /// The same as keys and values, for the app to show in the user's language.
    #[serde(default)]
    pub warning_msgs: Vec<Msg>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Imported {
    pub timetable: Timetable,
    pub summary: ImportSummary,
}

/// Purpose: seconds after midnight from GTFS `H:MM:SS` (hours may pass 24). None when empty or bad.
pub fn parse_time(s: &str) -> Option<u32> {
    let mut it = s.trim().split(':');
    let h: u32 = it.next()?.trim().parse().ok()?;
    let m: u32 = it.next()?.parse().ok()?;
    let sec: u32 = it.next()?.parse().ok()?;
    (m < 60 && sec < 61 && it.next().is_none()).then_some(h * 3600 + m * 60 + sec)
}

/// Purpose: GTFS `HH:MM:SS` from seconds after midnight.
pub fn fmt_time(s: u32) -> String {
    format!("{:02}:{:02}:{:02}", s / 3600, (s / 60) % 60, s % 60)
}

/// Days since 1970-01-01 of a civil date (proleptic Gregorian).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (
        if m <= 2 {
            yoe + era * 400 + 1
        } else {
            yoe + era * 400
        },
        m,
        d,
    )
}

/// Days since 1970-01-01 of `YYYYMMDD`.
fn day_of(s: &str) -> Option<i64> {
    let s = s.trim();
    if s.len() != 8 || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let y: i64 = s[0..4].parse().ok()?;
    let m: i64 = s[4..6].parse().ok()?;
    let d: i64 = s[6..8].parse().ok()?;
    ((1..=12).contains(&m) && (1..=31).contains(&d)).then(|| days_from_civil(y, m, d))
}

fn date_of(day: i64) -> String {
    let (y, m, d) = civil_from_days(day);
    format!("{y:04}{m:02}{d:02}")
}

/// Weekday column of `calendar.txt` for a day (1970-01-01 was a Thursday).
fn weekday_col(day: i64) -> &'static str {
    const COLS: [&str; 7] = [
        "thursday",
        "friday",
        "saturday",
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
    ];
    COLS[day.rem_euclid(7) as usize]
}

/// Services of a feed: `calendar.txt` ranges and weekdays, `calendar_dates.txt` exceptions.
struct Calendar {
    /// service → (start, end, weekday flags by column name).
    regular: HashMap<String, (i64, i64, HashSet<&'static str>)>,
    /// (service, day) → added (true) or removed (false).
    exceptions: HashMap<(String, i64), bool>,
}

impl Calendar {
    fn new(cal: Option<&Table>, dates: Option<&Table>) -> Self {
        const DAYS: [&str; 7] = [
            "monday",
            "tuesday",
            "wednesday",
            "thursday",
            "friday",
            "saturday",
            "sunday",
        ];
        let mut regular = HashMap::new();
        if let Some(t) = cal {
            for r in &t.rows {
                let (Some(a), Some(b)) =
                    (day_of(t.get(r, "start_date")), day_of(t.get(r, "end_date")))
                else {
                    continue;
                };
                let days = DAYS
                    .iter()
                    .copied()
                    .filter(|d| t.get(r, d) == "1")
                    .collect();
                regular.insert(t.get(r, "service_id").to_string(), (a, b, days));
            }
        }
        let mut exceptions = HashMap::new();
        if let Some(t) = dates {
            for r in &t.rows {
                if let Some(d) = day_of(t.get(r, "date")) {
                    let add = t.get(r, "exception_type") == "1";
                    exceptions.insert((t.get(r, "service_id").to_string(), d), add);
                }
            }
        }
        Calendar {
            regular,
            exceptions,
        }
    }

    fn active(&self, service: &str, day: i64) -> bool {
        if let Some(&add) = self.exceptions.get(&(service.to_string(), day)) {
            return add;
        }
        self.regular
            .get(service)
            .is_some_and(|(a, b, days)| *a <= day && day <= *b && days.contains(weekday_col(day)))
    }

    /// First and last day any service runs.
    fn span(&self) -> Option<(i64, i64)> {
        let days = self
            .regular
            .values()
            .flat_map(|(a, b, _)| [*a, *b])
            .chain(self.exceptions.keys().map(|k| k.1));
        let (mut lo, mut hi) = (i64::MAX, i64::MIN);
        for d in days {
            lo = lo.min(d);
            hi = hi.max(d);
        }
        (lo <= hi).then_some((lo, hi))
    }
}

fn table(files: &BTreeMap<String, String>, name: &str) -> Option<Table> {
    files
        .iter()
        .find(|(k, _)| k.rsplit('/').next() == Some(name))
        .map(|(_, v)| csv::parse(v))
}

/// Purpose: read a GTFS feed into the published timetable of one service day.
/// Input: the feed's text files, the day (or none for the busiest Wednesday) and an optional box.
/// Output: the timetable with ids as in the feed, and a summary; an error when a required file is
/// missing, no service runs that day or the day has more than [`MAX_TRIPS`] trips in the box.
pub fn import(input: &ImportInput) -> Result<Imported, String> {
    let f = &input.files;
    let need = |n: &str| table(f, n).ok_or_else(|| format!("The feed has no {n}."));
    let stops_t = need("stops.txt")?;
    let routes_t = need("routes.txt")?;
    let trips_t = need("trips.txt")?;
    let times_t = need("stop_times.txt")?;
    let cal_t = table(f, "calendar.txt");
    let dates_t = table(f, "calendar_dates.txt");
    if cal_t.is_none() && dates_t.is_none() {
        return Err("The feed has neither calendar.txt nor calendar_dates.txt.".into());
    }
    let cal = Calendar::new(cal_t.as_ref(), dates_t.as_ref());
    let mut warnings: Vec<Msg> = Vec::new();

    // Trips per service, to find the busiest Wednesday.
    let mut per_service: HashMap<String, usize> = HashMap::new();
    for r in &trips_t.rows {
        *per_service
            .entry(trips_t.get(r, "service_id").to_string())
            .or_default() += 1;
    }
    let day = match input.date.as_deref() {
        Some(d) => day_of(d).ok_or_else(|| format!("{d} is not a date (YYYYMMDD)."))?,
        None => {
            let (lo, hi) = cal.span().ok_or("The feed's calendar has no dates.")?;
            // First Wednesday on or after the start, then every week, for at most two years.
            let first = lo + (days_from_civil(1970, 1, 7) - lo).rem_euclid(7);
            let mut best = (0usize, first);
            let mut d = first;
            while d <= hi.min(first + 7 * 104) {
                let n: usize = per_service
                    .iter()
                    .filter(|(s, _)| cal.active(s, d))
                    .map(|(_, n)| *n)
                    .sum();
                if n > best.0 {
                    best = (n, d);
                }
                d += 7;
            }
            best.1
        }
    };

    // Stops.
    let mut stop_xy: HashMap<String, (f64, f64)> = HashMap::new();
    let mut stop_rows: HashMap<String, Stop> = HashMap::new();
    for r in &stops_t.rows {
        let id = stops_t.get(r, "stop_id").to_string();
        let (Ok(lat), Ok(lon)) = (
            stops_t.get(r, "stop_lat").parse::<f64>(),
            stops_t.get(r, "stop_lon").parse::<f64>(),
        ) else {
            continue;
        };
        stop_xy.insert(id.clone(), (lon, lat));
        let lt = stops_t.get(r, "location_type");
        if !(lt.is_empty() || lt == "0") {
            continue;
        }
        let parent = stops_t.get(r, "parent_station");
        let platform = stops_t.get(r, "platform_code");
        stop_rows.insert(
            id.clone(),
            Stop {
                stop_id: id,
                stop_name: stops_t.get(r, "stop_name").to_string(),
                stop_lat: lat,
                stop_lon: lon,
                parent_station: (!parent.is_empty()).then(|| parent.to_string()),
                platform_code: (!platform.is_empty()).then(|| platform.to_string()),
            },
        );
    }
    let inside = |id: &str| match (input.bbox, stop_xy.get(id)) {
        (None, _) => true,
        (Some([w, s, e, n]), Some(&(x, y))) => x >= w && x <= e && y >= s && y <= n,
        (Some(_), None) => false,
    };

    // Trips that run that day.
    let mut trip_meta: HashMap<String, (String, u8, String, Option<String>)> = HashMap::new();
    for r in &trips_t.rows {
        let service = trips_t.get(r, "service_id");
        if !cal.active(service, day) {
            continue;
        }
        let block = trips_t.get(r, "block_id");
        trip_meta.insert(
            trips_t.get(r, "trip_id").to_string(),
            (
                trips_t.get(r, "route_id").to_string(),
                trips_t.get(r, "direction_id").parse().unwrap_or(0),
                service.to_string(),
                (!block.is_empty()).then(|| block.to_string()),
            ),
        );
    }
    if trip_meta.is_empty() {
        return Err(format!("No trips run on {}.", date_of(day)));
    }

    // Stop times of those trips: (sequence, stop, arrival, departure).
    type Call = (u32, String, Option<u32>, Option<u32>);
    let mut calls: HashMap<String, Vec<Call>> = HashMap::new();
    for r in &times_t.rows {
        let trip = times_t.get(r, "trip_id");
        if !trip_meta.contains_key(trip) {
            continue;
        }
        calls.entry(trip.to_string()).or_default().push((
            times_t.get(r, "stop_sequence").parse().unwrap_or(0),
            times_t.get(r, "stop_id").to_string(),
            parse_time(times_t.get(r, "arrival_time")),
            parse_time(times_t.get(r, "departure_time")),
        ));
    }

    // Frequencies: trip → periods.
    let mut freq: HashMap<String, Vec<Period>> = HashMap::new();
    if let Some(t) = table(f, "frequencies.txt") {
        for r in &t.rows {
            let (Some(a), Some(b), Ok(h)) = (
                parse_time(t.get(r, "start_time")),
                parse_time(t.get(r, "end_time")),
                t.get(r, "headway_secs").parse::<u32>(),
            ) else {
                continue;
            };
            if h == 0 || b <= a {
                continue;
            }
            freq.entry(t.get(r, "trip_id").to_string())
                .or_default()
                .push(Period {
                    start_time: a,
                    end_time: b,
                    headway_secs: h,
                    offset_secs: None,
                    kind: PeriodKind::OffPeak,
                });
        }
    }

    let mut trips = Vec::new();
    let mut patterns = Vec::new();
    let mut used_stops: BTreeSet<String> = BTreeSet::new();
    let mut used_routes: BTreeSet<String> = BTreeSet::new();
    let mut outside = 0usize;
    let mut untimed = 0usize;
    let mut ids: Vec<&String> = calls.keys().collect();
    ids.sort();
    for trip_id in ids {
        let mut c = calls[trip_id].clone();
        c.sort_by_key(|x| x.0);
        c.retain(|x| stop_rows.contains_key(&x.1));
        if c.len() < 2 {
            continue;
        }
        if !c.iter().any(|x| inside(&x.1)) {
            outside += 1;
            continue;
        }
        // Times: departure falls back to arrival and back; missing ones are interpolated by position.
        let known: Vec<(Option<u32>, Option<u32>)> = c.iter().map(|x| (x.2, x.3)).collect();
        let Some(times) = interpolate(&known) else {
            untimed += 1;
            continue;
        };
        let (route, dir, service, block) = trip_meta[trip_id].clone();
        let stop_times: Vec<StopTime> = c
            .iter()
            .enumerate()
            .map(|(i, x)| {
                let (arr, dep) = times[i];
                StopTime {
                    stop_id: x.1.clone(),
                    stop_sequence: i as u32,
                    arrival_time: arr,
                    departure_time: dep,
                    pickup_type: 0,
                    drop_off_type: 0,
                }
            })
            .collect();
        used_routes.insert(route.clone());
        used_stops.extend(stop_times.iter().map(|s| s.stop_id.clone()));
        if let Some(periods) = freq.get(trip_id) {
            let t0 = stop_times[0].arrival_time;
            let mut prev = t0;
            let stops = stop_times
                .iter()
                .map(|s| {
                    let run = s.arrival_time.saturating_sub(prev);
                    prev = s.departure_time;
                    PatternStop {
                        stop_id: s.stop_id.clone(),
                        run_time: run,
                        dwell_time: s.departure_time - s.arrival_time,
                    }
                })
                .collect();
            patterns.push(FrequencyPattern {
                pattern_id: trip_id.clone(),
                route_id: route,
                direction_id: dir,
                service_id: service,
                stops,
                periods: periods.clone(),
            });
        } else {
            trips.push(Trip {
                trip_id: trip_id.clone(),
                route_id: route,
                direction_id: dir,
                service_id: service,
                block_id: block,
                stop_times,
            });
        }
    }
    if untimed > 0 {
        warnings.push(msg!("gtfs.untimed_trips", count = untimed.to_string()));
    }
    if trips.len() + patterns.len() == 0 {
        return Err(if outside > 0 {
            "No trip of that day stops inside the map view.".into()
        } else {
            "No trip of that day has two or more stops with times.".into()
        });
    }
    if trips.len() > MAX_TRIPS {
        return Err(format!(
            "{} trips run that day, more than a project keeps ({MAX_TRIPS}). Zoom the map to the study area and import again.",
            trips.len()
        ));
    }

    // Routes and modes.
    let mut agencies: BTreeSet<String> = BTreeSet::new();
    let agency_names: HashMap<String, String> = table(f, "agency.txt")
        .map(|t| {
            t.rows
                .iter()
                .map(|r| {
                    (
                        t.get(r, "agency_id").to_string(),
                        t.get(r, "agency_name").to_string(),
                    )
                })
                .collect()
        })
        .unwrap_or_default();
    let mut routes = Vec::new();
    let mut unknown_types: BTreeSet<String> = BTreeSet::new();
    for r in &routes_t.rows {
        let id = routes_t.get(r, "route_id");
        if !used_routes.contains(id) {
            continue;
        }
        let rt = routes_t.get(r, "route_type");
        let mode = rt.parse::<u16>().ok().and_then(modes::mode_of);
        if mode.is_none() {
            unknown_types.insert(rt.to_string());
        }
        let short = routes_t.get(r, "route_short_name");
        let name = if short.is_empty() {
            routes_t.get(r, "route_long_name")
        } else {
            short
        };
        let colour = routes_t.get(r, "route_color");
        let agency = routes_t.get(r, "agency_id");
        if let Some(a) = agency_names
            .get(agency)
            .or_else(|| agency_names.values().next())
        {
            if !a.is_empty() {
                agencies.insert(a.clone());
            }
        }
        routes.push(Route {
            route_id: id.to_string(),
            route_short_name: if name.is_empty() { id } else { name }.to_string(),
            mode: mode.unwrap_or("bus").to_string(),
            route_color: (colour.len() == 6).then(|| colour.to_ascii_lowercase()),
        });
    }
    if !unknown_types.is_empty() {
        warnings.push(msg!(
            "gtfs.unknown_route_types",
            types = unknown_types.into_iter().collect::<Vec<_>>().join(", ")
        ));
    }

    // Stops in use, and the parents they name only as groups.
    let stops: Vec<Stop> = used_stops
        .iter()
        .filter_map(|id| stop_rows.get(id).cloned())
        .collect();

    // Transfers between kept stops.
    let transfers = table(f, "transfers.txt")
        .map(|t| {
            t.rows
                .iter()
                .filter(|r| {
                    used_stops.contains(t.get(r, "from_stop_id"))
                        && used_stops.contains(t.get(r, "to_stop_id"))
                })
                .map(|r| Transfer {
                    from_stop_id: t.get(r, "from_stop_id").to_string(),
                    to_stop_id: t.get(r, "to_stop_id").to_string(),
                    transfer_type: t.get(r, "transfer_type").parse().unwrap_or(0).min(3),
                    min_transfer_time: t.get(r, "min_transfer_time").parse().ok(),
                    max_wait_s: None,
                    estimated: false,
                })
                .collect()
        })
        .unwrap_or_default();

    let summary = ImportSummary {
        agencies: agencies.into_iter().collect(),
        date: date_of(day),
        routes: routes.len(),
        stops: stops.len(),
        trips: trips.len(),
        patterns: patterns.len(),
        outside,
        warnings: warnings.iter().map(Msg::english).collect(),
        warning_msgs: warnings,
    };
    Ok(Imported {
        timetable: Timetable {
            stops,
            routes,
            trips,
            transfers,
            frequency_patterns: patterns,
        },
        summary,
    })
}

/// Fill missing (arrival, departure) times linearly by position from the last departure to the next
/// arrival; None without a known time at the start and the end.
fn interpolate(known: &[(Option<u32>, Option<u32>)]) -> Option<Vec<(u32, u32)>> {
    let (fa, fd) = *known.first()?;
    fa.or(fd)?;
    let (la, ld) = *known.last()?;
    la.or(ld)?;
    let mut out: Vec<(u32, u32)> = Vec::with_capacity(known.len());
    // Last known departure and its position.
    let mut last = (0usize, 0u32);
    for (i, &(a, d)) in known.iter().enumerate() {
        match a.or(d) {
            Some(_) => {
                let arr = a.or(d).unwrap_or(0).max(last.1);
                let dep = d.or(a).unwrap_or(0).max(arr);
                out.push((arr, dep));
                last = (i, dep);
            }
            None => {
                let (j, next) = known[i..]
                    .iter()
                    .enumerate()
                    .find_map(|(k, x)| x.0.or(x.1).map(|t| (i + k, t)))?;
                let span = (j - last.0) as f64;
                let t =
                    last.1 as f64 + (next.max(last.1) - last.1) as f64 * (i - last.0) as f64 / span;
                let t = t.round() as u32;
                out.push((t, t));
            }
        }
    }
    Some(out)
}

/// What the exporter writes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportInput {
    pub timetable: Timetable,
    pub agency_name: String,
    pub agency_url: String,
    /// IANA time zone, such as `Europe/Berlin`.
    pub agency_timezone: String,
    #[serde(default = "en")]
    pub lang: String,
    /// First and last day of the weekday service, `YYYYMMDD`.
    pub start_date: String,
    pub end_date: String,
    /// GTFS route type of modes the core does not know (plugin modes such as `cable_car`).
    #[serde(default)]
    pub route_types: BTreeMap<String, u16>,
    #[serde(default)]
    pub feed_version: String,
    /// Public holidays in the validity, `YYYYMMDD`: the `holiday` service runs on them instead of the
    /// `weekday`, `saturday` or `sunday` one (`calendar_dates.txt`).
    #[serde(default)]
    pub holidays: Vec<String>,
    /// The weekend: the `sunday` service runs on the main rest day and the `saturday` one on the other
    /// weekend day; absent: Saturday and Sunday.
    #[serde(default)]
    pub weekend: Option<Weekend>,
}

/// The days of the weekend, as days of the week (0 Sunday to 6 Saturday).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Weekend {
    /// The main rest day: the `sunday` service runs on it.
    pub rest: u8,
    /// The other weekend day: the `saturday` service runs on it; absent: a one-day weekend.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub second: Option<u8>,
}

impl Default for Weekend {
    fn default() -> Self {
        Self {
            rest: 0,
            second: Some(6),
        }
    }
}

impl Weekend {
    /// Purpose: the weekend if its days are days of the week and differ, else Saturday and Sunday.
    fn valid(self) -> Self {
        let second_ok = !matches!(self.second, Some(s) if s >= 7 || s == self.rest);
        if self.rest < 7 && second_ok {
            self
        } else {
            Self::default()
        }
    }
    /// Purpose: `calendar.txt`'s Monday-to-Sunday columns with a 1 on one day of the week (0 Sunday), if any.
    fn columns(day: Option<u8>) -> [&'static str; 7] {
        let mut c = ["0"; 7];
        if let Some(day) = day {
            c[(usize::from(day) + 6) % 7] = "1";
        }
        c
    }
    /// Purpose: the service that runs on a day of the week (0 Sunday).
    fn service(self, day: u8) -> &'static str {
        if day == self.rest {
            "sunday"
        } else if Some(day) == self.second {
            "saturday"
        } else {
            "weekday"
        }
    }
}

fn en() -> String {
    "en".into()
}

/// Purpose: write a published timetable as GTFS text files.
/// Input: the timetable and the feed's agency, time zone and validity. Output: file name → text.
pub fn export(input: &ExportInput) -> BTreeMap<String, String> {
    let tt = &input.timetable;
    let mut files = BTreeMap::new();
    let agency = "mobsimlab";
    files.insert(
        "agency.txt".into(),
        csv::write(
            &[
                "agency_id",
                "agency_name",
                "agency_url",
                "agency_timezone",
                "agency_lang",
            ],
            &[vec![
                agency.into(),
                input.agency_name.clone(),
                input.agency_url.clone(),
                input.agency_timezone.clone(),
                input.lang.clone(),
            ]],
        ),
    );

    // Stops, with a station row for every group named as a parent.
    let mut rows = Vec::new();
    let ids: HashSet<&str> = tt.stops.iter().map(|s| s.stop_id.as_str()).collect();
    let mut parents: BTreeMap<&str, (f64, f64, usize, &str)> = BTreeMap::new();
    for s in &tt.stops {
        if let Some(p) = s.parent_station.as_deref().filter(|p| !ids.contains(p)) {
            let e = parents
                .entry(p)
                .or_insert((0.0, 0.0, 0, s.stop_name.as_str()));
            e.0 += s.stop_lat;
            e.1 += s.stop_lon;
            e.2 += 1;
        }
    }
    let coord = |x: f64| format!("{:.6}", x);
    for (id, (lat, lon, n, name)) in &parents {
        rows.push(vec![
            id.to_string(),
            name.to_string(),
            coord(lat / *n as f64),
            coord(lon / *n as f64),
            "1".into(),
            String::new(),
            String::new(),
        ]);
    }
    for s in &tt.stops {
        let parent = s
            .parent_station
            .as_deref()
            .filter(|p| parents.contains_key(p))
            .unwrap_or("");
        rows.push(vec![
            s.stop_id.clone(),
            s.stop_name.clone(),
            coord(s.stop_lat),
            coord(s.stop_lon),
            "0".into(),
            parent.into(),
            s.platform_code.clone().unwrap_or_default(),
        ]);
    }
    files.insert(
        "stops.txt".into(),
        csv::write(
            &[
                "stop_id",
                "stop_name",
                "stop_lat",
                "stop_lon",
                "location_type",
                "parent_station",
                "platform_code",
            ],
            &rows,
        ),
    );

    let route_type = |mode: &str| {
        modes::route_type_of(mode)
            .or_else(|| input.route_types.get(mode).copied())
            .unwrap_or(3)
    };
    files.insert(
        "routes.txt".into(),
        csv::write(
            &[
                "route_id",
                "agency_id",
                "route_short_name",
                "route_type",
                "route_color",
            ],
            &tt.routes
                .iter()
                .map(|r| {
                    vec![
                        r.route_id.clone(),
                        agency.into(),
                        r.route_short_name.clone(),
                        route_type(&r.mode).to_string(),
                        r.route_color
                            .clone()
                            .unwrap_or_default()
                            .trim_start_matches('#')
                            .to_ascii_uppercase(),
                    ]
                })
                .collect::<Vec<_>>(),
        ),
    );

    // Services: the day types run on their days (`saturday`, `sunday` as the weekend sets them; `holiday` only on
    // the holidays); any other service, `weekday` among them, on the other days over the feed's validity.
    let weekend = input.weekend.unwrap_or_default().valid();
    let services: BTreeSet<&str> = tt
        .trips
        .iter()
        .map(|t| t.service_id.as_str())
        .chain(tt.frequency_patterns.iter().map(|p| p.service_id.as_str()))
        .collect();
    files.insert(
        "calendar.txt".into(),
        csv::write(
            &[
                "service_id",
                "monday",
                "tuesday",
                "wednesday",
                "thursday",
                "friday",
                "saturday",
                "sunday",
                "start_date",
                "end_date",
            ],
            &services
                .iter()
                .map(|s| {
                    let mut r = vec![s.to_string()];
                    let days = match *s {
                        "saturday" => Weekend::columns(weekend.second),
                        "sunday" => Weekend::columns(Some(weekend.rest)),
                        "holiday" => ["0"; 7],
                        _ => {
                            let mut c = ["1"; 7];
                            for d in std::iter::once(weekend.rest).chain(weekend.second) {
                                c[(usize::from(d) + 6) % 7] = "0";
                            }
                            c
                        }
                    };
                    r.extend(days.map(String::from));
                    r.push(input.start_date.clone());
                    r.push(input.end_date.clone());
                    r
                })
                .collect::<Vec<_>>(),
        ),
    );
    // Holidays: the holiday service runs and the day's usual service does not.
    if services.contains("holiday") {
        let mut dates = Vec::new();
        let mut hol: Vec<&String> = input
            .holidays
            .iter()
            .filter(|d| {
                d.len() == 8
                    && d.as_str() >= input.start_date.as_str()
                    && d.as_str() <= input.end_date.as_str()
            })
            .collect();
        hol.sort();
        hol.dedup();
        for d in hol {
            let Some(day) = day_of(d) else { continue };
            // Day 0 (1970-01-01) was a Thursday: day of the week with 0 for Sunday.
            let usual = weekend.service(((day + 4).rem_euclid(7)) as u8);
            dates.push(vec!["holiday".to_string(), d.clone(), "1".into()]);
            if services.contains(usual) {
                dates.push(vec![usual.to_string(), d.clone(), "2".into()]);
            }
        }
        if !dates.is_empty() {
            files.insert(
                "calendar_dates.txt".into(),
                csv::write(&["service_id", "date", "exception_type"], &dates),
            );
        }
    }

    // Trips: exact ones, then one template trip per frequency pattern.
    let mut trips = Vec::new();
    let mut times = Vec::new();
    let mut freqs = Vec::new();
    for t in &tt.trips {
        trips.push(vec![
            t.route_id.clone(),
            t.service_id.clone(),
            t.trip_id.clone(),
            t.direction_id.to_string(),
            t.block_id.clone().unwrap_or_default(),
        ]);
        for (i, s) in t.stop_times.iter().enumerate() {
            times.push(vec![
                t.trip_id.clone(),
                fmt_time(s.arrival_time),
                fmt_time(s.departure_time.max(s.arrival_time)),
                s.stop_id.clone(),
                (i + 1).to_string(),
                s.pickup_type.to_string(),
                s.drop_off_type.to_string(),
            ]);
        }
    }
    for p in &tt.frequency_patterns {
        let Some(first) = p.periods.iter().map(|x| x.start_time).min() else {
            continue;
        };
        trips.push(vec![
            p.route_id.clone(),
            p.service_id.clone(),
            p.pattern_id.clone(),
            p.direction_id.to_string(),
            String::new(),
        ]);
        let mut t = first;
        for (i, s) in p.stops.iter().enumerate() {
            t += s.run_time;
            let arr = t;
            t += s.dwell_time;
            times.push(vec![
                p.pattern_id.clone(),
                fmt_time(arr),
                fmt_time(t),
                s.stop_id.clone(),
                (i + 1).to_string(),
                "0".into(),
                "0".into(),
            ]);
        }
        for x in &p.periods {
            freqs.push(vec![
                p.pattern_id.clone(),
                fmt_time(x.start_time),
                fmt_time(x.end_time),
                x.headway_secs.to_string(),
                "0".into(),
            ]);
        }
    }
    files.insert(
        "trips.txt".into(),
        csv::write(
            &[
                "route_id",
                "service_id",
                "trip_id",
                "direction_id",
                "block_id",
            ],
            &trips,
        ),
    );
    files.insert(
        "stop_times.txt".into(),
        csv::write(
            &[
                "trip_id",
                "arrival_time",
                "departure_time",
                "stop_id",
                "stop_sequence",
                "pickup_type",
                "drop_off_type",
            ],
            &times,
        ),
    );
    if !freqs.is_empty() {
        files.insert(
            "frequencies.txt".into(),
            csv::write(
                &[
                    "trip_id",
                    "start_time",
                    "end_time",
                    "headway_secs",
                    "exact_times",
                ],
                &freqs,
            ),
        );
    }
    if !tt.transfers.is_empty() {
        files.insert(
            "transfers.txt".into(),
            csv::write(
                &[
                    "from_stop_id",
                    "to_stop_id",
                    "transfer_type",
                    "min_transfer_time",
                ],
                &tt.transfers
                    .iter()
                    .map(|x| {
                        vec![
                            x.from_stop_id.clone(),
                            x.to_stop_id.clone(),
                            x.transfer_type.to_string(),
                            x.min_transfer_time
                                .map(|m| m.to_string())
                                .unwrap_or_default(),
                        ]
                    })
                    .collect::<Vec<_>>(),
            ),
        );
    }
    files.insert(
        "feed_info.txt".into(),
        csv::write(
            &[
                "feed_publisher_name",
                "feed_publisher_url",
                "feed_lang",
                "feed_start_date",
                "feed_end_date",
                "feed_version",
            ],
            &[vec![
                "MobSimLab".into(),
                input.agency_url.clone(),
                input.lang.clone(),
                input.start_date.clone(),
                input.end_date.clone(),
                input.feed_version.clone(),
            ]],
        ),
    );
    files
}

#[cfg(test)]
mod tests;
