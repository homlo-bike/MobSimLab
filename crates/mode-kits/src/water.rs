//! Water route kit (ADR-0036 §6, ADR-0037 §3): a ferry line as an ordered list of pier calls.
//!
//! Each leg runs from one call to the next through the planner's via points. The sailing time uses the
//! lower of the vessel's service speed and the speed limit of the zone the vessel is in, and each leg adds
//! the berthing manoeuvre. Dwell at a call comes from gangway throughput, with a minimum. Both directions
//! are generated from the one pattern, the line needs `ceil(cycle / headway)` vessels, and any slack is
//! shared between the layovers at both ends. The berth check runs that service on the
//! [`segment`](crate::segment) engine with each pier's berths as a reservable resource, so vessels that
//! would meet at a pier with too few berths show up as holds.
//!
//! Routing on a water graph built from OpenStreetMap, bridges, locks and depth are later steps; until then
//! the route is the planner's via points, and the result says so.

use crate::geo::{self, LonLat, Xy};
use crate::issue::{Issue, Level};
use crate::segment::{self, Call, Run, SimInput};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Metres per second in one knot.
pub const KNOT_MS: f64 = 1852.0 / 3600.0;

/// A vessel type's speeds and handling: the plugin supplies them from the assumption library.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VesselType {
    /// `monohull`, `catamaran`, `hydrofoil` (assumption context `vessel_type`).
    pub id: String,
    /// `ferry.service_speed_kn`.
    pub service_speed_kn: f64,
    /// `ferry.berthing_s`: approach, mooring and leaving, per call.
    pub berthing_s: f64,
    /// `ferry.boarding_pax_per_min_per_gangway`.
    pub boarding_pax_per_min_per_gangway: f64,
    /// `ferry.min_dwell_s`.
    pub min_dwell_s: f64,
    /// `ferry.passenger_capacity`: passengers per vessel, as certified.
    pub capacity: f64,
}

/// A pier (landing) with its berths and gangways.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Pier {
    #[serde(default)]
    pub name: String,
    pub lonlat: LonLat,
    #[serde(default = "one")]
    pub berths: u32,
    #[serde(default = "one")]
    pub gangways: u32,
}

fn one() -> u32 {
    1
}

/// A call at a pier; `via` shapes the leg that arrives here.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WaterCall {
    pub pier: usize,
    #[serde(default)]
    pub via: Vec<LonLat>,
}

/// A polygon with a speed limit (harbour, wash-restricted, canal).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SpeedZone {
    #[serde(default)]
    pub name: String,
    pub ring: Vec<LonLat>,
    pub max_kn: f64,
}

/// The kit's input.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WaterLine {
    pub piers: Vec<Pier>,
    pub calls: Vec<WaterCall>,
    pub vessel: VesselType,
    /// Time between departures, seconds.
    pub headway_s: f64,
    /// Minimum layover at each end, seconds (`timetable.layover_min`).
    pub layover_s: f64,
    /// Passengers getting on plus off at the busiest call (sets the dwell).
    pub pax_per_call: f64,
    #[serde(default)]
    pub speed_zones: Vec<SpeedZone>,
    /// How long the berth check runs the service, seconds (default 3 hours).
    #[serde(default = "three_hours")]
    pub check_window_s: f64,
}

fn three_hours() -> f64 {
    3.0 * 3600.0
}

/// A leg between two calls, forward direction.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LegView {
    pub path: Vec<LonLat>,
    pub length_m: f64,
    pub sail_s: f64,
    /// Metres sailed below service speed because of a speed zone.
    pub slow_m: f64,
    /// Sailing plus berthing manoeuvre.
    pub time_s: f64,
}

/// A stop of one direction, for the published timetable.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct WaterStop {
    pub pier: usize,
    pub run_s: f64,
    pub dwell_s: f64,
}

