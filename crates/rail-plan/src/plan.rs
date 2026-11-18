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

use std::cell::RefCell;
use std::collections::{BTreeMap, BinaryHeap, HashMap, HashSet};

use rail_dynamics::Stop;
use rail_model::{Dir, Model, PieceId, PlatformId, RouteId, TdsId};
use serde::Serialize;

use crate::blocking::{
    route_steps, run_profile, timing_with_profile, Blocking, BlockingParams, RunTiming, TrainRun,
};
use crate::line::{resolve, LineSpec};
use crate::path::{
    arrival_dir, departure_routes, find_path, find_path_costed, stop_at, Candidate, FoundPath,
    Place,
};
use rail_dynamics::SpeedProfile;

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
        /// Why trains cannot run it when track does join the stops (a platform too short for the
        /// train, a gradient it cannot climb); None when no track joins them.
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
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
    /// An end-station siding where trains only wait between trips: none stays overnight.
    layover: bool,
}

/// Sections a run blocks, with start and end relative to its departure, s.
type Blocks = Vec<(TdsId, f64, f64)>;

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
    /// The terminal platform each line direction arrives in: the one its trains leave from on the
    /// track the other direction runs on.
    ends: HashMap<(usize, u8), PlatformId>,
    /// The track pieces each line direction's usual run passes, with the direction it runs them in.
    heads: HashMap<(usize, u8), HashSet<(PieceId, Dir)>>,
    vehicles: Vec<Vehicle>,
    stacks: Vec<Stack>,
    /// Departure routes reserved for trains standing in a platform: (vehicle, start, end) per section.
    reserved: BTreeMap<TdsId, Vec<(usize, f64, f64)>>,
    /// Speed profiles already worked out, by [`profile_key`]: the search for a free slot tries a
    /// run at many departure times, and the profile does not change with the time.
    profiles: RefCell<HashMap<String, SpeedProfile>>,
    /// Trip paths already found ([`Planner::trip_path`]), by line, direction, origin, departure
    /// direction and banned places.
    paths: RefCell<TripPaths>,
    /// Depot paths already found ([`Planner::depot_path`]), dropped with the trip paths.
    depot_paths: RefCell<DepotPaths>,
}

type TripPaths = HashMap<(usize, u8, Place, Dir, Vec<Place>), Option<FoundPath>>;
type DepotPaths = HashMap<(usize, u8, Vec<RouteId>, Vec<(Place, u64)>, bool), Option<FoundPath>>;

