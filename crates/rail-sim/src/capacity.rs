//! The **capacity run** of the simulator tab (ADR-0032 §3 step 8 and §4).
//!
//! For one period of the day (for example the morning peak 07:00–09:00) it
//! answers three questions for every rail line, in plain terms:
//!
//! 1. **Does the plan fit the infrastructure?** The timetable planner places
//!    every trip of the period on blocking times (trips it cannot place are
//!    counted), and the UIC 406 compression method gives the **capacity
//!    consumption** of the line and of its busier terminal, with the
//!    bottleneck section, against the recommended limit
//!    (`capacity.occupancy_limit_share`).
//! 2. **Does it run?** The planned period is run through the interlocking and
//!    train protection of the network kernel ([`crate::network`]): punctuality
//!    (`recording.late_threshold_s`), the worst delay, and any event (deadlock,
//!    overspeed braking, a train held at a level crossing).
//! 3. **Is it stable?** The **stability test** runs the period again
//!    `stability.runs` times with seeded random **primary delays** at the
//!    origin of a share of the trips (`stability.delayed_share`, exponential
//!    with mean `stability.primary_delay_mean_s`, capped at
//!    `stability.primary_delay_max_s`). It measures the **knock-on delay**
//!    (delay at the destination beyond the trip's own primary delay) and the
//!    **residual delay**: the mean arrival delay in the last 15 minutes of a
//!    recovery time after the period (`stability.recovery_s`), with no new
//!    primary delays. Delays **die out** when the residual delay stays under
//!    `stability.residual_delay_s`; otherwise they **pile up**.
//!
//! The **frequency sweep** ([`sweep_point`]) replans the period with shorter
//! clock-face headways for one line ([`sweep_headways`]) and repeats the three
//! checks. The **practical maximum** is the highest frequency that is placed
//! without conflicts, stays under the occupancy limit and passes the stability
//! test; the theoretical one comes from the compression (100 %).
//!
//! Only the period and its margins are planned: service from `warmup_s` before
//! the period (so the line is full when it starts) to `recovery_s` after it.
//! Everything is deterministic for a given seed (NFR-ACC-02).

use std::collections::BTreeMap;

use rail_model::Model;
use rail_plan::{
    plan, report, Band, Issue, LineSpec, Plan, PlanParams, RunKind, CLOCK_FACE_HEADWAYS_S,
};
use serde::{Deserialize, Serialize};

use crate::network::{NetEvent, NetParams, NetworkSim};

/// Settings of a capacity run (assumption library keys in brackets).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct CapacityParams {
    /// Start of the period measured, s from the start of the service day.
    pub from_s: f64,
    /// End of the period, s.
    pub to_s: f64,
    /// Service planned before the period so that the line is full when it starts, s.
    pub warmup_s: f64,
    /// Service planned and run after the period, without new primary delays,
    /// to see whether delays die out, s (`stability.recovery_s`).
    pub recovery_s: f64,
    /// Minimum buffer time between two trains on a section, s (`timetable.min_buffer_s`).
    pub min_buffer_s: f64,
    /// Recommended capacity consumption limit (`capacity.occupancy_limit_share`).
    pub occupancy_limit_share: f64,
    /// Reserve trains as a share of the trains in service (`mode.spare_share`).
    pub spare_share: f64,
    /// A call counts as late from this delay on, s (`recording.late_threshold_s`).
    pub late_threshold_s: f64,
    /// Runs with random primary delays in the stability test (`stability.runs`).
    pub stability_runs: usize,
    /// Share of the period's trips that get a primary delay (`stability.delayed_share`).
    pub delayed_share: f64,
    /// Mean primary delay, s (`stability.primary_delay_mean_s`).
    pub primary_delay_mean_s: f64,
    /// Largest primary delay, s (`stability.primary_delay_max_s`).
    pub primary_delay_max_s: f64,
    /// Delays have died out when the mean arrival delay at the end of the
    /// recovery time is under this, s (`stability.residual_delay_s`).
    pub residual_delay_s: f64,
    /// Seed of the random primary delays.
    pub seed: u64,
}

