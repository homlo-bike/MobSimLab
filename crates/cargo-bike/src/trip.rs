//! A round trip from a start point to a destination and back, and the range map from one point.

use crate::energy::{ride, smooth, Leg, Piece};
use crate::network::{haversine, Class, Route};
use crate::params::Bike;
use serde::{Deserialize, Serialize};

/// Heights along a line from the terrain service: `(distance from the start, height)`, the height `None`
/// where the elevation model has no data.
pub type Profile = Vec<(f64, Option<f64>)>;

/// Purpose: fill missing heights from their neighbours (or 0 when there are none), sorted by distance.
fn filled(profile: &[(f64, Option<f64>)]) -> Vec<(f64, f64)> {
    let known: Vec<(f64, f64)> = profile
        .iter()
        .filter_map(|(d, z)| z.filter(|z| z.is_finite()).map(|z| (*d, z)))
        .collect();
    if known.is_empty() {
        return profile.iter().map(|(d, _)| (*d, 0.0)).collect();
    }
    profile
        .iter()
        .map(|(d, z)| match z.filter(|z| z.is_finite()) {
            Some(z) => (*d, z),
            None => {
                let after = known.iter().find(|k| k.0 >= *d);
                let before = known.iter().rev().find(|k| k.0 <= *d);
                (*d, after.or(before).map_or(0.0, |k| k.1))
            }
        })
        .collect()
}

/// Purpose: the pieces of a route with heights: the profile's samples become pieces, each with the street
/// class at its middle. The profile's distances are scaled to the route's length.
pub fn route_pieces(
    route: &Route,
    profile: &[(f64, Option<f64>)],
    bike: &Bike,
) -> (Vec<Piece>, f64) {
    let mut cum = vec![0.0];
    for w in route.coords.windows(2) {
        cum.push(cum.last().copied().unwrap_or(0.0) + haversine(w[0], w[1]));
    }
    let total = *cum.last().unwrap_or(&0.0);
    let mut prof = filled(profile);
    prof.sort_by(|a, b| a.0.total_cmp(&b.0));
    let plen = prof.last().map_or(0.0, |p| p.0);
    if prof.len() < 2 || plen <= 0.0 {
        // No heights: ride it flat.
        let pieces = route
            .classes
            .iter()
            .enumerate()
            .map(|(i, c)| Piece {
                len_m: cum[i + 1] - cum[i],
                dz_m: 0.0,
                class: *c,
            })
            .collect();
        return (pieces, prof.first().map_or(0.0, |p| p.1));
    }
    let k = total / plen;
    let pts: Vec<(f64, f64)> = prof.iter().map(|(d, z)| (d * k, *z)).collect();
    let z = smooth(&pts, bike.smoothing_m);
    let class_at = |d: f64| {
        let i = cum.partition_point(|c| *c <= d).saturating_sub(1);
        route
            .classes
            .get(i.min(route.classes.len().saturating_sub(1)))
            .copied()
            .unwrap_or(Class::Quiet)
    };
    let pieces = pts
        .windows(2)
        .zip(z.windows(2))
        .map(|(p, h)| Piece {
            len_m: p[1].0 - p[0].0,
            dz_m: h[1] - h[0],
            class: class_at(0.5 * (p[0].0 + p[1].0)),
        })
        .collect();
    (pieces, z[0])
}

/// Purpose: ride one way of a trip.
pub fn ride_route(route: &Route, profile: &[(f64, Option<f64>)], bike: &Bike) -> Leg {
    let (pieces, z0) = route_pieces(route, profile, bike);
    let extra = route.signals as f64 * bike.signal_stop_share + route.stop_signs as f64;
    ride(bike, &pieces, extra, z0)
}

/// A round trip there and back.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Trip {
    /// From the start to the destination.
    pub go: Leg,
    /// From the destination back to the start.
    pub back: Leg,
    /// Both ways, m.
    pub distance_m: f64,
    /// Battery energy both ways, Wh.
    pub battery_wh: f64,
    /// Usable battery energy, Wh.
    pub usable_wh: f64,
    /// Share of the usable battery the round trip takes (above 1: the battery runs out on the way).
    pub battery_share: f64,
    /// Usable energy left on arrival back at the start (negative: missing), Wh.
    pub remaining_wh: f64,
    /// The round trip fits in one charge.
    pub feasible: bool,
    /// Average battery energy per km, Wh/km.
    pub wh_per_km: f64,
    /// Round trip distance one charge allows at this trip's consumption, km.
    pub range_km: f64,
    /// Riding time both ways without stops, s.
    pub time_s: f64,
    /// Rider's own pedalling energy both ways, Wh.
    pub rider_wh: f64,
}

/// Purpose: the round trip from two ridden legs.
pub fn trip(go: Leg, back: Leg, bike: &Bike) -> Trip {
    let distance_m = go.distance_m + back.distance_m;
    let battery_wh = go.battery_wh + back.battery_wh;
    let wh_per_km = if distance_m > 0.0 {
        battery_wh / (distance_m / 1000.0)
    } else {
        0.0
    };
    Trip {
        time_s: go.time_s + back.time_s,
        rider_wh: go.rider_wh + back.rider_wh,
        distance_m,
        battery_wh,
        usable_wh: bike.usable_wh,
        battery_share: if bike.usable_wh > 0.0 {
            battery_wh / bike.usable_wh
        } else {
            f64::INFINITY
        },
        remaining_wh: bike.usable_wh - battery_wh,
        feasible: battery_wh <= bike.usable_wh,
        wh_per_km,
        range_km: if wh_per_km > 0.0 {
            bike.usable_wh / wh_per_km
        } else {
            0.0
        },
        go,
        back,
    }
}

