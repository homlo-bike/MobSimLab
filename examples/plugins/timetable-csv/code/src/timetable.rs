//! The plugin's logic on plain JSON and text, so it is tested natively (`cargo test`) as well.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;

#[derive(Serialize, Deserialize, Default)]
pub struct Timetable {
    #[serde(default)]
    pub stops: Vec<Stop>,
    #[serde(default)]
    pub routes: Vec<Route>,
    #[serde(default)]
    pub trips: Vec<Trip>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Stop {
    pub stop_id: String,
    pub stop_name: String,
    pub stop_lat: f64,
    pub stop_lon: f64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Route {
    pub route_id: String,
    pub route_short_name: String,
    pub mode: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Trip {
    pub trip_id: String,
    pub route_id: String,
    pub stop_times: Vec<StopTime>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct StopTime {
    pub stop_id: String,
    pub stop_sequence: u32,
    pub arrival_time: u32,
    pub departure_time: u32,
}

fn clock(s: u32) -> String {
    format!("{:02}:{:02}:{:02}", s / 3600, (s / 60) % 60, s % 60)
}

fn parse_clock(t: &str) -> Option<u32> {
    let p: Vec<&str> = t.trim().split(':').collect();
    if p.len() < 2 || p.len() > 3 {
        return None;
    }
    let n: Vec<u32> = p.iter().map(|x| x.parse().ok()).collect::<Option<_>>()?;
    if n[1] > 59 || n.get(2).is_some_and(|s| *s > 59) || n[0] > 47 {
        return None;
    }
    Some(n[0] * 3600 + n[1] * 60 + n.get(2).copied().unwrap_or(0))
}

/// Calculation `route_summary`: per route, its trips, stops, first and last departure and mean headway.
/// Input JSON `{ "inputs": { "timetable": … }, "parameters": {…}, "options": {…} }`.
pub fn route_summary(input: &str) -> Result<String, String> {
    let v: Value = serde_json::from_str(input).map_err(|e| format!("input is not JSON: {e}"))?;
    let tt: Timetable = serde_json::from_value(v["inputs"]["timetable"].clone()).unwrap_or_default();
    let mut rows = Vec::new();
    let mut total_trips = 0;
    for r in &tt.routes {
        let mut deps: Vec<u32> = tt
            .trips
            .iter()
            .filter(|t| t.route_id == r.route_id)
            .filter_map(|t| t.stop_times.first().map(|s| s.departure_time))
            .collect();
        deps.sort_unstable();
        let mut stops: Vec<&str> = tt
            .trips
            .iter()
            .filter(|t| t.route_id == r.route_id)
            .flat_map(|t| t.stop_times.iter().map(|s| s.stop_id.as_str()))
            .collect();
        stops.sort_unstable();
        stops.dedup();
        let headway = if deps.len() > 1 {
            Some(((deps[deps.len() - 1] - deps[0]) as f64 / (deps.len() - 1) as f64 / 60.0 * 10.0).round() / 10.0)
        } else {
            None
        };
        total_trips += deps.len();
        rows.push(json!([
            r.route_short_name,
            r.mode,
            deps.len(),
            stops.len(),
            deps.first().map(|s| clock(*s)),
            deps.last().map(|s| clock(*s)),
            headway
        ]));
    }
    Ok(json!({
        "table": {
            "columns": [
                { "id": "route", "label": "Route" },
                { "id": "mode", "label": "Mode" },
                { "id": "trips", "label": "Trips", "unit": "" },
                { "id": "stops", "label": "Stops", "unit": "" },
                { "id": "first", "label": "First departure" },
                { "id": "last", "label": "Last departure" },
                { "id": "headway", "label": "Mean headway", "unit": "min" }
            ],
            "rows": rows
        },
        "kpis": [
            { "id": "routes", "label": "Routes", "value": tt.routes.len(), "unit": "" },
            { "id": "trips", "label": "Trips", "value": total_trips, "unit": "" }
        ]
    })
    .to_string())
}

/// Importer `csv_import`: CSV rows `trip_id,route,mode,stop_name,lat,lon,time` into a published timetable.
pub fn import_csv(text: &str) -> Result<String, String> {
    let mut tt = Timetable::default();
    let mut stop_ids: BTreeMap<String, String> = BTreeMap::new();
    let mut trips: BTreeMap<String, usize> = BTreeMap::new();
    let mut warnings: Vec<String> = Vec::new();
    for (n, line) in text.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() || (n == 0 && line.starts_with("trip_id")) {
            continue;
        }
        let c: Vec<&str> = line.split(',').map(str::trim).collect();
        if c.len() != 7 {
            return Err(format!("line {}: expected 7 columns, found {}", n + 1, c.len()));
        }
        let (lat, lon) = match (c[4].parse::<f64>(), c[5].parse::<f64>()) {
            (Ok(a), Ok(b)) if (-90.0..=90.0).contains(&a) && (-180.0..=180.0).contains(&b) => (a, b),
            _ => return Err(format!("line {}: latitude or longitude is not a number in range", n + 1)),
        };
        let Some(time) = parse_clock(c[6]) else {
            return Err(format!("line {}: time {} is not HH:MM", n + 1, c[6]));
        };
        let key = format!("{}|{:.6}|{:.6}", c[3], lat, lon);
        let next = format!("s{}", stop_ids.len() + 1);
        let stop_id = stop_ids.entry(key).or_insert_with(|| {
            tt.stops.push(Stop { stop_id: next.clone(), stop_name: c[3].into(), stop_lat: lat, stop_lon: lon });
            next
        });
        if !tt.routes.iter().any(|r| r.route_id == c[1]) {
            tt.routes.push(Route { route_id: c[1].into(), route_short_name: c[1].into(), mode: c[2].into() });
        }
        let i = *trips.entry(c[0].into()).or_insert_with(|| {
            tt.trips.push(Trip { trip_id: c[0].into(), route_id: c[1].into(), stop_times: vec![] });
            tt.trips.len() - 1
        });
        let trip = &mut tt.trips[i];
        let seq = trip.stop_times.len() as u32;
        if trip.stop_times.last().is_some_and(|s| s.departure_time > time) {
            warnings.push(format!("trip {}: times go backwards at line {}", c[0], n + 1));
        }
        trip.stop_times.push(StopTime { stop_id: stop_id.clone(), stop_sequence: seq, arrival_time: time, departure_time: time });
    }
    let short = tt.trips.iter().filter(|t| t.stop_times.len() < 2).count();
    if short > 0 {
        warnings.push(format!("{short} trips with one call were left out"));
        tt.trips.retain(|t| t.stop_times.len() >= 2);
    }
    if tt.trips.is_empty() {
        return Err("the CSV has no trip with two or more calls".into());
    }
    let summary = json!({
        "agencies": [],
        "date": "",
        "routes": tt.routes.len(),
        "stops": tt.stops.len(),
        "trips": tt.trips.len(),
        "patterns": 0,
        "outside": 0,
        "warnings": warnings,
    });
    Ok(json!({ "timetable": tt, "summary": summary }).to_string())
}

/// Exporter `csv_export`: a published timetable's trips as CSV rows (frequency patterns are left out).
pub fn export_csv(input: &str) -> Result<String, String> {
    let v: Value = serde_json::from_str(input).map_err(|e| format!("input is not JSON: {e}"))?;
    let tt: Timetable =
        serde_json::from_value(v["timetable"].clone()).map_err(|e| format!("not a timetable: {e}"))?;
    let stops: BTreeMap<&str, &Stop> = tt.stops.iter().map(|s| (s.stop_id.as_str(), s)).collect();
    let routes: BTreeMap<&str, &Route> = tt.routes.iter().map(|r| (r.route_id.as_str(), r)).collect();
    let mut out = String::from("trip_id,route,mode,stop_name,lat,lon,time\n");
    let field = |s: &str| s.replace([',', '\n', '\r'], " ");
    for t in &tt.trips {
        let Some(r) = routes.get(t.route_id.as_str()) else { continue };
        for st in &t.stop_times {
            let Some(s) = stops.get(st.stop_id.as_str()) else { continue };
            out.push_str(&format!(
                "{},{},{},{},{:.6},{:.6},{}\n",
                field(&t.trip_id),
                field(&r.route_short_name),
                field(&r.mode),
                field(&s.stop_name),
                s.stop_lat,
                s.stop_lon,
                clock(st.departure_time)
            ));
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CSV: &str = "trip_id,route,mode,stop_name,lat,lon,time\n\
        t1,A,bus,Harbour,47.1,8.1,07:00\nt1,A,bus,Market,47.11,8.11,07:06\n\
        t2,A,bus,Harbour,47.1,8.1,07:10\nt2,A,bus,Market,47.11,8.11,07:16\n";

    #[test]
    fn round_trip() {
        let imported: Value = serde_json::from_str(&import_csv(CSV).unwrap()).unwrap();
        assert_eq!(imported["summary"]["trips"], 2);
        assert_eq!(imported["summary"]["stops"], 2);
        let csv = export_csv(&json!({ "timetable": imported["timetable"] }).to_string()).unwrap();
        assert_eq!(csv.replace(":00\n", "\n").replace(".100000", ".1").lines().count(), 5);
        assert!(csv.contains("t2,A,bus,Market,47.110000,8.110000,07:16:00"));
    }

    #[test]
    fn summary() {
        let imported: Value = serde_json::from_str(&import_csv(CSV).unwrap()).unwrap();
        let out: Value = serde_json::from_str(
            &route_summary(&json!({ "inputs": { "timetable": imported["timetable"] } }).to_string()).unwrap(),
        )
        .unwrap();
        assert_eq!(out["table"]["rows"][0], json!(["A", "bus", 2, 2, "07:00:00", "07:10:00", 10.0]));
        assert_eq!(out["kpis"][1]["value"], 2);
    }

    #[test]
    fn bad_rows() {
        assert!(import_csv("t1,A,bus,X,95,8,07:00\n").unwrap_err().contains("latitude"));
        assert!(import_csv("t1,A,bus,X,47,8,7h\n").unwrap_err().contains("HH:MM"));
    }
}
