//! The **service zone kit**: an on-demand (demand-responsive) service inside a drawn zone, estimated with
//! the standard continuous-approximation formulas instead of a trip-by-trip dispatch simulation (which
//! needs its own ADR, ADR-0037 §7).
//!
//! - The mean trip length is the mean straight distance between two random points of the zone (sampled
//!   on a grid, so a long thin zone gets longer trips than a round one) times the street network factor.
//! - The vehicles' driving follows the Beardwood–Halton–Hammersley tour length: `n` random stops in an
//!   area `A` take about `0.7124 √(n A)` of driving. With `N` vehicles sharing `2λ` stops an hour (each
//!   request is a pick-up and a drop-off), the fleet drives `0.7124 √(2 λ A N)` an hour (Daganzo 1978).
//! - Vehicles needed: the smallest fleet whose busy share stays at the target utilisation, solving
//!   `u N = 2 λ d / 3600 + k 0.7124 √(2 λ A N) / v` for `N`.
//! - Wait: the drive from the nearest vehicle (`0.5 √(A / N)` straight, times the network factor), longer
//!   as the fleet gets busy (divided by `1 − ρ`); no estimate when the fleet cannot keep up (`ρ ≥ 1`).
//! - Ride: the direct trip at the service speed, longer by the pooling detour share, plus one dwell.

use crate::geo::{dist, to_local, LonLat, Xy};
use crate::{Issue, Level};
use serde::{Deserialize, Serialize};

/// The on-demand system, from the plugin's `drt.*` parameter values.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZoneSystem {
    /// Average driving speed in the zone, km/h.
    pub speed_kmh: f64,
    /// Street distance over straight distance.
    pub network_factor: f64,
    /// Time stopped for a pick-up or a drop-off, s.
    pub stop_dwell_s: f64,
    /// Passenger places per vehicle.
    pub vehicle_places: f64,
    /// Busy share of the fleet that still leaves vehicles free to answer requests quickly.
    pub target_utilisation: f64,
    /// How much longer a shared ride is than the direct trip (0.3 = 30 % longer).
    pub pooling_detour_share: f64,
    /// The wait a rider should not exceed on average, s (a recommendation).
    pub max_wait_s: f64,
    /// Riders per request (groups travelling together).
    pub riders_per_request: f64,
}

/// What the planner drew and set.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZoneInput {
    /// The zone's outline (not closed: the last point joins the first).
    pub ring: Vec<LonLat>,
    /// Ride requests an hour, on average over the service hours.
    pub requests_per_hour: f64,
    /// Vehicles in service.
    pub fleet: u32,
    /// Service hours, seconds after midnight.
    pub start_s: u32,
    pub end_s: u32,
    pub system: ZoneSystem,
    /// Prefix of the parameter keys in findings, such as `drt`.
    #[serde(default = "drt_prefix")]
    pub parameter_prefix: String,
}

fn drt_prefix() -> String {
    "drt".into()
}

/// The estimate.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ZoneView {
    pub area_km2: f64,
    /// Mean straight distance between two points of the zone, km.
    pub mean_straight_km: f64,
    /// Mean trip on the streets, km.
    pub mean_trip_km: f64,
    /// Fleet needed to serve the requests at the target utilisation.
    pub vehicles_needed: u32,
    /// Busy share of the planner's fleet (above 1: it cannot keep up).
    pub utilisation: f64,
    /// Average wait from request to pick-up, s; None when the fleet cannot keep up.
    pub wait_s: Option<f64>,
    /// Average time on board, s.
    pub ride_s: f64,
    /// Wait plus ride, s; None when the fleet cannot keep up.
    pub door_to_door_s: Option<f64>,
    /// Average riders on board of a vehicle in service.
    pub mean_occupancy: f64,
    /// For a trip of `d` km: on board `ride_fixed_s + d × ride_s_per_km`.
    pub ride_s_per_km: f64,
    pub ride_fixed_s: f64,
    pub service_hours: f64,
    pub requests_per_day: f64,
    pub vehicle_hours_per_day: f64,
    pub vehicle_km_per_day: f64,
    pub issues: Vec<Issue>,
}

