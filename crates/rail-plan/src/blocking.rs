//! Blocking times (blocking time theory; Pachl, *Railway Operation and Control*;
//! UIC Code 406).
//!
//! A train blocks each detection section of a route from the moment the route
//! must start being set (so that the driver sees a proceed aspect in time) until
//! the train's tail has cleared the section and the interlocking has released
//! it (sectional release). For a route the blocking time is:
//!
//! ```text
//! route setting + sight and reaction + approach + running + clearing + release
//! ```
//!
//! The approach starts where the train would have to start braking to stop at
//! the entry signal: the service braking distance from its speed at the signal
//! plus the sighting distance. A train that stands at the entry signal (a
//! departure), or stops between the approach point and the signal (at a
//! platform with the starter just beyond its end), needs the route at its
//! departure time. Overlap sections are
//! blocked until the head passes (or, after a stop, leaves) the exit signal.

use rail_dynamics::{run, RunOptions, Segment, SpeedProfile, Stop, TrainParams};
use rail_model::{Model, RouteId, Step, TdsId};
use serde::Serialize;

/// Timing parameters of the signalling (new assumption-library keys
/// `signalling.route_setting_s`, `signalling.sight_reaction_s`,
/// `signalling.release_s`, `signalling.sighting_m`).
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct BlockingParams {
    /// Interlocking processing time to set a route, before switch throwing, s.
    pub route_setting_s: f64,
    /// Driver's sight and reaction time at the approach point, s.
    pub sight_reaction_s: f64,
    /// Time for the interlocking to release a section after the tail clears it, s.
    pub release_s: f64,
    /// Sighting distance added to the braking distance for the approach, m.
    pub sighting_m: f64,
}

impl Default for BlockingParams {
    /// Purpose: planning defaults for an electronic interlocking with lineside
    /// signals: 3 s setting (plus switch throw time), 12 s sight and reaction,
    /// 3 s release, 150 m sighting. Documented in the assumption library.
    fn default() -> Self {
        Self {
            route_setting_s: 3.0,
            sight_reaction_s: 12.0,
            release_s: 3.0,
            sighting_m: 150.0,
        }
    }
}

/// One train run over a sequence of routes.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct TrainRun {
    /// Train name (for example the trip id).
    pub name: String,
    /// Train parameters.
    pub train: TrainParams,
    /// Routes in travel order; each must follow the previous one.
    pub routes: Vec<RouteId>,
    /// Head position at the start, measured from the entry signal of the first route, m.
    pub start_m: f64,
    /// Departure time, s after service-day midnight.
    pub depart_s: f64,
    /// Scheduled stops: head position from the first route's entry signal and dwell.
    pub stops: Vec<Stop>,
    /// Whether the train stops at the end of its path (buffer stop, terminal
    /// platform, storage track) or runs out (portal).
    pub stop_at_end: bool,
    /// Where the path ends, as the head position from the first route's entry
    /// signal, m. None = the end of the last route. A train that stops at a
    /// platform inside its last route ends there; the rest of that route stays
    /// blocked until it leaves.
    #[serde(default)]
    pub end_m: Option<f64>,
    /// Until when the train stays on the end of its path after arriving, s
    /// (for a turn-back: the departure of the next run). None = arrival time.
    pub occupy_until_s: Option<f64>,
    /// Running-time supplement share (UIC 451-1), for example 0.05.
    pub supplement_share: f64,
}

/// One blocking interval of a train on one detection section.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct Blocking {
    /// Index of the train run in the input slice.
    pub train: usize,
    /// The route that blocks the section.
    pub route: RouteId,
    /// The section.
    pub tds: TdsId,
    /// Start of blocking, s.
    pub start_s: f64,
    /// End of blocking, s.
    pub end_s: f64,
    /// Whether the section is part of the route's overlap.
    pub overlap: bool,
}

/// The computed timing of one train run.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct RunTiming {
    /// Speed profile with times relative to the departure.
    pub profile: SpeedProfile,
    /// Departure time, s.
    pub depart_s: f64,
    /// Blocking intervals in route order.
    pub blocking: Vec<Blocking>,
}