impl Default for CapacityParams {
    /// Purpose: the morning peak 07:00–09:00 with the metro values of the
    /// assumption library (central values).
    fn default() -> Self {
        CapacityParams {
            from_s: 7.0 * 3600.0,
            to_s: 9.0 * 3600.0,
            warmup_s: 1800.0,
            recovery_s: 1800.0,
            min_buffer_s: 20.0,
            occupancy_limit_share: 0.85,
            spare_share: 0.15,
            late_threshold_s: 120.0,
            stability_runs: 8,
            delayed_share: 0.2,
            primary_delay_mean_s: 45.0,
            primary_delay_max_s: 180.0,
            residual_delay_s: 30.0,
            seed: 1,
        }
    }
}

/// The plain verdict for a line (or the whole run: the worst line).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Verdict {
    /// Placed, under the occupancy limit with margin, and delays die out.
    Works,
    /// Works, but the capacity consumption is within 10 % of the limit.
    NearLimit,
    /// Placed and stable, but above the recommended occupancy limit.
    OverLimit,
    /// Delays pile up in the stability test (or the kernel deadlocked with delays).
    DelaysPileUp,
    /// Trips of the period could not be placed, or the plan does not run.
    NotEnoughCapacity,
}

/// One frequency of a line, as planned, run and tested.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Point {
    /// Headway in the period, s.
    pub headway_s: f64,
    /// Trains per hour and direction in the period.
    pub per_hour: f64,
    /// Trips of the line that could not be placed.
    pub unplaced: usize,
    /// Highest capacity consumption of the line in an hour of the period (either direction).
    pub consumption: f64,
    /// Busier terminal and its blocked share in that hour.
    pub terminal: String,
    /// Blocked share of the terminal's platforms.
    pub terminal_share: f64,
    /// Section with the longest blocking in that hour.
    pub bottleneck: String,
    /// Its blocked share of the hour.
    pub bottleneck_share: f64,
    /// Trains per hour at 100 % consumption (UIC 406 theoretical maximum).
    pub theoretical_per_hour: f64,
    /// Trains per hour at the recommended occupancy limit.
    pub limit_per_hour: f64,
    /// Share of the line's calls in the period that were on time, run without disturbances.
    pub punctuality: f64,
    /// Worst arrival delay in the period, run without disturbances, s.
    pub max_delay_s: f64,
    /// Mean knock-on delay per trip in the stability test, s.
    pub knock_on_s: f64,
    /// Share of calls on time in the stability test.
    pub disturbed_punctuality: f64,
    /// Mean arrival delay at the end of the recovery time in the stability test, s.
    pub residual_delay_s: f64,
    /// Whether delays die out (mean residual delay of the stability runs under the limit, no deadlock).
    pub stable: bool,
    /// Kernel events or errors (deadlocks, overspeed braking), as text.
    pub problems: Vec<String>,
    /// The verdict at this frequency.
    pub verdict: Verdict,
}

/// One line of the capacity run.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct LineResult {
    /// Line id.
    pub line: String,
    /// Public name.
    pub name: String,
    /// The line as planned (its headway in the period).
    pub planned: Point,
}

/// Trains and fleet over the run.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Fleet {
    /// Service trips planned (period and margins).
    pub trips: usize,
    /// Trains used.
    pub vehicles: usize,
    /// Most trains out of stabling at once.
    pub peak_out: usize,
    /// Reserve trains.
    pub reserve: usize,
    /// Routes the interlocking locked in the undisturbed run.
    pub routes_locked: u64,
}

/// The result of a capacity run.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct CapacityRun {
    /// The settings used.
    pub params: CapacityParams,
    /// The worst verdict of all lines.
    pub verdict: Verdict,
    /// Per line.
    pub lines: Vec<LineResult>,
    /// Fleet.
    pub fleet: Fleet,
    /// Planner issues other than shifted departures, as text.
    pub issues: Vec<String>,
}

/// A deterministic random generator (SplitMix64), so runs repeat exactly.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
    /// Uniform in (0, 1).
    fn unit(&mut self) -> f64 {
        ((self.next() >> 11) as f64 + 0.5) / (1u64 << 53) as f64
    }
}

