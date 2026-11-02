//! Timetable construction (ADR-0032 §3 steps 4b to 7): train paths placed on
//! blocking times, consistent platforms, circulation with turn-back in the
//! platform, and depot pull-out and pull-in runs with stabling.
//!
//! 1. **Templates.** For each line and direction the cheapest path through its
//!    calls gives the nominal running time.
//! 2. **Trips** are generated from the service bands (outbound, and the return
//!    direction offset by `return_offset_s`).
//! 3. **Circulation.** At each terminal an arriving trip continues as the
//!    departing trip with the shortest layover that still respects the
//!    turn-back time and `max_idle_s` (minimum-layover matching; with regular
//!    headways it uses no more trains than first-in-first-out matching and
//!    keeps fewer trains standing in the terminal platforms). Departures left
//!    without an arrival start with a **pull-out**; arrivals left without a
//!    departure end with a **pull-in** (this also gives mid-day returns
//!    between the peaks).
//! 4. **Construction.** Trips are placed in order of departure, each with a
//!    space-time search over its departure time and its platforms: the run is
//!    moved later (pull-outs earlier) by the shortfall of every blocking-time
//!    overlap, plus the minimum buffer time, until it fits, within a bounded
//!    shift; then another platform is tried. A train that waits in a platform
//!    blocks it until it leaves, so turn-backs are checked like any other
//!    occupation. A trip that cannot be placed is reported with the train and
//!    section that block it, never dropped silently.
//! 5. **Stabling.** Each storage track is a stack (dead-end sidings are
//!    last-in, first-out): a pull-out takes the train nearest the exit and a
//!    pull-in puts the train in front, so no train is ever blocked in by one
//!    that leaves later. Trains are added to the morning stabling only where
//!    the track is empty at that moment.

use std::collections::{BTreeMap, BinaryHeap, HashMap};

use rail_dynamics::Stop;
use rail_model::{Dir, Model, PlatformId, RouteId, TdsId};
use serde::Serialize;

use crate::blocking::{route_steps, run_timing, Blocking, BlockingParams, RunTiming, TrainRun};
use crate::line::{resolve, LineSpec};
use crate::path::{arrival_dir, departure_routes, find_path, stop_at, Candidate, FoundPath, Place};

/// Planner settings.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct PlanParams {
    /// Signalling timing.
    pub blocking: BlockingParams,
    /// Minimum buffer time between two trains on a section, s (`timetable.min_buffer_s`).
    pub min_buffer_s: f64,
    /// Stop short of the platform end or buffer stop, m.
    pub stop_margin_m: f64,
    /// Most a service departure may move from its slot, s.
    pub max_shift_s: f64,
    /// Most a pull-out or pull-in may move from its ideal time, s.
    pub max_depot_shift_s: f64,
    /// Longest a train waits in a terminal for its next trip before it is
    /// sent to stabling instead, s.
    pub max_idle_s: f64,
    /// Penalty per rank for a platform that is not the planner's first choice, m.
    pub alternative_penalty_m: f64,
    /// Penalty for leaving the platform the line uses in this direction, m.
    pub change_penalty_m: f64,
    /// Gap between trains stabled on one track, m.
    pub stabling_gap_m: f64,
    /// Most routes in one path.
    pub max_routes: usize,
    /// Minimum separation the periodic pattern keeps between an arrival and a
    /// departure at the same terminal, s (crossing moves in the throat).
    pub terminal_separation_s: f64,
    /// Time a train brought out of stabling stands in its first platform
    /// before departure (boarding), s.
    pub pull_out_margin_s: f64,
}

impl Default for PlanParams {
    /// Purpose: metro planning defaults (min buffer from the assumption library's
    /// metro value, 2 min shift, 15 min for depot moves, 20 min idle limit).
    fn default() -> Self {
        Self {
            blocking: BlockingParams::default(),
            min_buffer_s: 20.0,
            stop_margin_m: 5.0,
            max_shift_s: 120.0,
            max_depot_shift_s: 900.0,
            max_idle_s: 1200.0,
            alternative_penalty_m: 500.0,
            change_penalty_m: 2000.0,
            stabling_gap_m: 10.0,
            max_routes: 64,
            terminal_separation_s: 90.0,
            pull_out_margin_s: 90.0,
        }
    }
}

/// What a run is for.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum RunKind {
    /// A passenger trip.
    Service,
    /// From a storage track to the first platform of the day (or after a break).
    PullOut,
    /// From the last platform to a storage track.
    PullIn,
}

/// When a train is at one place of a run.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct CallTime {
    /// The place.
    pub place: Place,
    /// Its id (platform edge or storage track).
    pub id: String,
    /// Whether the train stops there.
    pub stop: bool,
    /// Arrival, s (None at the origin).
    pub arrive_s: Option<f64>,
    /// Departure, s (None at the destination).
    pub depart_s: Option<f64>,
}

/// One placed run.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct PlannedRun {
    /// Name (trip id).
    pub name: String,
    /// Index of the line.
    pub line: usize,
    /// Kind.
    pub kind: RunKind,
    /// 0 = outbound (the line's call order), 1 = return.
    pub direction: u8,
    /// Vehicle (train) number.
    pub vehicle: usize,
    /// Slot departure before conflict resolution, s.
    pub planned_depart_s: f64,
    /// The run as placed (routes, stops, departure, occupation of its last place).
    pub run: TrainRun,
    /// Origin, calls and destination with times.
    pub calls: Vec<CallTime>,
    /// Blocking intervals (train index = this run's index).
    pub blocking: Vec<Blocking>,
}

impl PlannedRun {
    /// Purpose: departure from the origin, s.
    pub fn depart_s(&self) -> f64 {
        self.run.depart_s
    }
    /// Purpose: arrival at the destination, s.
    pub fn arrive_s(&self) -> f64 {
        self.calls
            .last()
            .and_then(|c| c.arrive_s)
            .unwrap_or(self.run.depart_s)
    }
}

/// Something the planner reports.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub enum Issue {
    /// A line has no path through its calls.
    NoPath {
        /// Line id.
        line: String,
        /// Direction.
        direction: u8,
    },
    /// A trip could not be placed.
    Unplaced {
        /// Trip id.
        trip: String,
        /// Why.
        reason: String,
        /// The run that blocks it, if a conflict.
        blocked_by: Option<String>,
        /// The section where, if a conflict.
        section: Option<String>,
    },
    /// A departure was moved from its slot.
    Shifted {
        /// Run.
        run: String,
        /// By how much, s (positive = later).
        by_s: f64,
    },
    /// A trip uses another platform than its line normally uses there.
    PlatformChange {
        /// Trip.
        trip: String,
        /// Usual platform.
        usual: String,
        /// Platform used.
        used: String,
    },
    /// A train could not be stabled and stays in its last platform.
    NotStabled {
        /// Vehicle.
        vehicle: usize,
        /// Where it stays.
        at: String,
        /// Why.
        reason: String,
    },
}

