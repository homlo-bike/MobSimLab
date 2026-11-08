//! Expected wait of road vehicles at level crossings (railway track crossing a street).
//!
//! The railway owns a level crossing (ADR-0007): it closes the street before each train and
//! opens it after the train has cleared. A bus that arrives while the street is closed waits
//! until it opens. For a bus arriving at a random moment in a window of length `T` with
//! closures `c_i`, the expected wait is `Σ c_i² / (2 T)`: the chance of arriving during
//! closure `i` is `c_i / T`, and the mean remaining closure is then `c_i / 2`. This is the
//! uniform delay of a fixed-time signal with red time `c` and cycle `T` for arrivals that
//! find no queue (HCM, `walk.crossing_delay_s` uses the same form).
//!
//! The closures come from:
//!
//! - the **rail timetable** (`contracts/level-crossing-closures.schema.json`, written by
//!   `rail-plan` from the planned runs): the busiest clock hour is used for running times, and
//!   the average over the service day is reported as off-peak;
//! - otherwise the **assumed service** in the track topology (`road_closure`): each train
//!   closes the street for `closure_s` (warning time, the train over the crossing at line
//!   speed, barriers rising) and `assumed_trains_per_hour_peak` / `_off_peak` trains pass, from
//!   the assumption library's longest headways for the rail mode.
//!
//! Crossings of the same street within each other's stop lines (two railway lines side by
//! side) are one place to wait: timetable closures are merged; assumed waits add up.

use serde::{Deserialize, Serialize};

use crate::geo::{dist, project_on_segment, LocalProjection};
use crate::graph::RoadGraph;
use crate::router::Path;

/// A routed path passes a crossing when it runs on the crossing's street this close to it, m.
const PASS_TOL_M: f64 = 8.0;
const HOUR_S: f64 = 3600.0;

/// One time the street is closed, s after service-day midnight.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize)]
pub struct Closure {
    /// Street closed.
    pub start_s: f64,
    /// Street open again.
    pub end_s: f64,
}

/// Where the wait comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WaitSource {
    /// Closures of the planned train runs.
    Timetable,
    /// The service assumed in the track topology.
    Assumed,
    /// Timetable closures for some of the railway lines at this place, assumed for the others.
    Mixed,
}

/// The expected wait at one place where the line crosses a railway.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CrossingWait {
    /// Expected wait per pass in the peak (the busiest hour of the timetable), s. Added to
    /// running times.
    pub wait_s: f64,
    /// Expected wait per pass off-peak (the timetable's service-day average), s.
    pub off_peak_wait_s: f64,
    /// Share of the peak hour the street is closed.
    pub closed_share: f64,
    /// Street closures in the peak hour.
    pub closures_per_hour: f64,
    /// Mean closure in the peak hour, s.
    pub mean_closure_s: f64,
    /// Start of the busiest hour, s after midnight (timetable only).
    pub peak_hour_s: Option<f64>,
    /// Where the closures come from.
    pub source: WaitSource,
}

/// A place where railway track crosses a street, as the street line tool uses it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LevelCrossing {
    /// Topology ids of the level crossings at this place (one per railway alignment).
    pub ids: Vec<String>,
    /// OSM way id of the street.
    pub way: i64,
    /// Street name.
    pub street: String,
    /// Railway system(s), from the topology.
    pub modes: Vec<String>,
    /// `barriers` or `traffic_signals` (barriers if any alignment has them).
    pub protection: String,
    /// Crossing point `[lon, lat]`.
    pub lonlat: [f64; 2],
    /// Expected wait.
    pub wait: CrossingWait,
}

#[derive(Deserialize)]
struct TopologyIn {
    schema: String,
    #[serde(default)]
    level_crossings: Vec<LcIn>,
}

#[derive(Deserialize)]
struct LcIn {
    id: String,
    protection: String,
    mode: String,
    lonlat: Option<[f64; 2]>,
    line_speed_kmh: f64,
    warning_time_s: f64,
    rail_zone_m: f64,
    street: StreetIn,
    road_closure: Option<RoadClosureIn>,
}