/// Purpose: what a run's speed profile depends on ([`run_profile`]), as a map key: everything
/// but its name, departure time and how long it stays at the end.
fn profile_key(r: &TrainRun) -> String {
    format!(
        "{:?}|{:?}|{:?}|{:?}|{:?}|{}|{:?}",
        r.train, r.routes, r.start_m, r.end_m, r.stops, r.stop_at_end, r.supplement_share
    )
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
                layover: lines.iter().any(|x| x.layover.contains(s)),
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
        ends: HashMap::new(),
        heads: HashMap::new(),
        vehicles: Vec::new(),
        stacks,
        reserved: BTreeMap::new(),
        profiles: RefCell::new(HashMap::new()),
        paths: RefCell::new(HashMap::new()),
        depot_paths: RefCell::new(HashMap::new()),
    };
    let trips = pl.trips();
    pl.construct(trips);
    pl.clear_layovers();
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
#[allow(clippy::too_many_arguments)]
fn periodic_pattern(
    h: f64,
    offsets: &[f64],
    extra: f64,
    t_out: f64,
    t_back: f64,
    turnback: f64,
    target: f64,
    meets: &dyn Fn(f64, f64) -> bool,
) -> Pattern {
    let circ = |x: f64| {
        let r = x.rem_euclid(h);
        r.min(h - r)
    };
    // Layover from an arrival at `a` (relative to the departure grid) to the first departure it can make.
    let layover = |a: f64| (-(a + turnback)).rem_euclid(h) + turnback;
    // Lexicographic key: (too close, the directions meet, fleet, -separation, extra time, offset).
    type Key = (f64, f64, f64, f64, f64, f64);
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
                meets(off, e) as u8 as f64,
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
        let mem = if i == 0 {
            None
        } else if i == last {
            self.ends.get(&(line, dir)).copied()
        } else {
            self.memory.get(&(line, dir, i)).copied()
        };
        // The track the other direction stops on here: running on it too puts both directions on one
        // track of a double track, where every train meets the one coming the other way (Damascus T1).
        let other = if i == 0 || i == last {
            None
        } else {
            self.memory
                .get(&(line, 1 - dir, last - i))
                .map(|&p| self.m.platforms[p as usize].track)
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
                if mem.is_none() && other == Some(self.m.platforms[pid as usize].track) {
                    pen += self.p.change_penalty_m;
                }
                (Place::Platform(pid), pen)
            })
            .collect()
    }

    /// Purpose: the service path of a trip from an origin place, with platforms banned.
    /// The search depends on the platforms the line remembers, so the answers kept in
    /// [`Planner::paths`] are dropped whenever those change ([`Planner::set_platform`]).
    fn trip_path(
        &self,
        line: usize,
        dir: u8,
        origin: Place,
        depart_dir: Dir,
        banned: &[Place],
    ) -> Option<FoundPath> {
        let key = (line, dir, origin, depart_dir, banned.to_vec());
        if let Some(found) = self.paths.borrow().get(&key) {
            return found.clone();
        }
        let found = self.find_trip_path(line, dir, origin, depart_dir, banned);
        self.paths.borrow_mut().insert(key, found.clone());
        found
    }

    /// Purpose: remember the platform a line direction uses at a call (`None`: its last call, the
    /// terminal it arrives in), dropping the kept trip paths when it changes.
    fn set_platform(&mut self, line: usize, dir: u8, call: Option<usize>, pid: PlatformId) {
        let old = match call {
            Some(k) => self.memory.insert((line, dir, k), pid),
            None => self.ends.insert((line, dir), pid),
        };
        if old != Some(pid) {
            self.forget_paths();
        }
    }

    /// Purpose: drop the kept trip and depot paths, after the remembered platforms changed.
    fn forget_paths(&self) {
        self.paths.borrow_mut().clear();
        self.depot_paths.borrow_mut().clear();
    }

    /// Purpose: [`Planner::trip_path`] without the kept answers.
    fn find_trip_path(
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
        // Track the other direction runs the other way costs its length again, so where two ways
        // lead out of a terminal the train takes the crossover onto its own track rather than
        // running back along the arrival track to one further on (Damascus test, bug 25).
        let against = self.heads.get(&(line, 1 - dir));
        let extra = |r: RouteId| -> f64 {
            let Some(a) = against else {
                return 0.0;
            };
            self.m.routes[r as usize]
                .steps
                .iter()
                .filter(|st| a.contains(&(st.piece, st.dir.reverse())))
                .map(|st| self.m.pieces[st.piece as usize].length_m())
                .sum()
        };
        find_path_costed(
            self.m,
            &departure_routes(self.m, origin, depart_dir),
            &calls,
            self.p.max_routes,
            &extra,
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

    /// Purpose: the path of a depot run along the line, through the platforms the line's trains use
    /// when they run the same way, so a train going to or from the depot runs on the right track behind
    /// the service trains instead of the shortest way, which can be against them (Damascus T1, bug 9).
    /// Inputs: the line, the direction `e` of travel, the routes the run can start with, the candidates
    /// for its end, and whether it ends at the end of direction `e` (a pull-out to a terminal) or starts
    /// at its start (a pull-in). Output: the path, its places being the platforms passed and then the
    /// end; the plain shortest path when no path along the line is short enough.
    fn depot_path(
        &self,
        line: usize,
        e: u8,
        start: &[RouteId],
        end: &[Candidate],
        to_terminal: bool,
    ) -> Option<FoundPath> {
        let ends: Vec<(Place, u64)> = end.iter().map(|&(p, c)| (p, c.to_bits())).collect();
        let key = (line, e, start.to_vec(), ends, to_terminal);
        if let Some(found) = self.depot_paths.borrow().get(&key) {
            return found.clone();
        }
        let found = self.find_depot_path(line, e, start, end, to_terminal);
        self.depot_paths.borrow_mut().insert(key, found.clone());
        found
    }

    /// Purpose: [`Planner::depot_path`] without the kept answers.
    fn find_depot_path(
        &self,
        line: usize,
        e: u8,
        start: &[RouteId],
        end: &[Candidate],
        to_terminal: bool,
    ) -> Option<FoundPath> {
        let shortest = find_path(self.m, start, &[end.to_vec()], self.p.max_routes)?;
        let last = self.cands[line][e as usize].len() - 1;
        let via: Vec<Place> = (1..last)
            .filter_map(|i| self.memory.get(&(line, e, i)).map(|&p| Place::Platform(p)))
            .collect();
        let limit = shortest.cost * 1.5 + 1000.0;
        // The longest stretch of the line first.
        for k in (1..=via.len()).rev() {
            let part = if to_terminal {
                &via[via.len() - k..]
            } else {
                &via[..k]
            };
            let mut calls: Vec<Vec<Candidate>> = part.iter().map(|&p| vec![(p, 0.0)]).collect();
            calls.push(end.to_vec());
            if let Some(fp) = find_path(self.m, start, &calls, self.p.max_routes) {
                if fp.cost <= limit {
                    return Some(fp);
                }
            }
        }
        Some(shortest)
    }

    /// Purpose: the runs a depot run can make along its path: straight through first, then stopping at
    /// the platforms it passes for the line's dwell, as a service train does, so it can follow one along
    /// the line instead of catching it up. Inputs: the line, the run's name and its path (the last place
    /// is its end). Output: the runs, without a departure time.
    fn depot_variants(&self, line: usize, name: &str, fp: &FoundPath) -> Vec<TrainRun> {
        let end = *fp.places.last().unwrap();
        let mut out = Vec::new();
        if let Ok((plain, _)) = self.build_run(line, name, &fp.routes, &[end], &[], 0.0) {
            out.push(plain);
        }
        if fp.places.len() > 1 {
            let mut dw = vec![Some(self.lines[line].dwell_s); fp.places.len() - 1];
            dw.push(None);
            if let Ok((stopping, _)) = self.build_run(line, name, &fp.routes, &fp.places, &dw, 0.0)
            {
                out.push(stopping);
            }
        }
        out
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
        // Nominal occupation of the lines phased so far, per section, sorted by start.
        let mut placed: HashMap<TdsId, Vec<(f64, f64)>> = HashMap::new();
        for li in 0..self.lines.len() {
            self.seed_tracks(li);
            let mut t_run = [0.0f64; 2];
            let mut blocks: [Vec<(TdsId, f64, f64)>; 2] = [Vec::new(), Vec::new()];
            for dir in 0..2u8 {
                match self.template_run(li, dir) {
                    Ok((t, b, routes)) => {
                        t_run[dir as usize] = t;
                        blocks[dir as usize] = b;
                        // The other direction's paths avoid running against this one.
                        let heads = route_steps(self.m, &routes)
                            .unwrap_or_default()
                            .iter()
                            .map(|st| (st.piece, st.dir))
                            .collect();
                        self.heads.insert((li, dir), heads);
                        self.forget_paths();
                    }
                    Err(reason) => {
                        self.issues.push(Issue::NoPath {
                            line: self.lines[li].id.clone(),
                            direction: dir,
                            reason,
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
            // Whether the two directions meet on track they share outside the end stations (a double
            // junction whose crossing move is the line's own, a single-track stretch), for a return
            // offset and headway; the pattern avoids it (Damascus T2, bug 9).
            let end_tds: HashSet<TdsId> = [0, self.cands[li][0].len() - 1]
                .iter()
                .flat_map(|&i| self.cands[li][0][i].iter())
                .flat_map(|&p| {
                    let st = self.m.platforms[p as usize].station;
                    self.m.stations[st as usize].platforms.clone()
                })
                .flat_map(|p| {
                    let tr = self.m.platforms[p as usize].track;
                    self.m
                        .track_pieces(tr)
                        .iter()
                        .map(|&pc| self.m.pieces[pc as usize].tds)
                })
                .collect();
            let buf = self.p.min_buffer_s;
            // The pairs of outbound and return blockings of one section outside the end stations,
            // found once: the pattern search below asks for thousands of offsets (bug 21).
            let pairs: Vec<(f64, f64, f64, f64)> = blocks[0]
                .iter()
                .filter(|b| !end_tds.contains(&b.0))
                .flat_map(|&(t0, s0, e0)| {
                    blocks[1]
                        .iter()
                        .filter(move |b| b.0 == t0)
                        .map(move |&(_, s1, e1)| (s0, e0, s1, e1))
                })
                .collect();
            let meets_at = |off: f64, e: f64, h: f64| -> bool {
                for &(s0, e0, s1, e1) in &pairs {
                    let (a0, a1) = (s0 - buf, e0 + e / 2.0 + buf);
                    let (b0, b1) = (off + s1, off + e1 + e / 2.0);
                    for k in -4..=4 {
                        let d = k as f64 * h;
                        if a0 < b1 + d && b0 + d < a1 {
                            return true;
                        }
                    }
                }
                false
            };
            let base = periodic_pattern(
                h_min,
                &[0.0],
                0.0,
                t_run[0],
                t_run[1],
                l.turnback_s,
                self.p.terminal_separation_s,
                &|o, e| meets_at(o, e, h_min),
            );
            let pats: Vec<Pattern> = l
                .bands
                .iter()
                .map(|b| {
                    let ratio = b.headway_s / h_min;
                    match l.return_offset_s {
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
                                &|o, e| meets_at(o, e, b.headway_s),
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
                            &|o, e| meets_at(o, e, b.headway_s),
                        ),
                    }
                })
                .collect();
            for (bi, b) in l.bands.iter().enumerate() {
                let pat = pats[bi];
                // A band runs from its start, and each direction's last departure in it keeps at
                // least half a headway (the shorter of the two) before that direction's first in
                // the next band. A band whose headway is not a multiple of the shortest has its
                // own pattern, so its last train could leave a minute or two before the next
                // band's first, and the two got in each other's way at each step of a gradual
                // start or a ramp to a peak (Damascus test, bug 25).
                let next = l
                    .bands
                    .get(bi + 1)
                    .filter(|n| (n.from_s - b.to_s).abs() < 1e-6)
                    .map(|n| (n, pats[bi + 1]));
                for dir in 0..2u8 {
                    let off = if dir == 0 { 0.0 } else { pat.offset_s };
                    let extra = pat.extra_s / 2.0;
                    let mut end = b.to_s + off - 1e-6;
                    if let Some((n, np)) = next {
                        let n_off = if dir == 0 { 0.0 } else { np.offset_s };
                        end = end.min(n.from_s + n_off - 0.5 * n.headway_s.min(b.headway_s) + 1e-6);
                    }
                    let mut t = b.from_s + off;
                    while t < end {
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
            // Shift the whole line into the gaps of the lines before it on shared track.
            let phase = self.line_phase(&trips[first..], &blocks, h_min, &placed);
            for t in &mut trips[first..] {
                t.dep += phase;
                t.arr += phase;
            }
            for t in &trips[first..] {
                for &(tds, s0, e0) in &blocks[t.dir as usize] {
                    placed
                        .entry(tds)
                        .or_default()
                        .push((t.dep + s0, t.dep + e0));
                }
            }
            for v in placed.values_mut() {
                v.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
            }
        }
        trips
    }

    /// Purpose: choose the platforms of a line before its trips, so its two directions run on
    /// different tracks of a double track and each terminal platform leads out on the other direction's
    /// track. Chosen trip by trip, the first train of a direction takes the best platforms with no
    /// thought for the return: at Ahmad Kiftaro (Damascus T1) it arrived in the platform whose way out
    /// joins the track it came in on, so every return train met the next train coming in (bug 9).
    /// Inputs: the line. Effect: the remembered platform of each call and the terminal platforms.
    fn seed_tracks(&mut self, line: usize) {
        let n = self.cands[line][0].len();
        if n < 2 {
            return;
        }
        let last = n - 1;
        // The detection sections a path runs over, outside its two end stations: where trains of
        // the two directions would meet.
        let sections = |pl: &Planner, p: &FoundPath| -> HashSet<TdsId> {
            let Ok(steps) = route_steps(pl.m, &p.routes) else {
                return HashSet::new();
            };
            let ends: Vec<usize> = [p.places.first(), p.places.last()]
                .iter()
                .flatten()
                .map(|x| x.range(pl.m).0)
                .collect();
            steps
                .iter()
                .map(|st| &pl.m.pieces[st.piece as usize])
                .filter(|pc| !ends.contains(&pc.track))
                .map(|pc| pc.tds)
                .collect()
        };
        let set = |pl: &mut Planner, p: &FoundPath, dir: u8| {
            for (k, x) in p.places.iter().enumerate() {
                if let Place::Platform(pid) = *x {
                    pl.set_platform(line, dir, (k + 1 < last).then_some(k + 1), pid);
                }
            }
        };
        let clear = |pl: &mut Planner| {
            pl.memory.retain(|k, _| k.0 != line);
            pl.ends.retain(|k, _| k.0 != line);
            pl.forget_paths();
        };
        let ret = |pl: &Planner, p: &FoundPath, dir: u8| -> Option<FoundPath> {
            let end = *p.places.last()?;
            let steps = route_steps(pl.m, &p.routes).ok()?;
            let d = arrival_dir(pl.m, &steps, end)?.reverse();
            pl.trip_path(line, 1 - dir, end, d, &[])
        };
        // Outbound paths to try: the best from each first platform, and each with one of its places
        // banned (another platform at a station, or another terminal platform).
        let mut outs: Vec<FoundPath> = Vec::new();
        for (start, _) in self.candidates(line, 0, 0) {
            for d in [Dir::Up, Dir::Down] {
                let Some(first) = self.trip_path(line, 0, start, d, &[]) else {
                    continue;
                };
                for pl in first.places.clone() {
                    if let Some(alt) = self.trip_path(line, 0, start, d, &[pl]) {
                        if !outs.iter().any(|o| o.routes == alt.routes) {
                            outs.push(alt);
                        }
                    }
                }
                if !outs.iter().any(|o| o.routes == first.routes) {
                    outs.push(first);
                }
            }
        }
        // (sections shared, cost, out path, back path)
        let mut best: Option<(usize, f64, FoundPath, FoundPath)> = None;
        for out in outs {
            clear(self);
            set(self, &out, 0);
            let Some(back) = ret(self, &out, 0) else {
                continue;
            };
            set(self, &back, 1);
            let so = sections(self, &out);
            let sb = sections(self, &back);
            let mut sh = so.intersection(&sb).count();
            // The next outbound trip, from where the return ends, should run as this one does.
            match ret(self, &back, 1) {
                Some(again) => sh += sections(self, &again).intersection(&sb).count(),
                None => sh += 1000,
            }
            let cost = out.cost + back.cost;
            if best
                .as_ref()
                .map_or(true, |b| (sh, cost) < (b.0, b.1 - 1e-6))
            {
                best = Some((sh, cost, out, back));
            }
        }
        clear(self);
        if let Some((_, _, out, back)) = best {
            set(self, &out, 0);
            set(self, &back, 1);
        }
    }

    /// Purpose: nominal running time of a line direction and the sections it blocks (start and end
    /// relative to its departure), from the best origin platform.
    /// Output: Err with why trains cannot run it when the track joins the stops but no run along it
    /// can be built or timed (a platform too short for the train, a gradient it cannot climb); Err
    /// with None when no track joins the stops.
    fn template_run(
        &self,
        line: usize,
        dir: u8,
    ) -> Result<(f64, Blocks, Vec<RouteId>), Option<String>> {
        let mut best: Option<(f64, f64, Blocks, Vec<RouteId>)> = None;
        let mut why: Option<String> = None;
        for (pl, _) in self.candidates(line, dir, 0) {
            for d in [Dir::Up, Dir::Down] {
                let Some(path) = self.trip_path(line, dir, pl, d, &[]) else {
                    continue;
                };
                let dw = self.dwells(line, dir);
                let built = self.build_run(line, "template", &path.routes, &path.places, &dw, 0.0);
                let timed = built
                    .as_ref()
                    .map_err(|e| e.clone())
                    .and_then(|(run, _)| self.timing(run, 0));
                let t = match timed {
                    Ok(t) => t,
                    Err(e) => {
                        let e = e.trim_start_matches("template: ");
                        let stuck = built
                            .as_ref()
                            .ok()
                            .and_then(|(_, pos)| self.stuck_after(e, pl, &path.places, pos));
                        why.get_or_insert(stuck.unwrap_or_else(|| e.to_string()));
                        continue;
                    }
                };
                let total = t.profile.total_time_s();
                if best.as_ref().map_or(true, |(c, _, _, _)| path.cost < *c) {
                    let blocks = t
                        .blocking
                        .iter()
                        .map(|b| (b.tds, b.start_s, b.end_s))
                        .collect();
                    best = Some((path.cost, total, blocks, path.routes.clone()));
                }
            }
        }
        best.map(|(_, t, b, r)| (t, b, r)).ok_or(why)
    }

    /// Purpose: a run that stalls on a gradient, said where: the station it last left and how far
    /// beyond it. Inputs: the timing error, the origin, the places of the path and the head's stop
    /// position at each. Output: the sentence, or None for any other error.
    fn stuck_after(
        &self,
        err: &str,
        origin: Place,
        places: &[Place],
        pos: &[f64],
    ) -> Option<String> {
        let x: f64 = err
            .strip_prefix("the train cannot move at ")?
            .split(' ')
            .next()?
            .parse()
            .ok()?;
        let k = pos.iter().take_while(|&&p| p <= x).count();
        let (from, at) = match k {
            0 => (origin, 0.0),
            _ => (places[k - 1], pos[k - 1]),
        };
        let name = |pl: Place| match pl {
            Place::Platform(p) => {
                let st = self.m.platforms[p as usize].station;
                self.m.stations[st as usize].name.clone()
            }
            Place::Storage(t) => self.m.tracks[t].id.clone(),
        };
        let between = match places.get(k) {
            Some(&next) => format!("between {} and {}", name(from), name(next)),
            None => format!("after {}", name(from)),
        };
        Some(format!(
            "the train stalls on a gradient too steep for it {between}, about {:.0} m after {}. The track checks warn where the track is steeper than the maximum: change the level there, or the heights of the station and track",
            (x - at).max(0.0),
            name(from)
        ))
    }

    /// Purpose: the phase of a line (ADR-0032 §3 step 4a, lines sharing track): a shift of all its
    /// departures, less than its shortest headway, so its trains run in the gaps of the lines already
    /// phased on the sections they share, instead of every line leaving its terminals at the same times.
    /// Inputs: the line's trips (unshifted), the sections each direction blocks relative to departure,
    /// and the nominal occupation of the lines phased before it. Output: the shift, s, on a 10 s grid:
    /// the least overlap (with the minimum buffer), then the smallest shift.
    fn line_phase(
        &self,
        trips: &[Trip],
        blocks: &[Vec<(TdsId, f64, f64)>; 2],
        h: f64,
        placed: &HashMap<TdsId, Vec<(f64, f64)>>,
    ) -> f64 {
        if placed.is_empty() || !h.is_finite() || h <= 0.0 {
            return 0.0;
        }
        let shared = |d: usize| blocks[d].iter().any(|b| placed.contains_key(&b.0));
        if !shared(0) && !shared(1) {
            return 0.0;
        }
        let buf = self.p.min_buffer_s;
        let overlap = |phi: f64| -> f64 {
            let mut sum = 0.0;
            for t in trips {
                for &(tds, s0, e0) in &blocks[t.dir as usize] {
                    let Some(v) = placed.get(&tds) else { continue };
                    let (s, e) = (t.dep + phi + s0 - buf, t.dep + phi + e0 + buf);
                    // Intervals are sorted by start; none of them is longer than a run.
                    let hi = v.partition_point(|x| x.0 < e);
                    for x in v[..hi].iter().rev() {
                        if x.0 < s - 3600.0 {
                            break;
                        }
                        let o = e.min(x.1) - s.max(x.0);
                        if o > 0.0 {
                            sum += o;
                        }
                    }
                }
            }
            sum
        };
        let mut best = (overlap(0.0), 0.0);
        let mut phi = 10.0;
        while phi < h - 1e-6 && best.0 > 0.0 {
            let o = overlap(phi);
            if o < best.0 - 1e-6 {
                best = (o, phi);
            }
            phi += 10.0;
        }
        best.1
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
        if let Ok(t) = self.timing(&run, 0) {
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
        match self.timing(&run, 0) {
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

    /// Purpose: [`crate::blocking::run_timing`] with the speed profile worked out once per run
    /// shape (see [`Planner::profiles`]). Inputs and output as for `run_timing`.
    fn timing(&self, run: &TrainRun, index: usize) -> Result<RunTiming, String> {
        let key = profile_key(run);
        let known = self.profiles.borrow().get(&key).cloned();
        let profile = match known {
            Some(p) => p,
            None => {
                let p = run_profile(self.m, run)?;
                self.profiles.borrow_mut().insert(key, p.clone());
                p
            }
        };
        Ok(timing_with_profile(
            self.m,
            run,
            profile,
            index,
            &self.p.blocking,
        ))
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
            let timing = self.timing(&run, index_as).map_err(|e| (e, None))?;
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
                let pt = self.timing(&r, pr).map_err(|e| (e, None))?;
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

    /// Purpose: whether a path stops, at a station it passes through, on the track the line's
    /// other direction stops on there instead of its own: on double track it would run against the
    /// trains coming the other way, from the station before to the one after, and often all the
    /// way to the end (Damascus test, bug 25). Such a path is no alternative to the usual one.
    /// Inputs: the line, the direction and the path's places (calls after the origin, the last
    /// being the destination). Output: true when it does.
    fn against_the_other_way(&self, line: usize, dir: u8, places: &[Place]) -> bool {
        let last = self.cands[line][dir as usize].len() - 1;
        places.iter().enumerate().any(|(k, pl)| {
            let i = k + 1;
            let Place::Platform(pid) = *pl else {
                return false;
            };
            if i >= last {
                return false;
            }
            let own = self.memory.get(&(line, dir, i)).copied();
            let other = self.memory.get(&(line, 1 - dir, last - i)).copied();
            match (own, other) {
                (Some(o), Some(x)) => {
                    let track = |p: PlatformId| self.m.platforms[p as usize].track;
                    o != pid && track(x) == track(pid) && track(o) != track(pid)
                }
                _ => false,
            }
        })
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
                    if !attempts.iter().any(|a| a.routes == alt.routes)
                        && alt.routes != best.routes
                        && !self.against_the_other_way(trip.line, trip.dir, &alt.places)
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
                None => self.set_platform(key.0, key.1, Some(key.2), pid),
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

    /// Purpose: a place as the planner's notes name it: the station of a platform (with the
    /// platform id), or the storage track's id.
    fn place_name(&self, place: Place) -> String {
        match place {
            Place::Platform(p) => {
                let pf = &self.m.platforms[p as usize];
                let st = &self.m.stations[pf.station as usize];
                format!("{} ({})", st.name, pf.id)
            }
            Place::Storage(t) => self.m.tracks[t].id.clone(),
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
            // A train comes out of the morning stabling, or, on an end-station siding, from an
            // overnight track first (see `stage`).
            if !has && (s.morning.len() >= s.capacity || s.layover && s.now.len() >= s.capacity) {
                continue;
            }
            for d in [Dir::Up, Dir::Down] {
                let start = departure_routes(self.m, Place::Storage(s.track), d);
                if start.is_empty() {
                    continue;
                }
                for cand in origin_c.iter().filter(|c| !banned.contains(&c.0)) {
                    let e = 1 - trip.dir;
                    if let Some(fp) = self.depot_path(trip.line, e, &start, &[*cand], true) {
                        // Reuse a train already out of the morning stabling first; then a new
                        // one by way of an end-station siding, where it waits for its trip after
                        // coming out early; then one straight from its overnight track.
                        let c = fp.cost
                            + match (has, s.layover) {
                                (true, _) => 0.0,
                                (false, true) => 0.5e5,
                                (false, false) => 1.0e5,
                            };
                        opts.push((c, si, fp));
                    }
                }
            }
        }
        opts.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap().then(a.1.cmp(&b.1)));
        if opts.is_empty() {
            // Name the terminal, so the planner knows where trains cannot turn.
            let at = origin_c.iter().find_map(|c| match c.0 {
                Place::Platform(pf) => {
                    let st = &self.m.stations[self.m.platforms[pf as usize].station as usize];
                    Some(self.m.groups[st.group as usize].name.clone())
                }
                _ => None,
            });
            // Every storage track of the line in use: say which, so the drawing can get more.
            let mine: Vec<&Stack> = self
                .stacks
                .iter()
                .filter(|s| l.stabling.contains(&self.m.tracks[s.track].id))
                .filter(|s| !self.m.platforms.iter().any(|p| p.track == s.track))
                .collect();
            let full = !mine.is_empty()
                && mine
                    .iter()
                    .all(|s| s.now.is_empty() && s.morning.len() >= s.capacity);
            if full {
                let names: Vec<String> = mine
                    .iter()
                    .map(|s| format!("{} ({} trains)", self.m.tracks[s.track].id, s.capacity))
                    .collect();
                return Err((
                    format!(
                        "every storage track is in use ({}): add storage tracks, or a siding at {}",
                        names.join(", "),
                        at.unwrap_or_else(|| "the end station".into())
                    ),
                    None,
                ));
            }
            return Err((
                match at {
                    Some(name) => {
                        format!("no stabling track reaches a free first platform at {name}")
                    }
                    None => "no stabling track reaches a free first platform".into(),
                },
                None,
            ));
        }
        let mut last = ("".to_string(), None);
        // Each option once in order of cost; one whose platform's way out is taken at the
        // departure is passed over while other options are left, and tried again (without that
        // preference) after all of them. Dropping it outright left trips with no train and no
        // reason when the options after it failed (Damascus test, bug 20).
        let mut opts_left = opts.len();
        let mut queue: Vec<(usize, FoundPath, bool)> = opts
            .into_iter()
            .map(|(_, si, fp)| (si, fp, false))
            .collect();
        let mut qi = 0;
        while qi < queue.len() {
            let (si, fp, retry) = queue[qi].clone();
            qi += 1;
            let track = self.stacks[si].track;
            let origin = *fp.places.last().unwrap();
            // An empty end-station siding: bring a train to it from an overnight track first.
            if self.stacks[si].layover
                && self.stacks[si].now.is_empty()
                && !self.stage(trip.line, si, trip.dep - self.p.pull_out_margin_s - 600.0)
            {
                last = (
                    format!(
                        "no overnight track has a train to bring to the end-station siding {} in time",
                        self.m.tracks[track].id
                    ),
                    None,
                );
                continue;
            }
            // Pull-out must also leave a service path from that platform.
            let steps = route_steps(self.m, &fp.routes).unwrap_or_default();
            // A train from the line turns back at the terminal; one from a siding beyond the
            // terminal's far end arrives facing the line already and runs straight on (Damascus
            // test, bug 20). `adir` is then the direction it is treated as having arrived in, so
            // the trip leaves in its reverse.
            let arrived = arrival_dir(self.m, &steps, origin).unwrap_or(Dir::Up);
            let way_on = [arrived, arrived.reverse()].into_iter().find_map(|a| {
                self.trip_path(trip.line, trip.dir, origin, a.reverse(), &[])
                    .and_then(|p| p.routes.first().copied())
                    .map(|r| (a, r))
            });
            let Some((adir, first)) = way_on else {
                last = (
                    format!(
                        "a train from {} reaches {} with no way on to start the trip",
                        self.m.tracks[track].id,
                        self.place_name(origin)
                    ),
                    None,
                );
                continue;
            };
            // Prefer a platform whose way out is free at the departure.
            if !retry && opts_left > 1 && !self.way_out_free(trip.line, first, trip.dep) {
                opts_left -= 1;
                queue.push((si, fp, true));
                last = (
                    format!(
                        "the way out of {} is taken at the departure",
                        self.place_name(origin)
                    ),
                    None,
                );
                continue;
            }
            let name = format!("{}-po", trip.name);
            let variants = self.depot_variants(trip.line, &name, &fp);
            if variants.is_empty() {
                last = (
                    format!(
                        "no run can be built from {} to {}",
                        self.m.tracks[track].id,
                        self.place_name(origin)
                    ),
                    None,
                );
                continue;
            }
            for base in variants {
                let probe = match self.timing(&base, 0) {
                    Ok(p) => p,
                    Err(e) => {
                        last = (e, None);
                        continue;
                    }
                };
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
                // A train already there leaves once it has arrived.
                let window = match s.now.last() {
                    Some(&v) => self
                        .p
                        .max_depot_shift_s
                        .min(ideal - self.vehicles[v].ready_s),
                    None => self.p.max_depot_shift_s,
                };
                if window < 0.0 {
                    last = (
                        format!(
                            "the next train on {} is not back there in time",
                            self.m.tracks[track].id
                        ),
                        None,
                    );
                    continue;
                }
                let idx = self.runs.len();
                match self.search_time(&mk, ideal, false, window, vehicle, None, idx) {
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
        }
        Err((format!("pull-out: {}", last.0), last.1))
    }

    /// Purpose: the ways from a place to a storage track: straight on, or by way of one or two end
    /// platforms of the line, where the train reverses (sidings and depots behind stub terminals
    /// are entered from a platform). Output: each way's legs, cheapest way first.
    fn shunt_ways(&self, line: usize, from: Place, to: usize) -> Vec<Vec<FoundPath>> {
        let l = &self.lines[line];
        let ends: Vec<PlatformId> = [l.calls.first(), l.calls.last()]
            .into_iter()
            .flatten()
            .flat_map(|c| resolve(self.m, &c.pick).unwrap_or_default())
            .collect();
        let goal = vec![(Place::Storage(to), 0.0)];
        let mut ways: Vec<(f64, Vec<FoundPath>)> = Vec::new();
        // (place, directions it may leave in, cost so far, legs so far)
        let mut front: Vec<(Place, Vec<Dir>, f64, Vec<FoundPath>)> =
            vec![(from, vec![Dir::Up, Dir::Down], 0.0, Vec::new())];
        for reversals in 0..3 {
            let mut next = Vec::new();
            for (at, dirs, cost, legs) in &front {
                for &d in dirs {
                    let start = departure_routes(self.m, *at, d);
                    if start.is_empty() {
                        continue;
                    }
                    if let Some(fp) = find_path(
                        self.m,
                        &start,
                        std::slice::from_ref(&goal),
                        self.p.max_routes,
                    ) {
                        let mut w = legs.clone();
                        let c = cost + fp.cost;
                        w.push(fp);
                        ways.push((c, w));
                    }
                    if reversals == 2 {
                        continue;
                    }
                    for &pf in &ends {
                        let p = Place::Platform(pf);
                        if p == *at {
                            continue;
                        }
                        let Some(fp) =
                            find_path(self.m, &start, &[vec![(p, 0.0)]], self.p.max_routes)
                        else {
                            continue;
                        };
                        let steps = route_steps(self.m, &fp.routes).unwrap_or_default();
                        let Some(adir) = arrival_dir(self.m, &steps, p) else {
                            continue;
                        };
                        let mut w = legs.clone();
                        let c = cost + fp.cost;
                        w.push(fp);
                        next.push((p, vec![adir.reverse()], c, w));
                    }
                }
            }
            if !ways.is_empty() {
                break;
            }
            front = next;
        }
        ways.sort_by(|a, b| a.0.total_cmp(&b.0));
        ways.into_iter().map(|w| w.1).collect()
    }

    /// Purpose: move train `v`, standing at `from` and ready at `ready_s` after run `prev`, to the
    /// storage track `to`, straight on or reversing in an end platform of the line.
    /// Inputs: `by_s` = Some(time): arrive as close before it as possible; None: leave as soon as
    /// the line has room (within 6 h). Run names start with `name`.
    /// Output: the last run's index and the train's arrival direction, or None with nothing changed.
    #[allow(clippy::too_many_arguments)]
    fn shunt(
        &mut self,
        line: usize,
        v: usize,
        from: Place,
        prev: Option<usize>,
        ready_s: f64,
        to: usize,
        by_s: Option<f64>,
        name: &str,
        kind: RunKind,
        direction: u8,
    ) -> Option<(usize, Dir)> {
        let turn = self.lines[line].turnback_s;
        for legs in self.shunt_ways(line, from, to) {
            // Running time of each leg (its first variant).
            let mut times = Vec::new();
            for (k, fp) in legs.iter().enumerate() {
                let t = self
                    .depot_variants(line, name, fp)
                    .first()
                    .and_then(|r| self.timing(r, k).ok())
                    .map(|x| x.profile.total_time_s());
                times.push(t);
            }
            let Some(times) = times.into_iter().collect::<Option<Vec<f64>>>() else {
                continue;
            };
            let total: f64 = times.iter().sum::<f64>() + turn * (legs.len() - 1) as f64;
            // Saved state, to undo a way that fails half-way.
            let n0 = self.runs.len();
            let saved_prev = prev.map(|p| self.runs[p].clone());
            let saved_v = self.vehicles[v].clone();
            let saved_res = self.reserved.clone();
            let mut at = (prev, ready_s, from, Dir::Up);
            let mut ok = true;
            for (k, fp) in legs.iter().enumerate() {
                let (ideal, later, shift) = match (k, by_s) {
                    (0, Some(by)) => {
                        let ideal = by - total;
                        if ideal < ready_s {
                            ok = false;
                            break;
                        }
                        (ideal, false, ideal - ready_s)
                    }
                    (_, Some(by)) => {
                        let ideal = at.1 + turn;
                        (ideal, true, (by - times[k] - ideal).max(0.0))
                    }
                    (0, None) => (ready_s + 60.0, true, 6.0 * 3600.0),
                    (_, None) => (at.1 + turn, true, 6.0 * 3600.0),
                };
                let leg_name = if k == 0 {
                    name.to_string()
                } else {
                    format!("{name}-{k}")
                };
                let mut placed = None;
                for base in self.depot_variants(line, &leg_name, fp) {
                    let mk = |t: f64| TrainRun {
                        depart_s: t,
                        ..base.clone()
                    };
                    let idx = self.runs.len();
                    if let Ok((timing, t, prev_t)) =
                        self.search_time(&mk, ideal, later, shift, v, at.0, idx)
                    {
                        placed = Some((mk(t), timing, prev_t));
                        break;
                    }
                }
                let Some((run, timing, prev_t)) = placed else {
                    ok = false;
                    break;
                };
                let dest = *fp.places.last().unwrap();
                let calls = self.call_list(&[at.2, dest], &[None, None]);
                let pr = PlannedRun {
                    name: leg_name,
                    line,
                    kind,
                    direction,
                    vehicle: v,
                    planned_depart_s: ideal,
                    run,
                    calls,
                    blocking: Vec::new(),
                };
                let i = self.commit(pr, timing, at.0.zip(prev_t));
                let steps = route_steps(self.m, &fp.routes).unwrap_or_default();
                let adir = arrival_dir(self.m, &steps, dest).unwrap_or(Dir::Up);
                self.vehicles[v] = Vehicle {
                    at: dest,
                    arrive_dir: adir,
                    ready_s: self.runs[i].arrive_s(),
                    last_run: i,
                };
                at = (Some(i), self.runs[i].arrive_s(), dest, adir);
            }
            if ok {
                return at.0.map(|i| (i, at.3));
            }
            for i in (n0..self.runs.len()).rev() {
                self.remove_index(i);
            }
            self.runs.truncate(n0);
            if let (Some(p), Some(r)) = (prev, saved_prev) {
                self.remove_index(p);
                self.runs[p] = r;
                self.add_index(p);
            }
            self.vehicles[v] = saved_v;
            self.reserved = saved_res;
        }
        None
    }

    /// Purpose: bring a train from an overnight track to an end-station siding, early, while the line
    /// has room, so it waits there until it is needed (Homlo, Damascus test: trains go from the
    /// overnight depot to the end stations before their time comes).
    /// Inputs: the line, the siding's stack and the time the train is needed there by, s.
    /// Output: whether a train is now on the siding. Effect: the runs, the vehicle and both stacks.
    fn stage(&mut self, line: usize, si: usize, by_s: f64) -> bool {
        let lines = self.lines;
        let l = &lines[line];
        let target = self.stacks[si].track;
        // From an hour before the line's first trip.
        let day = l
            .bands
            .iter()
            .map(|b| b.from_s)
            .fold(f64::INFINITY, f64::min)
            - 3600.0;
        // Overnight tracks with a train standing, then those with a train left for the morning.
        let mut srcs: Vec<usize> = (0..self.stacks.len())
            .filter(|&oi| {
                let o = &self.stacks[oi];
                oi != si
                    && !o.layover
                    && l.stabling.contains(&self.m.tracks[o.track].id)
                    && !self.m.platforms.iter().any(|p| p.track == o.track)
                    && (!o.now.is_empty() || o.morning.len() < o.capacity)
            })
            .collect();
        srcs.sort_by_key(|&oi| self.stacks[oi].now.is_empty());
        for oi in srcs {
            let from = Place::Storage(self.stacks[oi].track);
            let (v, fresh) = match self.stacks[oi].now.last() {
                Some(&v) => (v, false),
                None => {
                    self.vehicles.push(Vehicle {
                        at: from,
                        arrive_dir: Dir::Up,
                        ready_s: 0.0,
                        last_run: 0,
                    });
                    (self.vehicles.len() - 1, true)
                }
            };
            let (prev, ready) = if fresh {
                (None, day.min(by_s))
            } else {
                let ve = &self.vehicles[v];
                (Some(ve.last_run), ve.ready_s)
            };
            let name = format!("{}-stage-{}", l.id, self.runs.len());
            match self.shunt(
                line,
                v,
                from,
                prev,
                ready,
                target,
                Some(by_s),
                &name,
                RunKind::PullOut,
                0,
            ) {
                Some(_) => {
                    let o = &mut self.stacks[oi];
                    if fresh {
                        o.morning.push(v);
                    } else {
                        o.now.pop();
                    }
                    self.stacks[si].now.push(v);
                    return true;
                }
                None => {
                    if fresh {
                        self.vehicles.pop();
                    }
                }
            }
        }
        false
    }

    /// Purpose: at the end of the day, take the trains left on end-station sidings to overnight
    /// tracks, as soon as the line has room for each run (Homlo, Damascus test). A train that
    /// cannot go stays on its siding, and the issues say so.
    fn clear_layovers(&mut self) {
        for si in 0..self.stacks.len() {
            if !self.stacks[si].layover {
                continue;
            }
            while let Some(&v) = self.stacks[si].now.last() {
                let ve = self.vehicles[v].clone();
                let line = self.runs[ve.last_run].line;
                let lines = self.lines;
                let l = &lines[line];
                let direction = self.runs[ve.last_run].direction;
                let mut done = false;
                for oi in 0..self.stacks.len() {
                    let o = &self.stacks[oi];
                    if o.layover
                        || o.now.len() >= o.capacity
                        || !l.stabling.contains(&self.m.tracks[o.track].id)
                    {
                        continue;
                    }
                    let name = format!("{}-night-{}", l.id, self.runs.len());
                    let to = o.track;
                    if self
                        .shunt(
                            line,
                            v,
                            ve.at,
                            Some(ve.last_run),
                            ve.ready_s,
                            to,
                            None,
                            &name,
                            RunKind::PullIn,
                            direction,
                        )
                        .is_some()
                    {
                        self.stacks[si].now.pop();
                        self.stacks[oi].now.push(v);
                        done = true;
                        break;
                    }
                }
                if !done {
                    self.issues.push(Issue::NotStabled {
                        vehicle: v,
                        at: ve.at.id(self.m),
                        reason:
                            "no overnight track with room is reachable from the end-station siding"
                                .into(),
                    });
                    break;
                }
            }
        }
    }

    /// Purpose: take a train from its last platform to stabling.
    fn pull_in(&mut self, v: usize) {
        let ve = self.vehicles[v].clone();
        let line = self.runs[ve.last_run].line;
        let lines = self.lines;
        let l = &lines[line];
        // Back the way it came, or straight on into a siding beyond the terminal's far end: only
        // turning back sent trains at one end of the line to the sidings at the other end, empty
        // along the whole line against the service (Damascus test, bug 25).
        let starts: Vec<(Dir, Vec<RouteId>)> = [ve.arrive_dir.reverse(), ve.arrive_dir]
            .into_iter()
            .map(|d| (d, departure_routes(self.m, ve.at, d)))
            .filter(|(_, r)| !r.is_empty())
            .collect();
        let mut opts: Vec<(f64, usize, FoundPath, Dir)> = Vec::new();
        for (si, s) in self.stacks.iter().enumerate() {
            if !l.stabling.contains(&self.m.tracks[s.track].id) || s.now.len() >= s.capacity {
                continue;
            }
            let e = 1 - self.runs[ve.last_run].direction;
            let end = [(Place::Storage(s.track), 0.0)];
            for (d, start) in &starts {
                if let Some(fp) = self.depot_path(line, e, start, &end, false) {
                    // The overnight tracks first; an end-station siding when the line has no room
                    // to reach them now (the train goes on later, see `clear_layovers`).
                    let c = fp.cost + if s.layover { 1.0e5 } else { 0.0 };
                    opts.push((c, si, fp, *d));
                }
            }
        }
        opts.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap().then(a.1.cmp(&b.1)));
        let ideal = ve.ready_s + l.turnback_s;
        let mut why = "no stabling track with room is reachable".to_string();
        for (_, si, fp, dir) in opts {
            let track = self.stacks[si].track;
            let name = format!("{}-pi", self.runs[ve.last_run].name);
            let variants = self.depot_variants(line, &name, &fp);
            for base in variants {
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
        }
        self.issues.push(Issue::NotStabled {
            vehicle: v,
            at: ve.at.id(self.m),
            reason: why,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_pattern_keeps_the_two_directions_apart_where_they_share_track() {
        // Without the check, the best offset puts the two directions in the junction together.
        let free = periodic_pattern(600.0, &[0.0], 0.0, 1500.0, 1500.0, 240.0, 120.0, &|_, _| {
            false
        });
        let meets = move |off: f64, _e: f64| (off - free.offset_s).rem_euclid(600.0) < 120.0;
        let p = periodic_pattern(600.0, &[0.0], 0.0, 1500.0, 1500.0, 240.0, 120.0, &meets);
        assert!(!meets(p.offset_s, p.extra_s), "{p:?}");
    }
}