/// The result of planning.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Plan {
    /// All runs, in the order placed.
    pub runs: Vec<PlannedRun>,
    /// Reported issues.
    pub issues: Vec<Issue>,
    /// Trains used (stabled in the morning or pulled out during the day).
    pub vehicles: usize,
    /// Morning stabling: per storage track, vehicles front (exit) first.
    pub stabling_start: BTreeMap<String, Vec<usize>>,
    /// Night stabling: per storage track, vehicles front (exit) first.
    pub stabling_end: BTreeMap<String, Vec<usize>>,
}

impl Plan {
    /// Purpose: every blocking interval of the plan.
    pub fn blocks(&self) -> Vec<Blocking> {
        self.runs
            .iter()
            .flat_map(|r| r.blocking.iter().copied())
            .collect()
    }
    /// Purpose: the vehicle of each run, by run index.
    pub fn vehicle_of(&self) -> Vec<usize> {
        self.runs.iter().map(|r| r.vehicle).collect()
    }
}

#[derive(Clone, Debug)]
struct Trip {
    line: usize,
    dir: u8,
    /// Extra time held at the last intermediate stop (periodic pattern), s.
    extra_s: f64,
    dep: f64,
    arr: f64,
    name: String,
    pred: Option<usize>,
    succ: Option<usize>,
}

#[derive(Clone, Debug)]
struct Vehicle {
    at: Place,
    arrive_dir: Dir,
    ready_s: f64,
    last_run: usize,
}

#[derive(Clone, Debug)]
struct Stack {
    track: usize,
    capacity: usize,
    now: Vec<usize>,
    morning: Vec<usize>,
}

/// A conflict that stops a placement: (other run, section).
type Blocker = Option<(usize, TdsId)>;

struct Planner<'a> {
    m: &'a Model,
    lines: &'a [LineSpec],
    p: &'a PlanParams,
    cands: Vec<[Vec<Vec<PlatformId>>; 2]>,
    runs: Vec<PlannedRun>,
    index: BTreeMap<TdsId, Vec<(usize, f64, f64)>>,
    issues: Vec<Issue>,
    memory: HashMap<(usize, u8, usize), PlatformId>,
    vehicles: Vec<Vehicle>,
    stacks: Vec<Stack>,
    /// Departure routes reserved for trains standing in a platform: (vehicle, start, end) per section.
    reserved: BTreeMap<TdsId, Vec<(usize, f64, f64)>>,
}

/// Purpose: plan a day of service for a set of lines.
/// Inputs: the model, the lines (calls, train, bands, stabling) and settings.
/// Output: the plan with every run, its blocking times and the issues found;
/// Err for an unknown station, platform or storage track.
pub fn plan(m: &Model, lines: &[LineSpec], p: &PlanParams) -> Result<Plan, String> {
    let mut cands = Vec::new();
    for l in lines {
        let out: Vec<Vec<PlatformId>> = l
            .calls
            .iter()
            .map(|c| resolve(m, &c.pick))
            .collect::<Result<_, _>>()
            .map_err(|e| format!("line {}: {e}", l.id))?;
        let mut back = out.clone();
        back.reverse();
        cands.push([out, back]);
    }
    let mut stacks = Vec::new();
    for l in lines {
        for s in &l.stabling {
            let t = m
                .track(s)
                .ok_or_else(|| format!("line {}: unknown storage track {s}", l.id))?;
            if stacks.iter().any(|x: &Stack| x.track == t) {
                continue;
            }
            let train = l.train.length_m + p.stabling_gap_m;
            let cap = ((m.tracks[t].length_m - p.stop_margin_m + p.stabling_gap_m) / train)
                .floor()
                .max(0.0) as usize;
            stacks.push(Stack {
                track: t,
                capacity: cap,
                now: Vec::new(),
                morning: Vec::new(),
            });
        }
    }
    let mut pl = Planner {
        m,
        lines,
        p,
        cands,
        runs: Vec::new(),
        index: BTreeMap::new(),
        issues: Vec::new(),
        memory: HashMap::new(),
        vehicles: Vec::new(),
        stacks,
        reserved: BTreeMap::new(),
    };
    let trips = pl.trips();
    pl.construct(trips);
    // Drop pull-outs that were taken back, renumbering the blocking intervals.
    let keep: Vec<bool> = pl.runs.iter().map(|r| !r.calls.is_empty()).collect();
    let mut new_index = vec![usize::MAX; pl.runs.len()];
    let mut n = 0;
    for (i, &k) in keep.iter().enumerate() {
        if k {
            new_index[i] = n;
            n += 1;
        }
    }
    let mut runs: Vec<PlannedRun> = Vec::with_capacity(n);
    for (i, mut r) in std::mem::take(&mut pl.runs).into_iter().enumerate() {
        if keep[i] {
            for b in r.blocking.iter_mut() {
                b.train = new_index[i];
            }
            runs.push(r);
        }
    }
    pl.runs = runs;
    let name = |t: usize| m.tracks[t].id.clone();
    Ok(Plan {
        vehicles: pl.vehicles.len(),
        stabling_start: pl
            .stacks
            .iter()
            .map(|s| (name(s.track), s.morning.clone()))
            .collect(),
        stabling_end: pl
            .stacks
            .iter()
            .map(|s| (name(s.track), s.now.iter().rev().copied().collect()))
            .collect(),
        runs: pl.runs,
        issues: pl.issues,
    })
}

/// The periodic pattern of a line in one band.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Pattern {
    /// Return-direction departures relative to outbound ones, s.
    offset_s: f64,
    /// Extra time added to a round trip (half per direction), s.
    extra_s: f64,
}