/// Purpose: the line's service cut to the period and its margins, with the
/// headway inside the period replaced when `headway_s` is given.
fn cut(l: &LineSpec, p: &CapacityParams, headway_s: Option<f64>) -> LineSpec {
    let (a, b) = (p.from_s - p.warmup_s, p.to_s + p.recovery_s);
    let mut bands = Vec::new();
    for band in &l.bands {
        let (s, e) = (band.from_s.max(a), band.to_s.min(b));
        if e <= s {
            continue;
        }
        match headway_s {
            None => bands.push(Band {
                from_s: s,
                to_s: e,
                headway_s: band.headway_s,
            }),
            Some(h) => {
                // Split at the period: inside it the new headway, outside the old.
                let parts = [
                    (s, e.min(p.from_s), band.headway_s),
                    (s.max(p.from_s), e.min(p.to_s), h),
                    (s.max(p.to_s), e, band.headway_s),
                ];
                for (x, y, hw) in parts {
                    if y > x {
                        bands.push(Band {
                            from_s: x,
                            to_s: y,
                            headway_s: hw,
                        });
                    }
                }
            }
        }
    }
    // Merge neighbours with the same headway, so a band boundary does not
    // reset the pattern inside the period.
    let mut merged: Vec<Band> = Vec::new();
    for band in bands {
        match merged.last_mut() {
            Some(m) if (m.to_s - band.from_s).abs() < 1e-6 && m.headway_s == band.headway_s => {
                m.to_s = band.to_s
            }
            _ => merged.push(band),
        }
    }
    let mut out = l.clone();
    out.bands = merged;
    out
}

/// Purpose: the line's headway in the period: the shortest of the bands that overlap it.
/// Output: None when the line has no service in the period.
pub fn period_headway(l: &LineSpec, p: &CapacityParams) -> Option<f64> {
    l.bands
        .iter()
        .filter(|b| b.to_s > p.from_s && b.from_s < p.to_s)
        .map(|b| b.headway_s)
        .reduce(f64::min)
}

/// Purpose: the headways the frequency sweep tries for a line: shorter
/// clock-face headways than the planned one, nearest first, and, when the
/// planned frequency does not work, longer ones.
/// Inputs: the line, the settings, and whether the planned frequency works.
/// Output: headways in s, at most four shorter or three longer.
pub fn sweep_headways(l: &LineSpec, p: &CapacityParams, planned_works: bool) -> Vec<f64> {
    let Some(h) = period_headway(l, p) else {
        return Vec::new();
    };
    if planned_works {
        CLOCK_FACE_HEADWAYS_S
            .iter()
            .rev()
            .copied()
            .filter(|&x| x < h - 1e-6)
            .take(4)
            .collect()
    } else {
        CLOCK_FACE_HEADWAYS_S
            .iter()
            .copied()
            .filter(|&x| x > h + 1e-6)
            .take(3)
            .collect()
    }
}

/// Line index of a trip name `{line}-{direction}-{number}`.
fn trip_line(name: &str, ids: &[String]) -> Option<usize> {
    let mut it = name.rsplitn(3, '-');
    let (_, _, id) = (it.next()?, it.next()?, it.next()?);
    ids.iter().position(|x| x == id)
}

/// Delay statistics of one kernel run for one line.
#[derive(Default)]
struct RunStats {
    calls: usize,
    on_time: usize,
    max_delay: f64,
    knock_on_sum: f64,
    trips: usize,
    residual_sum: f64,
    residual_n: usize,
}

