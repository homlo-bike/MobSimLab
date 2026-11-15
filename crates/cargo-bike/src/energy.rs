//! Battery energy of a pedal-assisted cargo bike along a height profile.
//!
//! Each piece of the route is ridden at the cruising speed of its street class (never above the
//! assistance cut-off). The wheel needs `P = v·(m·g·(Crr·cosθ + sinθ) + ½·ρ·CdA·v²)`; the crank gives
//! `P / η_drive`, of which the motor gives its assist share (more on climbs, up to its rated power) and the
//! rider the rest.
//! Where the rider would need more than their sustained power, the bike slows down until it fits. Going
//! downhill the motor does nothing and the brakes hold the cruising speed (a mid-drive cannot recover
//! energy). Each stop costs the kinetic energy of starting again, shared between motor and rider the same
//! way. The battery gives the motor's energy divided by the motor's efficiency.

use crate::network::Class;
use crate::params::Bike;
use serde::Serialize;

const G: f64 = 9.81;
/// Slowest speed the model rides at; below it the rider pushes (walk assist).
pub const MIN_SPEED_MS: f64 = 1.0;
/// Below this speed a piece counts as too steep to ride comfortably.
pub const SLOW_MS: f64 = 6.0 / 3.6;

/// One piece of a ridden profile: its length, height change and street class.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Piece {
    /// Length along the street, m.
    pub len_m: f64,
    /// Height change, m (positive uphill).
    pub dz_m: f64,
    /// Street class.
    pub class: Class,
}

/// What riding one piece takes.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PieceRide {
    /// Battery energy, Wh.
    pub battery_wh: f64,
    /// Riding time, s.
    pub time_s: f64,
    /// Speed, m/s.
    pub speed_ms: f64,
}

/// Purpose: wheel power needed at a speed on a grade.
fn wheel_power(b: &Bike, v: f64, sin: f64, cos: f64) -> f64 {
    v * (b.mass_kg * G * (b.crr * cos + sin) + 0.5 * b.rho * b.cda * v * v)
}

/// Purpose: motor's mechanical share of a crank power: its assist share, or more where the rider would
/// otherwise go above their sustained power (the rider picks a higher assistance level on a climb), never
/// above the motor's rated power.
fn motor_part(b: &Bike, crank_w: f64) -> f64 {
    (b.assist_share * crank_w)
        .max(crank_w - b.rider_w)
        .min(b.motor_w)
        .max(0.0)
}

