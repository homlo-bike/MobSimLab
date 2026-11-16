//! **On-demand dispatch simulation** for the service zone kit (ADR-0042): ride requests arrive one by
//! one over the service hours, each with a random pick-up and drop-off inside the zone, and a dispatcher
//! inserts each request into the vehicle plan that grows least, keeping every rider's wait and ride
//! within the service's limits; a request no vehicle can take is turned away.
//!
//! - Requests: a Poisson process at the requests an hour, origins and destinations uniform in the zone
//!   (rejection sampling), a seeded generator so the same input always gives the same day.
//! - Driving: straight distance times the street network factor at the zone speed; each stop adds the
//!   dwell. Vehicles start spread over the zone and wait where they last dropped off.
//! - Dispatch: cheapest insertion of the pick-up and drop-off into each vehicle's remaining stops, the
//!   standard heuristic of operating services; the vehicle on its way to its next stop may turn from
//!   where it is. Limits: capacity, the longest wait, and the longest ride (direct ride times one plus the
//!   detour share, plus a fixed allowance), for the new rider and everyone already booked.

use crate::geo::{dist, inside, to_local, LonLat, Xy};
use crate::zone::ZoneInput;
use serde::{Deserialize, Serialize};

/// The dispatcher's limits, from the plugin's `drt.*` values.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DispatchRules {
    /// A request is turned away when no vehicle can pick it up within this time, s.
    pub max_wait_s: f64,
    /// Longest ride as a share over the direct ride (0.5 = 50 % longer) …
    pub max_detour_share: f64,
    /// … plus this allowance, s.
    pub max_detour_fixed_s: f64,
    /// Seed of the random day.
    #[serde(default = "seed")]
    pub seed: u64,
}

fn seed() -> u64 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DispatchInput {
    pub zone: ZoneInput,
    pub rules: DispatchRules,
}

/// One hour of the simulated day.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DispatchHour {
    /// Start of the hour, s after midnight.
    pub start_s: u32,
    pub requests: u32,
    pub served: u32,
    pub mean_wait_s: f64,
    /// Vehicles carrying at least one rider, on average.
    pub busy_vehicles: f64,
}

/// The simulated day.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DispatchResult {
    pub requests: u32,
    pub served: u32,
    pub rejected: u32,
    pub mean_wait_s: f64,
    pub p90_wait_s: f64,
    pub mean_ride_s: f64,
    /// Ride time over the direct ride, on average (1.2 = 20 % longer).
    pub mean_detour_factor: f64,
    pub vehicle_km: f64,
    /// Share of the vehicle-km driven without riders.
    pub empty_share: f64,
    /// Riders on board per vehicle-km driven.
    pub mean_occupancy: f64,
    /// Riders a vehicle-hour in service.
    pub riders_per_vehicle_hour: f64,
    /// Share of riders who shared part of their ride.
    pub shared_share: f64,
    pub hours: Vec<DispatchHour>,
}

/// SplitMix64: small, fast and the same on every platform.
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        ((z ^ (z >> 31)) >> 11) as f64 / (1u64 << 53) as f64
    }
}

#[derive(Debug, Clone, Copy)]
struct Stop {
    req: usize,
    pickup: bool,
    at: Xy,
}

#[derive(Debug, Clone)]
struct Vehicle {
    at: Xy,
    /// Time the vehicle is free at `at` (it may be later than now while dwelling).
    free_s: f64,
    stops: Vec<Stop>,
    load: u32,
}

#[derive(Debug, Clone, Default)]
struct Req {
    t: f64,
    from: Xy,
    to: Xy,
    riders: u32,
    direct_s: f64,
    pick_s: Option<f64>,
    drop_s: Option<f64>,
    shared: bool,
}