/// Shoelace area of a ring in local metres, m².
fn area_m2(ring: &[Xy]) -> f64 {
    let n = ring.len();
    let mut s = 0.0;
    for i in 0..n {
        let (a, b) = (ring[i], ring[(i + 1) % n]);
        s += a[0] * b[1] - b[0] * a[1];
    }
    (s / 2.0).abs()
}

/// Whether two segments cross (touching ends do not count).
fn crosses(a: Xy, b: Xy, c: Xy, d: Xy) -> bool {
    let o = |p: Xy, q: Xy, r: Xy| (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    let (d1, d2, d3, d4) = (o(c, d, a), o(c, d, b), o(a, b, c), o(a, b, d));
    d1 * d2 < 0.0 && d3 * d4 < 0.0
}

fn self_crossing(ring: &[Xy]) -> bool {
    let n = ring.len();
    for i in 0..n {
        for j in i + 1..n {
            // Neighbouring edges share an end.
            if j == i + 1 || (i == 0 && j == n - 1) {
                continue;
            }
            if crosses(ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n]) {
                return true;
            }
        }
    }
    false
}

/// Purpose: mean straight distance in metres between two random points of the zone, from points on a
/// regular grid inside it (about 400 points). For a square of side `s` it is 0.5214 `s`.
pub fn mean_distance_m(ring: &[Xy]) -> f64 {
    let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
    for p in ring {
        x0 = x0.min(p[0]);
        y0 = y0.min(p[1]);
        x1 = x1.max(p[0]);
        y1 = y1.max(p[1]);
    }
    let a = area_m2(ring);
    if a <= 0.0 {
        return 0.0;
    }
    let step = (a / 400.0).sqrt();
    let mut pts = Vec::new();
    let mut y = y0 + step / 2.0;
    while y < y1 {
        let mut x = x0 + step / 2.0;
        while x < x1 {
            if crate::geo::inside([x, y], ring) {
                pts.push([x, y]);
            }
            x += step;
        }
        y += step;
    }
    let n = pts.len();
    if n < 2 {
        return 0.0;
    }
    let mut sum = 0.0;
    for i in 0..n {
        for j in i + 1..n {
            sum += dist(pts[i], pts[j]);
        }
    }
    // Pairs of distinct points; random pairs also include the same cell, which adds the mean distance
    // within one cell (about 0.52 step) once per point.
    (2.0 * sum + n as f64 * 0.5214 * step) / (n * n) as f64
}

