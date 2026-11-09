//! Straight spans kit (ADR-0036 §6, ADR-0037 §2): a line of stations joined by straight sections, carried
//! by towers.
//!
//! The planner clicks stations in order. Each section between two stations is straight; towers are placed
//! automatically along it, as few as possible within the system's span limit while the loaded cabin keeps
//! the recommended clearance with rope sag, and taller (up to the maximum tower height) when that saves a
//! tower. The planner can replace the automatic towers of a section with their own. The kit returns the
//! geometry for the map, a longitudinal profile, the live checks, and the running time, capacity, cabin
//! count and stopping pattern that the timetable needs.
//!
//! The ground between two stations is a straight line between the station heights the planner gives;
//! sampling a terrain model and building heights is a later step, and the result says so.

use crate::geo::{self, LonLat, Xy};
use crate::issue::{Issue, Level};
use serde::{Deserialize, Serialize};

/// Continuous gondolas run a belt of cabins; reversible ropeways shuttle cabins between two terminals.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Operation {
    Continuous,
    Reversible,
}

/// A ropeway system's limits and speeds: the plugin supplies them from the assumption library.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SpanSystem {
    /// `mgd`, `2s`, `3s`, `funitel`, `pulsed`, `reversible` (assumption context `ropeway_system`).
    pub id: String,
    pub operation: Operation,
    /// `ropeway.line_speed_ms`.
    pub line_speed_ms: f64,
    /// `ropeway.cabin_interval_s` (continuous only).
    pub cabin_interval_s: f64,
    /// `ropeway.cabin_capacity`: passengers per cabin.
    pub cabin_capacity: f64,
    /// `ropeway.max_span_m`.
    pub max_span_m: f64,
    /// `ropeway.max_station_angle_deg`: deflection allowed in an intermediate or angle station.
    pub max_station_angle_deg: f64,
    /// `ropeway.min_clearance_m`: below it is an error.
    pub min_clearance_m: f64,
    /// `ropeway.recommended_clearance_m`: below it is a warning, and automatic towers keep it.
    pub recommended_clearance_m: f64,
    /// `ropeway.tower_height_m`: height of an automatic tower.
    pub tower_height_m: f64,
    /// `ropeway.max_tower_height_m`.
    pub max_tower_height_m: f64,
    /// `ropeway.station_rope_height_m`: rope height above the ground at a station.
    pub station_rope_height_m: f64,
    /// `ropeway.cabin_hang_m`: from the rope down to the bottom of the cabin.
    pub cabin_hang_m: f64,
    /// `ropeway.sag_ratio`: loaded mid-span sag as a share of the span.
    pub sag_ratio: f64,
    /// `ropeway.station_passage_s`: time a cabin spends passing an intermediate station (detached, at
    /// platform speed), or the acceleration and braking loss of a reversible cabin per trip.
    pub station_passage_s: f64,
    /// `ropeway.terminal_dwell_s`: boarding time at the terminals of a reversible ropeway.
    pub terminal_dwell_s: f64,
    /// `ropeway.reserve_share`: spare cabins as a share of the cabins on the line.
    pub reserve_share: f64,
    /// `ropeway.capacity_ceiling_pphpd`: above it the line's capacity is a warning (0: no check).
    #[serde(default)]
    pub capacity_ceiling_pphpd: f64,
}

/// What a station does.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StationKind {
    /// Drive or return station at an end of the line.
    Terminal,
    /// Boarding station along the line.
    Intermediate,
    /// Direction change; boarding is optional.
    Angle,
}

/// A station as the planner placed it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SpanStation {
    #[serde(default)]
    pub name: String,
    pub lonlat: LonLat,
    /// Ignored at the ends, which are always terminals.
    #[serde(default = "intermediate")]
    pub kind: StationKind,
    /// Whether passengers board at an angle station (other stations always board).
    #[serde(default)]
    pub boarding: bool,
    /// Ground height in metres (any common datum); 0 when unknown.
    #[serde(default)]
    pub elevation_m: f64,
}

fn intermediate() -> StationKind {
    StationKind::Intermediate
}

/// A tower the planner placed, along a section.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct TowerInput {
    /// Metres from the section's first station.
    pub at_m: f64,
    /// Height of the rope support above the ground; the system's tower height when absent.
    #[serde(default)]
    pub height_m: Option<f64>,
}