/// Purpose: the periodic pattern of one line in one band (a one-line periodic
/// timetable, ADR-0032 §3 step 4a, until the network PESP takes over).
/// Inputs: headway, nominal running times of both directions, minimum
/// turn-back time and the separation wanted between an arrival and a
/// departure at the same terminal.
/// Output: the return offset and extra round-trip time, on a 5 s grid,
/// chosen lexicographically: (1) at least the minimum separation; (2) the
/// fewest trains; (3) the largest separation (in 10 s steps); (4) the least
/// extra time; (5) the smallest offset. The arrival times at the two terminals sum to the
/// round-trip running time modulo the headway, so a separation can need
/// extra running time; this is how the Swiss periodic timetable sets running
/// times to fit the cycle.
fn periodic_pattern(
    h: f64,
    offsets: &[f64],
    extra: f64,
    t_out: f64,
    t_back: f64,
    turnback: f64,
    target: f64,
) -> Pattern {
    let circ = |x: f64| {
        let r = x.rem_euclid(h);
        r.min(h - r)
    };
    // Layover from an arrival at `a` (relative to the departure grid) to the first departure it can make.
    let layover = |a: f64| (-(a + turnback)).rem_euclid(h) + turnback;
    // Lexicographic key: (too close, fleet, -separation, extra time, offset).
    type Key = (f64, f64, f64, f64, f64);
    let mut best: Option<(Key, Pattern)> = None;
    // Free search on a 5 s grid, or only the given offsets with the given extra time.
    let grid: Vec<f64> = (0..(h / 5.0).ceil() as usize)
        .map(|i| i as f64 * 5.0)
        .collect();
    let (es, offs): (Vec<f64>, &[f64]) =
        if offsets.len() > 1 || offsets.first().is_some_and(|&o| o != 0.0) {
            (vec![extra], offsets)
        } else {
            (grid.clone(), &grid)
        };
    for &e in &es {
        for &off in offs {
            let far = t_out + e / 2.0 - off;
            let home = off + t_back + e / 2.0;
            let sep = circ(far).min(circ(home));
            let fleet = ((t_out + t_back + e + layover(far) + layover(home)) / h).round();
            // Separation counts in 10 s steps, so a fraction of a second never costs extra time.
            let key = (
                (sep < target) as u8 as f64,
                fleet,
                -(sep / 10.0).floor(),
                e,
                off,
            );
            if best.as_ref().map_or(true, |(k, _)| key < *k) {
                best = Some((
                    key,
                    Pattern {
                        offset_s: off,
                        extra_s: e,
                    },
                ));
            }
        }
    }
    best.map_or(
        Pattern {
            offset_s: 0.0,
            extra_s: 0.0,
        },
        |b| b.1,
    )
}

/// Placeholder holders of pull-out reservations start here (never a vehicle number).
const PRE_BASE: usize = usize::MAX / 2;

#[derive(PartialEq)]
enum Task {
    PullOut(usize),
    Trip(usize),
    PullIn(usize),
}

#[derive(PartialEq)]
struct Queued(f64, u64, Task);
impl Eq for Queued {}
impl PartialOrd for Queued {
    fn partial_cmp(&self, o: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(o))
    }
}
impl Ord for Queued {
    fn cmp(&self, o: &Self) -> std::cmp::Ordering {
        o.0.partial_cmp(&self.0)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| o.1.cmp(&self.1))
    }
}

impl<'a> Planner<'a> {
    /// Purpose: candidates with penalties for call `i` of a line direction.
    fn candidates(&self, line: usize, dir: u8, i: usize) -> Vec<Candidate> {
        // Terminal platforms alternate with the turn-backs; only through calls keep a platform.
        let last = self.cands[line][dir as usize].len() - 1;
        let mem = if i == 0 || i == last {
            None
        } else {
            self.memory.get(&(line, dir, i)).copied()
        };
        self.cands[line][dir as usize][i]
            .iter()
            .enumerate()
            .map(|(rank, &pid)| {
                let mut pen = rank as f64 * self.p.alternative_penalty_m;
                match mem {
                    Some(x) if x == pid => pen = 0.0,
                    Some(_) => pen += self.p.change_penalty_m,
                    None => {}
                }
                (Place::Platform(pid), pen)
            })
            .collect()
    }

    /// Purpose: the service path of a trip from an origin place, with platforms banned.
    fn trip_path(
        &self,
        line: usize,
        dir: u8,
        origin: Place,
        depart_dir: Dir,
        banned: &[Place],
    ) -> Option<FoundPath> {
        let n = self.cands[line][dir as usize].len();
        let calls: Vec<Vec<Candidate>> = (1..n)
            .map(|i| {
                self.candidates(line, dir, i)
                    .into_iter()
                    .filter(|(pl, _)| !banned.contains(pl))
                    .collect()
            })
            .collect();
        find_path(
            self.m,
            &departure_routes(self.m, origin, depart_dir),
            &calls,
            self.p.max_routes,
        )
    }

    /// Purpose: build a train run along a path.
    /// Inputs: line, path (routes and places), which places are stops with which
    /// dwell, departure time. The last place is the destination.
    /// Output: the run and the head position at each place.
    fn build_run(
        &self,
        line: usize,
        name: &str,
        routes: &[RouteId],
        places: &[Place],
        dwell: &[Option<f64>],
        depart_s: f64,
    ) -> Result<(TrainRun, Vec<f64>), String> {
        let l = &self.lines[line];
        let steps = route_steps(self.m, routes)?;
        let mut pos = Vec::new();
        let mut stops = Vec::new();
        for (i, &pl) in places.iter().enumerate() {
            let x = stop_at(self.m, &steps, pl, l.train.length_m, self.p.stop_margin_m)?;
            pos.push(x);
            if i + 1 < places.len() {
                if let Some(d) = dwell[i] {
                    stops.push(Stop {
                        position_m: x,
                        dwell_s: d,
                    });
                }
            }
        }
        Ok((
            TrainRun {
                name: name.into(),
                train: l.train.clone(),
                routes: routes.to_vec(),
                start_m: 0.0,
                depart_s,
                stops,
                stop_at_end: true,
                end_m: pos.last().copied(),
                occupy_until_s: None,
                supplement_share: l.supplement_share,
            },
            pos,
        ))
    }

    /// Purpose: dwell per call of a trip (None = pass), destination excluded.
    fn dwells(&self, line: usize, dir: u8) -> Vec<Option<f64>> {
        let l = &self.lines[line];
        let mut calls: Vec<_> = l.calls.iter().collect();
        if dir == 1 {
            calls.reverse();
        }
        calls[1..]
            .iter()
            .map(|c| c.stop.then(|| c.dwell_s.unwrap_or(l.dwell_s)))
            .collect()
    }