/// Purpose: run the plan through the kernel, optionally with primary delays.
/// Output: per line statistics and problems (events, kernel errors).
fn run_kernel(
    m: &Model,
    pl: &Plan,
    lines: usize,
    p: &CapacityParams,
    seed: Option<u64>,
) -> (Vec<RunStats>, Vec<Vec<String>>, u64) {
    let mut stats: Vec<RunStats> = (0..lines).map(|_| RunStats::default()).collect();
    let mut problems: Vec<Vec<String>> = vec![Vec::new(); lines];
    let np = NetParams {
        check_invariants: true,
        ..NetParams::default()
    };
    let mut sim = match NetworkSim::new(m, pl, np) {
        Ok(s) => s,
        Err(e) => {
            for pr in &mut problems {
                pr.push(format!("the kernel could not start: {e}"));
            }
            return (stats, problems, 0);
        }
    };
    // Primary delays at the origin of a share of the period's trips.
    let mut primary: BTreeMap<usize, f64> = BTreeMap::new();
    if let Some(seed) = seed {
        let mut rng = Rng(seed);
        for (i, r) in pl.runs.iter().enumerate() {
            if r.kind != RunKind::Service || r.depart_s() < p.from_s || r.depart_s() >= p.to_s {
                continue;
            }
            // Draw both numbers for every trip, so the sequence does not depend on the share.
            let (u, v) = (rng.unit(), rng.unit());
            if u < p.delayed_share {
                let d = (-p.primary_delay_mean_s * v.ln()).min(p.primary_delay_max_s);
                if sim.delay_departure(i, d) {
                    primary.insert(i, d);
                }
            }
        }
    }
    let t_end = p.to_s + p.recovery_s;
    let result = sim.run_until(t_end + 900.0);
    let t_now = sim.time();
    if let Err(e) = &result {
        // A deadlock or a safety violation: name it on every line that has trains.
        for pr in &mut problems {
            pr.push(e.clone());
        }
    }
    for ev in sim.events() {
        let line_of = |train: usize| {
            pl.runs
                .iter()
                .find(|r| r.vehicle == train)
                .map(|r| r.line)
                .unwrap_or(0)
        };
        match ev {
            NetEvent::Overspeed { t, train, .. } => problems[line_of(*train)]
                .push(format!("train {train} braked for overspeed at {t:.0} s")),
            NetEvent::HeldAtCrossing { t, train, crossing } => problems[line_of(*train)].push(
                format!("train {train} held at level crossing {crossing} at {t:.0} s"),
            ),
            NetEvent::Deadlock { .. } => {}
        }
    }
    // Per trip: the latest arrival delay at its destination.
    let mut last_arrival: BTreeMap<usize, (f64, f64)> = BTreeMap::new();
    for c in sim.calls() {
        let r = &pl.runs[c.run];
        let Some(pa) = c.planned_arrive_s else {
            continue;
        };
        // An arrival that did not happen by the end counts as late as the end.
        let delay = match c.arrive_s {
            Some(a) => a - pa,
            None if pa < t_now => t_now - pa,
            None => continue,
        };
        let s = &mut stats[r.line];
        if pa >= p.from_s && pa < p.to_s {
            s.calls += 1;
            if delay < p.late_threshold_s {
                s.on_time += 1;
            }
            s.max_delay = s.max_delay.max(delay);
        }
        if pa >= t_end - 900.0 && pa < t_end {
            s.residual_sum += delay.max(0.0);
            s.residual_n += 1;
        }
        let e = last_arrival.entry(c.run).or_insert((pa, delay));
        if pa >= e.0 {
            *e = (pa, delay);
        }
    }
    for (run, (_, delay)) in last_arrival {
        let r = &pl.runs[run];
        if r.depart_s() < p.from_s || r.depart_s() >= p.to_s {
            continue;
        }
        let own = primary.get(&run).copied().unwrap_or(0.0);
        let s = &mut stats[r.line];
        s.trips += 1;
        s.knock_on_sum += (delay - own).max(0.0);
    }
    for pr in &mut problems {
        pr.sort();
        pr.dedup();
        pr.truncate(5);
    }
    (stats, problems, sim.interlocking().routes_locked)
}