/// One bearing of the range map: heights along a straight line from the origin.
#[derive(Debug, Clone, Deserialize)]
pub struct Ray {
    /// Compass bearing, degrees.
    pub bearing_deg: f64,
    /// `[lon, lat]` of the line's far end.
    pub end: [f64; 2],
    /// Heights along the straight line: `(distance m, height m or null)`.
    pub profile: Profile,
}

/// How far the bike gets out and back along one bearing.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Reach {
    /// Compass bearing, degrees.
    pub bearing_deg: f64,
    /// Straight-line distance of the turning point from the origin, m.
    pub straight_m: f64,
    /// Street distance one way (straight line times the detour factor), m.
    pub street_m: f64,
    /// `[lon, lat]` of the turning point.
    pub at: [f64; 2],
    /// The battery lasted to the end of the line, so the bike gets further than shown.
    pub beyond: bool,
}

/// Purpose: how far the bike gets out and back along each bearing on one charge.
///
/// Streets are not loaded for the range map (a 900 Wh battery reaches some 30 km away, which is too many
/// streets): each bearing follows the terrain along a straight line, lengthened by the detour factor
/// (street network circuity), on quiet streets without a bike lane. The destination trip gives the
/// street-level answer.
pub fn range_map(origin: [f64; 2], rays: &[Ray], bike: &Bike) -> Vec<Reach> {
    rays.iter()
        .map(|ray| {
            let mut prof = filled(&ray.profile);
            prof.sort_by(|a, b| a.0.total_cmp(&b.0));
            let pts: Vec<(f64, f64)> = prof.iter().map(|(d, z)| (d * bike.detour, *z)).collect();
            let z = smooth(&pts, bike.smoothing_m);
            let mut used = 0.0;
            let mut reach_street = 0.0;
            let mut beyond = true;
            for (p, h) in pts.windows(2).zip(z.windows(2)) {
                let len = p[1].0 - p[0].0;
                let out = Piece {
                    len_m: len,
                    dz_m: h[1] - h[0],
                    class: Class::Quiet,
                };
                let back = Piece {
                    dz_m: -out.dz_m,
                    ..out
                };
                let e = ride(bike, &[out], 0.0, 0.0).battery_wh
                    + ride(bike, &[back], 0.0, 0.0).battery_wh;
                if used + e > bike.usable_wh {
                    let f = if e > 0.0 {
                        (bike.usable_wh - used) / e
                    } else {
                        0.0
                    };
                    reach_street += f * len;
                    beyond = false;
                    break;
                }
                used += e;
                reach_street = p[1].0;
            }
            let straight = reach_street / bike.detour;
            let len = haversine(origin, ray.end);
            let t = if len > 0.0 {
                (straight / len).min(1.0)
            } else {
                0.0
            };
            Reach {
                bearing_deg: ray.bearing_deg,
                straight_m: straight,
                street_m: reach_street,
                at: [
                    origin[0] + t * (ray.end[0] - origin[0]),
                    origin[1] + t * (ray.end[1] - origin[1]),
                ],
                beyond,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(len: f64) -> Route {
        // About 1 km of longitude at the equator is 0.008983°.
        let deg = len / 111_195.0;
        Route {
            coords: vec![[0.0, 0.0], [deg / 2.0, 0.0], [deg, 0.0]],
            classes: vec![Class::Separated, Class::Mixed],
            length_m: len,
            signals: 2,
            stop_signs: 0,
            gaps: Vec::new(),
        }
    }

    #[test]
    fn round_trip_over_a_hill_and_flat_range() {
        let b = Bike::default();
        let r = line(4000.0);
        let up: Profile = (0..=40)
            .map(|i| (i as f64 * 100.0, Some(i as f64 * 2.0)))
            .collect();
        let down: Profile = (0..=40)
            .map(|i| (i as f64 * 100.0, Some(80.0 - i as f64 * 2.0)))
            .collect();
        let go = ride_route(&r, &up, &b);
        let back = ride_route(&r, &down, &b);
        assert!((go.climb_m - 80.0).abs() < 1.0, "{}", go.climb_m);
        assert!(go.battery_wh > back.battery_wh);
        assert!(go.class_m[0] > 1900.0 && go.class_m[3] > 1900.0);
        let t = trip(go, back, &b);
        assert!(t.feasible);
        assert!(t.range_km > 30.0 && t.range_km < 200.0, "{}", t.range_km);
    }

    #[test]
    fn range_is_shorter_uphill() {
        let b = Bike::default();
        let flat: Profile = (0..=600).map(|i| (i as f64 * 100.0, Some(0.0))).collect();
        let hill: Profile = (0..=600)
            .map(|i| (i as f64 * 100.0, Some(i as f64 * 3.0)))
            .collect();
        let rays = vec![
            Ray {
                bearing_deg: 0.0,
                end: [0.0, 0.54],
                profile: flat,
            },
            Ray {
                bearing_deg: 90.0,
                end: [0.54, 0.0],
                profile: hill,
            },
        ];
        let reach = range_map([0.0, 0.0], &rays, &b);
        assert!(!reach[0].beyond && !reach[1].beyond);
        assert!(reach[1].straight_m < reach[0].straight_m);
        // Flat: out and back on one charge, so the turning point is half the flat range.
        let leg = ride(
            &b,
            &[Piece {
                len_m: 1000.0,
                dz_m: 0.0,
                class: Class::Quiet,
            }],
            0.0,
            0.0,
        );
        let expect = b.usable_wh / leg.battery_wh * 1000.0 / 2.0 / b.detour;
        assert!((reach[0].straight_m - expect).abs() / expect < 0.02);
    }
}