    /// Purpose: generate trips with nominal times and match them into circulations.
    fn trips(&mut self) -> Vec<Trip> {
        let mut trips = Vec::new();
        for li in 0..self.lines.len() {
            let mut t_run = [0.0f64; 2];
            for dir in 0..2u8 {
                match self.template(li, dir) {
                    Some(t) => t_run[dir as usize] = t,
                    None => {
                        self.issues.push(Issue::NoPath {
                            line: self.lines[li].id.clone(),
                            direction: dir,
                        });
                        t_run[dir as usize] = f64::NAN;
                    }
                }
            }
            if t_run.iter().any(|t| t.is_nan()) {
                continue;
            }
            let lines = self.lines;
            let l = &lines[li];
            let first = trips.len();
            let mut k = [0usize; 2];
            // The pattern of the shortest headway; longer headways that are a
            // multiple of it run a subset of its slots, so the change between
            // periods is smooth.
            let h_min = l
                .bands
                .iter()
                .map(|b| b.headway_s)
                .fold(f64::INFINITY, f64::min);
            let base = periodic_pattern(
                h_min,
                &[0.0],
                0.0,
                t_run[0],
                t_run[1],
                l.turnback_s,
                self.p.terminal_separation_s,
            );
            for b in &l.bands {
                let ratio = b.headway_s / h_min;
                let pat = match l.return_offset_s {
                    Some(o) => Pattern {
                        offset_s: o,
                        extra_s: 0.0,
                    },
                    None if (ratio - ratio.round()).abs() < 1e-6 => {
                        let offs: Vec<f64> = (0..ratio.round() as usize)
                            .map(|i| base.offset_s + i as f64 * h_min)
                            .collect();
                        periodic_pattern(
                            b.headway_s,
                            &offs,
                            base.extra_s,
                            t_run[0],
                            t_run[1],
                            l.turnback_s,
                            self.p.terminal_separation_s,
                        )
                    }
                    None => periodic_pattern(
                        b.headway_s,
                        &[],
                        0.0,
                        t_run[0],
                        t_run[1],
                        l.turnback_s,
                        self.p.terminal_separation_s,
                    ),
                };
                for dir in 0..2u8 {
                    let off = if dir == 0 { 0.0 } else { pat.offset_s };
                    let extra = pat.extra_s / 2.0;
                    let mut t = b.from_s + off;
                    while t < b.to_s + off - 1e-6 {
                        trips.push(Trip {
                            line: li,
                            dir,
                            extra_s: extra,
                            dep: t,
                            arr: t + t_run[dir as usize] + extra,
                            name: format!("{}-{}-{:03}", l.id, dir, k[dir as usize]),
                            pred: None,
                            succ: None,
                        });
                        k[dir as usize] += 1;
                        t += b.headway_s;
                    }
                }
            }
            // Minimum-layover matching at each terminal.
            for term_dir in 0..2u8 {
                // Arrivals of direction d end where direction 1 - d starts.
                let mut arr: Vec<usize> = (first..trips.len())
                    .filter(|&i| trips[i].dir == term_dir)
                    .collect();
                arr.sort_by(|&a, &b| trips[a].arr.partial_cmp(&trips[b].arr).unwrap());
                let mut dep: Vec<usize> = (first..trips.len())
                    .filter(|&i| trips[i].dir != term_dir)
                    .collect();
                dep.sort_by(|&a, &b| trips[a].dep.partial_cmp(&trips[b].dep).unwrap());
                for d in dep {
                    let td = trips[d].dep;
                    let pick = arr
                        .iter()
                        .copied()
                        .filter(|&a| {
                            trips[a].succ.is_none()
                                && trips[a].arr + l.turnback_s <= td + 1e-6
                                && td - trips[a].arr <= self.p.max_idle_s
                        })
                        .max_by(|&a, &b| trips[a].arr.partial_cmp(&trips[b].arr).unwrap());
                    if let Some(a) = pick {
                        trips[a].succ = Some(d);
                        trips[d].pred = Some(a);
                    }
                }
            }
        }
        trips
    }

    /// Purpose: nominal running time of a line direction, from the best origin platform.
    fn template(&self, line: usize, dir: u8) -> Option<f64> {
        let mut best: Option<(f64, f64)> = None;
        for (pl, _) in self.candidates(line, dir, 0) {
            for d in [Dir::Up, Dir::Down] {
                let Some(path) = self.trip_path(line, dir, pl, d, &[]) else {
                    continue;
                };
                let dw = self.dwells(line, dir);
                let Ok((run, _)) =
                    self.build_run(line, "template", &path.routes, &path.places, &dw, 0.0)
                else {
                    continue;
                };
                let Ok(t) = run_timing(self.m, &run, 0, &self.p.blocking) else {
                    continue;
                };
                let total = t.profile.total_time_s();
                if best.map_or(true, |(c, _)| path.cost < c) {
                    best = Some((path.cost, total));
                }
            }
        }
        best.map(|(_, t)| t)
    }

    fn vehicle_of(&self, run: usize) -> usize {
        self.runs[run].vehicle
    }

    /// Purpose: blocking overlaps of a set of blocks with placed runs of other vehicles.
    /// Output: (required later shift, required earlier shift, worst blocker).
    fn overlaps(
        &self,
        blocks: &[Blocking],
        vehicle: usize,
        skip: Option<usize>,
    ) -> (f64, f64, Blocker) {
        let buf = self.p.min_buffer_s;
        let mut later: f64 = 0.0;
        let mut earlier: f64 = 0.0;
        let mut who: Blocker = None;
        for b in blocks {
            let Some(v) = self.index.get(&b.tds) else {
                continue;
            };
            for &(r, s, e) in v {
                if Some(r) == skip || self.vehicle_of(r) == vehicle {
                    continue;
                }
                if b.start_s < e + buf - 1e-6 && s < b.end_s + buf - 1e-6 {
                    let l = e + buf - b.start_s;
                    let er = b.end_s + buf - s;
                    if l > later {
                        later = l;
                        who = Some((r, b.tds));
                    }
                    earlier = earlier.max(er);
                    if who.is_none() {
                        who = Some((r, b.tds));
                    }
                }
            }
        }
        for b in blocks {
            let Some(v) = self.reserved.get(&b.tds) else {
                continue;
            };
            for &(veh, s, e) in v {
                let holder_run = self.vehicles.get(veh).map(|x| x.last_run);
                if veh == vehicle || (skip.is_some() && holder_run == skip) {
                    continue;
                }
                if b.start_s < e + buf - 1e-6 && s < b.end_s + buf - 1e-6 {
                    let l = e + buf - b.start_s;
                    if l > later || who.is_none() {
                        later = later.max(l);
                        who = Some((holder_run.unwrap_or(usize::MAX), b.tds));
                    }
                    earlier = earlier.max(b.end_s + buf - s);
                }
            }
        }
        (later, earlier, who)
    }

    /// Purpose: reserve the first route a standing train will leave by
    /// (approach locking of its departure), so no other train is planned
    /// across its way out before it has left.
    fn reserve(&mut self, v: usize, route: RouteId, at_s: f64) {
        let line = self.runs[self.vehicles[v].last_run].line;
        self.reserve_route(v, line, route, at_s);
    }

    fn reserve_route(&mut self, v: usize, line: usize, route: RouteId, at_s: f64) {
        let run = TrainRun {
            name: "reservation".into(),
            train: self.lines[line].train.clone(),
            routes: vec![route],
            start_m: 0.0,
            depart_s: at_s,
            stops: vec![],
            stop_at_end: false,
            end_m: None,
            occupy_until_s: None,
            supplement_share: self.lines[line].supplement_share,
        };
        if let Ok(t) = run_timing(self.m, &run, 0, &self.p.blocking) {
            for b in t.blocking {
                self.reserved
                    .entry(b.tds)
                    .or_default()
                    .push((v, b.start_s, b.end_s));
            }
        }
    }