/// Purpose: plan, measure, run and test one set of lines.
/// Output: the plan, a point per line, the fleet and the issues; Err when the
/// lines cannot be planned at all (an unknown station or storage track).
fn evaluate(
    m: &Model,
    lines: &[LineSpec],
    p: &CapacityParams,
) -> Result<(Vec<Point>, Fleet, Vec<String>), String> {
    let pp = PlanParams {
        min_buffer_s: p.min_buffer_s,
        ..PlanParams::default()
    };
    let pl = plan(m, lines, &pp)?;
    let ids: Vec<String> = lines.iter().map(|l| l.id.clone()).collect();
    let rep = report(
        m,
        &pl,
        &ids,
        p.min_buffer_s,
        p.spare_share,
        p.occupancy_limit_share,
    );
    let mut unplaced = vec![0usize; lines.len()];
    let mut issues = Vec::new();
    for i in &pl.issues {
        match i {
            Issue::Shifted { .. } => continue,
            Issue::Unplaced { trip, .. } => {
                if let Some(li) = trip_line(trip, &ids) {
                    unplaced[li] += 1;
                }
            }
            Issue::NoPath { line, .. } => {
                if let Some(li) = ids.iter().position(|x| x == line) {
                    unplaced[li] += 1;
                }
            }
            _ => {}
        }
        issues.push(format!("{i:?}"));
    }
    let (clean, clean_problems, routes_locked) = run_kernel(m, &pl, lines.len(), p, None);
    let mut disturbed: Vec<Vec<RunStats>> = Vec::new();
    let mut disturbed_problems: Vec<Vec<String>> = vec![Vec::new(); lines.len()];
    for k in 0..p.stability_runs {
        let seed = p.seed.wrapping_mul(1_000_003).wrapping_add(k as u64);
        let (s, pr, _) = run_kernel(m, &pl, lines.len(), p, Some(seed));
        for (li, x) in pr.into_iter().enumerate() {
            disturbed_problems[li].extend(x.into_iter().map(|e| format!("with delays: {e}")));
        }
        disturbed.push(s);
    }
    let first_h = (p.from_s / 3600.0).floor() as u32;
    let last_h = ((p.to_s / 3600.0).ceil() as u32).saturating_sub(1);
    let mut points = Vec::new();
    for (li, l) in lines.iter().enumerate() {
        let hw = period_headway(l, p).unwrap_or(f64::INFINITY);
        // The busiest hour of the period, either direction.
        let worst = rep
            .capacity
            .iter()
            .filter(|c| c.line == l.id && c.hour >= first_h && c.hour <= last_h)
            .max_by(|a, b| {
                a.consumption
                    .max(a.terminal_share)
                    .partial_cmp(&b.consumption.max(b.terminal_share))
                    .unwrap()
            });
        let (consumption, terminal, terminal_share, bottleneck, bottleneck_share, trains) =
            match worst {
                Some(c) => (
                    c.consumption,
                    c.terminal.clone(),
                    c.terminal_share,
                    c.bottleneck.clone(),
                    c.bottleneck_share,
                    c.trains,
                ),
                None => (0.0, String::new(), 0.0, String::new(), 0.0, 0),
            };
        let tight = consumption.max(terminal_share);
        let theoretical = if tight > 1e-9 {
            trains as f64 / tight
        } else {
            0.0
        };
        let c = &clean[li];
        let punctuality = if c.calls > 0 {
            c.on_time as f64 / c.calls as f64
        } else {
            1.0
        };
        let n = disturbed.len().max(1) as f64;
        let mut knock = 0.0;
        let mut dp = 0.0;
        let mut residual = 0.0;
        for d in &disturbed {
            let s = &d[li];
            knock += if s.trips > 0 {
                s.knock_on_sum / s.trips as f64
            } else {
                0.0
            };
            dp += if s.calls > 0 {
                s.on_time as f64 / s.calls as f64
            } else {
                1.0
            };
            residual += if s.residual_n > 0 {
                s.residual_sum / s.residual_n as f64
            } else {
                0.0
            };
        }
        if disturbed.is_empty() {
            dp = 1.0;
        }
        let (knock, dp, residual) = (knock / n, dp / n, residual / n);
        let deadlocked = disturbed_problems[li]
            .iter()
            .any(|e| e.contains("deadlock"));
        let stable = residual <= p.residual_delay_s && !deadlocked;
        let mut problems = clean_problems[li].clone();
        let mut dprob = disturbed_problems[li].clone();
        dprob.sort();
        dprob.dedup();
        problems.extend(dprob.into_iter().take(3));
        let verdict = if unplaced[li] > 0 || !clean_problems[li].is_empty() || tight > 1.0 {
            Verdict::NotEnoughCapacity
        } else if !stable {
            Verdict::DelaysPileUp
        } else if tight > p.occupancy_limit_share {
            Verdict::OverLimit
        } else if tight > 0.9 * p.occupancy_limit_share {
            Verdict::NearLimit
        } else {
            Verdict::Works
        };
        points.push(Point {
            headway_s: hw,
            per_hour: if hw.is_finite() { 3600.0 / hw } else { 0.0 },
            unplaced: unplaced[li],
            consumption,
            terminal,
            terminal_share,
            bottleneck,
            bottleneck_share,
            theoretical_per_hour: theoretical,
            limit_per_hour: theoretical * p.occupancy_limit_share,
            punctuality,
            max_delay_s: c.max_delay.max(0.0),
            knock_on_s: knock,
            disturbed_punctuality: dp,
            residual_delay_s: residual,
            stable,
            problems,
            verdict,
        });
    }
    let fleet = Fleet {
        trips: rep.trips,
        vehicles: rep.vehicles,
        peak_out: rep.peak_out,
        reserve: rep.reserve,
        routes_locked,
    };
    Ok((points, fleet, issues))
}

