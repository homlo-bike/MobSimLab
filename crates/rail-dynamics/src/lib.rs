//! MobSimLab running-time calculation (ADR-0032 §3 step 2).
//!
//! Computes the minimum-time speed profile of a train along a path, the
//! standard way (Brünger & Dahlhaus, "Running time estimation", in Hansen &
//! Pachl, *Railway Timetabling & Operations*, 2014): on a fine distance grid, a
//! forward pass accelerates with the available tractive effort minus running
//! resistance (Davis) and gradient force, a backward pass builds the service
//! braking curves to every lower speed limit and stop, and the profile is the
//! minimum of both and of the permitted speed. A speed limit rises only when the
//! whole train has left the lower limit. Time follows from the speed profile;
//! dwell times are added at stops. A percentage running-time supplement (UIC
//! 451-1) can be spread over the running time.
//!
//! All units are SI.
#![warn(missing_docs)]

use serde::{Deserialize, Serialize};

const G: f64 = 9.81;
const EPS: f64 = 1e-9;
/// Below this speed a grid step counts as standing still (m/s).
const V_MIN: f64 = 1e-3;

/// Train parameters for running-time calculation.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TrainParams {
    /// Train length, m.
    pub length_m: f64,
    /// Total mass including load, kg.
    pub mass_kg: f64,
    /// Rotating mass factor (≥ 1; typical 1.04–1.10 for multiple units).
    pub rotating_mass_factor: f64,
    /// Maximum tractive effort at the wheel, N.
    pub max_tractive_effort_n: f64,
    /// Maximum traction power at the wheel, W.
    pub power_w: f64,
    /// Davis coefficient A, N.
    pub davis_a_n: f64,
    /// Davis coefficient B, N·s/m.
    pub davis_b_n_per_mps: f64,
    /// Davis coefficient C, N·s²/m².
    pub davis_c_n_per_mps2: f64,
    /// Service braking deceleration used for planning, m/s² (positive).
    pub service_decel_mps2: f64,
    /// Maximum speed of the train, m/s.
    pub max_speed_mps: f64,
}

impl TrainParams {
    /// Purpose: tractive effort available at speed `v`.
    /// Output: min(max tractive effort, power / v), in N.
    pub fn tractive_effort(&self, v: f64) -> f64 {
        self.max_tractive_effort_n.min(self.power_w / v.max(EPS))
    }

    /// Purpose: running resistance at speed `v` (Davis), N.
    pub fn resistance(&self, v: f64) -> f64 {
        self.davis_a_n + self.davis_b_n_per_mps * v + self.davis_c_n_per_mps2 * v * v
    }

    /// Purpose: service braking distance from `v` to a stand on level track, m.
    pub fn braking_distance(&self, v: f64) -> f64 {
        v * v / (2.0 * self.service_decel_mps2)
    }
}

/// A stretch of the path with constant permitted speed and gradient.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Segment {
    /// Length, m.
    pub length_m: f64,
    /// Permitted speed, m/s.
    pub speed_mps: f64,
    /// Gradient in the direction of travel (rise over run).
    pub gradient: f64,
}

/// A scheduled stop: the head stops at `position_m` and stands for `dwell_s`.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Stop {
    /// Head position from the start of the path, m.
    pub position_m: f64,
    /// Dwell time, s.
    pub dwell_s: f64,
}

/// How the run starts and ends.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct RunOptions {
    /// Speed at the start of the path, m/s (0 for a departure from a stand).
    pub start_speed_mps: f64,
    /// Whether the train stops at the end of the path (otherwise it runs out at the permitted speed).
    pub stop_at_end: bool,
    /// Grid step, m (1 m is accurate to well under 0.1 % for normal runs).
    pub step_m: f64,
}

impl Default for RunOptions {
    /// Purpose: a departure from a stand that stops at the path end, on a 1 m grid.
    fn default() -> Self {
        Self {
            start_speed_mps: 0.0,
            stop_at_end: true,
            step_m: 1.0,
        }
    }
}

/// The speed profile and timing of one run.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct SpeedProfile {
    /// Grid positions of the head, m (first 0, last = path length).
    pub position_m: Vec<f64>,
    /// Speed at each grid point, m/s.
    pub speed_mps: Vec<f64>,
    /// Time the head arrives at each grid point, s from the start.
    pub arrive_s: Vec<f64>,
    /// Time the head leaves each grid point (arrival + dwell at stops), s.
    pub depart_s: Vec<f64>,
    /// Arrival and departure time per stop, in stop order.
    pub stops: Vec<(f64, f64)>,
    /// Supplement share applied to running time (0 for minimum running time).
    pub supplement_share: f64,
}

impl SpeedProfile {
    /// Purpose: path length, m.
    pub fn length_m(&self) -> f64 {
        *self.position_m.last().unwrap()
    }

    /// Purpose: time from the start until the head leaves the path end, s.
    pub fn total_time_s(&self) -> f64 {
        *self.depart_s.last().unwrap()
    }