/// Purpose: simulate one service day of an on-demand zone, request by request.
/// Input: the zone (outline, requests an hour, fleet, hours, system values) and the dispatcher's limits.
/// Output: requests served and turned away, waits, rides, detours, vehicle-km and their empty share,
/// occupancy, and the same per hour. Deterministic for a given seed.
pub fn simulate(input: &DispatchInput) -> DispatchResult {
    let z = &input.zone;
    let s = &z.system;
    let rules = &input.rules;
    let mut out = DispatchResult::default();
    if z.ring.len() < 3 || z.fleet == 0 || z.end_s <= z.start_s || z.requests_per_hour <= 0.0 {
        return out;
    }
    let origin: LonLat = z.ring[0];
    let ring: Vec<Xy> = z.ring.iter().map(|p| to_local(origin, *p)).collect();
    let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
    for p in &ring {
        x0 = x0.min(p[0]);
        y0 = y0.min(p[1]);
        x1 = x1.max(p[0]);
        y1 = y1.max(p[1]);
    }
    let mut rng = Rng(rules.seed);
    let point = |rng: &mut Rng| -> Option<Xy> {
        for _ in 0..1000 {
            let p = [x0 + rng.next() * (x1 - x0), y0 + rng.next() * (y1 - y0)];
            if inside(p, &ring) {
                return Some(p);
            }
        }
        None
    };
    let k = s.network_factor.max(1.0);
    let mps = s.speed_kmh.max(1.0) / 3.6;
    let drive = |a: Xy, b: Xy| dist(a, b) * k / mps;
    let dwell = s.stop_dwell_s.max(0.0);
    let places = s.vehicle_places.max(1.0) as u32;

    // The day's requests.
    let (start, end) = (z.start_s as f64, z.end_s as f64);
    let rate = z.requests_per_hour / 3600.0;
    let mut reqs: Vec<Req> = Vec::new();
    let mut t = start;
    // At most 50 000 requests a day keeps a run in the browser to a few seconds.
    while reqs.len() < 50_000 {
        t += -(1.0 - rng.next()).ln() / rate;
        if t >= end {
            break;
        }
        let (Some(from), Some(to)) = (point(&mut rng), point(&mut rng)) else {
            return out;
        };
        let extra = s.riders_per_request.max(1.0) - 1.0;
        let riders = 1 + u32::from(rng.next() < extra.fract()) + extra.floor() as u32;
        reqs.push(Req {
            t,
            from,
            to,
            riders,
            direct_s: drive(from, to) + dwell,
            ..Req::default()
        });
    }

    let mut fleet: Vec<Vehicle> = (0..z.fleet)
        .map(|_| Vehicle {
            at: point(&mut rng).unwrap_or(ring[0]),
            free_s: start,
            stops: Vec::new(),
            load: 0,
        })
        .collect();
    let mut km = 0.0;
    let mut empty_km = 0.0;
    let mut rider_km = 0.0;
    let hours = ((end - start) / 3600.0).ceil() as usize;
    out.hours = (0..hours)
        .map(|h| DispatchHour {
            start_s: z.start_s + h as u32 * 3600,
            ..DispatchHour::default()
        })
        .collect();
    let mut busy_s = vec![0.0; hours];

    // Run a vehicle's plan up to time `now`: serve the stops it reaches; on the way to the next one it
    // stops where it is at `now`.
    let advance = |v: &mut Vehicle,
                   now: f64,
                   reqs: &mut [Req],
                   km: &mut f64,
                   empty_km: &mut f64,
                   rider_km: &mut f64,
                   busy_s: &mut [f64]| {
        while let Some(&st) = v.stops.first() {
            let leg = drive(v.at, st.at);
            let arrive = v.free_s + leg;
            let (to, done, until) = if arrive <= now {
                (st.at, true, arrive)
            } else if now > v.free_s && leg > 0.0 {
                let f = (now - v.free_s) / leg;
                (
                    [
                        v.at[0] + (st.at[0] - v.at[0]) * f,
                        v.at[1] + (st.at[1] - v.at[1]) * f,
                    ],
                    false,
                    now,
                )
            } else {
                break;
            };
            let d = dist(v.at, to) * k / 1000.0;
            *km += d;
            if v.load == 0 {
                *empty_km += d;
            } else {
                *rider_km += d * v.load as f64;
                let h = (((v.free_s - start) / 3600.0) as usize).min(busy_s.len() - 1);
                busy_s[h] += until - v.free_s;
            }
            v.at = to;
            v.free_s = until;
            if !done {
                break;
            }
            v.free_s += dwell;
            let r = &mut reqs[st.req];
            if st.pickup {
                r.pick_s = Some(arrive);
                if v.load > 0 {
                    r.shared = true;
                }
                // Riders already on board share with the new one.
                for o in v
                    .stops
                    .iter()
                    .skip(1)
                    .filter(|o| !o.pickup && o.req != st.req)
                {
                    reqs[o.req].shared = true;
                }
                v.load += reqs[st.req].riders;
            } else {
                r.drop_s = Some(arrive);
                v.load -= r.riders;
            }
            v.stops.remove(0);
        }
        if v.stops.is_empty() && v.free_s < now {
            v.free_s = now;
        }
    };

    // The time a plan ends and the new rider's pick-up time, from the vehicle's position; None when a
    // limit is broken.
    let check = |v: &Vehicle, plan: &[Stop], reqs: &[Req], new: usize| -> Option<(f64, f64, f64)> {
        let mut t = v.free_s;
        let mut at = v.at;
        let mut load = v.load;
        let mut picked: Vec<(usize, f64)> = Vec::new();
        let mut new_pick = t;
        let mut new_drop = t;
        for st in plan {
            t += drive(at, st.at);
            at = st.at;
            let r = &reqs[st.req];
            if st.pickup {
                if t - r.t > rules.max_wait_s {
                    return None;
                }
                load += r.riders;
                if load > places {
                    return None;
                }
                picked.push((st.req, t));
                if st.req == new {
                    new_pick = t;
                }
            } else {
                let p = picked
                    .iter()
                    .find(|x| x.0 == st.req)
                    .map(|x| x.1)
                    .or(r.pick_s)
                    .unwrap_or(t);
                let limit = r.direct_s * (1.0 + rules.max_detour_share) + rules.max_detour_fixed_s;
                if t - p > limit {
                    return None;
                }
                if st.req == new {
                    new_drop = t;
                }
                load -= r.riders;
            }
            t += dwell;
        }
        Some((t, new_pick, new_drop))
    };

    let mut waits: Vec<f64> = Vec::new();
    for i in 0..reqs.len() {
        let now = reqs[i].t;
        for v in fleet.iter_mut() {
            advance(
                v,
                now,
                &mut reqs,
                &mut km,
                &mut empty_km,
                &mut rider_km,
                &mut busy_s,
            );
        }
        let h = (((now - start) / 3600.0) as usize).min(hours - 1);
        out.hours[h].requests += 1;
        // Cheapest insertion over all vehicles: the extra driving (which is also the delay of the riders
        // already booked) plus the new rider's wait and ride.
        let mut best: Option<(f64, usize, Vec<Stop>)> = None;
        for (vi, v) in fleet.iter().enumerate() {
            let base = check(v, &v.stops, &reqs, i).map_or(v.free_s, |x| x.0);
            let n = v.stops.len();
            for a in 0..=n {
                for b in a..=n {
                    let mut plan = v.stops.clone();
                    plan.insert(
                        a,
                        Stop {
                            req: i,
                            pickup: true,
                            at: reqs[i].from,
                        },
                    );
                    plan.insert(
                        b + 1,
                        Stop {
                            req: i,
                            pickup: false,
                            at: reqs[i].to,
                        },
                    );
                    if let Some((done, _, drop)) = check(v, &plan, &reqs, i) {
                        let cost = done - base + (drop - now);
                        if best.as_ref().map_or(true, |x| cost < x.0) {
                            best = Some((cost, vi, plan));
                        }
                    }
                }
            }
        }
        match best {
            Some((_, vi, plan)) => {
                fleet[vi].stops = plan;
                out.served += 1;
                out.hours[h].served += 1;
            }
            None => out.rejected += 1,
        }
    }
    for v in fleet.iter_mut() {
        advance(
            v,
            f64::MAX / 4.0,
            &mut reqs,
            &mut km,
            &mut empty_km,
            &mut rider_km,
            &mut busy_s,
        );
    }

    let mut rides = 0.0;
    let mut detours = 0.0;
    let mut shared = 0usize;
    let mut n = 0usize;
    let mut hour_wait = vec![(0.0, 0u32); hours];
    for r in &reqs {
        if let (Some(p), Some(d)) = (r.pick_s, r.drop_s) {
            let w = p - r.t;
            waits.push(w);
            let hh = (((r.t - start) / 3600.0) as usize).min(hours - 1);
            hour_wait[hh].0 += w;
            hour_wait[hh].1 += 1;
            rides += d - p + dwell;
            detours += (d - p + dwell) / r.direct_s.max(1.0);
            shared += usize::from(r.shared);
            n += 1;
        }
    }
    out.requests = reqs.len() as u32;
    if n > 0 {
        waits.sort_by(|a, b| a.total_cmp(b));
        out.mean_wait_s = waits.iter().sum::<f64>() / n as f64;
        out.p90_wait_s = waits[((n as f64 * 0.9) as usize).min(n - 1)];
        out.mean_ride_s = rides / n as f64;
        out.mean_detour_factor = detours / n as f64;
        out.shared_share = shared as f64 / n as f64;
    }
    out.vehicle_km = km;
    out.empty_share = if km > 0.0 { empty_km / km } else { 0.0 };
    out.mean_occupancy = if km > 0.0 { rider_km / km } else { 0.0 };
    let vh = z.fleet as f64 * (end - start) / 3600.0;
    out.riders_per_vehicle_hour = reqs
        .iter()
        .filter(|r| r.drop_s.is_some())
        .map(|r| r.riders as f64)
        .sum::<f64>()
        / vh;
    for (h, x) in out.hours.iter_mut().enumerate() {
        x.mean_wait_s = if hour_wait[h].1 > 0 {
            hour_wait[h].0 / hour_wait[h].1 as f64
        } else {
            0.0
        };
        x.busy_vehicles = busy_s[h] / 3600.0;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::zone::{estimate, ZoneSystem};

    fn zone(requests: f64, fleet: u32) -> ZoneInput {
        let o = [10.0, 50.0];
        ZoneInput {
            ring: [[0.0, 0.0], [4000.0, 0.0], [4000.0, 4000.0], [0.0, 4000.0]]
                .iter()
                .map(|xy| crate::geo::to_lonlat(o, *xy))
                .collect(),
            requests_per_hour: requests,
            fleet,
            start_s: 6 * 3600,
            end_s: 22 * 3600,
            system: ZoneSystem {
                speed_kmh: 25.0,
                network_factor: 1.25,
                stop_dwell_s: 32.0,
                vehicle_places: 8.0,
                target_utilisation: 0.85,
                pooling_detour_share: 0.2,
                max_wait_s: 600.0,
                riders_per_request: 1.1,
            },
            parameter_prefix: "drt".into(),
        }
    }

    fn rules() -> DispatchRules {
        DispatchRules {
            max_wait_s: 1200.0,
            max_detour_share: 0.5,
            max_detour_fixed_s: 600.0,
            seed: 7,
        }
    }

    #[test]
    fn a_well_sized_fleet_serves_the_day() {
        let z = zone(60.0, 12);
        let r = simulate(&DispatchInput {
            zone: z.clone(),
            rules: rules(),
        });
        assert!((r.requests as f64 - 960.0).abs() < 100.0, "{}", r.requests);
        assert_eq!(r.served + r.rejected, r.requests);
        assert!(
            r.served as f64 > 0.95 * r.requests as f64,
            "{} of {}",
            r.served,
            r.requests
        );
        assert!(
            r.mean_wait_s > 60.0 && r.mean_wait_s < 900.0,
            "{}",
            r.mean_wait_s
        );
        assert!(r.p90_wait_s >= r.mean_wait_s);
        assert!(
            r.mean_detour_factor >= 1.0 && r.mean_detour_factor < 2.0,
            "{}",
            r.mean_detour_factor
        );
        assert!(
            r.empty_share > 0.05 && r.empty_share < 0.8,
            "{}",
            r.empty_share
        );
        assert!(r.shared_share > 0.0);
        assert_eq!(r.hours.len(), 16);
        // Same seed, same day.
        let again = simulate(&DispatchInput {
            zone: z.clone(),
            rules: rules(),
        });
        assert_eq!(again.served, r.served);
        assert_eq!(again.mean_wait_s, r.mean_wait_s);
        // The estimate and the simulation agree on the order of magnitude of the wait.
        let e = estimate(&z);
        let w = e.wait_s.unwrap();
        assert!(
            r.mean_wait_s < 3.0 * w && r.mean_wait_s > w / 3.0,
            "{} vs {}",
            r.mean_wait_s,
            w
        );
    }

    #[test]
    fn a_small_fleet_turns_requests_away() {
        let r = simulate(&DispatchInput {
            zone: zone(200.0, 3),
            rules: rules(),
        });
        assert!(
            r.rejected as f64 > 0.3 * r.requests as f64,
            "{} of {}",
            r.rejected,
            r.requests
        );
        // Nobody served waits longer than the limit.
        assert!(r.p90_wait_s <= 1200.0 + 1e-6);
        let none = simulate(&DispatchInput {
            zone: zone(60.0, 0),
            rules: rules(),
        });
        assert_eq!(none.requests, 0);
    }
}