    /// Purpose: choose ahead the first platform of a trip that starts with a
    /// pull-out, and reserve the platform and its way out under a placeholder.
    /// Output: the platform, if one is free.
    fn pre_pull_out(&mut self, trip: &Trip, holder: usize) -> Option<Place> {
        let line = trip.line;
        let l = &self.lines[line];
        for (cand, _) in self.candidates(line, trip.dir, 0) {
            // Reachable from a stabling track of the line?
            let reach = self.stacks.iter().any(|s| {
                l.stabling.contains(&self.m.tracks[s.track].id)
                    && [Dir::Up, Dir::Down].iter().any(|&d| {
                        let st = departure_routes(self.m, Place::Storage(s.track), d);
                        !st.is_empty()
                            && find_path(self.m, &st, &[vec![(cand, 0.0)]], self.p.max_routes)
                                .is_some()
                    })
            });
            if !reach {
                continue;
            }
            for d in [Dir::Up, Dir::Down] {
                let Some(first) = self
                    .trip_path(line, trip.dir, cand, d, &[])
                    .and_then(|p| p.routes.first().copied())
                else {
                    continue;
                };
                let hold =
                    self.platform_hold(cand, trip.dep - self.p.pull_out_margin_s - 60.0, trip.dep);
                if !self.way_out_free(line, first, trip.dep)
                    || self.overlaps(&hold, usize::MAX, None).2.is_some()
                {
                    continue;
                }
                for b in hold {
                    self.reserved
                        .entry(b.tds)
                        .or_default()
                        .push((holder, b.start_s, b.end_s));
                }
                self.reserve_route(holder, line, first, trip.dep);
                return Some(cand);
            }
        }
        None
    }

    /// Purpose: blocking of a platform's sections over an interval.
    fn platform_hold(&self, place: Place, from_s: f64, to_s: f64) -> Vec<Blocking> {
        let (track, a, b) = place.range(self.m);
        let mut out: Vec<Blocking> = Vec::new();
        for &pc in self.m.track_pieces(track) {
            let p = &self.m.pieces[pc as usize];
            if p.to_m > a && p.from_m < b && !out.iter().any(|x| x.tds == p.tds) {
                out.push(Blocking {
                    train: usize::MAX,
                    route: 0,
                    tds: p.tds,
                    start_s: from_s,
                    end_s: to_s,
                    overlap: false,
                });
            }
        }
        out
    }

    /// Purpose: whether a departure route is free of other trains at a time.
    fn way_out_free(&self, line: usize, route: RouteId, at_s: f64) -> bool {
        let run = TrainRun {
            name: "probe".into(),
            train: self.lines[line].train.clone(),
            routes: vec![route],
            start_m: 0.0,
            depart_s: at_s,
            stops: vec![],
            stop_at_end: false,
            end_m: None,
            occupy_until_s: None,
            supplement_share: self.lines[line].supplement_share,
        };
        match run_timing(self.m, &run, 0, &self.p.blocking) {
            Ok(t) => self.overlaps(&t.blocking, usize::MAX, None).2.is_none(),
            Err(_) => false,
        }
    }

    fn unreserve(&mut self, v: usize) {
        for x in self.reserved.values_mut() {
            x.retain(|e| e.0 != v);
        }
    }

    /// Purpose: reserve the way out of a train that has just arrived at a terminal.
    fn reserve_way_out(&mut self, v: usize, next: Option<&Trip>, at_s: f64) {
        let ve = self.vehicles[v].clone();
        let dir = ve.arrive_dir.reverse();
        let first = match next {
            Some(t) => self
                .trip_path(t.line, t.dir, ve.at, dir, &[])
                .and_then(|p| p.routes.first().copied()),
            None => {
                let line = self.runs[ve.last_run].line;
                let start = departure_routes(self.m, ve.at, dir);
                self.stacks
                    .iter()
                    .filter(|s| {
                        self.lines[line]
                            .stabling
                            .contains(&self.m.tracks[s.track].id)
                    })
                    .filter_map(|s| {
                        find_path(
                            self.m,
                            &start,
                            &[vec![(Place::Storage(s.track), 0.0)]],
                            self.p.max_routes,
                        )
                    })
                    .min_by(|a, b| a.cost.partial_cmp(&b.cost).unwrap())
                    .and_then(|p| p.routes.first().copied())
            }
        };
        if let Some(r) = first {
            self.reserve(v, r, at_s);
        }
    }

    fn add_index(&mut self, run: usize) {
        for b in &self.runs[run].blocking {
            self.index
                .entry(b.tds)
                .or_default()
                .push((run, b.start_s, b.end_s));
        }
    }

    fn remove_index(&mut self, run: usize) {
        for v in self.index.values_mut() {
            v.retain(|x| x.0 != run);
        }
    }

    /// Purpose: find a conflict-free departure for a run.
    /// Inputs: a run builder per departure time, the ideal departure, the
    /// search direction (later or earlier), the shift limit, the vehicle, and
    /// the vehicle's previous run (its occupation is extended to the departure).
    /// Output: the timing and departure, or the blocker.
    #[allow(clippy::too_many_arguments)]
    fn search_time(
        &self,
        mk: &dyn Fn(f64) -> TrainRun,
        ideal: f64,
        later: bool,
        max_shift: f64,
        vehicle: usize,
        prev: Option<usize>,
        index_as: usize,
    ) -> Result<(RunTiming, f64, Option<RunTiming>), (String, Blocker)> {
        let mut t = ideal;
        let mut last_who: Blocker = None;
        for _ in 0..60 {
            if (t - ideal).abs() > max_shift + 1e-6 {
                break;
            }
            let run = mk(t);
            let timing =
                run_timing(self.m, &run, index_as, &self.p.blocking).map_err(|e| (e, None))?;
            let (l, e, who) = self.overlaps(&timing.blocking, vehicle, None);
            if who.is_some() {
                last_who = who;
                if later {
                    t += l.max(1.0);
                } else {
                    t -= e.max(1.0);
                }
                continue;
            }
            // Extend the previous run's occupation of its last place to this departure.
            let mut prev_t = None;
            if let Some(pr) = prev {
                let mut r = self.runs[pr].run.clone();
                r.occupy_until_s = Some(t);
                let pt = run_timing(self.m, &r, pr, &self.p.blocking).map_err(|e| (e, None))?;
                let (_, _, who) = self.overlaps(&pt.blocking, vehicle, Some(pr));
                if who.is_some() {
                    return Err((
                        "the train cannot wait in its platform that long".into(),
                        who,
                    ));
                }
                prev_t = Some(pt);
            }
            return Ok((timing, t, prev_t));
        }
        Err((
            format!("no conflict-free slot within {max_shift:.0} s"),
            last_who,
        ))
    }