/// Purpose: battery energy and time to ride one piece.
pub fn ride_piece(b: &Bike, p: &Piece) -> PieceRide {
    if p.len_m <= 0.0 {
        return PieceRide {
            battery_wh: 0.0,
            time_s: 0.0,
            speed_ms: 0.0,
        };
    }
    let theta = (p.dz_m / p.len_m).atan();
    let (sin, cos) = theta.sin_cos();
    let target = b.speed_ms[p.class.index()].min(b.cutoff_ms);
    let rider_needed = |v: f64| {
        let crank = wheel_power(b, v, sin, cos) / b.drive_eff;
        crank - motor_part(b, crank)
    };
    let v = if rider_needed(target) <= b.rider_w {
        target
    } else if rider_needed(MIN_SPEED_MS) > b.rider_w {
        MIN_SPEED_MS
    } else {
        // Highest speed the rider can hold: rider_needed rises with speed on a climb.
        let (mut lo, mut hi) = (MIN_SPEED_MS, target);
        for _ in 0..40 {
            let mid = 0.5 * (lo + hi);
            if rider_needed(mid) <= b.rider_w {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        lo
    };
    let crank = (wheel_power(b, v, sin, cos) / b.drive_eff).max(0.0);
    let time_s = p.len_m / v;
    let battery_wh = motor_part(b, crank) / b.motor_eff * time_s / 3600.0;
    PieceRide {
        battery_wh,
        time_s,
        speed_ms: v,
    }
}

/// Purpose: battery energy of starting again after one stop on a street class.
pub fn stop_wh(b: &Bike, class: Class) -> f64 {
    let v = b.speed_ms[class.index()].min(b.cutoff_ms);
    let crank = 0.5 * b.mass_kg * v * v / b.drive_eff;
    b.assist_share * crank / b.motor_eff / 3600.0
}

/// One way of a trip, ridden.
#[derive(Debug, Clone, Default, Serialize, PartialEq)]
pub struct Leg {
    /// Length, m.
    pub distance_m: f64,
    /// Total climb, m.
    pub climb_m: f64,
    /// Total descent, m.
    pub descent_m: f64,
    /// Battery energy, Wh.
    pub battery_wh: f64,
    /// Riding time without stops, s.
    pub time_s: f64,
    /// Metres per street class: separated, lane, quiet, mixed.
    pub class_m: [f64; 4],
    /// Expected stops (per km of each class, plus traffic signals and stop signs).
    pub stops: f64,
    /// Metres ridden slower than 6 km/h because of the gradient.
    pub steep_m: f64,
    /// Steepest gradient after smoothing, % (uphill positive).
    pub max_grade_pct: f64,
    /// Profile for the chart: `[distance m, height m, battery Wh used so far]` about every 100 m.
    pub profile: Vec<[f64; 3]>,
}

/// Purpose: smooth heights with a moving average over `window_m` (heights from a surface model are noisy).
/// Inputs: `(distance, height)` sorted by distance. Output: smoothed heights, same length.
pub fn smooth(samples: &[(f64, f64)], window_m: f64) -> Vec<f64> {
    if window_m <= 0.0 || samples.len() < 3 {
        return samples.iter().map(|s| s.1).collect();
    }
    let half = window_m / 2.0;
    let (mut lo, mut hi) = (0usize, 0usize);
    let mut sum = 0.0;
    let mut out = Vec::with_capacity(samples.len());
    for s in samples {
        while hi < samples.len() && samples[hi].0 <= s.0 + half {
            sum += samples[hi].1;
            hi += 1;
        }
        while samples[lo].0 < s.0 - half {
            sum -= samples[lo].1;
            lo += 1;
        }
        out.push(sum / (hi - lo) as f64);
    }
    out
}

/// Purpose: ride a list of pieces in order and add the stops.
/// Inputs: the pieces, extra stops at signals and stop signs (already weighted), and the bike.
pub fn ride(b: &Bike, pieces: &[Piece], extra_stops: f64, start_z: f64) -> Leg {
    let mut leg = Leg::default();
    let mut z = start_z;
    let mut since = f64::INFINITY;
    let mut stops_wh = 0.0;
    for p in pieces {
        let r = ride_piece(b, p);
        leg.distance_m += p.len_m;
        leg.time_s += r.time_s;
        leg.battery_wh += r.battery_wh;
        leg.class_m[p.class.index()] += p.len_m;
        if p.dz_m > 0.0 {
            leg.climb_m += p.dz_m;
        } else {
            leg.descent_m -= p.dz_m;
        }
        if p.len_m > 0.0 {
            leg.max_grade_pct = leg.max_grade_pct.max(100.0 * p.dz_m / p.len_m);
        }
        if p.dz_m > 0.0 && r.speed_ms < SLOW_MS {
            leg.steep_m += p.len_m;
        }
        let s = b.stops_per_m[p.class.index()] * p.len_m;
        leg.stops += s;
        stops_wh += s * stop_wh(b, p.class);
        z += p.dz_m;
        since += p.len_m;
        if since >= 100.0 || leg.profile.is_empty() {
            leg.profile
                .push([leg.distance_m, z, leg.battery_wh + stops_wh]);
            since = 0.0;
        }
    }
    // Stops at signals and stop signs, at the speed of the leg's commonest street class.
    let common = Class::ALL
        .into_iter()
        .max_by(|a, c| leg.class_m[a.index()].total_cmp(&leg.class_m[c.index()]))
        .unwrap_or(Class::Quiet);
    leg.stops += extra_stops;
    stops_wh += extra_stops * stop_wh(b, common);
    leg.battery_wh += stops_wh;
    if let Some(last) = leg.profile.last_mut() {
        if (last[0] - leg.distance_m).abs() > 1e-6 {
            leg.profile.push([leg.distance_m, z, leg.battery_wh]);
        } else {
            last[2] = leg.battery_wh;
        }
    }
    leg
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flat(len: f64, class: Class) -> Piece {
        Piece {
            len_m: len,
            dz_m: 0.0,
            class,
        }
    }

    #[test]
    fn flat_consumption_is_plausible_for_a_loaded_cargo_trike() {
        let b = Bike::default();
        let leg = ride(&b, &[flat(10_000.0, Class::Quiet)], 0.0, 0.0);
        let wh_km = leg.battery_wh / 10.0;
        // Loaded e-cargo bikes use about 6–15 Wh/km in town.
        assert!((5.0..15.0).contains(&wh_km), "{wh_km} Wh/km");
    }

    #[test]
    fn climbing_costs_more_than_descending_returns() {
        let b = Bike::default();
        let up = ride_piece(
            &b,
            &Piece {
                len_m: 1000.0,
                dz_m: 50.0,
                class: Class::Quiet,
            },
        );
        let down = ride_piece(
            &b,
            &Piece {
                len_m: 1000.0,
                dz_m: -50.0,
                class: Class::Quiet,
            },
        );
        let level = ride_piece(&b, &flat(1000.0, Class::Quiet));
        assert_eq!(down.battery_wh, 0.0);
        assert!(up.battery_wh + down.battery_wh > 2.0 * level.battery_wh);
        // 5 % with 205 kg: the motor gives its full 250 W and the bike slows down.
        assert!(up.speed_ms < b.speed_ms[Class::Quiet.index()]);
        assert!(up.battery_wh > 250.0 / b.motor_eff * up.time_s / 3600.0 - 1e-6);
    }

    #[test]
    fn bike_lanes_save_energy_against_main_road_traffic() {
        let b = Bike::default();
        let lane = ride(&b, &[flat(5000.0, Class::Separated)], 0.0, 0.0);
        let mixed = ride(&b, &[flat(5000.0, Class::Mixed)], 0.0, 0.0);
        assert!(lane.stops < mixed.stops);
        assert!(lane.time_s < mixed.time_s);
    }

    #[test]
    fn smoothing_keeps_a_steady_slope_and_removes_spikes() {
        let s: Vec<(f64, f64)> = (0..=20).map(|i| (i as f64 * 25.0, i as f64)).collect();
        let sm = smooth(&s, 100.0);
        assert!((sm[10] - 10.0).abs() < 1e-9);
        let mut spike = s.clone();
        spike[10].1 += 20.0;
        assert!(smooth(&spike, 100.0)[10] < 15.0);
    }
}