/// Berth use per pier from the berth check.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BerthUse {
    pub pier: usize,
    pub berths: u32,
    /// Most vessels at the pier at once (including those that had to wait).
    pub peak: usize,
    pub holds: usize,
    pub held_s: f64,
}

/// The kit's output.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WaterView {
    pub legs: Vec<LegView>,
    pub length_m: f64,
    /// One-way time from the first to the last pier, with intermediate dwells, seconds.
    pub trip_time_s: f64,
    /// Dwell at intermediate calls, seconds.
    pub dwell_s: f64,
    /// Layover at the first and last pier as timetabled (each includes half the slack), seconds.
    pub layover_first_s: f64,
    pub layover_last_s: f64,
    /// Round trip of one vessel, seconds (a multiple of the headway).
    pub cycle_s: f64,
    pub vessels: u32,
    pub capacity_pphpd: f64,
    /// Forward and backward stopping patterns.
    pub directions: Vec<Vec<WaterStop>>,
    pub berths: Vec<BerthUse>,
    pub holds: usize,
    pub held_s: f64,
    pub issues: Vec<Issue>,
}

/// Sailing time and slow metres along a path in local metres.
fn sail(path: &[Xy], v_service: f64, zones: &[(Vec<Xy>, f64)]) -> (f64, f64, f64) {
    let (mut len, mut t, mut slow) = (0.0, 0.0, 0.0);
    for w in path.windows(2) {
        let d = geo::dist(w[0], w[1]);
        let n = ((d / 10.0).ceil() as usize).max(1);
        let ds = d / n as f64;
        for i in 0..n {
            let mid = geo::lerp(w[0], w[1], (i as f64 + 0.5) / n as f64);
            let mut v = v_service;
            for (ring, max) in zones {
                if geo::inside(mid, ring) {
                    v = v.min(*max);
                }
            }
            if v < v_service {
                slow += ds;
            }
            t += ds / v.max(0.1);
        }
        len += d;
    }
    (len, t, slow)
}

fn minutes(s: f64) -> String {
    format!("{:.0} min", s / 60.0)
}