    /// Purpose: commit a placed run (and the extended previous run).
    fn commit(
        &mut self,
        mut pr: PlannedRun,
        timing: RunTiming,
        prev: Option<(usize, RunTiming)>,
    ) -> usize {
        let idx = self.runs.len();
        self.unreserve(pr.vehicle);
        // Call times from the profile.
        let n = pr.calls.len();
        let mut k = 0;
        for (i, c) in pr.calls.iter_mut().enumerate() {
            if i == 0 {
                c.depart_s = Some(pr.run.depart_s);
            } else if i + 1 == n {
                c.arrive_s = Some(pr.run.depart_s + timing.profile.total_time_s());
            } else if c.stop {
                let (a, d) = timing.profile.stops[k];
                k += 1;
                c.arrive_s = Some(pr.run.depart_s + a);
                c.depart_s = Some(pr.run.depart_s + d);
            }
        }
        pr.blocking = timing.blocking;
        self.runs.push(pr);
        if let Some((p, pt)) = prev {
            self.remove_index(p);
            let until = self.runs[idx].run.depart_s;
            self.runs[p].run.occupy_until_s = Some(until);
            if let Some(last) = self.runs[p].calls.last_mut() {
                last.depart_s = Some(until);
            }
            self.runs[p].blocking = pt.blocking;
            self.add_index(p);
        }
        self.add_index(idx);
        idx
    }

    fn blocker_text(&self, who: Blocker) -> (Option<String>, Option<String>) {
        match who {
            Some((r, t)) => (
                Some(
                    self.runs
                        .get(r)
                        .map_or("a train being brought out of stabling".into(), |x| {
                            x.name.clone()
                        }),
                ),
                Some(self.m.tds[t as usize].id.clone()),
            ),
            None => (None, None),
        }
    }

    /// Purpose: place every trip, with pull-outs and pull-ins.
    fn construct(&mut self, mut trips: Vec<Trip>) {
        let mut queue = BinaryHeap::new();
        let mut seq = 0u64;
        for (i, t) in trips.iter().enumerate() {
            queue.push(Queued(t.dep, seq, Task::Trip(i)));
            seq += 1;
        }
        // Pull-outs are planned ahead of the trips they serve, so the train is in
        // its platform (and its way out reserved) before later trains are placed.
        for (i, t) in trips.iter().enumerate() {
            if t.pred.is_none() {
                let lead = self.lines[t.line].turnback_s + 300.0;
                queue.push(Queued(t.dep - lead, seq, Task::PullOut(i)));
                seq += 1;
            }
        }
        let mut trip_vehicle: Vec<Option<usize>> = vec![None; trips.len()];
        let mut pulled: HashMap<usize, Place> = HashMap::new();
        while let Some(Queued(_, _, task)) = queue.pop() {
            match task {
                Task::PullOut(i) => {
                    // Choose the first platform now and reserve it with its way
                    // out, so trains placed before the trip leave room for it;
                    // the pull-out run itself is placed with the trip.
                    if let Some(origin) = self.pre_pull_out(&trips[i], PRE_BASE + i) {
                        pulled.insert(i, origin);
                    }
                }
                Task::Trip(i) => {
                    let pred_v = trips[i].pred.and_then(|a| trip_vehicle[a]);
                    // The train holds its last platform until its next departure.
                    let hold = match trips[i].succ {
                        Some(s) => trips[s].dep,
                        None => trips[i].arr + self.lines[trips[i].line].turnback_s,
                    };
                    self.unreserve(PRE_BASE + i);
                    match self.place_trip(&trips[i], pred_v, pulled.remove(&i), hold) {
                        Ok(v) => {
                            trip_vehicle[i] = Some(v);
                            let next = trips[i].succ.map(|s| trips[s].clone());
                            let out_at = match &next {
                                Some(n) => n.dep,
                                None => {
                                    self.vehicles[v].ready_s + self.lines[trips[i].line].turnback_s
                                }
                            };
                            // A train going to stabling can wait for a gap, so only a
                            // train with a next trip has its way out reserved.
                            if next.is_some() {
                                self.reserve_way_out(v, next.as_ref(), out_at);
                            }
                            if trips[i].succ.is_none() {
                                let at =
                                    self.vehicles[v].ready_s + self.lines[trips[i].line].turnback_s;
                                queue.push(Queued(at, seq, Task::PullIn(v)));
                                seq += 1;
                            }
                        }
                        Err(left) => {
                            // The trip is cancelled; the next trip of the circulation
                            // starts with a pull-out, and a train left at the origin goes to stabling.
                            if let Some(s) = trips[i].succ {
                                trips[s].pred = None;
                            }
                            if let Some(v) = left {
                                queue.push(Queued(
                                    self.vehicles[v].ready_s + self.lines[trips[i].line].turnback_s,
                                    seq,
                                    Task::PullIn(v),
                                ));
                                seq += 1;
                            }
                        }
                    }
                }
                Task::PullIn(v) => self.pull_in(v),
            }
        }
    }

    /// Purpose: place one trip. Inputs: the trip and the vehicle of its predecessor.
    /// Output: the vehicle that runs it, or Err with the vehicle left standing (if any).
    fn place_trip(
        &mut self,
        trip: &Trip,
        pred_v: Option<usize>,
        pre_origin: Option<Place>,
        hold_until: f64,
    ) -> Result<usize, Option<usize>> {
        let lines = self.lines;
        let l = &lines[trip.line];
        let mut dwells = self.dwells(trip.line, trip.dir);
        // Hold the pattern's extra time at the last intermediate stop (a timing point).
        let n = dwells.len();
        if let Some(d) = dwells[..n.saturating_sub(1)]
            .iter_mut()
            .rev()
            .find_map(|d| d.as_mut())
        {
            *d += trip.extra_s;
        }
        match pred_v {
            Some(v) => {
                let ve = self.vehicles[v].clone();
                let earliest = trip.dep.max(ve.ready_s + l.turnback_s);
                match self.try_trip(
                    trip,
                    &dwells,
                    ve.at,
                    ve.arrive_dir.reverse(),
                    earliest,
                    v,
                    ve.last_run,
                    hold_until,
                ) {
                    Ok(()) => Ok(v),
                    Err(e) => {
                        self.unplaced(trip, e.0, e.1);
                        Err(Some(v))
                    }
                }
            }
            None => {
                // A train from stabling: the one pulled out ahead, then each first platform it can reach.
                let mut banned: Vec<Place> = Vec::new();
                let mut first_err: Option<(String, Blocker)> = None;
                let mut pre = pre_origin;
                loop {
                    let got = match pre.take() {
                        Some(o) => {
                            // The platform chosen ahead first.
                            let others: Vec<Place> = self
                                .candidates(trip.line, trip.dir, 0)
                                .into_iter()
                                .map(|c| c.0)
                                .filter(|&c| c != o)
                                .collect();
                            match self.pull_out(trip, &others) {
                                Ok(x) => Ok(x),
                                Err(_) => self.pull_out(trip, &banned),
                            }
                        }
                        None => self.pull_out(trip, &banned),
                    };
                    match got {
                        Ok((po, v)) => {
                            let ve = self.vehicles[v].clone();
                            let earliest = trip.dep.max(ve.ready_s + self.p.pull_out_margin_s);
                            match self.try_trip(
                                trip,
                                &dwells,
                                ve.at,
                                ve.arrive_dir.reverse(),
                                earliest,
                                v,
                                po,
                                hold_until,
                            ) {
                                Ok(()) => return Ok(v),
                                Err(e) => {
                                    self.unplace_pull_out(po, v);
                                    banned.push(ve.at);
                                    first_err.get_or_insert(e);
                                }
                            }
                        }
                        Err((reason, who)) => {
                            let e = first_err.unwrap_or((format!("no train: {reason}"), who));
                            self.unplaced(trip, e.0, e.1);
                            return Err(None);
                        }
                    }
                }
            }
        }
    }