    fn locate(&self, s: f64) -> (usize, f64) {
        let n = self.position_m.len();
        let s = s.clamp(0.0, self.length_m());
        let step = self.position_m[1] - self.position_m[0];
        let i = ((s / step).floor() as usize).min(n - 2);
        let frac = ((s - self.position_m[i]) / (self.position_m[i + 1] - self.position_m[i]))
            .clamp(0.0, 1.0);
        (i, frac)
    }

    /// Purpose: time the head first reaches position `s`, s (interpolated; clamped to the path).
    pub fn time_at(&self, s: f64) -> f64 {
        let (i, f) = self.locate(s);
        if f <= EPS {
            return self.arrive_s[i];
        }
        self.depart_s[i] + f * (self.arrive_s[i + 1] - self.depart_s[i])
    }

    /// Purpose: time the head leaves position `s` (after any dwell there), s.
    pub fn time_leaving(&self, s: f64) -> f64 {
        let (i, f) = self.locate(s);
        if f <= EPS {
            return self.depart_s[i];
        }
        if f >= 1.0 - EPS {
            return self.depart_s[i + 1];
        }
        self.time_at(s)
    }

    /// Purpose: speed at position `s`, m/s (interpolated).
    pub fn speed_at(&self, s: f64) -> f64 {
        let (i, f) = self.locate(s);
        self.speed_mps[i] + f * (self.speed_mps[i + 1] - self.speed_mps[i])
    }

    /// Purpose: spread a percentage running-time supplement (UIC 451-1) over the run.
    /// Inputs: share of running time, for example 0.05 for 5 %.
    /// Output: a profile whose running intervals are longer by the share; dwell
    /// times stay as they were. Speeds are kept from the minimum-time run
    /// (the driver model uses the extra time to coast).
    pub fn with_supplement(&self, share: f64) -> SpeedProfile {
        let mut p = self.stretched(|_| 1.0 + share);
        p.supplement_share = share;
        p
    }

    /// Purpose: add the expected delay in street traffic where a tram shares the road.
    /// Inputs: stretches of the path (from, to in m from the path start, share of the running
    /// time there, for example 0.25 for a quarter longer).
    /// Output: a profile whose running intervals inside the stretches are longer by their share;
    /// dwell times and speeds stay as they were. Without stretches, the profile unchanged.
    pub fn with_delays(&self, stretches: &[(f64, f64, f64)]) -> SpeedProfile {
        if stretches.iter().all(|s| s.2 <= 0.0) {
            return self.clone();
        }
        let pos = &self.position_m;
        let mut p = self.stretched(|i| {
            let mid = 0.5 * (pos[i - 1] + pos[i]);
            1.0 + stretches
                .iter()
                .filter(|s| mid >= s.0 && mid < s.1)
                .map(|s| s.2.max(0.0))
                .fold(0.0, f64::max)
        });
        p.supplement_share = self.supplement_share;
        p
    }

    /// Purpose: lengthen each running interval (grid point `i - 1` to `i`) by `factor(i)`.
    fn stretched(&self, factor: impl Fn(usize) -> f64) -> SpeedProfile {
        let n = self.position_m.len();
        let mut arrive = vec![0.0; n];
        let mut depart = vec![0.0; n];
        depart[0] = self.depart_s[0] - self.arrive_s[0];
        for i in 1..n {
            arrive[i] = depart[i - 1] + (self.arrive_s[i] - self.depart_s[i - 1]) * factor(i);
            depart[i] = arrive[i] + (self.depart_s[i] - self.arrive_s[i]);
        }
        let stops = self
            .stops
            .iter()
            .map(|&(a, _)| {
                let i = self
                    .arrive_s
                    .iter()
                    .position(|&x| (x - a).abs() < EPS)
                    .unwrap_or(0);
                (arrive[i], depart[i])
            })
            .collect();
        SpeedProfile {
            position_m: self.position_m.clone(),
            speed_mps: self.speed_mps.clone(),
            arrive_s: arrive,
            depart_s: depart,
            stops,
            supplement_share: 0.0,
        }
    }
}