#[derive(Deserialize)]
struct StreetIn {
    way: i64,
    #[serde(default)]
    name: String,
    keep_clear_m: f64,
}

#[derive(Deserialize)]
struct RoadClosureIn {
    closure_s: f64,
    assumed_trains_per_hour_peak: f64,
    assumed_trains_per_hour_off_peak: f64,
}

#[derive(Deserialize)]
struct ClosuresIn {
    schema: String,
    level_crossings: Vec<CrossingClosuresIn>,
}

#[derive(Deserialize)]
struct CrossingClosuresIn {
    id: String,
    closures: Vec<Closure>,
}

/// Purpose: expected wait, closed share and closure count of closures clipped to `[from, to)`.
/// Inputs: closures in any order (overlaps are merged first).
/// Output: (wait_s, closed_share, closures, mean closure s).
pub fn expected_wait(closures: &[Closure], from: f64, to: f64) -> (f64, f64, f64, f64) {
    let t = to - from;
    if t <= 0.0 {
        return (0.0, 0.0, 0.0, 0.0);
    }
    let merged = merge(closures);
    let (mut sq, mut sum, mut n) = (0.0, 0.0, 0.0);
    for c in merged {
        let (a, b) = (c.start_s.max(from), c.end_s.min(to));
        if b > a {
            sq += (b - a) * (b - a);
            sum += b - a;
            n += 1.0;
        }
    }
    let mean = if n > 0.0 { sum / n } else { 0.0 };
    (sq / (2.0 * t), sum / t, n, mean)
}

/// Purpose: closures in time order with overlapping ones joined.
pub fn merge(closures: &[Closure]) -> Vec<Closure> {
    let mut v: Vec<Closure> = closures
        .iter()
        .copied()
        .filter(|c| c.end_s > c.start_s)
        .collect();
    v.sort_by(|a, b| a.start_s.total_cmp(&b.start_s));
    let mut out: Vec<Closure> = Vec::new();
    for c in v {
        match out.last_mut() {
            Some(l) if c.start_s <= l.end_s => l.end_s = l.end_s.max(c.end_s),
            _ => out.push(c),
        }
    }
    out
}

/// Purpose: the wait from timetable closures: the busiest clock hour, and the average over the
/// hours from the first to the last closure.
pub fn timetable_wait(closures: &[Closure]) -> CrossingWait {
    let merged = merge(closures);
    let (Some(first), Some(last)) = (merged.first(), merged.last()) else {
        return CrossingWait {
            wait_s: 0.0,
            off_peak_wait_s: 0.0,
            closed_share: 0.0,
            closures_per_hour: 0.0,
            mean_closure_s: 0.0,
            peak_hour_s: None,
            source: WaitSource::Timetable,
        };
    };
    let h0 = (first.start_s / HOUR_S).floor();
    let h1 = (last.end_s / HOUR_S).ceil();
    let mut best = (f64::NEG_INFINITY, 0.0, (0.0, 0.0, 0.0, 0.0));
    let mut h = h0;
    while h < h1 {
        let w = expected_wait(&merged, h * HOUR_S, (h + 1.0) * HOUR_S);
        if w.0 > best.0 {
            best = (w.0, h * HOUR_S, w);
        }
        h += 1.0;
    }
    let day = expected_wait(&merged, h0 * HOUR_S, h1 * HOUR_S);
    let (wait_s, closed_share, n, mean) = best.2;
    CrossingWait {
        wait_s,
        off_peak_wait_s: day.0,
        closed_share,
        closures_per_hour: n,
        mean_closure_s: mean,
        peak_hour_s: Some(best.1),
        source: WaitSource::Timetable,
    }
}