    fn unplaced(&mut self, trip: &Trip, reason: String, who: Blocker) {
        let (b, s) = self.blocker_text(who);
        self.issues.push(Issue::Unplaced {
            trip: trip.name.clone(),
            reason,
            blocked_by: b,
            section: s,
        });
    }

    /// Purpose: place a trip from a given origin with its train; commits on success.
    #[allow(clippy::too_many_arguments)]
    fn try_trip(
        &mut self,
        trip: &Trip,
        dwells: &[Option<f64>],
        origin: Place,
        depart_dir: Dir,
        earliest: f64,
        vehicle: usize,
        prev_run: usize,
        hold_until: f64,
    ) -> Result<(), (String, Blocker)> {
        let prev = Some(prev_run);
        // Paths to try: the best, then each with one of its platforms banned.
        let mut attempts: Vec<FoundPath> = Vec::new();
        if let Some(best) = self.trip_path(trip.line, trip.dir, origin, depart_dir, &[]) {
            for pl in &best.places {
                if let Some(alt) = self.trip_path(trip.line, trip.dir, origin, depart_dir, &[*pl]) {
                    if !attempts.iter().any(|a| a.routes == alt.routes) && alt.routes != best.routes
                    {
                        attempts.push(alt);
                    }
                }
            }
            attempts.insert(0, best);
        }
        let mut last_err: (String, Blocker) = ("no path through the calls".to_string(), None);
        let mut first_err: Option<(String, Blocker)> = None;
        // Each path is searched for its earliest conflict-free departure; the one
        // that departs earliest wins (another platform before a later departure).
        let mut best: Option<(f64, usize, TrainRun, RunTiming, Option<RunTiming>)> = None;
        for (ai, path) in attempts.iter().enumerate() {
            let built = self.build_run(
                trip.line,
                &trip.name,
                &path.routes,
                &path.places,
                dwells,
                0.0,
            );
            let Ok((base, _)) = built else {
                last_err = (built.err().unwrap(), None);
                continue;
            };
            let mk = |t: f64| TrainRun {
                depart_s: t,
                occupy_until_s: Some(hold_until + (t - trip.dep).max(0.0)),
                ..base.clone()
            };
            let idx = self.runs.len();
            match self.search_time(&mk, earliest, true, self.p.max_shift_s, vehicle, prev, idx) {
                Ok((timing, t, prev_t)) => {
                    if best.as_ref().map_or(true, |b| t < b.0 - 0.5) {
                        best = Some((t, ai, mk(t), timing, prev_t));
                    }
                    if t <= earliest + 0.5 {
                        break;
                    }
                }
                Err(e) => {
                    if first_err.is_none() {
                        first_err = Some(e.clone());
                    }
                    last_err = e;
                }
            }
        }
        if let Some((t, ai, run, timing, prev_t)) = best {
            let path = &attempts[ai];
            let mut places = vec![origin];
            places.extend(path.places.iter().copied());
            let mut dw = vec![None];
            dw.extend(dwells.iter().copied());
            let calls = self.call_list(&places, &dw);
            let steps = route_steps(self.m, &path.routes).unwrap_or_default();
            let end = *places.last().unwrap();
            let pr = PlannedRun {
                name: trip.name.clone(),
                line: trip.line,
                kind: RunKind::Service,
                direction: trip.dir,
                vehicle,
                planned_depart_s: trip.dep,
                run,
                calls,
                blocking: Vec::new(),
            };
            let i = self.commit(pr, timing, prev.zip(prev_t));
            if (t - trip.dep).abs() > 0.5 {
                self.issues.push(Issue::Shifted {
                    run: trip.name.clone(),
                    by_s: t - trip.dep,
                });
            }
            self.remember(trip, &path.places);
            let arr = self.runs[i].arrive_s();
            self.vehicles[vehicle] = Vehicle {
                at: end,
                arrive_dir: arrival_dir(self.m, &steps, end).unwrap_or(Dir::Up),
                ready_s: arr,
                last_run: i,
            };
            return Ok(());
        }
        Err(first_err.unwrap_or(last_err))
    }

    fn call_list(&self, places: &[Place], dwell: &[Option<f64>]) -> Vec<CallTime> {
        places
            .iter()
            .enumerate()
            .map(|(i, &pl)| CallTime {
                place: pl,
                id: pl.id(self.m),
                stop: i == 0 || i + 1 == places.len() || dwell.get(i).copied().flatten().is_some(),
                arrive_s: None,
                depart_s: None,
            })
            .collect()
    }

    /// Purpose: remember the platforms a line uses, and report changes.
    fn remember(&mut self, trip: &Trip, places: &[Place]) {
        let n = places.len();
        for (k, pl) in places.iter().enumerate() {
            let Place::Platform(pid) = *pl else { continue };
            let key = (trip.line, trip.dir, k + 1);
            match self.memory.get(&key) {
                None => {
                    self.memory.insert(key, pid);
                }
                Some(&u) if u != pid && k + 1 < n => {
                    self.issues.push(Issue::PlatformChange {
                        trip: trip.name.clone(),
                        usual: self.m.platforms[u as usize].id.clone(),
                        used: self.m.platforms[pid as usize].id.clone(),
                    });
                }
                _ => {}
            }
        }
    }

    fn unplace_pull_out(&mut self, run: usize, vehicle: usize) {
        self.remove_index(run);
        // Push the train back onto its track.
        let track = match self.runs[run].calls.first().map(|c| c.place) {
            Some(Place::Storage(t)) => t,
            _ => return,
        };
        self.runs[run].blocking.clear();
        self.runs[run].calls.clear();
        self.runs[run].name = format!("{} (cancelled)", self.runs[run].name);
        if let Some(s) = self.stacks.iter_mut().find(|s| s.track == track) {
            s.now.push(vehicle);
        }
    }