/// Purpose: estimate an on-demand service in a zone.
/// Input: the zone, the requests an hour, the fleet, the service hours and the system's values.
/// Output: vehicles needed, utilisation, wait, ride, door-to-door time, occupancy, daily vehicle-hours and
/// vehicle-km, and findings.
pub fn estimate(input: &ZoneInput) -> ZoneView {
    let s = &input.system;
    let pk = |k: &str| format!("{}.{}", input.parameter_prefix, k);
    let mut issues = Vec::new();
    let mut view = ZoneView::default();
    if input.ring.len() < 3 {
        issues.push(Issue::new(
            Level::Info,
            "zone.draw",
            "Click at least three points on the map to outline the zone.",
        ));
        view.issues = issues;
        return view;
    }
    let origin = input.ring[0];
    let ring: Vec<Xy> = input.ring.iter().map(|p| to_local(origin, *p)).collect();
    if self_crossing(&ring) {
        issues.push(Issue::new(
            Level::Error,
            "zone.crossing",
            "The zone's outline crosses itself. Move a point so the outline goes round once.",
        ));
    }
    let area = area_m2(&ring) / 1e6;
    let straight = mean_distance_m(&ring) / 1000.0;
    let k = s.network_factor.max(1.0);
    let v = s.speed_kmh.max(1.0);
    let trip = straight * k;
    view.area_km2 = area;
    view.mean_straight_km = straight;
    view.mean_trip_km = trip;
    view.service_hours = (input.end_s.saturating_sub(input.start_s)) as f64 / 3600.0;

    let lambda = input.requests_per_hour.max(0.0);
    let u = s.target_utilisation.clamp(0.1, 1.0);
    // Busy vehicle-hours an hour for a fleet of n: stops plus the shared tour.
    let busy = |n: f64| {
        2.0 * lambda * s.stop_dwell_s / 3600.0 + k * 0.7124 * (2.0 * lambda * area * n).sqrt() / v
    };
    // u x² − b x − c = 0 with x = √N.
    let b = k * 0.7124 * (2.0 * lambda * area).sqrt() / v;
    let c = 2.0 * lambda * s.stop_dwell_s / 3600.0;
    let x = (b + (b * b + 4.0 * u * c).sqrt()) / (2.0 * u);
    view.vehicles_needed = if lambda > 0.0 {
        (x * x).ceil().max(1.0) as u32
    } else {
        0
    };

    let fleet = input.fleet as f64;
    view.ride_s_per_km = 3600.0 / v * k * (1.0 + s.pooling_detour_share.max(0.0));
    view.ride_fixed_s = s.stop_dwell_s;
    view.ride_s = view.ride_fixed_s + straight * view.ride_s_per_km;
    if fleet > 0.0 && area > 0.0 {
        let rho = busy(fleet) / fleet;
        view.utilisation = rho;
        if rho < 1.0 {
            let reach_km = 0.5 * (area / fleet).sqrt() * k;
            let wait = reach_km / v * 3600.0 / (1.0 - rho);
            view.wait_s = Some(wait);
            view.door_to_door_s = Some(wait + view.ride_s);
        }
        let riders = lambda * s.riders_per_request.max(1.0);
        view.mean_occupancy = riders * view.ride_s / 3600.0 / fleet;
        view.requests_per_day = lambda * view.service_hours;
        view.vehicle_hours_per_day = fleet * view.service_hours;
        view.vehicle_km_per_day =
            (k * 0.7124 * (2.0 * lambda * area * fleet).sqrt()).min(fleet * v) * view.service_hours;
    }

    if input.end_s <= input.start_s {
        issues.push(Issue::new(
            Level::Error,
            "zone.hours",
            "The service ends before it starts.",
        ));
    }
    if lambda > 0.0 && input.fleet == 0 {
        issues.push(Issue::new(
            Level::Error,
            "zone.no_fleet",
            "Set how many vehicles serve the zone.",
        ));
    } else if lambda > 0.0 && view.utilisation >= 1.0 {
        issues.push(
            Issue::new(
                Level::Error,
                "zone.fleet_short",
                format!(
                    "{} vehicles cannot keep up with {} requests an hour: about {} are needed.",
                    input.fleet,
                    lambda.round(),
                    view.vehicles_needed
                ),
            )
            .param(&pk("target_utilisation")),
        );
    } else if lambda > 0.0 && view.utilisation > u {
        issues.push(
            Issue::new(
                Level::Warning,
                "zone.busy",
                format!(
                    "The fleet is busy {:.0} % of the time, above the {:.0} % that keeps waits short; {} vehicles are recommended.",
                    view.utilisation * 100.0,
                    u * 100.0,
                    view.vehicles_needed
                ),
            )
            .param(&pk("target_utilisation")),
        );
    }
    if let Some(w) = view.wait_s {
        if w > s.max_wait_s {
            issues.push(
                Issue::new(
                    Level::Warning,
                    "zone.wait",
                    format!(
                        "Riders wait about {:.0} min on average, more than the {:.0} min recommended.",
                        w / 60.0,
                        s.max_wait_s / 60.0
                    ),
                )
                .param(&pk("max_wait_s")),
            );
        }
    }
    if view.mean_occupancy > s.vehicle_places * 0.8 {
        issues.push(
            Issue::new(
                Level::Warning,
                "zone.full",
                format!(
                    "Vehicles carry {:.1} riders on average with {:.0} places: many requests would find them full.",
                    view.mean_occupancy, s.vehicle_places
                ),
            )
            .param(&pk("vehicle_places")),
        );
    }
    view.issues = issues;
    view
}

#[cfg(test)]
mod tests {
    use super::*;