impl RunTiming {
    /// Purpose: absolute time the head reaches a position (from the first entry signal), s.
    pub fn time_at(&self, pos_from_entry_m: f64, start_m: f64) -> f64 {
        self.depart_s + self.profile.time_at(pos_from_entry_m - start_m)
    }
}

/// Purpose: the steps of a sequence of routes, checking that each follows the previous.
/// Output: concatenated steps, or Err naming the first break.
pub fn route_steps(model: &Model, routes: &[RouteId]) -> Result<Vec<Step>, String> {
    let mut steps = Vec::new();
    for (i, &r) in routes.iter().enumerate() {
        if i > 0 && !model.next_routes(routes[i - 1]).contains(&r) {
            return Err(format!(
                "route {} does not follow route {}",
                model.routes[r as usize].id,
                model.routes[routes[i - 1] as usize].id
            ));
        }
        steps.extend_from_slice(&model.routes[r as usize].steps);
    }
    Ok(steps)
}

fn segments_from(model: &Model, steps: &[Step], start_m: f64) -> Vec<Segment> {
    let mut out = Vec::new();
    let mut skip = start_m;
    for p in model.profile(steps) {
        if skip >= p.length_m {
            skip -= p.length_m;
            continue;
        }
        out.push(Segment {
            length_m: p.length_m - skip,
            speed_mps: p.speed_mps,
            gradient: p.gradient,
        });
        skip = 0.0;
    }
    out
}

/// Purpose: where the path runs in street traffic, with the expected delay share there.
/// Output: (from, to, share) in m from `start_m`, only stretches with a delay.
fn delays_from(model: &Model, steps: &[Step], start_m: f64) -> Vec<(f64, f64, f64)> {
    let mut out = Vec::new();
    let mut y = -start_m;
    for p in model.profile(steps) {
        if p.delay_share > 0.0 && y + p.length_m > 0.0 {
            out.push((y.max(0.0), y + p.length_m, p.delay_share));
        }
        y += p.length_m;
    }
    out
}

/// Purpose: cut a segment list to a total length.
fn truncate(segs: &mut Vec<Segment>, length_m: f64) {
    let mut acc = 0.0;
    let mut keep = 0;
    for s in segs.iter_mut() {
        if acc + s.length_m >= length_m - 1e-9 {
            s.length_m = length_m - acc;
            keep += 1;
            break;
        }
        acc += s.length_m;
        keep += 1;
    }
    segs.truncate(keep);
    segs.retain(|s| s.length_m > 1e-9);
}