/// Purpose: minimum running time of a train along a path.
/// Inputs: train parameters, the path as segments in travel order, scheduled
/// stops (any order, positions within the path) and run options.
/// Output: the speed profile, or Err if the input is invalid or the train
/// cannot move (for example it stalls on a gradient).
pub fn run(
    train: &TrainParams,
    segments: &[Segment],
    stops: &[Stop],
    opt: &RunOptions,
) -> Result<SpeedProfile, String> {
    #[allow(clippy::neg_cmp_op_on_partial_ord)]
    if !(train.mass_kg > 0.0)
        || !(train.service_decel_mps2 > 0.0)
        || !(train.max_speed_mps > 0.0)
        || !(opt.step_m > 0.0)
    {
        return Err("mass, service deceleration, max speed and step must be > 0".into());
    }
    let total: f64 = segments.iter().map(|s| s.length_m).sum();
    if segments.is_empty() || total <= 0.0 {
        return Err("empty path".into());
    }
    let n = ((total / opt.step_m).ceil() as usize).max(1) + 1;
    let pos: Vec<f64> = (0..n).map(|i| (i as f64 * opt.step_m).min(total)).collect();

    // Permitted speed and gradient per grid point (head position).
    let mut lim_point = vec![train.max_speed_mps; n];
    let mut grad = vec![0.0; n];
    {
        let mut bounds = Vec::with_capacity(segments.len());
        let mut start = 0.0;
        for seg in segments {
            bounds.push((start, start + seg.length_m));
            start += seg.length_m;
        }
        let mut k = 0usize;
        for i in 0..n {
            while k + 1 < segments.len() && pos[i] >= bounds[k].1 - EPS {
                // Points on a boundary see both segments' limits.
                if (pos[i] - bounds[k].1).abs() <= EPS {
                    lim_point[i] = lim_point[i].min(segments[k].speed_mps);
                }
                k += 1;
            }
            lim_point[i] = lim_point[i].min(segments[k].speed_mps);
            grad[i] = segments[k].gradient;
        }
    }
    // A rising limit applies only after the tail clears the lower one: sliding
    // minimum over the train length behind the head.
    let window = (train.length_m / opt.step_m).ceil() as usize;
    let mut lim = vec![0.0; n];
    let mut dq: std::collections::VecDeque<usize> = std::collections::VecDeque::new();
    for i in 0..n {
        while dq.back().is_some_and(|&j| lim_point[j] >= lim_point[i]) {
            dq.pop_back();
        }
        dq.push_back(i);
        while dq.front().is_some_and(|&j| j + window < i) {
            dq.pop_front();
        }
        lim[i] = lim_point[*dq.front().unwrap()];
    }

    // Stops on grid points.
    let mut stop_at: Vec<Option<f64>> = vec![None; n];
    let mut stop_idx = Vec::with_capacity(stops.len());
    for st in stops {
        if st.position_m < -EPS || st.position_m > total + EPS {
            return Err(format!(
                "stop at {:.1} m is outside the path",
                st.position_m
            ));
        }
        let i = ((st.position_m / opt.step_m).round() as usize).min(n - 1);
        stop_at[i] = Some(stop_at[i].unwrap_or(0.0) + st.dwell_s);
        stop_idx.push(i);
    }
    if opt.stop_at_end {
        stop_at[n - 1].get_or_insert(0.0);
    }

    // Backward pass: braking curves.
    let b = train.service_decel_mps2;
    let mut vb = vec![0.0; n];
    vb[n - 1] = if stop_at[n - 1].is_some() {
        0.0
    } else {
        lim[n - 1]
    };
    for i in (0..n - 1).rev() {
        let dx = pos[i + 1] - pos[i];
        let v = (vb[i + 1] * vb[i + 1] + 2.0 * b * dx).sqrt();
        vb[i] = if stop_at[i].is_some() && i > 0 {
            0.0
        } else {
            v.min(lim[i])
        };
    }

    // Forward pass: traction.
    let m_eff = train.mass_kg * train.rotating_mass_factor.max(1.0);
    let mut v = vec![0.0; n];
    v[0] = opt.start_speed_mps.min(lim[0]).min(vb[0]);
    for i in 0..n - 1 {
        let dx = pos[i + 1] - pos[i];
        let vi = if stop_at[i].is_some() && i > 0 {
            0.0
        } else {
            v[i]
        };
        // Two half-steps of the energy equation for accuracy at low speed.
        let a1 = (train.tractive_effort(vi) - train.resistance(vi) - train.mass_kg * G * grad[i])
            / m_eff;
        let vm = (vi * vi + a1 * dx).max(0.0).sqrt();
        let a2 = (train.tractive_effort(vm) - train.resistance(vm) - train.mass_kg * G * grad[i])
            / m_eff;
        let vn = (vi * vi + 2.0 * a2 * dx).max(0.0).sqrt();
        v[i + 1] = vn.min(lim[i + 1]).min(vb[i + 1]);
        if stop_at[i].is_some() && i > 0 {
            v[i] = 0.0;
        }
    }
    for i in 0..n {
        v[i] = v[i].min(vb[i]);
    }

    // Time.
    let mut arrive = vec![0.0; n];
    let mut depart = vec![0.0; n];
    depart[0] = stop_at[0].unwrap_or(0.0);
    for i in 0..n - 1 {
        let dx = pos[i + 1] - pos[i];
        let avg = 0.5 * (v[i] + v[i + 1]);
        if avg < V_MIN {
            if dx <= EPS {
                arrive[i + 1] = depart[i];
                depart[i + 1] = arrive[i + 1] + stop_at[i + 1].unwrap_or(0.0);
                continue;
            }
            return Err(format!(
                "the train cannot move at {:.0} m (too little tractive effort for the gradient?)",
                pos[i]
            ));
        }
        arrive[i + 1] = depart[i] + dx / avg;
        depart[i + 1] = arrive[i + 1] + stop_at[i + 1].unwrap_or(0.0);
    }
    let stops_out = stop_idx.iter().map(|&i| (arrive[i], depart[i])).collect();
    Ok(SpeedProfile {
        position_m: pos,
        speed_mps: v,
        arrive_s: arrive,
        depart_s: depart,
        stops: stops_out,
        supplement_share: 0.0,
    })
}