/// Purpose: build a ferry line: legs, running times, dwell, vessel blocks, stopping patterns and the
/// berth check.
/// Output: the built line; fewer than two calls gives no legs and an info finding.
pub fn build(line: &WaterLine) -> WaterView {
    let mut issues = Vec::new();
    let calls: Vec<&WaterCall> = line
        .calls
        .iter()
        .filter(|c| c.pier < line.piers.len())
        .collect();
    if calls.len() < line.calls.len() {
        issues.push(Issue::new(
            Level::Error,
            "call.unknown_pier",
            "A call refers to a pier that no longer exists.",
        ));
    }
    if calls.len() < 2 {
        issues.push(Issue::new(
            Level::Info,
            "line.too_short",
            "Click at least two piers on the map.",
        ));
    }
    let origin = line.piers.first().map_or([0.0, 0.0], |p| p.lonlat);
    let local = |p: LonLat| geo::to_local(origin, p);
    let zones: Vec<(Vec<Xy>, f64)> = line
        .speed_zones
        .iter()
        .map(|z| {
            (
                z.ring.iter().map(|&p| local(p)).collect(),
                z.max_kn * KNOT_MS,
            )
        })
        .collect();
    let v = line.vessel.service_speed_kn.max(0.1) * KNOT_MS;

    let mut legs = Vec::new();
    for (i, w) in calls.windows(2).enumerate() {
        let (a, b) = (w[0], w[1]);
        if a.pier == b.pier {
            issues.push(
                Issue::new(
                    Level::Error,
                    "leg.same_pier",
                    "Two calls in a row at the same pier.",
                )
                .at_section(i),
            );
        }
        let mut path = vec![line.piers[a.pier].lonlat];
        path.extend(b.via.iter().copied());
        path.push(line.piers[b.pier].lonlat);
        let xy: Vec<Xy> = path.iter().map(|&p| local(p)).collect();
        let (length_m, sail_s, slow_m) = sail(&xy, v, &zones);
        legs.push(LegView {
            path,
            length_m,
            sail_s,
            slow_m,
            time_s: sail_s + line.vessel.berthing_s,
        });
    }
    let length_m: f64 = legs.iter().map(|l| l.length_m).sum();

    // Dwell from gangway throughput, at the busiest call.
    let gangways = |p: usize| line.piers[p].gangways.max(1) as f64;
    let rate = line.vessel.boarding_pax_per_min_per_gangway.max(0.1);
    let dwell_at =
        |p: usize| (line.pax_per_call / (rate * gangways(p)) * 60.0).max(line.vessel.min_dwell_s);
    let dwell_s = calls
        .iter()
        .skip(1)
        .take(calls.len().saturating_sub(2))
        .map(|c| dwell_at(c.pier))
        .fold(0.0, f64::max);
    if line.pax_per_call > line.vessel.capacity {
        issues.push(
            Issue::new(
                Level::Warning,
                "dwell.over_capacity",
                format!(
                    "{:.0} passengers on and off at a call is more than the vessel carries ({:.0}).",
                    line.pax_per_call, line.vessel.capacity
                ),
            )
            .param("ferry.passenger_capacity"),
        );
    }

    let mut directions: Vec<Vec<WaterStop>> = Vec::new();
    let (mut trip_time_s, mut cycle_s, mut vessels, mut lay_first, mut lay_last) =
        (0.0, 0.0, 0, 0.0, 0.0);
    let mut berths = Vec::new();
    let (mut holds, mut held_s) = (0, 0.0);
    let headway = line.headway_s.max(60.0);
    if calls.len() >= 2 {
        let n = calls.len();
        let fwd: Vec<WaterStop> = (0..n)
            .map(|i| WaterStop {
                pier: calls[i].pier,
                run_s: if i == 0 { 0.0 } else { legs[i - 1].time_s },
                dwell_s: if i == 0 || i + 1 == n {
                    0.0
                } else {
                    dwell_at(calls[i].pier)
                },
            })
            .collect();
        let bwd: Vec<WaterStop> = (0..n)
            .map(|k| {
                let i = n - 1 - k;
                WaterStop {
                    pier: calls[i].pier,
                    run_s: if k == 0 { 0.0 } else { legs[i].time_s },
                    dwell_s: if k == 0 || k + 1 == n {
                        0.0
                    } else {
                        dwell_at(calls[i].pier)
                    },
                }
            })
            .collect();
        trip_time_s = fwd.iter().map(|s| s.run_s + s.dwell_s).sum();
        let lay_min = line
            .layover_s
            .max(line.vessel.min_dwell_s)
            .max(dwell_at(calls[0].pier));
        lay_last = line
            .layover_s
            .max(line.vessel.min_dwell_s)
            .max(dwell_at(calls[n - 1].pier));
        let need = 2.0 * trip_time_s + lay_min + lay_last;
        vessels = ((need / headway) - 1e-9).ceil().max(1.0) as u32;
        cycle_s = vessels as f64 * headway;
        // Slack is shared between both ends, so neither end holds vessels longer than it must.
        let slack = cycle_s - need;
        lay_first = lay_min + slack / 2.0;
        lay_last += slack / 2.0;

        // Berth check on the segment engine.
        let berth = |p: usize| format!("berth:{p}");
        let mut loop_calls: Vec<Call> = Vec::new();
        let mut push = |stops: &[WaterStop], first_dwell: f64| {
            for (k, s) in stops.iter().enumerate().take(stops.len() - 1) {
                let dwell = if k == 0 { first_dwell } else { s.dwell_s };
                loop_calls.push(Call {
                    stop: format!("pier:{}", s.pier),
                    resource: Some(berth(s.pier)),
                    dwell_s: dwell,
                    run_s: stops[k + 1].run_s,
                });
            }
        };
        push(&fwd, lay_first);
        push(&bwd, lay_last);
        let window = line.check_window_s.max(cycle_s);
        let rounds = (window / cycle_s).ceil() as usize + 1;
        let runs: Vec<Run> = (0..vessels)
            .map(|k| {
                let mut c: Vec<Call> = Vec::with_capacity(loop_calls.len() * rounds);
                for _ in 0..rounds {
                    c.extend(loop_calls.iter().cloned());
                }
                Run {
                    vehicle: format!("vessel {}", k + 1),
                    start: k as f64 * headway,
                    calls: c,
                }
            })
            .collect();
        let resources: BTreeMap<String, u32> = calls
            .iter()
            .map(|c| (berth(c.pier), line.piers[c.pier].berths.max(1)))
            .collect();
        let out = segment::simulate(&SimInput { resources, runs });
        let mut per: BTreeMap<usize, (usize, f64)> = BTreeMap::new();
        for ev in &out.events {
            if let segment::Event::Hold { stop, t, until, .. } = ev {
                if *t > window {
                    continue;
                }
                if let Some(p) = stop
                    .strip_prefix("pier:")
                    .and_then(|x| x.parse::<usize>().ok())
                {
                    let e = per.entry(p).or_default();
                    e.0 += 1;
                    e.1 += until - t;
                }
            }
        }
        let mut seen = Vec::new();
        for c in &calls {
            if seen.contains(&c.pier) {
                continue;
            }
            seen.push(c.pier);
            let (h, s) = per.get(&c.pier).copied().unwrap_or_default();
            holds += h;
            held_s += s;
            berths.push(BerthUse {
                pier: c.pier,
                berths: line.piers[c.pier].berths.max(1),
                peak: out.peak.get(&berth(c.pier)).copied().unwrap_or(0),
                holds: h,
                held_s: s,
            });
        }
        for b in &berths {
            if b.holds > 0 {
                let name = &line.piers[b.pier].name;
                issues.push(
                    Issue::new(
                        Level::Warning,
                        "berth.conflict",
                        format!(
                            "Vessels wait for a berth at {} {} times in {} (in total {}). Add a berth or change the headway or layover.",
                            if name.is_empty() { format!("pier {}", b.pier + 1) } else { name.clone() },
                            b.holds,
                            minutes(window).replace(" min", " minutes"),
                            minutes(b.held_s)
                        ),
                    )
                    .at_station(b.pier),
                );
            }
        }
        directions = vec![fwd, bwd];
        issues.push(Issue::new(
            Level::Info,
            "route.unchecked",
            "The route follows your via points. Land, bridges, locks and water depth are not checked yet.",
        ));
    }
    let capacity_pphpd = if calls.len() >= 2 {
        line.vessel.capacity * 3600.0 / headway
    } else {
        0.0
    };
    WaterView {
        legs,
        length_m,
        trip_time_s,
        dwell_s,
        layover_first_s: lay_first,
        layover_last_s: lay_last,
        cycle_s,
        vessels,
        capacity_pphpd,
        directions,
        berths,
        holds,
        held_s,
        issues,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vessel() -> VesselType {
        VesselType {
            id: "monohull".into(),
            service_speed_kn: 12.0,
            berthing_s: 120.0,
            boarding_pax_per_min_per_gangway: 30.0,
            min_dwell_s: 60.0,
            capacity: 250.0,
        }
    }

    fn pier(x: f64, y: f64, berths: u32) -> Pier {
        Pier {
            name: String::new(),
            lonlat: geo::to_lonlat([9.97, 53.54], [x, y]),
            berths,
            gangways: 1,
        }
    }

    fn line(piers: Vec<Pier>, headway: f64) -> WaterLine {
        let calls = (0..piers.len())
            .map(|pier| WaterCall { pier, via: vec![] })
            .collect();
        WaterLine {
            piers,
            calls,
            vessel: vessel(),
            headway_s: headway,
            layover_s: 300.0,
            pax_per_call: 60.0,
            speed_zones: vec![],
            check_window_s: 3.0 * 3600.0,
        }
    }

    #[test]
    fn running_time_dwell_and_vessels() {
        // 12 kn = 6.17 m/s: 2222 m in 360 s, plus 120 s berthing per leg.
        let l = line(
            vec![
                pier(0.0, 0.0, 1),
                pier(2222.4, 0.0, 1),
                pier(4444.8, 0.0, 1),
            ],
            15.0 * 60.0,
        );
        let v = build(&l);
        assert_eq!(v.legs.len(), 2);
        assert!(
            (v.legs[0].sail_s - 360.0).abs() < 1.0,
            "{}",
            v.legs[0].sail_s
        );
        // 60 passengers at 30 per minute through one gangway: 120 s.
        assert!((v.dwell_s - 120.0).abs() < 1e-9);
        assert!((v.trip_time_s - (2.0 * 480.0 + 120.0)).abs() < 2.0);
        // Round trip 2 × 1080 + 2 × 300 = 2760 s → 4 vessels at 15 min; cycle 3600 s.
        assert_eq!(v.vessels, 4);
        assert!((v.cycle_s - 3600.0).abs() < 1e-9);
        assert!((v.layover_first_s - v.layover_last_s).abs() < 1e-9);
        assert!((v.layover_first_s + v.layover_last_s + 2.0 * v.trip_time_s - 3600.0).abs() < 1e-9);
        assert_eq!(v.directions.len(), 2);
        assert_eq!(v.directions[1][0].pier, 2);
        assert!((v.capacity_pphpd - 1000.0).abs() < 1e-9);
    }

    #[test]
    fn speed_zone_slows_the_leg() {
        let mut l = line(vec![pier(0.0, 0.0, 1), pier(2000.0, 0.0, 1)], 1800.0);
        let ring = [
            [-10.0, -100.0],
            [1000.0, -100.0],
            [1000.0, 100.0],
            [-10.0, 100.0],
        ];
        l.speed_zones = vec![SpeedZone {
            name: "harbour".into(),
            ring: ring
                .iter()
                .map(|&p| geo::to_lonlat([9.97, 53.54], p))
                .collect(),
            max_kn: 6.0,
        }];
        let v = build(&l);
        assert!((v.legs[0].slow_m - 1000.0).abs() < 15.0);
        // 1000 m at 6 kn and 1000 m at 12 kn.
        let want = 1000.0 / (6.0 * KNOT_MS) + 1000.0 / (12.0 * KNOT_MS);
        assert!((v.legs[0].sail_s - want).abs() < 3.0);
    }

    #[test]
    fn one_berth_terminal_with_long_layover_makes_vessels_wait() {
        // A short crossing at a 5 min headway: the layover at the home pier is longer than the headway,
        // so two vessels need the one berth at the same time.
        let mut l = line(vec![pier(0.0, 0.0, 1), pier(600.0, 0.0, 1)], 300.0);
        l.layover_s = 400.0;
        let v = build(&l);
        assert!(v.holds > 0);
        assert!(v.issues.iter().any(|i| i.code == "berth.conflict"));
        // Two berths at both piers fix it.
        let mut l2 = l.clone();
        for p in &mut l2.piers {
            p.berths = 2;
        }
        let v2 = build(&l2);
        assert_eq!(v2.holds, 0, "{:?}", v2.berths);
        assert!(v2.berths.iter().all(|b| b.peak <= 2));
    }

    #[test]
    fn same_pier_twice_is_an_error() {
        let mut l = line(vec![pier(0.0, 0.0, 1), pier(1000.0, 0.0, 1)], 600.0);
        l.calls = vec![
            WaterCall {
                pier: 0,
                via: vec![],
            },
            WaterCall {
                pier: 0,
                via: vec![],
            },
        ];
        let v = build(&l);
        assert!(v.issues.iter().any(|i| i.code == "leg.same_pier"));
    }
}