/// Purpose: running time and blocking times of one train run.
/// Inputs: model, the run, its index (stored in each [`Blocking`]) and signalling parameters.
/// Output: the run's timing, or Err for a broken route chain, a stop outside
/// the path or a train that cannot run.
pub fn run_timing(
    model: &Model,
    tr: &TrainRun,
    index: usize,
    p: &BlockingParams,
) -> Result<RunTiming, String> {
    if tr.routes.is_empty() {
        return Err(format!("{}: no routes", tr.name));
    }
    let steps = route_steps(model, &tr.routes)?;
    let mut segs = segments_from(model, &steps, tr.start_m);
    if let Some(end) = tr.end_m {
        truncate(&mut segs, end - tr.start_m);
    }
    let stops: Vec<Stop> = tr
        .stops
        .iter()
        .map(|s| Stop {
            position_m: s.position_m - tr.start_m,
            dwell_s: s.dwell_s,
        })
        .collect();
    let opt = RunOptions {
        start_speed_mps: 0.0,
        stop_at_end: tr.stop_at_end,
        step_m: 1.0,
    };
    let mut profile =
        run(&tr.train, &segs, &stops, &opt).map_err(|e| format!("{}: {e}", tr.name))?;
    // Trams in street traffic: the expected delay at peak (`street.mixed_traffic_delay_share`).
    profile = profile.with_delays(&delays_from(model, &steps, tr.start_m));
    if tr.supplement_share > 0.0 {
        profile = profile.with_supplement(tr.supplement_share);
    }
    let path_len = tr.start_m + profile.length_m();
    let arrive_end = tr.depart_s + profile.total_time_s();
    let occupy_until = tr.occupy_until_s.unwrap_or(arrive_end).max(arrive_end);
    // Absolute time the head reaches / leaves a path position (from the first entry signal).
    let at = |pos: f64| tr.depart_s + profile.time_at(pos - tr.start_m);
    let leaving = |pos: f64| tr.depart_s + profile.time_leaving(pos - tr.start_m);
    // Time the tail clears a position: head at pos + length, or never on this path.
    let tail_clear = |pos: f64| {
        let h = pos + tr.train.length_m;
        if h > path_len + 1e-6 {
            if tr.stop_at_end {
                occupy_until
            } else {
                // Runs out at the speed it has at the path end.
                let v = profile.speed_mps.last().copied().unwrap_or(0.0).max(0.1);
                arrive_end + (h - path_len) / v
            }
        } else {
            at(h)
        }
    };

    let mut blocking = Vec::new();
    let mut entry_pos = 0.0;
    for &rid in &tr.routes {
        let r = &model.routes[rid as usize];
        let exit_pos = entry_pos + r.length_m;
        if exit_pos <= tr.start_m - tr.train.length_m {
            // Entirely behind the train at its start: not part of this run.
            entry_pos = exit_pos;
            continue;
        }
        let throw = r
            .switches
            .iter()
            .chain(r.overlap_switches.iter())
            .map(|&(s, _)| model.switches[s as usize].throw_time_s)
            .fold(0.0, f64::max);
        let setting = p.route_setting_s + throw;
        let t_approach = if entry_pos <= tr.start_m + 1e-6 {
            // The train starts inside or at the start of this route: it needs it to depart.
            tr.depart_s
        } else {
            let v_e = profile.speed_at(entry_pos - tr.start_m);
            if v_e < 0.1 {
                // Stands at the entry signal: needs the route to leave.
                leaving(entry_pos)
            } else {
                let approach = tr.train.braking_distance(v_e) + p.sighting_m;
                let ap = (entry_pos - approach).max(tr.start_m);
                // A train that stops between the approach point and the signal (a
                // starter just beyond the platform end) needs the route only to
                // leave that stop.
                let stop_before = tr
                    .stops
                    .iter()
                    .filter(|s| s.position_m >= ap - 1e-6 && s.position_m <= entry_pos + 1e-6)
                    .map(|s| s.position_m)
                    .fold(None, |a: Option<f64>, x| Some(a.map_or(x, |a| a.max(x))));
                if let Some(sp) = stop_before {
                    leaving(sp)
                } else if ap <= tr.start_m + 1e-6 {
                    tr.depart_s
                } else {
                    at(ap)
                }
            }
        };
        let start = t_approach - p.sight_reaction_s - setting;
        // Sections: release when the tail clears the end of each section's part of the route.
        let mut pos = entry_pos;
        let mut last_end: Vec<(TdsId, f64)> = Vec::new();
        for st in &r.steps {
            pos += model.pieces[st.piece as usize].length_m();
            let t = model.pieces[st.piece as usize].tds;
            match last_end.iter_mut().find(|(x, _)| *x == t) {
                Some(e) => e.1 = pos,
                None => last_end.push((t, pos)),
            }
        }
        for (t, end_pos) in last_end {
            blocking.push(Blocking {
                train: index,
                route: rid,
                tds: t,
                start_s: start,
                end_s: tail_clear(end_pos) + p.release_s,
                overlap: false,
            });
        }
        let overlap_end = if exit_pos >= path_len - 1e-6 {
            if tr.stop_at_end {
                occupy_until
            } else {
                arrive_end
            }
        } else {
            leaving(exit_pos)
        } + p.release_s;
        for &t in &r.overlap_tds {
            blocking.push(Blocking {
                train: index,
                route: rid,
                tds: t,
                start_s: start,
                end_s: overlap_end,
                overlap: true,
            });
        }
        entry_pos = exit_pos;
    }
    Ok(RunTiming {
        profile,
        depart_s: tr.depart_s,
        blocking,
    })
}

/// Purpose: running and blocking times of many train runs.
/// Output: one timing per run in input order, or Err with the first failure.
pub fn timetable_timing(
    model: &Model,
    runs: &[TrainRun],
    p: &BlockingParams,
) -> Result<Vec<RunTiming>, String> {
    runs.iter()
        .enumerate()
        .map(|(i, r)| run_timing(model, r, i, p))
        .collect()
}