/// Purpose: the wait from an assumed service: `n` closures of `c` seconds per hour, spread
/// evenly so they do not overlap.
pub fn assumed_wait(closure_s: f64, per_hour_peak: f64, per_hour_off_peak: f64) -> CrossingWait {
    let w = |n: f64| n * closure_s * closure_s / (2.0 * HOUR_S);
    CrossingWait {
        wait_s: w(per_hour_peak),
        off_peak_wait_s: w(per_hour_off_peak),
        closed_share: (per_hour_peak * closure_s / HOUR_S).min(1.0),
        closures_per_hour: per_hour_peak,
        mean_closure_s: closure_s,
        peak_hour_s: None,
        source: WaitSource::Assumed,
    }
}

/// Purpose: the level crossings from a track topology export, with the expected wait from
/// timetable closures where given (by topology id) and the assumed service otherwise.
/// Inputs: `topology_json` (contracts/rail-topology.schema.json), `closures_json`
/// (contracts/level-crossing-closures.schema.json) or an empty string.
/// Output: one entry per place to wait; Err for JSON that is not a topology or closures file.
pub fn from_topology(
    topology_json: &str,
    closures_json: &str,
) -> Result<Vec<LevelCrossing>, String> {
    let t: TopologyIn = serde_json::from_str(topology_json)
        .map_err(|e| format!("Not a track topology file: {e}"))?;
    if t.schema != "mobsimlab.rail-topology/1" {
        return Err(format!("Unknown track topology schema {}", t.schema));
    }
    let closures: Vec<CrossingClosuresIn> = if closures_json.trim().is_empty() {
        Vec::new()
    } else {
        let c: ClosuresIn = serde_json::from_str(closures_json)
            .map_err(|e| format!("Not a level crossing closures file: {e}"))?;
        if c.schema != "mobsimlab.level-crossing-closures/1" {
            return Err(format!("Unknown closures schema {}", c.schema));
        }
        c.level_crossings
    };
    // Group the crossings of one street that lie within each other's stop lines.
    let proj = t
        .level_crossings
        .iter()
        .find_map(|l| l.lonlat)
        .map(|[lon, lat]| LocalProjection::new(lon, lat));
    let mut groups: Vec<Vec<&LcIn>> = Vec::new();
    for lc in t.level_crossings.iter().filter(|l| l.lonlat.is_some()) {
        let p = proj.expect("has a position");
        let xy = |l: &LcIn| {
            let [lon, lat] = l.lonlat.expect("filtered");
            p.to_xy(lon, lat)
        };
        let here = xy(lc);
        match groups.iter_mut().find(|g| {
            g.iter().any(|o| {
                o.street.way == lc.street.way
                    && dist(xy(o), here) <= o.street.keep_clear_m + lc.street.keep_clear_m + 5.0
            })
        }) {
            Some(g) => g.push(lc),
            None => groups.push(vec![lc]),
        }
    }
    Ok(groups
        .into_iter()
        .map(|g| {
            let mut tt: Vec<Closure> = Vec::new();
            let (mut with_tt, mut assumed) = (0usize, Vec::new());
            for lc in &g {
                match closures.iter().find(|c| c.id == lc.id) {
                    Some(c) => {
                        with_tt += 1;
                        tt.extend(c.closures.iter().copied());
                    }
                    None => assumed.push(match &lc.road_closure {
                        Some(r) => assumed_wait(
                            r.closure_s,
                            r.assumed_trains_per_hour_peak,
                            r.assumed_trains_per_hour_off_peak,
                        ),
                        // Exports made before `road_closure`: warning time and the zone at line
                        // speed only, and no service assumed.
                        None => assumed_wait(
                            lc.warning_time_s + lc.rail_zone_m / (lc.line_speed_kmh.max(5.0) / 3.6),
                            0.0,
                            0.0,
                        ),
                    }),
                }
            }
            let mut wait = if with_tt > 0 {
                timetable_wait(&tt)
            } else {
                assumed_wait(0.0, 0.0, 0.0)
            };
            for a in &assumed {
                let n = wait.closures_per_hour + a.closures_per_hour;
                wait.mean_closure_s = if n > 0.0 {
                    (wait.mean_closure_s * wait.closures_per_hour
                        + a.mean_closure_s * a.closures_per_hour)
                        / n
                } else {
                    0.0
                };
                wait.closures_per_hour = n;
                wait.wait_s += a.wait_s;
                wait.off_peak_wait_s += a.off_peak_wait_s;
                wait.closed_share = (wait.closed_share + a.closed_share).min(1.0);
            }
            wait.source = match (with_tt, assumed.len()) {
                (0, _) => WaitSource::Assumed,
                (_, 0) => WaitSource::Timetable,
                _ => WaitSource::Mixed,
            };
            if wait.source != WaitSource::Timetable {
                wait.peak_hour_s = None;
            }
            let mut modes: Vec<String> = g.iter().map(|l| l.mode.clone()).collect();
            modes.dedup();
            let protection = if g.iter().any(|l| l.protection == "barriers") {
                "barriers"
            } else {
                "traffic_signals"
            };
            LevelCrossing {
                ids: g.iter().map(|l| l.id.clone()).collect(),
                way: g[0].street.way,
                street: g[0].street.name.clone(),
                modes,
                protection: protection.to_string(),
                lonlat: g[0].lonlat.expect("filtered"),
                wait,
            }
        })
        .collect())
}