    fn system() -> ZoneSystem {
        ZoneSystem {
            speed_kmh: 25.0,
            network_factor: 1.3,
            stop_dwell_s: 45.0,
            vehicle_places: 8.0,
            target_utilisation: 0.85,
            pooling_detour_share: 0.3,
            max_wait_s: 900.0,
            riders_per_request: 1.2,
        }
    }

    /// A square of `side_m` metres near 50° N.
    fn square(side_m: f64) -> Vec<LonLat> {
        let o = [10.0, 50.0];
        [[0.0, 0.0], [side_m, 0.0], [side_m, side_m], [0.0, side_m]]
            .iter()
            .map(|xy| crate::geo::to_lonlat(o, *xy))
            .collect()
    }

    fn input(requests: f64, fleet: u32) -> ZoneInput {
        ZoneInput {
            ring: square(4000.0),
            requests_per_hour: requests,
            fleet,
            start_s: 6 * 3600,
            end_s: 22 * 3600,
            system: system(),
            parameter_prefix: "drt".into(),
        }
    }

    #[test]
    fn mean_distance_of_a_square_and_a_strip() {
        let sq: Vec<Xy> = vec![[0.0, 0.0], [1000.0, 0.0], [1000.0, 1000.0], [0.0, 1000.0]];
        let d = mean_distance_m(&sq);
        assert!((d - 521.4).abs() < 8.0, "{d}");
        // The same area as a strip four times as long: longer trips.
        let strip: Vec<Xy> = vec![[0.0, 0.0], [2000.0, 0.0], [2000.0, 500.0], [0.0, 500.0]];
        assert!(mean_distance_m(&strip) > 1.3 * d);
    }

    #[test]
    fn estimates_wait_ride_and_fleet() {
        let v = estimate(&input(60.0, 8));
        assert!((v.area_km2 - 16.0).abs() < 0.05, "{}", v.area_km2);
        assert!(
            (v.mean_straight_km - 2.086).abs() < 0.05,
            "{}",
            v.mean_straight_km
        );
        // 60 requests an hour in 16 km²: a handful of vehicles.
        assert!(
            (4..=8).contains(&v.vehicles_needed),
            "{}",
            v.vehicles_needed
        );
        assert!(
            v.utilisation > 0.4 && v.utilisation < 0.85,
            "{}",
            v.utilisation
        );
        let w = v.wait_s.unwrap();
        assert!(w > 120.0 && w < 900.0, "{w}");
        // 2.09 km × 1.3 × 1.3 at 25 km/h + 45 s ≈ 9.6 min.
        assert!((v.ride_s - 553.0).abs() < 15.0, "{}", v.ride_s);
        assert_eq!(v.door_to_door_s, Some(w + v.ride_s));
        assert!((v.requests_per_day - 960.0).abs() < 1e-9);
        assert!((v.vehicle_hours_per_day - 128.0).abs() < 1e-9);
        assert!(v.issues.is_empty(), "{:?}", v.issues);
        // The planner's fleet at the recommended size keeps the busy share at the target.
        let at = estimate(&input(60.0, v.vehicles_needed));
        assert!(at.utilisation <= 0.85 + 1e-9);
    }

    #[test]
    fn a_small_fleet_and_bad_outlines_are_flagged() {
        let v = estimate(&input(300.0, 3));
        assert!(v.utilisation >= 1.0);
        assert_eq!(v.wait_s, None);
        assert!(v.issues.iter().any(|i| i.code == "zone.fleet_short"
            && i.parameter.as_deref() == Some("drt.target_utilisation")));
        let mut bow = input(10.0, 2);
        bow.ring = vec![bow.ring[0], bow.ring[2], bow.ring[1], bow.ring[3]];
        assert!(estimate(&bow)
            .issues
            .iter()
            .any(|i| i.code == "zone.crossing"));
        let mut two = input(10.0, 2);
        two.ring.truncate(2);
        assert_eq!(estimate(&two).issues[0].code, "zone.draw");
        let busy = estimate(&input(60.0, 6));
        assert!(
            busy.issues
                .iter()
                .any(|i| i.code == "zone.busy" || i.code == "zone.wait"),
            "{:?}",
            busy.issues
        );
    }
}