/// Purpose: the capacity run of the planned lines over one period.
/// Inputs: the compiled network, the lines with their service for the day,
/// and the settings.
/// Output: the verdict, a result per line and the fleet, or Err when a line
/// refers to a station or storage track that is not on the network.
/// Side effects: none (deterministic for a given seed).
pub fn capacity_run(
    m: &Model,
    lines: &[LineSpec],
    p: &CapacityParams,
) -> Result<CapacityRun, String> {
    if p.to_s <= p.from_s {
        return Err("the period ends before it starts".into());
    }
    // Only lines with service in the period are planned (the others do not
    // use the network then).
    let active: Vec<&LineSpec> = lines
        .iter()
        .filter(|l| period_headway(l, p).is_some())
        .collect();
    if active.is_empty() {
        return Err("no line has service in this period".into());
    }
    let cut_lines: Vec<LineSpec> = active.iter().map(|l| cut(l, p, None)).collect();
    let (points, fleet, issues) = evaluate(m, &cut_lines, p)?;
    let results: Vec<LineResult> = active
        .iter()
        .zip(points)
        .map(|(l, pt)| LineResult {
            line: l.id.clone(),
            name: l.name.clone(),
            planned: pt,
        })
        .collect();
    let verdict = results
        .iter()
        .map(|r| r.planned.verdict)
        .max()
        .unwrap_or(Verdict::Works);
    Ok(CapacityRun {
        params: p.clone(),
        verdict,
        lines: results,
        fleet,
        issues,
    })
}

/// Purpose: one point of the frequency sweep: the period replanned with
/// another headway for one line (the other lines as planned), measured, run
/// and tested.
/// Inputs: network, lines, settings, the line's index and the headway, s.
/// Output: the line's point at that headway.
pub fn sweep_point(
    m: &Model,
    lines: &[LineSpec],
    p: &CapacityParams,
    line: usize,
    headway_s: f64,
) -> Result<Point, String> {
    if line >= lines.len() {
        return Err(format!("no line {line}"));
    }
    if period_headway(&lines[line], p).is_none() {
        return Err(format!(
            "line {} has no service in this period",
            lines[line].id
        ));
    }
    let mut at = 0;
    let mut cut_lines = Vec::new();
    for (i, l) in lines.iter().enumerate() {
        if period_headway(l, p).is_none() {
            continue;
        }
        if i == line {
            at = cut_lines.len();
        }
        cut_lines.push(cut(l, p, (i == line).then_some(headway_s)));
    }
    let (mut points, _, _) = evaluate(m, &cut_lines, p)?;
    Ok(points.swap_remove(at))
}

/// Purpose: the practical maximum from the planned point and the sweep: the
/// highest frequency that works (placed, under the occupancy limit, stable).
/// Output: trains per hour, or None if no frequency tried works.
pub fn practical_maximum(points: &[&Point]) -> Option<f64> {
    points
        .iter()
        .filter(|x| x.verdict <= Verdict::NearLimit)
        .map(|x| x.per_hour)
        .reduce(f64::max)
}
