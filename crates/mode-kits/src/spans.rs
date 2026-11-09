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
//! The ground of a section comes from terrain samples when the app supplies them (heights along the
//! section from the terrain model, plus building heights), and is otherwise a straight line between the
//! station heights; the result says which sections assume a straight line.

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
    /// Per section: ground samples along it, or `None` (or missing) for a straight line between the
    /// station heights.
    #[serde(default)]
    pub ground: Vec<Option<Vec<GroundSample>>>,
}

/// A point of the ground under a section, from the terrain model.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct GroundSample {
    /// Metres from the section's first station.
    pub at_m: f64,
    /// Terrain height, same datum as the station heights.
    pub z_m: f64,
    /// Height of a building or other obstacle above the terrain here; the cabin must clear its top.
    #[serde(default)]
    pub obstacle_m: f64,
}

/// The ground of one section: a straight line between the station heights, or the samples.
struct Ground {
    len: f64,
    z0: f64,
    z1: f64,
    /// (chainage, terrain, terrain + obstacle), sorted, inside the section.
    pts: Vec<(f64, f64, f64)>,
}

impl Ground {
    fn new(len: f64, z0: f64, z1: f64, samples: Option<&Vec<GroundSample>>) -> Self {
        let mut pts: Vec<(f64, f64, f64)> = samples
            .map(|v| {
                v.iter()
                    .filter(|g| {
                        g.at_m.is_finite() && g.z_m.is_finite() && g.at_m >= 0.0 && g.at_m <= len
                    })
                    .map(|g| (g.at_m, g.z_m, g.z_m + g.obstacle_m.max(0.0)))
                    .collect()
            })
            .unwrap_or_default();
        pts.sort_by(|a, b| a.0.total_cmp(&b.0));
        Ground { len, z0, z1, pts }
    }

    fn sampled(&self) -> bool {
        !self.pts.is_empty()
    }