/// The kit's input: stations in order, the system, and the planner's towers per section.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SpanLine {
    pub stations: Vec<SpanStation>,
    pub system: SpanSystem,
    /// Per section: `None` (or missing) places towers automatically; `Some` uses the planner's towers.
    #[serde(default)]
    pub towers: Vec<Option<Vec<TowerInput>>>,
}

/// A tower as built.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TowerView {
    pub at_m: f64,
    pub lonlat: LonLat,
    pub height_m: f64,
    /// Placed by the kit (not by the planner).
    pub auto: bool,
}

/// One point of the longitudinal profile.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ProfilePoint {
    /// Metres from the first station of the line.
    pub at_m: f64,
    pub ground_m: f64,
    pub rope_m: f64,
    pub cabin_m: f64,
}

/// A section between two stations.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SectionView {
    pub length_m: f64,
    pub towers: Vec<TowerView>,
    /// Span lengths between supports (stations and towers), in order.
    pub spans_m: Vec<f64>,
    /// Lowest clearance under the loaded cabin.
    pub min_clearance_m: f64,
    /// Whether the planner placed this section's towers.
    pub manual: bool,
}

/// A station as built.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StationView {
    pub kind: StationKind,
    pub boarding: bool,
    pub at_m: f64,
    /// Direction change at the station, degrees (0 at the ends).
    pub deflection_deg: f64,
}

/// A passenger stop of the stopping pattern, for the published timetable.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct StopTime {
    /// Index into the stations.
    pub station: usize,
    /// Running time from the previous stop, seconds.
    pub run_s: f64,
    /// Time at this stop, seconds.
    pub dwell_s: f64,
}

/// The kit's output.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SpanView {
    pub stations: Vec<StationView>,
    pub sections: Vec<SectionView>,
    pub profile: Vec<ProfilePoint>,
    pub length_m: f64,
    /// One-way trip time from the first to the last station, seconds.
    pub trip_time_s: f64,
    /// Time between departures at a station, seconds (the cabin interval, or the shuttle cycle).
    pub headway_s: f64,
    /// Passengers per hour and direction at full cabins.
    pub capacity_pphpd: f64,
    /// Distance between cabins on the rope (continuous systems), metres.
    pub cabin_spacing_m: f64,
    /// Cabins needed including the reserve (the cabin garage holds them at night).
    pub cabins: u32,
    pub tower_count: usize,
    pub stops: Vec<StopTime>,
    pub issues: Vec<Issue>,
}

/// Supports of a section: chainage, rope height above datum.
fn supports(len: f64, z0: f64, z1: f64, h_station: f64, towers: &[(f64, f64)]) -> Vec<(f64, f64)> {
    let ground = |x: f64| z0 + (z1 - z0) * x / len.max(1e-9);
    let mut s = vec![(0.0, z0 + h_station)];
    s.extend(towers.iter().map(|&(x, h)| (x, ground(x) + h)));
    s.push((len, z1 + h_station));
    s
}

/// Lowest clearance over the section, and profile points (chainage within the section).
fn clearance(
    sys: &SpanSystem,
    len: f64,
    z0: f64,
    z1: f64,
    sup: &[(f64, f64)],
) -> (f64, Vec<ProfilePoint>) {
    let ground = |x: f64| z0 + (z1 - z0) * x / len.max(1e-9);
    let mut min = f64::INFINITY;
    let mut pts = Vec::new();
    for w in sup.windows(2) {
        let ((xa, ya), (xb, yb)) = (w[0], w[1]);
        let l = xb - xa;
        if l <= 0.0 {
            continue;
        }
        let sag = sys.sag_ratio * l;
        let n = ((l / 10.0).ceil() as usize).clamp(8, 60);
        for i in 0..=n {
            let u = l * i as f64 / n as f64;
            let rope = ya + (yb - ya) * u / l - 4.0 * sag * u * (l - u) / (l * l);
            let cabin = rope - sys.cabin_hang_m;
            let x = xa + u;
            let g = ground(x);
            // The cabin is in the station at the ends; clearance there is the station's business.
            let in_station = x < 1.0 || x > len - 1.0;
            if !in_station {
                min = min.min(cabin - g);
            }
            if i < n || (xb - len).abs() < 1e-9 {
                pts.push(ProfilePoint {
                    at_m: x,
                    ground_m: g,
                    rope_m: rope,
                    cabin_m: cabin,
                });
            }
        }
    }
    (min, pts)
}