/// Purpose: how many times a routed path passes a level crossing: it drives on the crossing's
/// street and comes within a few metres of the crossing point.
pub fn passes(g: &RoadGraph, path: &Path, lc: &LevelCrossing) -> usize {
    if !path.arcs.iter().any(|&a| g.arcs[a as usize].way == lc.way) {
        return 0;
    }
    let p = g.proj.to_xy(lc.lonlat[0], lc.lonlat[1]);
    let mut n = 0;
    let mut near = false;
    for w in path.xy.windows(2) {
        let d = project_on_segment(p, w[0], w[1]).dist;
        let now = d <= PASS_TOL_M;
        if now && !near {
            n += 1;
        }
        near = now;
    }
    n
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(a: f64, b: f64) -> Closure {
        Closure {
            start_s: a,
            end_s: b,
        }
    }

    #[test]
    fn one_closure_of_a_minute_an_hour_costs_half_a_second_on_average() {
        // 60 s closed in 3600 s: 1/60 chance of waiting 30 s on average.
        let (w, share, n, mean) = expected_wait(&[c(100.0, 160.0)], 0.0, 3600.0);
        assert!((w - 0.5).abs() < 1e-9 && (share - 1.0 / 60.0).abs() < 1e-9);
        assert_eq!((n, mean), (1.0, 60.0));
    }

    #[test]
    fn overlapping_closures_are_one_and_a_closure_is_clipped_to_the_window() {
        let m = merge(&[c(10.0, 50.0), c(40.0, 70.0), c(100.0, 110.0)]);
        assert_eq!(m, vec![c(10.0, 70.0), c(100.0, 110.0)]);
        let (w, ..) = expected_wait(&[c(3590.0, 3630.0)], 0.0, 3600.0);
        assert!((w - 100.0 / 7200.0).abs() < 1e-9);
    }

    #[test]
    fn the_busiest_hour_sets_the_running_time_and_the_day_average_is_off_peak() {
        let mut v = vec![c(6.0 * HOUR_S, 6.0 * HOUR_S + 60.0)];
        for k in 0..6 {
            let s = 8.0 * HOUR_S + k as f64 * 600.0;
            v.push(c(s, s + 60.0));
        }
        let w = timetable_wait(&v);
        assert_eq!(w.peak_hour_s, Some(8.0 * HOUR_S));
        assert!((w.wait_s - 6.0 * 3600.0 / 7200.0).abs() < 1e-9, "{w:?}");
        assert_eq!(w.closures_per_hour, 6.0);
        assert!(w.off_peak_wait_s < w.wait_s);
    }

    #[test]
    fn assumed_service_uses_the_closure_per_train() {
        // 8 trains an hour closing for 40 s: 8 × 1600 / 7200 ≈ 1.8 s per pass.
        let w = assumed_wait(40.0, 8.0, 4.0);
        assert!((w.wait_s - 8.0 * 1600.0 / 7200.0).abs() < 1e-9);
        assert!((w.off_peak_wait_s - w.wait_s / 2.0).abs() < 1e-9);
        assert_eq!(w.source, WaitSource::Assumed);
    }

    const TOPO: &str = r#"{"schema":"mobsimlab.rail-topology/1","level_crossings":[
      {"id":"lc3-1001-0","protection":"barriers","mode":"regional_rail","lonlat":[7.0,50.9],
       "line_speed_kmh":160,"warning_time_s":25,"rail_zone_m":3.3,
       "road_closure":{"train_length_m":170,"reopen_s":10,"closure_s":38.9,
         "assumed_trains_per_hour_peak":8,"assumed_trains_per_hour_off_peak":4},
       "street":{"way":1001,"name":"Station Road","keep_clear_m":8.8}},
      {"id":"lc9-1001-0","protection":"traffic_signals","mode":"tram","lonlat":[7.00015,50.9],
       "line_speed_kmh":30,"warning_time_s":15,"rail_zone_m":4,
       "road_closure":{"train_length_m":45,"reopen_s":5,"closure_s":28,
         "assumed_trains_per_hour_peak":24,"assumed_trains_per_hour_off_peak":12},
       "street":{"way":1001,"name":"Station Road","keep_clear_m":7}},
      {"id":"lc3-2002-0","protection":"barriers","mode":"regional_rail","lonlat":[7.01,50.9],
       "line_speed_kmh":160,"warning_time_s":25,"rail_zone_m":3.3,
       "road_closure":{"train_length_m":170,"reopen_s":10,"closure_s":38.9,
         "assumed_trains_per_hour_peak":8,"assumed_trains_per_hour_off_peak":4},
       "street":{"way":2002,"name":"Mill Lane","keep_clear_m":8.8}}
    ]}"#;

    #[test]
    fn crossings_of_one_street_side_by_side_are_one_place_and_assumed_waits_add_up() {
        let v = from_topology(TOPO, "").unwrap();
        assert_eq!(v.len(), 2);
        let station = &v[0];
        assert_eq!(station.ids, ["lc3-1001-0", "lc9-1001-0"]);
        assert_eq!(station.protection, "barriers");
        let want = assumed_wait(38.9, 8.0, 4.0).wait_s + assumed_wait(28.0, 24.0, 12.0).wait_s;
        assert!((station.wait.wait_s - want).abs() < 1e-9);
        assert_eq!(station.wait.closures_per_hour, 32.0);
        assert_eq!(v[1].street, "Mill Lane");
    }

    #[test]
    fn timetable_closures_replace_the_assumed_service() {
        let closures = r#"{"schema":"mobsimlab.level-crossing-closures/1","level_crossings":[
          {"id":"lc3-2002-0","way":2002,"street":"Mill Lane",
           "closures":[{"start_s":28800,"end_s":28890,"runs":["RE 1"]},
                       {"start_s":30600,"end_s":30690,"runs":["RE 3"]}]}]}"#;
        let v = from_topology(TOPO, closures).unwrap();
        let mill = v.iter().find(|x| x.street == "Mill Lane").unwrap();
        assert_eq!(mill.wait.source, WaitSource::Timetable);
        assert!((mill.wait.wait_s - 2.0 * 8100.0 / 7200.0).abs() < 1e-9);
        assert_eq!(mill.wait.peak_hour_s, Some(28800.0));
        let station = v.iter().find(|x| x.street == "Station Road").unwrap();
        assert_eq!(station.wait.source, WaitSource::Assumed);
        assert!(from_topology(TOPO, r#"{"schema":"x","level_crossings":[]}"#).is_err());
        assert!(from_topology(r#"{"level_crossings":[]}"#, "").is_err());
    }
}