    /// Terrain and top of obstacles at a chainage. Stations sit at their own heights at the ends.
    fn at(&self, x: f64) -> (f64, f64) {
        if self.pts.is_empty() {
            let z = self.z0 + (self.z1 - self.z0) * x / self.len.max(1e-9);
            return (z, z);
        }
        let first = (0.0, self.z0, self.z0);
        let last = (self.len, self.z1, self.z1);
        let mut prev = first;
        for &p in self.pts.iter().chain(std::iter::once(&last)) {
            if x <= p.0 {
                let t = if p.0 - prev.0 > 1e-9 {
                    (x - prev.0) / (p.0 - prev.0)
                } else {
                    1.0
                };
                let terrain = prev.1 + (p.1 - prev.1) * t;
                // An obstacle does not taper between samples: the nearest sample's height stands.
                let near = if t < 0.5 { prev } else { p };
                return (terrain, terrain + (near.2 - near.1));
            }
            prev = p;
        }
        (self.z1, self.z1)
    }
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
    /// Terrain height.
    pub ground_m: f64,
    /// Height of a building or other obstacle above the terrain here (0 for none).
    #[serde(default)]
    pub obstacle_m: f64,
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
fn supports(g: &Ground, h_station: f64, towers: &[(f64, f64)]) -> Vec<(f64, f64)> {
    let mut s = vec![(0.0, g.z0 + h_station)];
    s.extend(towers.iter().map(|&(x, h)| (x, g.at(x).0 + h)));
    s.push((g.len, g.z1 + h_station));
    s
}

/// Lowest clearance over the section, and profile points (chainage within the section).
fn clearance(sys: &SpanSystem, g: &Ground, sup: &[(f64, f64)]) -> (f64, Vec<ProfilePoint>) {
    let len = g.len;
    let mut min = f64::INFINITY;
    let mut pts = Vec::new();
    for w in sup.windows(2) {
        let ((xa, ya), (xb, yb)) = (w[0], w[1]);
        let l = xb - xa;
        if l <= 0.0 {
            continue;
        }
        let sag = sys.sag_ratio * l;
        let cabin_at = |u: f64| {
            let rope = ya + (yb - ya) * u / l - 4.0 * sag * u * (l - u) / (l * l);
            (rope, rope - sys.cabin_hang_m)
        };
        // The cabin is in the station at the ends; clearance there is the station's business.
        let in_station = |x: f64| x < 1.0 || x > len - 1.0;
        let n = ((l / 10.0).ceil() as usize).clamp(8, 60);
        for i in 0..=n {
            let u = l * i as f64 / n as f64;
            let (rope, cabin) = cabin_at(u);
            let x = xa + u;
            let (terrain, top) = g.at(x);
            if !in_station(x) {
                min = min.min(cabin - top);
            }
            if i < n || (xb - len).abs() < 1e-9 {
                pts.push(ProfilePoint {
                    at_m: x,
                    ground_m: terrain,
                    obstacle_m: top - terrain,
                    rope_m: rope,
                    cabin_m: cabin,
                });
            }
        }
        // Every sample too, so a ridge or a building between profile steps is not missed.
        for &(x, _, top) in g.pts.iter().filter(|p| p.0 > xa && p.0 < xb) {
            if !in_station(x) {
                min = min.min(cabin_at(x - xa).1 - top);
            }
        }
    }
    (min, pts)
}

/// Purpose: automatic towers for one section: the fewest equal spans within the span limit whose lowest
/// clearance reaches the recommended value, at the standard tower height or taller up to the maximum.
fn auto_towers(sys: &SpanSystem, g: &Ground) -> Vec<(f64, f64)> {
    let len = g.len;
    let first = (len / sys.max_span_m.max(1.0)).ceil().max(1.0) as usize;
    let last = first.max((len / 30.0).ceil() as usize);
    let place = |n: usize, h: f64| -> Vec<(f64, f64)> {
        (1..n).map(|i| (len * i as f64 / n as f64, h)).collect()
    };
    let ok = |t: &[(f64, f64)]| {
        let sup = supports(g, sys.station_rope_height_m, t);
        clearance(sys, g, &sup).0 >= sys.recommended_clearance_m
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
    let mut assumed: Vec<usize> = Vec::new();
    let mut base = 0.0;
    for i in 0..n.saturating_sub(1) {
        let (a, b) = (xy[i], xy[i + 1]);
        let len = geo::dist(a, b);
        let (z0, z1) = (st[i].elevation_m, st[i + 1].elevation_m);
        let ground = Ground::new(len, z0, z1, line.ground.get(i).and_then(|g| g.as_ref()));
        if !ground.sampled() {
            assumed.push(i);
        }
        let manual = line.towers.get(i).and_then(|t| t.as_ref());
        let mut tw: Vec<(f64, f64)> = match manual {
            Some(list) => list
                .iter()
                .filter(|t| t.at_m > 0.0 && t.at_m < len)
                .map(|t| (t.at_m, t.height_m.unwrap_or(sys.tower_height_m)))
                .collect(),
            None => auto_towers(sys, &ground),
        };
        tw.sort_by(|p, q| p.0.total_cmp(&q.0));
        let sup = supports(&ground, sys.station_rope_height_m, &tw);
        let (min_c, pts) = clearance(sys, &ground, &sup);
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
    if n >= 2 && assumed.len() == n - 1 {
        issues.push(Issue::new(
            Level::Info,
            "ground.assumed",
            "Ground is a straight line between the station heights. Terrain and building heights are not checked.",
        ));
    } else {
        for &i in &assumed {
            issues.push(
                Issue::new(
                    Level::Info,
                    "ground.assumed",
                    "No terrain heights for this section; the ground is a straight line between the station heights.",
                )
                .at_section(i),
            );
        }
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
            ground: vec![],
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
            ground: vec![],
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
            ground: vec![],
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
            ground: vec![],
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
            ground: vec![],
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
            ground: vec![],
        };
        let v = build(&line);
        let last = v.profile.last().unwrap();
        assert!((last.ground_m - 150.0).abs() < 1e-6);
        assert!((last.rope_m - 158.0).abs() < 1e-6);
    }

    /// Samples every 50 m at height `z`, with a building of `building` m at the middle.
    fn valley(len: f64, z: f64, building: f64) -> Vec<GroundSample> {
        let n = (len / 50.0) as usize;
        (1..n)
            .map(|i| GroundSample {
                at_m: i as f64 * 50.0,
                z_m: z,
                obstacle_m: if i == n / 2 { building } else { 0.0 },
            })
            .collect()
    }

    fn ridge(at: f64, z: f64) -> Vec<GroundSample> {
        [(at - 50.0, 0.0), (at, z), (at + 50.0, 0.0)]
            .map(|(at_m, z_m)| GroundSample {
                at_m,
                z_m,
                obstacle_m: 0.0,
            })
            .to_vec()
    }

    #[test]
    fn sampled_ridge_and_buildings_set_clearance_and_towers() {
        let flat = SpanLine {
            stations: vec![
                st(0.0, 0.0, StationKind::Terminal),
                st(400.0, 0.0, StationKind::Terminal),
            ],
            system: mgd(),
            towers: vec![Some(vec![])],
            ground: vec![],
        };
        assert!(build(&flat)
            .issues
            .iter()
            .any(|i| i.code == "ground.assumed"));

        // Stations on the valley sides, 40 m above its floor: the span clears the floor.
        let open = SpanLine {
            ground: vec![Some(valley(400.0, -40.0, 0.0))],
            ..flat.clone()
        };
        let v = build(&open);
        assert!(!v
            .issues
            .iter()
            .any(|i| i.code.starts_with("clearance") || i.code == "ground.assumed"));

        // A 45 m building in the middle of the valley: the cabin no longer clears it.
        let building = SpanLine {
            ground: vec![Some(valley(400.0, -40.0, 45.0))],
            ..flat.clone()
        };
        let v = build(&building);
        assert!(
            v.issues.iter().any(|i| i.code == "clearance.min"),
            "{:?}",
            v.issues
        );
        let top = v.profile.iter().map(|p| p.obstacle_m).fold(0.0, f64::max);
        assert!((top - 45.0).abs() < 1e-9);

        // A 40 m ridge on a longer line: automatic towers stand on it and keep the clearance.
        let hill = SpanLine {
            stations: vec![
                st(0.0, 0.0, StationKind::Terminal),
                st(1200.0, 0.0, StationKind::Terminal),
            ],
            towers: vec![],
            ground: vec![Some(ridge(600.0, 40.0))],
            ..flat.clone()
        };
        let v = build(&hill);
        assert!(v.tower_count >= 1);
        assert!(
            !v.issues.iter().any(|i| i.code.starts_with("clearance")),
            "{:?}",
            v.issues
        );
        let peak = v
            .profile
            .iter()
            .map(|p| p.ground_m)
            .fold(f64::MIN, f64::max);
        assert!((peak - 40.0).abs() < 1e-9);
    }

    #[test]
    fn sections_without_samples_are_flagged_one_by_one() {
        let line = SpanLine {
            stations: vec![
                st(0.0, 0.0, StationKind::Terminal),
                st(500.0, 0.0, StationKind::Intermediate),
                st(1000.0, 0.0, StationKind::Terminal),
            ],
            system: mgd(),
            towers: vec![],
            ground: vec![Some(ridge(250.0, 5.0)), None],
        };
        let v = build(&line);
        let flagged: Vec<_> = v
            .issues
            .iter()
            .filter(|i| i.code == "ground.assumed")
            .collect();
        assert_eq!(flagged.len(), 1);
        assert_eq!(flagged[0].section, Some(1));
    }
}