/// Purpose: automatic towers for one section: the fewest equal spans within the span limit whose lowest
/// clearance reaches the recommended value, at the standard tower height or taller up to the maximum.
fn auto_towers(sys: &SpanSystem, len: f64, z0: f64, z1: f64) -> Vec<(f64, f64)> {
    let first = (len / sys.max_span_m.max(1.0)).ceil().max(1.0) as usize;
    let last = first.max((len / 30.0).ceil() as usize);
    let place = |n: usize, h: f64| -> Vec<(f64, f64)> {
        (1..n).map(|i| (len * i as f64 / n as f64, h)).collect()
    };
    let ok = |t: &[(f64, f64)]| {
        let sup = supports(len, z0, z1, sys.station_rope_height_m, t);
        clearance(sys, len, z0, z1, &sup).0 >= sys.recommended_clearance_m
    };
    for n in first..=last {
        let low = place(n, sys.tower_height_m);
        if ok(&low) {
            return low;
        }
        let high = sys.max_tower_height_m.max(sys.tower_height_m);
        if n > 1 && ok(&place(n, high)) {
            // Lowest height that works, to the metre.
            let (mut lo, mut hi) = (sys.tower_height_m, high);
            while hi - lo > 0.5 {
                let mid = (lo + hi) / 2.0;
                if ok(&place(n, mid)) {
                    hi = mid;
                } else {
                    lo = mid;
                }
            }
            return place(n, hi.ceil());
        }
    }
    place(first, sys.tower_height_m)
}

fn fmt_m(x: f64) -> String {
    format!("{:.0} m", x)
}