    /// Purpose: bring a train from stabling to the origin of a trip.
    /// Output: (pull-out run index, vehicle), or Err with the reason and blocker.
    fn pull_out(
        &mut self,
        trip: &Trip,
        banned: &[Place],
    ) -> Result<(usize, usize), (String, Blocker)> {
        let lines = self.lines;
        let l = &lines[trip.line];
        let origin_c = self.candidates(trip.line, trip.dir, 0);
        // Options: (cost, stack index, path, dir).
        let mut opts: Vec<(f64, usize, FoundPath)> = Vec::new();
        for (si, s) in self.stacks.iter().enumerate() {
            if !l.stabling.contains(&self.m.tracks[s.track].id) {
                continue;
            }
            let has = !s.now.is_empty();
            if !has && s.morning.len() >= s.capacity {
                continue;
            }
            for d in [Dir::Up, Dir::Down] {
                let start = departure_routes(self.m, Place::Storage(s.track), d);
                if start.is_empty() {
                    continue;
                }
                for cand in origin_c.iter().filter(|c| !banned.contains(&c.0)) {
                    if let Some(fp) = find_path(self.m, &start, &[vec![*cand]], self.p.max_routes) {
                        // Reuse a train already out of the morning stabling first.
                        let c = fp.cost + if has { 0.0 } else { 1.0e5 };
                        opts.push((c, si, fp));
                    }
                }
            }
        }
        opts.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap().then(a.1.cmp(&b.1)));
        if opts.is_empty() {
            return Err((
                "no stabling track reaches a free first platform".into(),
                None,
            ));
        }
        let mut last = ("".to_string(), None);
        let mut opts_left = opts.len();
        for (_, si, fp) in opts {
            let track = self.stacks[si].track;
            let origin = fp.places[0];
            // Pull-out must also leave a service path from that platform.
            let steps = route_steps(self.m, &fp.routes).unwrap_or_default();
            let adir = arrival_dir(self.m, &steps, origin).unwrap_or(Dir::Up);
            let Some(first) = self
                .trip_path(trip.line, trip.dir, origin, adir.reverse(), &[])
                .and_then(|p| p.routes.first().copied())
            else {
                continue;
            };
            // Prefer a platform whose way out is free at the departure.
            if !self.way_out_free(trip.line, first, trip.dep) && opts_left > 1 {
                opts_left -= 1;
                continue;
            }
            let name = format!("{}-po", trip.name);
            let Ok((base, _)) = self.build_run(trip.line, &name, &fp.routes, &[origin], &[], 0.0)
            else {
                continue;
            };
            let probe = run_timing(self.m, &base, 0, &self.p.blocking);
            let Ok(probe) = probe else { continue };
            let dur = probe.profile.total_time_s();
            let ideal = trip.dep - self.p.pull_out_margin_s - dur;
            let base2 = TrainRun {
                occupy_until_s: Some(trip.dep),
                ..base
            };
            let mk = |t: f64| TrainRun {
                depart_s: t,
                occupy_until_s: Some(trip.dep.max(t + dur)),
                ..base2.clone()
            };
            // The vehicle: the front train, or a new one in the morning stabling.
            let s = &self.stacks[si];
            let vehicle = s.now.last().copied().unwrap_or(self.vehicles.len());
            let idx = self.runs.len();
            match self.search_time(
                &mk,
                ideal,
                false,
                self.p.max_depot_shift_s,
                vehicle,
                None,
                idx,
            ) {
                Ok((timing, t, _)) => {
                    let s = &mut self.stacks[si];
                    if s.now.pop().is_none() {
                        s.morning.push(vehicle);
                        self.vehicles.push(Vehicle {
                            at: Place::Storage(track),
                            arrive_dir: Dir::Up,
                            ready_s: 0.0,
                            last_run: 0,
                        });
                    }
                    let calls = self.call_list(&[Place::Storage(track), origin], &[None, None]);
                    let pr = PlannedRun {
                        name,
                        line: trip.line,
                        kind: RunKind::PullOut,
                        direction: trip.dir,
                        vehicle,
                        planned_depart_s: ideal,
                        run: mk(t),
                        calls,
                        blocking: Vec::new(),
                    };
                    let i = self.commit(pr, timing, None);
                    self.vehicles[vehicle] = Vehicle {
                        at: origin,
                        arrive_dir: adir,
                        ready_s: self.runs[i].arrive_s(),
                        last_run: i,
                    };
                    return Ok((i, vehicle));
                }
                Err(e) => last = e,
            }
        }
        Err((format!("pull-out: {}", last.0), last.1))
    }

    /// Purpose: take a train from its last platform to stabling.
    fn pull_in(&mut self, v: usize) {
        let ve = self.vehicles[v].clone();
        let line = self.runs[ve.last_run].line;
        let lines = self.lines;
        let l = &lines[line];
        let dir = ve.arrive_dir.reverse();
        let start = departure_routes(self.m, ve.at, dir);
        let mut opts: Vec<(f64, usize, FoundPath)> = Vec::new();
        for (si, s) in self.stacks.iter().enumerate() {
            if !l.stabling.contains(&self.m.tracks[s.track].id) || s.now.len() >= s.capacity {
                continue;
            }
            if let Some(fp) = find_path(
                self.m,
                &start,
                &[vec![(Place::Storage(s.track), 0.0)]],
                self.p.max_routes,
            ) {
                opts.push((fp.cost, si, fp));
            }
        }
        opts.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap().then(a.1.cmp(&b.1)));
        let ideal = ve.ready_s + l.turnback_s;
        let mut why = "no stabling track with room is reachable".to_string();
        for (_, si, fp) in opts {
            let track = self.stacks[si].track;
            let name = format!("{}-pi", self.runs[ve.last_run].name);
            let Ok((base, _)) =
                self.build_run(line, &name, &fp.routes, &[Place::Storage(track)], &[], 0.0)
            else {
                continue;
            };
            let mk = |t: f64| TrainRun {
                depart_s: t,
                ..base.clone()
            };
            let idx = self.runs.len();
            // Later first (the train waits for a gap); if it cannot wait that
            // long in its platform, leave earlier, after a short margin.
            let found = self
                .search_time(
                    &mk,
                    ideal,
                    true,
                    self.p.max_depot_shift_s,
                    v,
                    Some(ve.last_run),
                    idx,
                )
                .or_else(|_| {
                    let room = (ideal - ve.ready_s - 60.0).max(0.0);
                    self.search_time(&mk, ideal, false, room, v, Some(ve.last_run), idx)
                });
            match found {
                Ok((timing, t, prev_t)) => {
                    let calls = self.call_list(&[ve.at, Place::Storage(track)], &[None, None]);
                    let pr = PlannedRun {
                        name,
                        line,
                        kind: RunKind::PullIn,
                        direction: self.runs[ve.last_run].direction,
                        vehicle: v,
                        planned_depart_s: ideal,
                        run: mk(t),
                        calls,
                        blocking: Vec::new(),
                    };
                    let i = self.commit(pr, timing, Some(ve.last_run).zip(prev_t));
                    self.stacks[si].now.push(v);
                    self.vehicles[v] = Vehicle {
                        at: Place::Storage(track),
                        arrive_dir: dir,
                        ready_s: self.runs[i].arrive_s(),
                        last_run: i,
                    };
                    return;
                }
                Err(e) => why = e.0,
            }
        }
        self.issues.push(Issue::NotStabled {
            vehicle: v,
            at: ve.at.id(self.m),
            reason: why,
        });
    }
}