/// Purpose: build a ropeway line: towers, profile, checks, running time, capacity and cabin count.
/// Input: stations in order (ends are terminals), the system, optional towers per section.
/// Output: the built line; a line with fewer than two stations has no sections and an info finding.
pub fn build(line: &SpanLine) -> SpanView {
    let sys = &line.system;
    let st = &line.stations;
    let mut issues = Vec::new();
    let n = st.len();
    if n < 2 {
        issues.push(Issue::new(
            Level::Info,
            "line.too_short",
            "Click at least two stations on the map.",
        ));
    }
    let origin = st.first().map_or([0.0, 0.0], |s| s.lonlat);
    let xy: Vec<Xy> = st.iter().map(|s| geo::to_local(origin, s.lonlat)).collect();
    let reversible = sys.operation == Operation::Reversible;

    // Stations: effective kind, boarding and deflection.
    let mut stations = Vec::with_capacity(n);
    let mut at = 0.0;
    for i in 0..n {
        if i > 0 {
            at += geo::dist(xy[i - 1], xy[i]);
        }
        let end = i == 0 || i + 1 == n;
        let kind = if end {
            StationKind::Terminal
        } else if st[i].kind == StationKind::Terminal {
            StationKind::Intermediate
        } else {
            st[i].kind
        };
        let boarding = kind != StationKind::Angle || st[i].boarding;
        let deflection_deg = if end {
            0.0
        } else {
            geo::deflection_deg(xy[i - 1], xy[i], xy[i + 1])
        };
        if !end {
            if reversible && deflection_deg > 0.5 {
                issues.push(
                    Issue::new(
                        Level::Error,
                        "station.angle_reversible",
                        format!(
                            "An aerial tramway runs straight; it turns {:.0}° here. Split it into two lines.",
                            deflection_deg
                        ),
                    )
                    .at_station(i),
                );
            } else if deflection_deg > sys.max_station_angle_deg {
                issues.push(
                    Issue::new(
                        Level::Error,
                        "station.angle",
                        format!(
                            "The line turns {:.0}° here; this system allows {:.0}° in a station.",
                            deflection_deg, sys.max_station_angle_deg
                        ),
                    )
                    .at_station(i)
                    .param("ropeway.max_station_angle_deg"),
                );
            }
            if reversible {
                issues.push(
                    Issue::new(
                        Level::Warning,
                        "station.intermediate_reversible",
                        "Aerial tramways rarely have stations between the terminals; both cabins stop when one does.",
                    )
                    .at_station(i),
                );
            }
        }
        stations.push(StationView {
            kind,
            boarding,
            at_m: at,
            deflection_deg,
        });
    }

    // Sections.
    let mut sections = Vec::new();
    let mut profile = Vec::new();
    let mut base = 0.0;
    for i in 0..n.saturating_sub(1) {
        let (a, b) = (xy[i], xy[i + 1]);
        let len = geo::dist(a, b);
        let (z0, z1) = (st[i].elevation_m, st[i + 1].elevation_m);
        let manual = line.towers.get(i).and_then(|t| t.as_ref());
        let mut tw: Vec<(f64, f64)> = match manual {
            Some(list) => list
                .iter()
                .filter(|t| t.at_m > 0.0 && t.at_m < len)
                .map(|t| (t.at_m, t.height_m.unwrap_or(sys.tower_height_m)))
                .collect(),
            None => auto_towers(sys, len, z0, z1),
        };
        tw.sort_by(|p, q| p.0.total_cmp(&q.0));
        let sup = supports(len, z0, z1, sys.station_rope_height_m, &tw);
        let (min_c, pts) = clearance(sys, len, z0, z1, &sup);
        profile.extend(pts.into_iter().map(|p| ProfilePoint {
            at_m: base + p.at_m,
            ..p
        }));
        let spans_m: Vec<f64> = sup.windows(2).map(|w| w[1].0 - w[0].0).collect();
        for (k, s) in spans_m.iter().enumerate() {
            if *s > sys.max_span_m + 0.5 {
                issues.push(
                    Issue::new(
                        Level::Error,
                        "span.too_long",
                        format!(
                            "Span {} is {}; this system spans at most {}. Add a tower.",
                            k + 1,
                            fmt_m(*s),
                            fmt_m(sys.max_span_m)
                        ),
                    )
                    .at_section(i)
                    .param("ropeway.max_span_m"),
                );
            }
        }
        if len > 0.0 && min_c < sys.min_clearance_m {
            issues.push(
                Issue::new(
                    Level::Error,
                    "clearance.min",
                    format!(
                        "The loaded cabin comes within {} of the ground; at least {} is needed.",
                        fmt_m(min_c),
                        fmt_m(sys.min_clearance_m)
                    ),
                )
                .at_section(i)
                .param("ropeway.min_clearance_m"),
            );
        } else if len > 0.0 && min_c < sys.recommended_clearance_m {
            issues.push(
                Issue::new(
                    Level::Warning,
                    "clearance.recommended",
                    format!(
                        "The loaded cabin comes within {} of the ground; {} is recommended.",
                        fmt_m(min_c),
                        fmt_m(sys.recommended_clearance_m)
                    ),
                )
                .at_section(i)
                .param("ropeway.recommended_clearance_m"),
            );
        }
        for (x, h) in &tw {
            if *h > sys.max_tower_height_m + 0.5 {
                issues.push(
                    Issue::new(
                        Level::Warning,
                        "tower.too_tall",
                        format!(
                            "A tower {} along is {} tall; this system's towers are at most {}.",
                            fmt_m(*x),
                            fmt_m(*h),
                            fmt_m(sys.max_tower_height_m)
                        ),
                    )
                    .at_section(i)
                    .param("ropeway.max_tower_height_m"),
                );
            }
        }
        if len < 60.0 {
            issues.push(
                Issue::new(
                    Level::Warning,
                    "section.short",
                    format!(
                        "Stations {} and {} are only {} apart.",
                        i + 1,
                        i + 2,
                        fmt_m(len)
                    ),
                )
                .at_section(i),
            );
        }
        let towers = tw
            .iter()
            .map(|&(x, h)| TowerView {
                at_m: x,
                lonlat: geo::to_lonlat(origin, geo::lerp(a, b, x / len.max(1e-9))),
                height_m: h,
                auto: manual.is_none(),
            })
            .collect();
        sections.push(SectionView {
            length_m: len,
            towers,
            spans_m,
            min_clearance_m: min_c,
            manual: manual.is_some(),
        });
        base += len;
    }
    let length_m = base;

    // Running time and stopping pattern.
    let v = sys.line_speed_ms.max(0.1);
    let mut stops = Vec::new();
    let mut run = 0.0;
    let mut trip = 0.0;
    for i in 0..n {
        if i > 0 {
            let t = sections[i - 1].length_m / v;
            run += t;
            trip += t;
        }
        let end = i == 0 || i + 1 == n;
        let passage = if end || reversible {
            0.0
        } else {
            sys.station_passage_s
        };
        trip += passage;
        if stations[i].boarding {
            stops.push(StopTime {
                station: i,
                run_s: if stops.is_empty() { 0.0 } else { run },
                dwell_s: passage,
            });
            run = 0.0;
        } else {
            run += passage;
        }
    }
    let (headway_s, capacity_pphpd, cabin_spacing_m, cabins) = if n < 2 {
        (0.0, 0.0, 0.0, 0)
    } else if reversible {
        trip += sys.station_passage_s;
        if let Some(last) = stops.last_mut() {
            last.run_s += sys.station_passage_s;
        }
        let h = trip + sys.terminal_dwell_s;
        (h, sys.cabin_capacity * 3600.0 / h, 0.0, 2)
    } else {
        let iv = sys.cabin_interval_s.max(1.0);
        let spacing = v * iv;
        let on_line = 2.0 * length_m / spacing;
        let cabins = (on_line * (1.0 + sys.reserve_share) - 1e-9).ceil() as u32;
        (iv, sys.cabin_capacity * 3600.0 / iv, spacing, cabins)
    };
    if n >= 2 && sys.capacity_ceiling_pphpd > 0.0 && capacity_pphpd > sys.capacity_ceiling_pphpd {
        issues.push(
            Issue::new(
                Level::Warning,
                "capacity.ceiling",
                format!(
                    "{:.0} passengers per hour and direction is more than any ropeway carries (about {:.0}).",
                    capacity_pphpd, sys.capacity_ceiling_pphpd
                ),
            )
            .param("ropeway.capacity_ceiling_pphpd"),
        );
    }
    if n >= 2 {
        issues.push(Issue::new(
            Level::Info,
            "ground.assumed",
            "Ground is a straight line between the station heights you entered. Terrain and building heights are not checked yet.",
        ));
    }
    let tower_count = sections.iter().map(|s| s.towers.len()).sum();
    SpanView {
        stations,
        sections,
        profile,
        length_m,
        trip_time_s: trip,
        headway_s,
        capacity_pphpd,
        cabin_spacing_m,
        cabins,
        tower_count,
        stops,
        issues,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    pub(crate) fn mgd() -> SpanSystem {
        SpanSystem {
            id: "mgd".into(),
            operation: Operation::Continuous,
            line_speed_ms: 6.0,
            cabin_interval_s: 12.0,
            cabin_capacity: 10.0,
            max_span_m: 400.0,
            max_station_angle_deg: 20.0,
            min_clearance_m: 5.0,
            recommended_clearance_m: 8.0,
            tower_height_m: 25.0,
            max_tower_height_m: 50.0,
            station_rope_height_m: 8.0,
            cabin_hang_m: 4.0,
            sag_ratio: 0.04,
            station_passage_s: 45.0,
            terminal_dwell_s: 60.0,
            reserve_share: 0.1,
            capacity_ceiling_pphpd: 6000.0,
        }
    }

    fn st(x: f64, y: f64, kind: StationKind) -> SpanStation {
        let o = [7.6, 50.36];
        SpanStation {
            name: String::new(),
            lonlat: geo::to_lonlat(o, [x, y]),
            kind,
            boarding: false,
            elevation_m: 0.0,
        }
    }

    #[test]
    fn capacity_and_cabins_follow_the_research_example() {
        // R1 §1.2: a 10-cabin MGD at 6 m/s with cabins every 12 s gives 3,000 p/h/dir.
        let line = SpanLine {
            stations: vec![
                st(0.0, 0.0, StationKind::Terminal),
                st(1800.0, 0.0, StationKind::Terminal),
            ],
            system: mgd(),
            towers: vec![],
        };
        let v = build(&line);
        assert!((v.length_m - 1800.0).abs() < 1.0);
        assert!((v.capacity_pphpd - 3000.0).abs() < 1e-6);
        assert!((v.cabin_spacing_m - 72.0).abs() < 1e-9);
        // 2 × 1800 / 72 = 50 cabins on the rope, + 10 % reserve = 55.
        assert_eq!(v.cabins, 55);
        assert!((v.trip_time_s - 300.0).abs() < 1.0);
        assert_eq!(v.headway_s, 12.0);
        assert!(
            !v.issues.iter().any(|i| i.level == Level::Error),
            "{:?}",
            v.issues
        );
    }

    #[test]
    fn automatic_towers_respect_span_limit_and_clearance() {
        let line = SpanLine {
            stations: vec![
                st(0.0, 0.0, StationKind::Terminal),
                st(1500.0, 0.0, StationKind::Terminal),
            ],
            system: mgd(),
            towers: vec![],
        };
        let v = build(&line);
        let s = &v.sections[0];
        assert!(
            s.spans_m.iter().all(|x| *x <= 400.0 + 1e-6),
            "{:?}",
            s.spans_m
        );
        assert!(
            s.min_clearance_m >= 8.0 - 1e-6,
            "clearance {}",
            s.min_clearance_m
        );
        assert!(s.towers.iter().all(|t| t.auto && t.height_m <= 50.0));
        assert!(!v.profile.is_empty());
    }

    #[test]
    fn long_manual_span_and_low_clearance_are_errors() {
        let line = SpanLine {
            stations: vec![
                st(0.0, 0.0, StationKind::Terminal),
                st(1000.0, 0.0, StationKind::Terminal),
            ],
            system: mgd(),
            towers: vec![Some(vec![])],
        };
        let v = build(&line);
        assert!(v.issues.iter().any(|i| i.code == "span.too_long"));
        assert!(v.issues.iter().any(|i| i.code == "clearance.min"));
        assert!(v.sections[0].manual);
    }

    #[test]
    fn sharp_angle_is_an_error_and_stops_skip_angle_stations() {
        let line = SpanLine {
            stations: vec![
                st(0.0, 0.0, StationKind::Terminal),
                st(800.0, 0.0, StationKind::Angle),
                st(800.0, 800.0, StationKind::Terminal),
            ],
            system: mgd(),
            towers: vec![],
        };
        let v = build(&line);
        let e = v
            .issues
            .iter()
            .find(|i| i.code == "station.angle")
            .expect("angle error");
        assert_eq!(e.station, Some(1));
        assert_eq!(v.stops.len(), 2, "the angle station has no boarding");
        assert!((v.stops[1].run_s - (1600.0 / 6.0 + 45.0)).abs() < 1.0);
    }

    #[test]
    fn reversible_runs_a_shuttle() {
        let mut sys = mgd();
        sys.operation = Operation::Reversible;
        sys.line_speed_ms = 10.0;
        sys.cabin_capacity = 80.0;
        sys.station_passage_s = 30.0;
        let line = SpanLine {
            stations: vec![
                st(0.0, 0.0, StationKind::Terminal),
                st(1000.0, 0.0, StationKind::Terminal),
            ],
            system: sys,
            towers: vec![],
        };
        let v = build(&line);
        // 100 s at line speed + 30 s acceleration and braking; departures every 130 + 60 s.
        assert!((v.trip_time_s - 130.0).abs() < 1.0);
        assert!((v.headway_s - 190.0).abs() < 1.0);
        assert!((v.capacity_pphpd - 80.0 * 3600.0 / 190.0).abs() < 1.0);
        assert_eq!(v.cabins, 2);
    }

    #[test]
    fn hill_raises_the_far_end() {
        let mut s1 = st(1200.0, 0.0, StationKind::Terminal);
        s1.elevation_m = 150.0;
        let line = SpanLine {
            stations: vec![st(0.0, 0.0, StationKind::Terminal), s1],
            system: mgd(),
            towers: vec![],
        };
        let v = build(&line);
        let last = v.profile.last().unwrap();
        assert!((last.ground_m - 150.0).abs() < 1e-6);
        assert!((last.rope_m - 158.0).abs() < 1e-6);
    }
}
