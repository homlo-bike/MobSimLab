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

use engine_msg::{msg, Msg};
use std::cell::RefCell;
use std::collections::{BTreeMap, BinaryHeap, HashMap, HashSet};

use rail_dynamics::Stop;
use rail_model::{Dir, Model, PieceId, PlatformId, RouteId, TdsId, TrackUse};
use serde::Serialize;

use crate::blocking::{
    route_steps, run_profile, starts_between, timing_with_profile, Blocking, BlockingParams,
    RunTiming, TrainRun,
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
    /// Longest a train waits at a station for a train of a higher-ranked line to pass, s.
    pub max_overtake_wait_s: f64,
}

impl Default for PlanParams {
    /// Purpose: metro planning defaults (min buffer from the assumption library's
    /// metro value, 4 min shift (2 min left too many trips out where lines of different headways share track, Damascus test), 15 min for depot moves, 20 min idle limit, 10 min longest wait
    /// to be overtaken).
    fn default() -> Self {
        Self {
            blocking: BlockingParams::default(),
            min_buffer_s: 20.0,
            stop_margin_m: 5.0,
            max_shift_s: 240.0,
            max_depot_shift_s: 900.0,
            max_idle_s: 1200.0,
            alternative_penalty_m: 500.0,
            change_penalty_m: 2000.0,
            stabling_gap_m: 10.0,
            max_routes: 400,
            terminal_separation_s: 90.0,
            pull_out_margin_s: 90.0,
            max_overtake_wait_s: 600.0,
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

/// Purpose: an error of the template run (run name "template") without the run name in front.
fn without_run_name(e: Msg) -> Msg {
    if e.text_arg("run") != Some("template") {
        return e;
    }
    match e.key.as_str() {
        "rail.plan.cannot_move" => msg!(
            "rail.plan.cannot_move_here",
            position = e.text_arg("position").unwrap_or_default()
        ),
        "rail.plan.run_failed" => msg!(
            "rail.plan.detail",
            detail = e.text_arg("detail").unwrap_or_default()
        ),
        _ => e,
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
        reason: Option<Msg>,
    },
    /// A trip could not be placed.
    Unplaced {
        /// Trip id.
        trip: String,
        /// Why.
        reason: Msg,
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
        reason: Msg,
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
    /// Each train's time on the track: (vehicle, arrival, departure); the morning trains arrive
    /// at 0 and a train still there leaves at infinity.
    stays: Vec<(usize, f64, f64)>,
    /// Trains leave the way they came in (one end has no way out).
    dead_end: bool,
}

impl Stack {
    /// Purpose: whether a train put away at `arrive_s` would stand in front of one that leaves
    /// later (a dead-end track is last in, first out).
    fn blocks_one_leaving(&self, arrive_s: f64) -> bool {
        self.dead_end
            && self
                .stays
                .iter()
                .any(|&(_, a, d)| a < arrive_s && d.is_finite() && d > arrive_s)
    }

    /// Purpose: most trains on the track at once from `from_s` until `to_s`.
    fn peak(&self, from_s: f64, to_s: f64) -> usize {
        std::iter::once(from_s)
            .chain(
                self.stays
                    .iter()
                    .map(|x| x.1)
                    .filter(|&a| a > from_s && a < to_s),
            )
            .map(|x| self.stays.iter().filter(|s| s.1 <= x && x < s.2).count())
            .max()
            .unwrap_or(0)
    }

    /// Purpose: note when train `v` leaves (a morning train: it was there from the start).
    fn leave(&mut self, v: usize, at_s: f64) {
        match self
            .stays
            .iter_mut()
            .find(|x| x.0 == v && x.2 == f64::INFINITY)
        {
            Some(x) => x.2 = at_s,
            None => self.stays.push((v, 0.0, at_s)),
        }
    }
}

/// Sections a run blocks, with start and end relative to its departure, s.
type Blocks = Vec<(TdsId, f64, f64)>;

/// A conflict that stops a placement: (other run, section).
type Blocker = Option<(usize, TdsId)>;

/// A placed run's blocking of one section: (run, start, end, following on sight, see
/// [`Blocking::follow`]).
type Placed = (usize, f64, f64, Option<(Dir, f64)>);

struct Planner<'a> {
    m: &'a Model,
    lines: &'a [LineSpec],
    p: &'a PlanParams,
    cands: Vec<[Vec<Vec<PlatformId>>; 2]>,
    runs: Vec<PlannedRun>,
    /// Placed blocking per section.
    index: BTreeMap<TdsId, Vec<Placed>>,
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
    /// Speed profiles already worked out, by [`profile_key`], with the dwells they were worked
    /// out for: the search for a free slot tries a run at many departure times and dwells, and the
    /// speeds do not change with them (a long run's profile takes megabytes, so one is kept per
    /// path and stops, not per dwell).
    profiles: RefCell<HashMap<String, (SpeedProfile, Vec<f64>)>>,
    /// Trip paths already found ([`Planner::trip_path`]), by line, direction, origin, departure
    /// direction and banned places.
    paths: RefCell<TripPaths>,
    /// Depot paths already found ([`Planner::depot_path`]), dropped with the trip paths.
    depot_paths: RefCell<DepotPaths>,
    /// The trip each placed passenger run serves, by run index.
    trip_of_run: HashMap<usize, usize>,
    /// Where each placed pull-out took its train from, by run index: the stack and the train's
    /// place in it (None for a train of the morning stabling).
    pulled_from: HashMap<usize, (usize, Option<usize>)>,
    /// The stack each pull-in placed by [`Planner::pull_in`] took its train to, by run index.
    pulled_in: HashMap<usize, usize>,
    /// Trains left standing because their runs were taken back: the run they stand after, and
    /// from when they stand there in place of the run taken back, s.
    left_standing: HashMap<usize, (usize, f64)>,
}

type TripPaths = HashMap<(usize, u8, Place, Dir, Vec<Place>), Option<FoundPath>>;
type DepotPaths = HashMap<(usize, u8, Vec<RouteId>, Vec<(Place, u64)>, bool), Option<FoundPath>>;

/// Purpose: what a run's speeds depend on ([`run_profile`]), as a map key: everything but its
/// name, departure time, dwells and how long it stays at the end.
fn profile_key(r: &TrainRun) -> String {
    let stops: Vec<f64> = r.stops.iter().map(|s| s.position_m).collect();
    format!(
        "{:?}|{:?}|{:?}|{:?}|{:?}|{}|{:?}",
        r.train, r.routes, r.start_m, r.end_m, stops, r.stop_at_end, r.supplement_share
    )
}

/// Purpose: a speed profile worked out for other dwells at the same stops, with the times moved
/// on by the difference in dwell from each stop onwards (running times do not depend on dwells).
/// Inputs: the profile, the dwells it was worked out for, the run's start on its path and stops.
/// Output: the profile for the run's dwells.
fn with_dwells(mut p: SpeedProfile, had: &[f64], start_m: f64, stops: &[Stop]) -> SpeedProfile {
    for (i, st) in stops.iter().enumerate() {
        let d = st.dwell_s - had.get(i).copied().unwrap_or(st.dwell_s);
        if d == 0.0 {
            continue;
        }
        let pos = st.position_m - start_m;
        // The stop is on the grid point nearest to it.
        let n = p.position_m.len();
        let mut j = p.position_m.partition_point(|&x| x < pos).min(n - 1);
        if j > 0 && (pos - p.position_m[j - 1]).abs() <= (p.position_m[j] - pos).abs() {
            j -= 1;
        }
        p.depart_s[j] += d;
        for k in j + 1..p.position_m.len() {
            p.arrive_s[k] += d;
            p.depart_s[k] += d;
        }
        if let Some(t) = p.stops.get_mut(i) {
            t.1 += d;
        }
        for t in p.stops.iter_mut().skip(i + 1) {
            t.0 += d;
            t.1 += d;
        }
    }
    p
}

/// Purpose: plan a day of service for a set of lines.
/// Inputs: the model, the lines (calls, train, bands, stabling) and settings.
/// Output: the plan with every run, its blocking times and the issues found;
/// Err for an unknown station, platform or storage track.
pub fn plan(m: &Model, lines: &[LineSpec], p: &PlanParams) -> Result<Plan, Msg> {
    let mut cands = Vec::new();
    for l in lines {
        let out: Vec<Vec<PlatformId>> = l
            .calls
            .iter()
            .map(|c| resolve(m, &c.pick))
            .collect::<Result<_, _>>()
            .map_err(|e| msg!("rail.plan.line_error", line = &l.id, error = e))?;
        let mut back = out.clone();
        back.reverse();
        cands.push([out, back]);
    }
    let mut stacks = Vec::new();
    for l in lines {
        for s in &l.stabling {
            let t = m
                .track(s)
                .ok_or_else(|| msg!("rail.plan.unknown_storage", line = &l.id, track = s))?;
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
                stays: Vec::new(),
                dead_end: [Dir::Up, Dir::Down]
                    .iter()
                    .filter(|&&d| !departure_routes(m, Place::Storage(t), d).is_empty())
                    .count()
                    < 2,
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
        trip_of_run: HashMap::new(),
        pulled_from: HashMap::new(),
        pulled_in: HashMap::new(),
        left_standing: HashMap::new(),
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
    // The morning stack in the order the trains leave: a pull-out may be placed
    // earlier than one for an earlier trip, and the front train has to go first.
    let mut first_dep: HashMap<usize, f64> = HashMap::new();
    for r in &pl.runs {
        let d = first_dep.entry(r.vehicle).or_insert(f64::INFINITY);
        *d = d.min(r.run.depart_s);
    }
    for s in &mut pl.stacks {
        s.morning.sort_by(|a, b| {
            let da = first_dep.get(a).copied().unwrap_or(f64::INFINITY);
            let db = first_dep.get(b).copied().unwrap_or(f64::INFINITY);
            da.total_cmp(&db)
        });
    }
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
    one_platform: [bool; 2],
    meets: &dyn Fn(f64, f64) -> bool,
) -> Pattern {
    let circ = |x: f64| {
        let r = x.rem_euclid(h);
        r.min(h - r)
    };
    // Layover from an arrival at `a` (relative to the departure grid) to the first departure it can make.
    let layover = |a: f64| (-(a + turnback)).rem_euclid(h) + turnback;
    // At a terminal with one platform trains can turn in, a train must have left before the next
    // one comes in: its layover at most the headway less the separation.
    let crowded = |a: f64, one: bool| one && layover(a) > h - target + 1e-6;
    // Lexicographic key: (too close, a one-platform terminal overfull, the directions meet, fleet,
    // -separation, extra time, offset).
    type Key = (f64, f64, f64, f64, f64, f64, f64);
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
                (crowded(far, one_platform[0]) as u8 + crowded(home, one_platform[1]) as u8) as f64,
                meets(off, e) as u8 as f64,
                fleet,
                -(sep / 10.0).floor(),
                e,
                off,
            );
            if best.as_ref().is_none_or(|(k, _)| key < *k) {
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

/// Track a path into a terminal platform may run on against the other direction (the crossover
/// itself), m; more and the platform is no place for trains to turn ([`Planner::turning_platforms`]).
const AGAINST_TOLERANCE_M: f64 = 500.0;

/// How much further than its usual path another path of a train may run against the trains
/// coming the other way between its first and last station, m: crossing over between stations of
/// a main line, where crossovers lie a kilometre or more beyond the platforms, takes that much;
/// a path that keeps to the other direction's track to the next station runs many kilometres.
const OTHER_TRACK_TOLERANCE_M: f64 = 3000.0;

/// Most routes a way out from a platform reserves ([`Planner::way_out`]).
const WAY_OUT_ROUTES: usize = 4;

/// Placeholder holders of pull-out reservations start here (never a vehicle number).
const PRE_BASE: usize = usize::MAX / 2;

/// Tries to send a train to stabling after its last trip, one `max_depot_shift_s` apart.
const PULL_IN_TRIES: u32 = 8;

/// A train that never gets to stabling holds its place until this time, s (two days).
const END_OF_DAY_S: f64 = 2.0 * 86_400.0;

/// Most trips taken back to make room for one train that cannot leave its platform.
const MAX_TAKEN_BACK: u32 = 8;

#[derive(PartialEq)]
enum Task {
    PullOut(usize),
    Trip(usize),
    /// Send a train to stabling: the train and its run the task is for (the task is dropped once
    /// the train has run another since).
    PullIn(usize, usize),
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

/// Purpose: the arrival and departure times of a run's calls from its timing.
/// Inputs: the calls, the departure and the timing. Effect: the calls' times.
fn set_call_times(calls: &mut [CallTime], depart_s: f64, timing: &RunTiming) {
    let n = calls.len();
    let mut k = 0;
    for (i, c) in calls.iter_mut().enumerate() {
        if i == 0 {
            c.depart_s = Some(depart_s);
        } else if i + 1 == n {
            c.arrive_s = Some(depart_s + timing.profile.total_time_s());
        } else if c.stop {
            let (a, d) = timing.profile.stops[k];
            k += 1;
            c.arrive_s = Some(depart_s + a);
            c.depart_s = Some(depart_s + d);
        }
    }
}

/// Purpose: whether two runs block a section at the same time, with the buffer between them.
/// Inputs: the blocks of both runs and the buffer, s. Output: true when they do.
fn blocks_meet(a: &[Blocking], b: &[Blocking], buf: f64) -> bool {
    let mut by: HashMap<TdsId, Vec<(f64, f64)>> = HashMap::new();
    for x in b {
        by.entry(x.tds).or_default().push((x.start_s, x.end_s));
    }
    a.iter().any(|x| {
        by.get(&x.tds).is_some_and(|v| {
            v.iter()
                .any(|&(s, e)| x.start_s < e + buf - 1e-6 && s < x.end_s + buf - 1e-6)
        })
    })
}

/// A run with a wait at a station: the run, its timing, the wait (s) and the dwells.
type Waited = (TrainRun, RunTiming, f64, Vec<Option<f64>>);

/// A change made to let a train pass, with what was there before.
enum Undo {
    /// A run that now waits at a station: run index, run and train as they were.
    Run(usize, Box<PlannedRun>, Vehicle),
    /// The way out reserved for a standing train, given up: the reservations.
    Reserved(Vec<(TdsId, (usize, f64, f64))>),
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
        // On a main line, track other lines run only the other way costs its length again too:
        // a train that passes stations without stopping is held to no platform there, and took
        // the track of the trains coming the other way (test line with regional, IC and ICE).
        let others = (self.lines[line].priority > 0).then(|| self.other_heads(line));
        let extra = |r: RouteId| -> f64 {
            self.m.routes[r as usize]
                .steps
                .iter()
                .filter(|st| {
                    let back = (st.piece, st.dir.reverse());
                    against.is_some_and(|a| a.contains(&back))
                        || others
                            .as_ref()
                            .is_some_and(|o| o.contains(&back) && !o.contains(&(st.piece, st.dir)))
                })
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

    /// Purpose: the track pieces the other lines' usual runs pass, with the direction they run
    /// them in. Input: the line. Output: the pieces and directions.
    fn other_heads(&self, line: usize) -> HashSet<(PieceId, Dir)> {
        self.heads
            .iter()
            .filter(|(k, _)| k.0 != line)
            .flat_map(|(_, h)| h.iter().copied())
            .collect()
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
    ) -> Result<(TrainRun, Vec<f64>), Msg> {
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
        // Higher-ranked lines choose their tracks first, and the others keep to the same side.
        let mut order: Vec<usize> = (0..self.lines.len()).collect();
        order.sort_by_key(|&li| std::cmp::Reverse(self.lines[li].priority));
        for li in order {
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
            // Whether the terminal each direction ends at has only one platform trains can turn in.
            let one_platform = [0u8, 1].map(|d| self.turning_platforms(li, d) == 1);
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
                one_platform,
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
                                one_platform,
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
                            one_platform,
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
            // Minimum-layover matching at each terminal; at a terminal with one platform trains can
            // turn in, first in, first out (see `match_one_platform`).
            for term_dir in 0..2u8 {
                if one_platform[term_dir as usize] {
                    self.match_one_platform(&mut trips, first, term_dir);
                    continue;
                }
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

    /// Purpose: how many platforms of the terminal a line direction ends at its trains can turn in:
    /// reach on the way in and leave from on the way back. Moadamiyeh West (Damascus T4) has two
    /// platforms, but its crossover lets arriving trams reach only one of them.
    /// Inputs: the line and the arriving direction. Output: the count (0 when none is found).
    fn turning_platforms(&self, line: usize, dir: u8) -> usize {
        let ends = &self.cands[line][dir as usize];
        let Some(last) = ends.last() else {
            return 0;
        };
        let st = self.m.platforms[last[0] as usize].station;
        let origins: Vec<Place> = self
            .candidates(line, dir, 0)
            .into_iter()
            .map(|c| c.0)
            .collect();
        last.iter()
            .filter(|&&p| {
                let banned: Vec<Place> = last
                    .iter()
                    .filter(|&&x| x != p)
                    .map(|&x| Place::Platform(x))
                    .collect();
                origins.iter().any(|&o| {
                    [Dir::Up, Dir::Down].into_iter().any(|d| {
                        let Some(path) = self.trip_path(line, dir, o, d, &banned) else {
                            return false;
                        };
                        let end = Place::Platform(p);
                        if self.against_m(line, dir, &path.routes, st) > AGAINST_TOLERANCE_M {
                            return false;
                        }
                        let Some(a) = route_steps(self.m, &path.routes)
                            .ok()
                            .and_then(|st| arrival_dir(self.m, &st, end))
                        else {
                            return false;
                        };
                        self.trip_path(line, 1 - dir, end, a.reverse(), &[])
                            .is_some()
                    })
                })
            })
            .count()
    }

    /// Purpose: how far a path runs against the other direction of its line, on track the other
    /// direction's usual run passes the other way, outside the platforms of one station.
    /// Inputs: the line, the direction, the routes and the station. Output: the length, m.
    fn against_m(&self, line: usize, dir: u8, routes: &[RouteId], station: u32) -> f64 {
        let Some(heads) = self.heads.get(&(line, 1 - dir)) else {
            return 0.0;
        };
        let own: HashSet<usize> = self.m.stations[station as usize]
            .platforms
            .iter()
            .map(|&p| self.m.platforms[p as usize].track)
            .collect();
        route_steps(self.m, routes)
            .unwrap_or_default()
            .iter()
            .filter(|st| heads.contains(&(st.piece, st.dir.reverse())))
            .map(|st| &self.m.pieces[st.piece as usize])
            .filter(|pc| !own.contains(&pc.track))
            .map(|pc| pc.length_m())
            .sum()
    }

    /// Purpose: how far a path runs against the other direction of its line between its first and
    /// last station, on track the other direction's usual run passes the other way. Another
    /// platform at a station with loops can lead onto the other direction's track all the way to
    /// the next station, where it meets every train coming the other way (four-track stations on
    /// a main line); such a path is no alternative to the usual one.
    /// Inputs: the line, the direction, where the path starts and the path. Output: the length, m.
    fn against_between(&self, line: usize, dir: u8, origin: Place, path: &FoundPath) -> f64 {
        let none = HashSet::new();
        let heads = self.heads.get(&(line, 1 - dir)).unwrap_or(&none);
        let others = (self.lines[line].priority > 0).then(|| self.other_heads(line));
        let ends: HashSet<usize> = [Some(&origin), path.places.last()]
            .into_iter()
            .flatten()
            .filter_map(|pl| match *pl {
                Place::Platform(p) => Some(self.m.platforms[p as usize].station),
                _ => None,
            })
            .flat_map(|st| self.m.stations[st as usize].platforms.iter())
            .map(|&p| self.m.platforms[p as usize].track)
            .collect();
        route_steps(self.m, &path.routes)
            .unwrap_or_default()
            .iter()
            .filter(|st| {
                let back = (st.piece, st.dir.reverse());
                heads.contains(&back)
                    || others
                        .as_ref()
                        .is_some_and(|o| o.contains(&back) && !o.contains(&(st.piece, st.dir)))
            })
            .map(|st| &self.m.pieces[st.piece as usize])
            .filter(|pc| !ends.contains(&pc.track))
            .map(|pc| pc.length_m())
            .sum()
    }

    /// Purpose: match the arrivals of a line direction at a terminal with one platform trains can
    /// turn in to the departures back. Trains there leave in the order they came, and each must be
    /// gone before the next comes in; matched as at other terminals (the latest arrival that can
    /// make a departure), a train could wait for a later departure while the next one came into its
    /// platform, and both trips were lost (Damascus test, T4 at Moadamiyeh West).
    /// Inputs: the line's trips and the arriving direction. Effect: their successors and
    /// predecessors at that terminal; an arrival with none goes to stabling, a departure with none
    /// gets a train brought out of stabling.
    fn match_one_platform(&self, trips: &mut [Trip], first: usize, term_dir: u8) {
        let Some(line) = trips.get(first).map(|t| t.line) else {
            return;
        };
        let tb = self.lines[line].turnback_s;
        let mut arr: Vec<usize> = (first..trips.len())
            .filter(|&i| trips[i].dir == term_dir)
            .collect();
        arr.sort_by(|&a, &b| trips[a].arr.total_cmp(&trips[b].arr));
        let mut dep: Vec<usize> = (first..trips.len())
            .filter(|&i| trips[i].dir != term_dir)
            .collect();
        dep.sort_by(|&a, &b| trips[a].dep.total_cmp(&trips[b].dep));
        let mut j = 0;
        for (k, &a) in arr.iter().enumerate() {
            let ta = trips[a].arr;
            while j < dep.len() && trips[dep[j]].dep < ta + tb - 1e-6 {
                j += 1;
            }
            let Some(&d) = dep.get(j) else {
                break;
            };
            let td = trips[d].dep;
            let next = arr.get(k + 1).map_or(f64::INFINITY, |&n| trips[n].arr);
            if td - ta <= self.p.max_idle_s && td <= next - self.p.min_buffer_s + 1e-6 {
                trips[a].succ = Some(d);
                trips[d].pred = Some(a);
                j += 1;
            }
        }
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
        // On a main line, the way back keeps off the track the way out runs on: with four-track
        // stations, both directions took the same track all the way (test line).
        let main_line = self.lines[line].priority > 0;
        let ret = |pl: &mut Planner, p: &FoundPath, dir: u8| -> Option<FoundPath> {
            let end = *p.places.last()?;
            let steps = route_steps(pl.m, &p.routes).ok()?;
            let d = arrival_dir(pl.m, &steps, end)?.reverse();
            if !main_line {
                return pl.trip_path(line, 1 - dir, end, d, &[]);
            }
            let old = pl.heads.insert(
                (line, dir),
                steps.iter().map(|st| (st.piece, st.dir)).collect(),
            );
            pl.forget_paths();
            let back = pl.trip_path(line, 1 - dir, end, d, &[]);
            match old {
                Some(h) => pl.heads.insert((line, dir), h),
                None => pl.heads.remove(&(line, dir)),
            };
            pl.forget_paths();
            back
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
                // Each platform of the far terminal, so lines that share it can turn in different
                // ones (the third platform at Zahira was never tried).
                let far: Vec<Place> = self.cands[line][0][last]
                    .iter()
                    .map(|&p| Place::Platform(p))
                    .collect();
                for &p in &far {
                    let banned: Vec<Place> = far.iter().copied().filter(|&x| x != p).collect();
                    if let Some(alt) = self.trip_path(line, 0, start, d, &banned) {
                        if !outs.iter().any(|o| o.routes == alt.routes) {
                            outs.push(alt);
                        }
                    }
                }
            }
        }
        // Track the lines planned before run the other way: where lines share a double track,
        // each runs on the track of its travel direction. Seeded alone, Damascus T3 took the track
        // T1 and T2 ran towards Zahira on to leave it, and met their trains head on all the way
        // (all lines together: 6 of its 208 trips ran).
        let end_tracks: HashSet<usize> = [0, last]
            .iter()
            .flat_map(|&i| self.cands[line][0][i].iter())
            .flat_map(|&p| {
                let st = self.m.platforms[p as usize].station;
                self.m.stations[st as usize].platforms.clone()
            })
            .map(|p| self.m.platforms[p as usize].track)
            .collect();
        let others: HashSet<(PieceId, Dir)> = self
            .heads
            .iter()
            .filter(|(k, _)| k.0 != line)
            .flat_map(|(_, h)| h.iter().copied())
            .collect();
        let against_others = |pl: &Planner, p: &FoundPath| -> f64 {
            route_steps(pl.m, &p.routes)
                .unwrap_or_default()
                .iter()
                .filter(|st| others.contains(&(st.piece, st.dir.reverse())))
                .map(|st| &pl.m.pieces[st.piece as usize])
                .filter(|pc| !end_tracks.contains(&pc.track))
                .map(|pc| pc.length_m())
                .sum()
        };
        // The terminal platforms other lines turn in: where lines share a terminal, each turns in
        // a platform of its own while there are enough. Seeded alone, T1, T2 and T3 all turned in
        // the same platform at Zahira and never used its third (Damascus test).
        let taken: HashSet<PlatformId> = self
            .ends
            .iter()
            .filter(|(k, _)| k.0 != line)
            .map(|(_, &p)| p)
            .collect();
        let shared_ends = |p: &FoundPath| -> usize {
            match p.places.last() {
                Some(Place::Platform(x)) if taken.contains(x) => 1,
                _ => 0,
            }
        };
        // (track run against other lines in 100 m, sections shared, terminal platforms shared with
        // other lines, cost, out path, back path)
        type Seed = (u64, usize, usize, f64, FoundPath, FoundPath);
        let mut best: Option<Seed> = None;
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
            let against =
                ((against_others(self, &out) + against_others(self, &back)) / 100.0).floor() as u64;
            let shared = shared_ends(&out) + shared_ends(&back);
            if best
                .as_ref()
                .is_none_or(|b| (against, shared, sh, cost) < (b.0, b.1, b.2, b.3 - 1e-6))
            {
                best = Some((against, shared, sh, cost, out, back));
            }
        }
        clear(self);
        if let Some((_, _, _, _, out, back)) = best {
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
    ) -> Result<(f64, Blocks, Vec<RouteId>), Option<Msg>> {
        let mut best: Option<(f64, f64, Blocks, Vec<RouteId>)> = None;
        let mut why: Option<Msg> = None;
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
                        let stuck = built
                            .as_ref()
                            .ok()
                            .and_then(|(_, pos)| self.stuck_after(&e, pl, &path.places, pos));
                        why.get_or_insert(stuck.unwrap_or_else(|| without_run_name(e)));
                        continue;
                    }
                };
                let total = t.profile.total_time_s();
                if best.as_ref().is_none_or(|(c, _, _, _)| path.cost < *c) {
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
    fn stuck_after(&self, err: &Msg, origin: Place, places: &[Place], pos: &[f64]) -> Option<Msg> {
        if err.key != "rail.plan.cannot_move" {
            return None;
        }
        let x: f64 = err
            .text_arg("position")?
            .trim_end_matches(" m")
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
        let distance = format!("{:.0} m", (x - at).max(0.0));
        Some(match places.get(k) {
            Some(&next) => msg!(
                "rail.plan.stalls_between",
                from = name(from),
                to = name(next),
                distance = distance
            ),
            None => msg!(
                "rail.plan.stalls_after",
                from = name(from),
                distance = distance
            ),
        })
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
            for &(r, s, e, follow) in v {
                if Some(r) == skip || self.vehicle_of(r) == vehicle {
                    continue;
                }
                // Two trams running the same way on sight need the section only as each comes near it.
                let (bs, s) = starts_between((b.start_s, b.follow), (s, follow));
                if bs < e + buf - 1e-6 && s < b.end_s + buf - 1e-6 {
                    let l = e + buf - bs;
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
    fn reserve(&mut self, v: usize, routes: &[RouteId], at_s: f64) {
        let line = self.runs[self.vehicles[v].last_run].line;
        self.reserve_route(v, line, routes, at_s);
    }

    /// Purpose: the routes of a path that take a train from where it stands towards its first call,
    /// short of the route into it: its way out. Leaving a terminal by a crossover takes two or three routes, and reserving only the
    /// first left the crossover free for a train coming in, which then shut the waiting train in
    /// (Damascus T4 at Moadamiyeh West, bug 25). Inputs: the path. Output: its first routes (at
    /// least one).
    fn way_out(&self, path: &FoundPath) -> Vec<RouteId> {
        let Some(first) = path.places.first() else {
            return path.routes.iter().take(1).copied().collect();
        };
        let track = first.range(self.m).0;
        let mut out = Vec::new();
        for &r in &path.routes {
            let reaches = self.m.routes[r as usize]
                .steps
                .iter()
                .any(|st| self.m.pieces[st.piece as usize].track == track);
            // The route into the first call is the next station's business, not the way out.
            if reaches && !out.is_empty() {
                break;
            }
            out.push(r);
            if reaches || out.len() >= WAY_OUT_ROUTES {
                break;
            }
        }
        out
    }

    fn reserve_route(&mut self, v: usize, line: usize, routes: &[RouteId], at_s: f64) {
        let run = TrainRun {
            name: "reservation".into(),
            train: self.lines[line].train.clone(),
            routes: routes.to_vec(),
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
                    .map(|p| self.way_out(&p))
                else {
                    continue;
                };
                let hold =
                    self.platform_hold(cand, trip.dep - self.p.pull_out_margin_s - 60.0, trip.dep);
                if !self.way_out_free(line, &first, trip.dep)
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
                self.reserve_route(holder, line, &first, trip.dep);
                return Some(cand);
            }
        }
        None
    }

    /// Purpose: blocking of a platform's sections over an interval.
    fn platform_hold(&self, place: Place, from_s: f64, to_s: f64) -> Vec<Blocking> {
        let (track, a, b) = place.range(self.m);
        self.range_hold(track, a, b, from_s, to_s)
    }

    /// Purpose: where a train leaving a track by `route` stands before it leaves: the stretch of
    /// the track behind the route's entry, a train length and the stop margin long.
    /// Output: (track, from chainage, to chainage).
    fn standing_range(&self, track: usize, route: RouteId, length_m: f64) -> (usize, f64, f64) {
        let m = self.m;
        let len = m.tracks[track].length_m;
        let d = length_m + self.p.stop_margin_m;
        let st = m.routes[route as usize].steps[0];
        let p = &m.pieces[st.piece as usize];
        let (at, up) = if p.track == track {
            match st.dir {
                Dir::Up => (p.from_m, true),
                Dir::Down => (p.to_m, false),
            }
        } else {
            let ps = m.track_pieces(track);
            let b_end = ps.last().is_some_and(|&l| {
                m.neighbours(l, rail_model::End::B)
                    .iter()
                    .any(|x| x.0 == st.piece)
            });
            if b_end {
                (len, true)
            } else {
                (0.0, false)
            }
        };
        if up {
            (track, (at - d).max(0.0), at)
        } else {
            (track, at, (at + d).min(len))
        }
    }

    /// Purpose: blocking of the sections of a stretch of track for a time.
    fn range_hold(&self, track: usize, a: f64, b: f64, from_s: f64, to_s: f64) -> Vec<Blocking> {
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
                    follow: None,
                });
            }
        }
        out
    }

    /// Purpose: whether a departure route is free of other trains at a time.
    fn way_out_free(&self, line: usize, routes: &[RouteId], at_s: f64) -> bool {
        let run = TrainRun {
            name: "probe".into(),
            train: self.lines[line].train.clone(),
            routes: routes.to_vec(),
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
                .map(|p| self.way_out(&p)),
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
                    .map(|r| vec![r])
            }
        };
        if let Some(r) = first {
            self.reserve(v, &r, at_s);
        }
    }

    /// Purpose: [`crate::blocking::run_timing`] with the speed profile worked out once per run
    /// shape (see [`Planner::profiles`]). Inputs and output as for `run_timing`.
    fn timing(&self, run: &TrainRun, index: usize) -> Result<RunTiming, Msg> {
        let key = profile_key(run);
        let dwells: Vec<f64> = run.stops.iter().map(|s| s.dwell_s).collect();
        let known = self.profiles.borrow().get(&key).cloned();
        let profile = match known {
            Some((p, had)) if had == dwells => p,
            Some((p, had)) => with_dwells(p, &had, run.start_m, &run.stops),
            None => {
                let p = run_profile(self.m, run)?;
                self.profiles.borrow_mut().insert(key, (p.clone(), dwells));
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
                .push((run, b.start_s, b.end_s, b.follow));
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
    ) -> Result<(RunTiming, f64, Option<RunTiming>), (Msg, Blocker)> {
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
                    return Err((msg!("rail.plan.cannot_wait"), who));
                }
                prev_t = Some(pt);
            }
            return Ok((timing, t, prev_t));
        }
        Err((
            msg!("rail.plan.no_slot", shift = format!("{max_shift:.0} s")),
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
        set_call_times(&mut pr.calls, pr.run.depart_s, &timing);
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
        let mut pull_in_tries: HashMap<usize, u32> = HashMap::new();
        while let Some(Queued(at_s, _, task)) = queue.pop() {
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
                            self.trip_of_run.insert(self.vehicles[v].last_run, i);
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
                                let run = self.vehicles[v].last_run;
                                queue.push(Queued(at, seq, Task::PullIn(v, run)));
                                seq += 1;
                            }
                        }
                        Err(left) => {
                            // The trip is cancelled; the next trip of the circulation
                            // starts with a pull-out, and a train left at the origin goes to stabling.
                            if let Some(s) = trips[i].succ {
                                trips[s].pred = None;
                            }
                            // Right away: its platform is free for the next train only from
                            // the planned departure, so the train has to leave by then.
                            if let Some(v) = left {
                                let run = self.vehicles[v].last_run;
                                queue.push(Queued(trips[i].dep, seq, Task::PullIn(v, run)));
                                seq += 1;
                            }
                        }
                    }
                }
                Task::PullIn(v, run) => {
                    // The train has been put away, or given other work, since.
                    if self.vehicles[v].last_run != run
                        || matches!(self.vehicles[v].at, Place::Storage(_))
                    {
                        continue;
                    }
                    let n = pull_in_tries.entry(v).or_insert(0);
                    *n += 1;
                    let last = *n >= PULL_IN_TRIES;
                    if !self.pull_in(v, false) {
                        // The train stays in its platform: it holds it until the next try, or
                        // for the rest of the day, so no other train is planned into it.
                        let retry = self.vehicles[v].ready_s + self.p.max_depot_shift_s;
                        let until = if last { END_OF_DAY_S } else { retry };
                        let mut held = self.hold_last_place(v, until);
                        // Trains already planned into the platform cannot come while it stands
                        // there (example metro line at 2 minute headways, where the kernel
                        // stopped on such a plan). A train brought out of stabling for a trip
                        // from this platform leaves the trip to this one; trips of others are
                        // taken back, one at a time, until it can leave or stay.
                        let mut taken = 0;
                        let mut gone = false;
                        while let Err(Some((r, _))) = held {
                            if let Some(pull_in_at) =
                                self.hand_over(r, v, &trips, &mut trip_vehicle)
                            {
                                if let Some(at) = pull_in_at {
                                    let run = self.vehicles[v].last_run;
                                    queue.push(Queued(at, seq, Task::PullIn(v, run)));
                                    seq += 1;
                                }
                                gone = true;
                                break;
                            }
                            // A train left standing because its own runs were taken back takes back
                            // only runs leaving after it was left there: one leaving earlier would
                            // leave another train standing earlier in the day, and on a busy line
                            // that ran back through the whole day and cancelled most of its trips.
                            if taken >= MAX_TAKEN_BACK
                                || self.left_standing.get(&v).is_some_and(|&(run, since)| {
                                    run == self.vehicles[v].last_run
                                        && self.runs[r].run.depart_s < since
                                })
                            {
                                break;
                            }
                            let Some(w) = self.take_back(r, v, &mut trips, &mut trip_vehicle)
                            else {
                                break;
                            };
                            taken += 1;
                            let since = self.vehicles[w].ready_s;
                            self.left_standing
                                .insert(w, (self.vehicles[w].last_run, since));
                            if !matches!(self.vehicles[w].at, Place::Storage(_)) {
                                let run = self.vehicles[w].last_run;
                                queue.push(Queued(at_s, seq, Task::PullIn(w, run)));
                                seq += 1;
                            }
                            if self.pull_in(v, false) {
                                gone = true;
                                break;
                            }
                            held = self.hold_last_place(v, until);
                        }
                        if gone {
                            continue;
                        }
                        if held.is_ok() && !last {
                            self.vehicles[v].ready_s = retry;
                            let run = self.vehicles[v].last_run;
                            let at = retry + self.lines[self.runs[run].line].turnback_s;
                            queue.push(Queued(at, seq, Task::PullIn(v, run)));
                            seq += 1;
                        } else {
                            // The last try, or no place to wait: say why it stays.
                            let _ = self.pull_in(v, true);
                        }
                    }
                }
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
                let mut first_err: Option<(Msg, Blocker)> = None;
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
                            let e = first_err
                                .unwrap_or((msg!("rail.plan.no_train", reason = reason), who));
                            self.unplaced(trip, e.0, e.1);
                            return Err(None);
                        }
                    }
                }
            }
        }
    }

    fn unplaced(&mut self, trip: &Trip, reason: Msg, who: Blocker) {
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
    ) -> Result<(), (Msg, Blocker)> {
        let prev = Some(prev_run);
        // Paths to try: the best, then each with one of its platforms banned.
        let mut attempts: Vec<FoundPath> = Vec::new();
        if let Some(best) = self.trip_path(trip.line, trip.dir, origin, depart_dir, &[]) {
            let usual = self.against_between(trip.line, trip.dir, origin, &best);
            for pl in &best.places {
                if let Some(alt) = self.trip_path(trip.line, trip.dir, origin, depart_dir, &[*pl]) {
                    if !attempts.iter().any(|a| a.routes == alt.routes)
                        && alt.routes != best.routes
                        && !self.against_the_other_way(trip.line, trip.dir, &alt.places)
                        && self.against_between(trip.line, trip.dir, origin, &alt)
                            <= usual + OTHER_TRACK_TOLERANCE_M
                    {
                        attempts.push(alt);
                    }
                }
            }
            // On a main line, every platform of the terminal: a train held to the two nearest
            // ones could not get in while trains of other lines stood in both (test line, IC).
            if self.lines[trip.line].priority > 0 {
                let last = self.cands[trip.line][trip.dir as usize].len() - 1;
                let far: Vec<Place> = self.cands[trip.line][trip.dir as usize][last]
                    .iter()
                    .map(|&p| Place::Platform(p))
                    .collect();
                for &p in &far {
                    let banned: Vec<Place> = far.iter().copied().filter(|&x| x != p).collect();
                    if let Some(alt) =
                        self.trip_path(trip.line, trip.dir, origin, depart_dir, &banned)
                    {
                        if !attempts.iter().any(|a| a.routes == alt.routes)
                            && alt.routes != best.routes
                            && self.against_between(trip.line, trip.dir, origin, &alt)
                                <= usual + OTHER_TRACK_TOLERANCE_M
                        {
                            attempts.push(alt);
                        }
                    }
                }
            }
            attempts.insert(0, best);
        }
        let mut last_err: (Msg, Blocker) = (msg!("rail.plan.no_path_calls"), None);
        let mut first_err: Option<(Msg, Blocker)> = None;
        // Each path is searched for its earliest conflict-free departure; the one
        // that departs earliest wins (another platform before a later departure).
        let mut best: Option<(f64, FoundPath, TrainRun, RunTiming, Option<RunTiming>)> = None;
        for path in attempts.iter() {
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
                    if best.as_ref().is_none_or(|b| t < b.0 - 0.5) {
                        best = Some((t, path.clone(), mk(t), timing, prev_t));
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
        // Where lines of different ranks share track, a train that would leave late or not at all
        // has the lower-ranked trains in its way wait at a station for it, or waits there itself
        // for a higher-ranked one, if that costs less time.
        let mut waited: Option<Vec<Option<f64>>> = None;
        if best.as_ref().is_none_or(|b| b.0 > earliest + 0.5) && !attempts.is_empty() {
            let shift = best.as_ref().map(|b| b.0 - earliest);
            if let Some((t, path, run, timing, prev_t, dw)) = self.overtake(
                trip,
                &attempts[0],
                dwells,
                origin,
                depart_dir,
                earliest,
                vehicle,
                prev,
                hold_until,
                shift,
            ) {
                best = Some((t, path, run, timing, prev_t));
                waited = dw;
            }
        }
        if let Some((t, path, run, timing, prev_t)) = best {
            let dwells = waited.as_deref().unwrap_or(dwells);
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
            if waited.is_none() {
                self.remember(trip, &path.places);
            }
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

    /// Purpose: let a trip keep its time where a train of another rank is in its way: lower-ranked
    /// trains in its way wait at a station for it to pass, or, when a higher-ranked train is in its
    /// way, it waits at a station for that one, whichever applies, within
    /// [`PlanParams::max_overtake_wait_s`].
    /// Inputs: the trip, its usual path and dwells, where and which way it starts, its earliest
    /// departure, train, previous run, how long it holds its last platform, and how much later it
    /// could leave without this (None: not at all). Output: the departure, path, run, timing, the
    /// previous run's timing and, when the trip itself waits, its dwells; None when neither helps.
    /// Effect: the runs that wait for it are changed.
    #[allow(clippy::too_many_arguments, clippy::type_complexity)]
    fn overtake(
        &mut self,
        trip: &Trip,
        path: &FoundPath,
        dwells: &[Option<f64>],
        origin: Place,
        depart_dir: Dir,
        earliest: f64,
        vehicle: usize,
        prev: Option<usize>,
        hold_until: f64,
        shift: Option<f64>,
    ) -> Option<(
        f64,
        FoundPath,
        TrainRun,
        RunTiming,
        Option<RunTiming>,
        Option<Vec<Option<f64>>>,
    )> {
        let rank = self.lines[trip.line].priority;
        if self.lines.iter().all(|l| l.priority == rank) {
            return None;
        }
        let idx = self.runs.len();
        let occupy = |t: f64| Some(hold_until + (t - trip.dep).max(0.0));
        let (base, _) = self
            .build_run(
                trip.line,
                &trip.name,
                &path.routes,
                &path.places,
                dwells,
                0.0,
            )
            .ok()?;
        let mk = |t: f64| TrainRun {
            depart_s: t,
            occupy_until_s: occupy(t),
            ..base.clone()
        };
        let blocker = |pl: &Planner, run: &TrainRun| -> Option<usize> {
            let timing = pl.timing(run, idx).ok()?;
            pl.overlaps(&timing.blocking, vehicle, None)
                .2
                .map(|(r, _)| r)
        };
        let limit = shift.unwrap_or(self.p.max_shift_s + 1.0);
        // A lower-ranked train may wait longer than a departure may move, for the higher-ranked.
        let wait_limit = shift.unwrap_or(self.p.max_overtake_wait_s + 1.0);
        let mut t = earliest;
        for _ in 0..60 {
            if t - earliest >= limit - 0.5 {
                break;
            }
            let Ok(timing) = self.timing(&mk(t), idx) else {
                return None;
            };
            let (later, _, who) = self.overlaps(&timing.blocking, vehicle, None);
            let Some((first, _)) = who else {
                if let Ok((tm, t2, prev_t)) =
                    self.search_time(&mk, t, true, 0.0, vehicle, prev, idx)
                {
                    return Some((t2, path.clone(), mk(t2), tm, prev_t, None));
                }
                return None;
            };
            let other =
                (first < self.runs.len()).then(|| self.lines[self.runs[first].line].priority);
            if other.is_some_and(|o| o < rank) {
                // The trains in the way wait for this one, one after the other.
                let mut undo: Vec<Undo> = Vec::new();
                let mut who = Some(first);
                for _ in 0..6 {
                    let Some(r) = who.filter(|&r| r < self.runs.len()) else {
                        break;
                    };
                    if self.lines[self.runs[r].line].priority >= rank {
                        break;
                    }
                    let Ok(timing) = self.timing(&mk(t), idx) else {
                        break;
                    };
                    // The run itself is in the way, or the way out reserved for its train standing
                    // in a terminal platform: that train then leaves after this one has passed.
                    let buf = self.p.min_buffer_s;
                    let moved = if blocks_meet(&timing.blocking, &self.runs[r].blocking, buf) {
                        self.hold_back(r, rank, &timing.blocking, &mut undo)
                    } else {
                        self.give_up_way_out(self.runs[r].vehicle, &mut undo)
                    };
                    if !moved {
                        break;
                    }
                    who = blocker(self, &mk(t));
                    if who.is_none() {
                        if let Ok((tm, t2, prev_t)) =
                            self.search_time(&mk, t, true, 0.0, vehicle, prev, idx)
                        {
                            return Some((t2, path.clone(), mk(t2), tm, prev_t, None));
                        }
                        break;
                    }
                }
                self.undo(undo);
            } else if other.is_some_and(|o| o > rank) {
                // This train waits for the higher-ranked one, if that is sooner than leaving later.
                let most = wait_limit - (t - earliest);
                let mut found: Option<(f64, FoundPath, Vec<Option<f64>>)> = None;
                for (k, wp) in
                    self.wait_paths(trip.line, trip.dir, origin, depart_dir, path, dwells)
                {
                    let most = found.as_ref().map_or(most, |f| f.0);
                    let ok = |pl: &Planner, tm: &RunTiming| {
                        pl.overlaps(&tm.blocking, vehicle, None).2.is_none()
                    };
                    if let Some((_, _, w, dw)) = self.try_waits(
                        trip.line,
                        &trip.name,
                        k,
                        &wp,
                        dwells,
                        t,
                        occupy(t),
                        idx,
                        most,
                        &ok,
                    ) {
                        found = Some((w, wp, dw));
                    }
                }
                // Or it leaves later, after the higher-ranked train.
                let late_most = self.p.max_overtake_wait_s.min(most - 1.0).max(0.0);
                let late = self
                    .search_time(&mk, t, true, late_most, vehicle, prev, idx)
                    .ok()
                    .filter(|x| found.as_ref().is_none_or(|f| x.1 - t < f.0));
                if let Some((tm, t2, prev_t)) = late {
                    return Some((t2, path.clone(), mk(t2), tm, prev_t, None));
                }
                if let Some((_, wp, dw)) = found {
                    if let Ok((b2, _)) =
                        self.build_run(trip.line, &trip.name, &wp.routes, &wp.places, &dw, 0.0)
                    {
                        let mk2 = |t: f64| TrainRun {
                            depart_s: t,
                            occupy_until_s: occupy(t),
                            ..b2.clone()
                        };
                        if let Ok((tm, t2, prev_t)) =
                            self.search_time(&mk2, t, true, 0.0, vehicle, prev, idx)
                        {
                            return Some((t2, wp, mk2(t2), tm, prev_t, Some(dw)));
                        }
                    }
                }
            }
            t += later.max(1.0);
        }
        None
    }

    /// Purpose: the paths on which a train can wait at a station for another to pass: at each stop,
    /// its own path, and the path with another platform there (a loop, or the far side of an
    /// island), unless that leads onto the other direction's track.
    /// Inputs: the line, direction, where and which way it starts, its path and dwells.
    /// Output: (index of the stop among the path's places, path) pairs.
    fn wait_paths(
        &self,
        line: usize,
        dir: u8,
        origin: Place,
        depart_dir: Dir,
        path: &FoundPath,
        dwells: &[Option<f64>],
    ) -> Vec<(usize, FoundPath)> {
        let usual = self.against_between(line, dir, origin, path);
        let mut out = Vec::new();
        for k in 0..path.places.len().saturating_sub(1) {
            if dwells.get(k).copied().flatten().is_none() {
                continue;
            }
            out.push((k, path.clone()));
            if let Some(alt) = self.trip_path(line, dir, origin, depart_dir, &[path.places[k]]) {
                if alt.places.len() == path.places.len()
                    && alt.routes != path.routes
                    && self.against_between(line, dir, origin, &alt)
                        <= usual + OTHER_TRACK_TOLERANCE_M
                {
                    out.push((k, alt));
                }
            }
        }
        out
    }

    /// Purpose: the shortest wait at one stop of a path that makes a run acceptable.
    /// Inputs: the line, run name, stop index, path, dwells, departure, how long it holds its last
    /// platform (moved on by the wait), index of the run, the longest wait to try and the test.
    /// Output: the run, its timing, the wait and the dwells, or None.
    #[allow(clippy::too_many_arguments)]
    fn try_waits(
        &self,
        line: usize,
        name: &str,
        k: usize,
        path: &FoundPath,
        dwells: &[Option<f64>],
        depart_s: f64,
        occupy_until_s: Option<f64>,
        index: usize,
        most_s: f64,
        ok: &dyn Fn(&Planner, &RunTiming) -> bool,
    ) -> Option<Waited> {
        let step = 30.0;
        let mut w = step;
        while w <= self.p.max_overtake_wait_s.min(most_s - 1.0) + 1e-6 {
            let mut dw = dwells.to_vec();
            dw[k] = dw[k].map(|d| d + w);
            let (mut run, _) = self
                .build_run(line, name, &path.routes, &path.places, &dw, depart_s)
                .ok()?;
            run.occupy_until_s = occupy_until_s.map(|o| o + w);
            let timing = self.timing(&run, index).ok()?;
            if ok(self, &timing) {
                return Some((run, timing, w, dw));
            }
            w += step;
        }
        None
    }

    /// Purpose: have a placed run of a lower rank wait at one of its stations so that a train of
    /// the given rank can pass. Only the last run of its train is changed, before its next trip is
    /// placed. Inputs: the run, the rank, the passing train's blocks and the list of changes.
    /// Output: whether it now waits clear of the passing train. Effect: the run, its train and the
    /// list of changes (for [`Planner::undo`]).
    fn hold_back(
        &mut self,
        r: usize,
        rank: u8,
        passing: &[Blocking],
        undo: &mut Vec<Undo>,
    ) -> bool {
        let Some(pr) = self.runs.get(r).cloned() else {
            return false;
        };
        if pr.kind != RunKind::Service || self.lines[pr.line].priority >= rank {
            return false;
        }
        let v = pr.vehicle;
        if self.vehicles.get(v).map(|x| x.last_run) != Some(r) || pr.calls.len() < 3 {
            return false;
        }
        let Some(first_route) = pr.run.routes.first() else {
            return false;
        };
        let origin = pr.calls[0].place;
        let Some(depart_dir) = [Dir::Up, Dir::Down]
            .into_iter()
            .find(|&d| departure_routes(self.m, origin, d).contains(first_route))
        else {
            return false;
        };
        let n = pr.calls.len();
        let dwells: Vec<Option<f64>> = pr.calls[1..]
            .iter()
            .enumerate()
            .map(
                |(i, c)| match (c.stop && i + 2 < n, c.arrive_s, c.depart_s) {
                    (true, Some(a), Some(d)) => Some(d - a),
                    _ => None,
                },
            )
            .collect();
        let path = FoundPath {
            routes: pr.run.routes.clone(),
            places: pr.calls[1..].iter().map(|c| c.place).collect(),
            cost: 0.0,
        };
        let buf = self.p.min_buffer_s;
        let ok = |pl: &Planner, tm: &RunTiming| {
            !blocks_meet(&tm.blocking, passing, buf)
                && pl.overlaps(&tm.blocking, v, Some(r)).2.is_none()
        };
        let mut found: Option<(Waited, FoundPath)> = None;
        for (k, wp) in self.wait_paths(pr.line, pr.direction, origin, depart_dir, &path, &dwells) {
            let most = found.as_ref().map_or(f64::INFINITY, |f| f.0 .2);
            if let Some((run, tm, w, dw)) = self.try_waits(
                pr.line,
                &pr.name,
                k,
                &wp,
                &dwells,
                pr.run.depart_s,
                pr.run.occupy_until_s,
                r,
                most,
                &ok,
            ) {
                found = Some(((run, tm, w, dw), wp));
            }
        }
        let Some(((run, tm, _, dw), wp)) = found else {
            return false;
        };
        undo.push(Undo::Run(r, Box::new(pr.clone()), self.vehicles[v].clone()));
        let mut places = vec![origin];
        places.extend(wp.places.iter().copied());
        let mut d = vec![None];
        d.extend(dw.iter().copied());
        let mut calls = self.call_list(&places, &d);
        set_call_times(&mut calls, run.depart_s, &tm);
        self.remove_index(r);
        self.runs[r].run = run;
        self.runs[r].calls = calls;
        self.runs[r].blocking = tm.blocking;
        self.add_index(r);
        self.vehicles[v].ready_s = self.runs[r].arrive_s();
        true
    }

    /// Purpose: put back runs changed to let a train pass. Input: the changes, oldest first.
    fn undo(&mut self, undo: Vec<Undo>) {
        for u in undo.into_iter().rev() {
            match u {
                Undo::Run(r, pr, ve) => {
                    self.remove_index(r);
                    let v = pr.vehicle;
                    self.runs[r] = *pr;
                    self.add_index(r);
                    self.vehicles[v] = ve;
                }
                Undo::Reserved(entries) => {
                    for (tds, e) in entries {
                        self.reserved.entry(tds).or_default().push(e);
                    }
                }
            }
        }
    }

    /// Purpose: give up the way out reserved for a standing train, so a higher-ranked train can
    /// pass first; the standing train's next trip then leaves after it.
    /// Inputs: the train and the list of changes. Output: whether it had a way out reserved.
    /// Effect: the reservations and the list of changes (for [`Planner::undo`]).
    fn give_up_way_out(&mut self, v: usize, undo: &mut Vec<Undo>) -> bool {
        let entries: Vec<(TdsId, (usize, f64, f64))> = self
            .reserved
            .iter()
            .flat_map(|(&tds, x)| x.iter().filter(|e| e.0 == v).map(move |&e| (tds, e)))
            .collect();
        if entries.is_empty() {
            return false;
        }
        self.unreserve(v);
        undo.push(Undo::Reserved(entries));
        true
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
        // Back on its track: a pull-in still to be placed for it has nothing to do.
        self.vehicles[vehicle].at = Place::Storage(track);
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
    ) -> Result<(usize, usize), (Msg, Blocker)> {
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
            // A train put away there is back in time to be reused (otherwise a new one comes out of
            // the morning stabling, and costs as much as one from any other track).
            let back = s
                .now
                .iter()
                .any(|&v| self.vehicles[v].ready_s <= trip.dep - self.p.pull_out_margin_s);
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
                            + match (back, s.layover, has) {
                                (true, _, _) => 0.0,
                                (false, true, _) => 0.5e5,
                                (false, false, false) => 1.0e5,
                                // Trains put away there are still on their way: another track's
                                // first, to leave room for them.
                                (false, false, true) => 1.5e5,
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
                    match at {
                        Some(at) => msg!(
                            "rail.plan.storage_full_at",
                            tracks = names.join(", "),
                            station = at
                        ),
                        None => msg!("rail.plan.storage_full", tracks = names.join(", ")),
                    },
                    None,
                ));
            }
            return Err((
                match at {
                    Some(name) => msg!("rail.plan.no_stabling_reaches_at", station = name),
                    None => msg!("rail.plan.no_stabling_reaches"),
                },
                None,
            ));
        }
        let mut last = (msg!("rail.plan.detail", detail = ""), None);
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
                    msg!(
                        "rail.plan.no_train_for_siding",
                        track = self.m.tracks[track].id.clone()
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
                    .map(|p| (a, self.way_out(&p)))
            });
            let Some((adir, first)) = way_on else {
                last = (
                    msg!(
                        "rail.plan.no_way_on",
                        track = self.m.tracks[track].id.clone(),
                        to = self.place_name(origin)
                    ),
                    None,
                );
                continue;
            };
            // Prefer a platform whose way out is free at the departure.
            if !retry && opts_left > 1 && !self.way_out_free(trip.line, &first, trip.dep) {
                opts_left -= 1;
                queue.push((si, fp, true));
                last = (
                    msg!("rail.plan.way_out_taken", place = self.place_name(origin)),
                    None,
                );
                continue;
            }
            let name = format!("{}-po", trip.name);
            let variants = self.depot_variants(trip.line, &name, &fp);
            if variants.is_empty() {
                last = (
                    msg!(
                        "rail.plan.no_run_built",
                        track = self.m.tracks[track].id.clone(),
                        to = self.place_name(origin)
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
                // The vehicle: the front train of those there by then, or a new one in the
                // morning stabling. A train put away later than this one leaves is not in its
                // way: taking only the last one put away, a trip early in the day found it "not
                // back there in time" and had no train (Damascus test, T4).
                let s = &self.stacks[si];
                let there = s
                    .now
                    .iter()
                    .rposition(|&v| self.vehicles[v].ready_s <= ideal);
                let fresh = s.morning.len() < s.capacity && !s.layover;
                let (slot, vehicle) = match there {
                    Some(j) => (Some(j), s.now[j]),
                    None if s.now.is_empty() || fresh => (None, self.vehicles.len()),
                    // Every train put away there arrives later and the track has no room for more
                    // overnight.
                    None => (None, usize::MAX),
                };
                // A train already there leaves once it has arrived.
                let window = match slot {
                    Some(_) => self
                        .p
                        .max_depot_shift_s
                        .min(ideal - self.vehicles[vehicle].ready_s),
                    None if vehicle == usize::MAX => -1.0,
                    None => self.p.max_depot_shift_s,
                };
                if window < 0.0 {
                    last = (
                        msg!(
                            "rail.plan.next_train_late",
                            track = self.m.tracks[track].id.clone()
                        ),
                        None,
                    );
                    continue;
                }
                let idx = self.runs.len();
                // On a track other trains run over (a platform track used for stabling), the train
                // blocks it while it stands there: since it was put away, or since the start of the
                // day. Without this, trains were planned through a terminal platform with a train
                // stabled in it, and the kernel stopped there (Damascus test, Zahira).
                let shared = self.m.tracks[track].usage == TrackUse::Running
                    || self.m.platforms.iter().any(|p| p.track == track);
                let prev = slot
                    .filter(|_| shared)
                    .map(|_| self.vehicles[vehicle].last_run);
                match self.search_time(&mk, ideal, false, window, vehicle, prev, idx) {
                    Ok((mut timing, t, prev_t)) => {
                        // A train of the morning stabling stood there from the start of the day:
                        // the track must have had room for it with the trains put away since.
                        if slot.is_none()
                            && self.stacks[si].peak(0.0, t) >= self.stacks[si].capacity
                        {
                            last = (msg!("rail.plan.no_stabling_room"), None);
                            continue;
                        }
                        if shared && slot.is_none() {
                            let run = mk(t);
                            let (tk, a, b) =
                                self.standing_range(track, run.routes[0], run.train.length_m);
                            let mut hold = self.range_hold(tk, a, b, 0.0, t);
                            for b in &mut hold {
                                b.train = idx;
                            }
                            if let Some(who) = self.overlaps(&hold, vehicle, None).2 {
                                last = (msg!("rail.plan.cannot_wait"), Some(who));
                                continue;
                            }
                            timing.blocking.extend(hold);
                        }
                        let s = &mut self.stacks[si];
                        s.leave(vehicle, t);
                        if let Some(j) = slot {
                            s.now.remove(j);
                            // The trains behind it can only leave after it: a later pull-out may be
                            // placed earlier in time, and took a train blocked in by this one.
                            for &w in &s.now[..j] {
                                let ve = &mut self.vehicles[w];
                                ve.ready_s = ve.ready_s.max(t);
                            }
                        } else {
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
                        let i = self.commit(pr, timing, prev.zip(prev_t));
                        self.pulled_from.insert(i, (si, slot));
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
        Err((msg!("rail.plan.pull_out", reason = last.0), last.1))
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
                    let left = self
                        .runs
                        .iter()
                        .find(|r| r.name == name)
                        .map_or(ready, |r| r.run.depart_s);
                    let arrive = self.vehicles[v].ready_s;
                    let o = &mut self.stacks[oi];
                    o.leave(v, left);
                    if fresh {
                        o.morning.push(v);
                    } else {
                        o.now.pop();
                    }
                    self.stacks[si].now.push(v);
                    self.stacks[si].stays.push((v, arrive, f64::INFINITY));
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
                        reason: msg!("rail.plan.no_overnight_from_siding"),
                    });
                    break;
                }
            }
        }
    }

    /// Purpose: keep a train that could not be stabled in its last place.
    /// Inputs: the vehicle and the time it holds the place until, s.
    /// Output: Ok when the longer occupation fits (it is then committed); else the run in the
    /// way (None when the occupation cannot be worked out).
    fn hold_last_place(&mut self, v: usize, until: f64) -> Result<(), Blocker> {
        let pr = self.vehicles[v].last_run;
        let mut r = self.runs[pr].run.clone();
        if r.occupy_until_s.is_some_and(|u| u >= until) {
            return Ok(());
        }
        r.occupy_until_s = Some(until);
        let Ok(pt) = self.timing(&r, pr) else {
            return Err(None);
        };
        if let Some(who) = self.overlaps(&pt.blocking, v, Some(pr)).2 {
            return Err(Some(who));
        }
        self.remove_index(pr);
        self.runs[pr].run.occupy_until_s = Some(until);
        self.runs[pr].blocking = pt.blocking;
        self.add_index(pr);
        Ok(())
    }

    /// Purpose: a train's placed runs around a time: its last run leaving before it, and its runs
    /// leaving at or after it, in order.
    fn day_split(&self, w: usize, dep: f64) -> (Option<usize>, Vec<usize>) {
        let mut own: Vec<usize> = (0..self.runs.len())
            .filter(|&i| self.runs[i].vehicle == w && !self.runs[i].calls.is_empty())
            .collect();
        own.sort_by(|&a, &b| {
            self.runs[a]
                .run
                .depart_s
                .total_cmp(&self.runs[b].run.depart_s)
        });
        let k = own.partition_point(|&i| self.runs[i].run.depart_s < dep);
        (k.checked_sub(1).map(|j| own[j]), own[k..].to_vec())
    }

    /// Purpose: whether a placed run can be taken back: a passenger trip, or a pull-out or pull-in
    /// whose stack is known.
    fn can_take_back(&self, i: usize) -> bool {
        match self.runs[i].kind {
            RunKind::Service => self.trip_of_run.contains_key(&i),
            RunKind::PullOut => self.pulled_from.contains_key(&i),
            RunKind::PullIn => self.pulled_in.contains_key(&i),
        }
    }

    /// Purpose: take back a run that is in the way of a train standing in a platform it cannot
    /// leave, with the rest of that run's train's day, so the plan does not send two trains into
    /// one place.
    /// Inputs: the run in the way, the standing train, the trips and the train of each placed trip
    /// (both updated: a later trip of the circulation starts with a pull-out).
    /// Output: the train of the run taken back, which now stands where its run before ended (a
    /// platform, from where it is to be sent to stabling, or its storage track); None when the run
    /// cannot be taken back (the standing train's own, or one of the runs is not known).
    fn take_back(
        &mut self,
        run: usize,
        standing: usize,
        trips: &mut [Trip],
        trip_vehicle: &mut [Option<usize>],
    ) -> Option<usize> {
        let r = self.runs.get(run)?;
        let w = r.vehicle;
        let kind = r.kind;
        if r.calls.is_empty() || w == standing || !self.can_take_back(run) {
            return None;
        }
        let dep = r.run.depart_s;
        let (before, later) = self.day_split(w, dep);
        // A train brought out of stabling for this trip goes back with it.
        if let Some(b) = before.filter(|&b| {
            kind == RunKind::Service
                && self.runs[b].kind == RunKind::PullOut
                && self.pulled_from.contains_key(&b)
        }) {
            return self.take_back(b, standing, trips, trip_vehicle);
        }
        // A train brought out of stabling goes back onto its track; any other stays where its run
        // before ended, a platform.
        let at = match before {
            Some(b) => self.runs[b].calls.last()?.place,
            None if kind == RunKind::PullOut => self.runs[run].calls.first()?.place,
            None => return None,
        };
        let pull_out = kind == RunKind::PullOut;
        if later.first() != Some(&run)
            || matches!(at, Place::Storage(_)) != pull_out
            || later.iter().any(|&i| !self.can_take_back(i))
        {
            return None;
        }
        let blocked_by = self.runs[self.vehicles[standing].last_run].name.clone();
        // The latest first, so each train goes back onto its track as it stood.
        for &i in later.iter().rev() {
            match self.runs[i].kind {
                RunKind::PullOut => {
                    self.cancel_pull_out(i);
                    continue;
                }
                RunKind::PullIn => {
                    self.cancel_pull_in(i);
                    continue;
                }
                RunKind::Service => {}
            }
            self.remove_index(i);
            let ti = self.trip_of_run.remove(&i)?;
            trip_vehicle[ti] = None;
            if let Some(s) = trips[ti].succ {
                trips[s].pred = None;
            }
            let name = self.runs[i].name.clone();
            self.issues.retain(|x| {
                !matches!(x, Issue::Shifted { run, .. } | Issue::PlatformChange { trip: run, .. } if *run == name)
            });
            self.issues.push(Issue::Unplaced {
                trip: name.clone(),
                reason: msg!("rail.plan.platform_taken"),
                blocked_by: Some(blocked_by.clone()),
                section: None,
            });
            self.runs[i].blocking.clear();
            self.runs[i].calls.clear();
            self.runs[i].name = format!("{name} (cancelled)");
        }
        self.unreserve(w);
        // It is sent to stabling again, and says so again if it cannot go.
        self.issues
            .retain(|x| !matches!(x, Issue::NotStabled { vehicle, .. } if *vehicle == w));
        self.vehicles[w] = self.state_after(before, at);
        Some(w)
    }

    /// Purpose: a train's state after a run, or on its storage track before any run.
    fn state_after(&self, before: Option<usize>, at: Place) -> Vehicle {
        match before {
            Some(bi) => {
                let b = &self.runs[bi];
                let steps = route_steps(self.m, &b.run.routes).unwrap_or_default();
                Vehicle {
                    at,
                    arrive_dir: arrival_dir(self.m, &steps, at).unwrap_or(Dir::Up),
                    ready_s: b.arrive_s(),
                    last_run: bi,
                }
            }
            None => Vehicle {
                at,
                arrive_dir: Dir::Up,
                ready_s: 0.0,
                last_run: 0,
            },
        }
    }

    /// Purpose: take back a placed pull-out: its train goes back onto its storage track where it
    /// stood. Inputs: the pull-out's run index (one in `pulled_from`).
    fn cancel_pull_out(&mut self, run: usize) {
        let Some((si, slot)) = self.pulled_from.remove(&run) else {
            return;
        };
        let w = self.runs[run].vehicle;
        let dep = self.runs[run].run.depart_s;
        self.remove_index(run);
        self.runs[run].blocking.clear();
        self.runs[run].calls.clear();
        self.runs[run].name = format!("{} (cancelled)", self.runs[run].name);
        let st = &mut self.stacks[si];
        if let Some(x) = st.stays.iter_mut().find(|x| x.0 == w && x.2 == dep) {
            x.2 = f64::INFINITY;
        }
        match slot {
            Some(j) => st.now.insert(j.min(st.now.len()), w),
            // A train of the morning stabling (it stays one) that has not left yet: at the
            // buffer end, behind the trains put away since.
            None => st.now.insert(0, w),
        }
    }

    /// Purpose: take back a placed pull-in: its train is no longer on the storage track.
    /// Inputs: the pull-in's run index (one in `pulled_in`).
    fn cancel_pull_in(&mut self, run: usize) {
        let Some(si) = self.pulled_in.remove(&run) else {
            return;
        };
        let w = self.runs[run].vehicle;
        let arrive = self.runs[run].arrive_s();
        self.remove_index(run);
        self.runs[run].blocking.clear();
        self.runs[run].calls.clear();
        self.runs[run].name = format!("{} (cancelled)", self.runs[run].name);
        let st = &mut self.stacks[si];
        st.now.retain(|&x| x != w);
        st.stays
            .retain(|x| !(x.0 == w && (x.1 - arrive).abs() < 1.0));
    }

    /// Purpose: a train standing in a platform it cannot leave runs the trips of a train brought
    /// out of stabling to that platform for them; that train stays on its storage track.
    /// Inputs: the pull-out in the way, the standing train, the trips and the train of each
    /// placed trip (updated).
    /// Output: None when it cannot be done (not such a pull-out, or the standing train cannot
    /// wait until the first trip leaves); else the time to send the standing train to stabling
    /// after its new last trip, if that trip ends the circulation.
    fn hand_over(
        &mut self,
        run: usize,
        standing: usize,
        trips: &[Trip],
        trip_vehicle: &mut [Option<usize>],
    ) -> Option<Option<f64>> {
        let r = self.runs.get(run)?;
        let w = r.vehicle;
        let at = self.vehicles[standing].at;
        if r.kind != RunKind::PullOut
            || !self.pulled_from.contains_key(&run)
            || w == standing
            || r.calls.last().map(|c| c.place) != Some(at)
        {
            return None;
        }
        let dep = r.run.depart_s;
        let (before, later) = self.day_split(w, dep);
        let services = later.get(1..)?;
        let first = *services.first()?;
        if later[0] != run
            || self.runs[first].calls.first().map(|c| c.place) != Some(at)
            || services.iter().any(|&i| {
                self.runs[i].kind != RunKind::Service || !self.trip_of_run.contains_key(&i)
            })
        {
            return None;
        }
        // Try: without the pull-out, and with the trips its own, the standing train waits for the
        // first one.
        self.remove_index(run);
        for &i in services {
            self.runs[i].vehicle = standing;
        }
        let leave = self.runs[first].run.depart_s;
        if self.hold_last_place(standing, leave).is_err() {
            for &i in services {
                self.runs[i].vehicle = w;
            }
            self.add_index(run);
            return None;
        }
        let held = self.vehicles[standing].last_run;
        if let Some(c) = self.runs[held].calls.last_mut() {
            c.depart_s = Some(leave);
        }
        self.cancel_pull_out(run);
        for &i in services {
            trip_vehicle[self.trip_of_run[&i]] = Some(standing);
        }
        self.unreserve(w);
        self.unreserve(standing);
        self.vehicles[standing] = self.vehicles[w].clone();
        self.vehicles[w] = match before {
            Some(b) => self.state_after(Some(b), self.runs[b].calls.last()?.place),
            None => {
                let track = self.stacks[self.stacks.iter().position(|s| s.now.contains(&w))?].track;
                self.state_after(None, Place::Storage(track))
            }
        };
        // The way out after its new last trip, as it was reserved for the other train.
        let last = *services.last()?;
        let ti = self.trip_of_run[&last];
        Some(match trips[ti].succ {
            Some(s) => {
                self.reserve_way_out(standing, Some(&trips[s]), trips[s].dep);
                None
            }
            None => {
                Some(self.vehicles[standing].ready_s + self.lines[self.runs[last].line].turnback_s)
            }
        })
    }

    /// Purpose: send a train to stabling after its last trip.
    /// Inputs: the vehicle; `report`: record an issue when it cannot go.
    /// Output: true when a pull-in was placed.
    fn pull_in(&mut self, v: usize, report: bool) -> bool {
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
        let mut why = msg!("rail.plan.no_stabling_room");
        for (_, si, fp, dir) in opts {
            let track = self.stacks[si].track;
            let name = format!("{}-pi", self.runs[ve.last_run].name);
            let variants = self.depot_variants(line, &name, &fp);
            // On a track other trains run over (a terminal platform used for stabling), the train
            // blocks where it stands until it leaves again (its pull-out shortens this).
            let shared = self.m.tracks[track].usage == TrackUse::Running
                || self.m.platforms.iter().any(|p| p.track == track);
            for base in variants {
                let mk = |t: f64| TrainRun {
                    depart_s: t,
                    occupy_until_s: if shared {
                        Some(END_OF_DAY_S)
                    } else {
                        base.occupy_until_s
                    },
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
                        // Not in front of a train that leaves after it arrives.
                        let arrive = t + timing.profile.total_time_s();
                        let st = &self.stacks[si];
                        if st.blocks_one_leaving(arrive)
                            || st.peak(arrive, f64::INFINITY) >= st.capacity
                        {
                            why = msg!("rail.plan.no_stabling_room");
                            continue;
                        }
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
                        self.pulled_in.insert(i, si);
                        self.stacks[si].now.push(v);
                        self.stacks[si].stays.push((v, arrive, f64::INFINITY));
                        self.vehicles[v] = Vehicle {
                            at: Place::Storage(track),
                            arrive_dir: dir,
                            ready_s: self.runs[i].arrive_s(),
                            last_run: i,
                        };
                        return true;
                    }
                    Err(e) => why = e.0,
                }
            }
        }
        if report {
            self.issues.push(Issue::NotStabled {
                vehicle: v,
                at: ve.at.id(self.m),
                reason: why,
            });
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_pattern_keeps_the_two_directions_apart_where_they_share_track() {
        // Without the check, the best offset puts the two directions in the junction together.
        let free = periodic_pattern(
            600.0,
            &[0.0],
            0.0,
            1500.0,
            1500.0,
            240.0,
            120.0,
            [false; 2],
            &|_, _| false,
        );
        let meets = move |off: f64, _e: f64| (off - free.offset_s).rem_euclid(600.0) < 120.0;
        let p = periodic_pattern(
            600.0,
            &[0.0],
            0.0,
            1500.0,
            1500.0,
            240.0,
            120.0,
            [false; 2],
            &meets,
        );
        assert!(!meets(p.offset_s, p.extra_s), "{p:?}");
    }

    #[test]
    fn a_kept_profile_moved_on_by_longer_dwells_matches_one_worked_out_for_them() {
        // Profiles are kept once per path and stops; a wait at a stop only moves the times on.
        let train = crate::examples::metro_train();
        let segs = [rail_dynamics::Segment {
            length_m: 6000.0,
            speed_mps: 22.0,
            gradient: 0.0,
        }];
        let opt = rail_dynamics::RunOptions {
            start_speed_mps: 0.0,
            stop_at_end: true,
            step_m: 1.0,
        };
        let stops = |a: f64, b: f64| {
            [
                Stop {
                    position_m: 2000.4,
                    dwell_s: a,
                },
                Stop {
                    position_m: 4000.6,
                    dwell_s: b,
                },
            ]
        };
        let had = rail_dynamics::run(&train, &segs, &stops(30.0, 30.0), &opt).unwrap();
        let want = rail_dynamics::run(&train, &segs, &stops(150.0, 60.0), &opt).unwrap();
        let got = with_dwells(had, &[30.0, 30.0], 0.0, &stops(150.0, 60.0));
        for (g, w) in got.stops.iter().zip(&want.stops) {
            assert!(
                (g.0 - w.0).abs() < 1e-6 && (g.1 - w.1).abs() < 1e-6,
                "{g:?} {w:?}"
            );
        }
        for k in 0..want.arrive_s.len() {
            assert!(
                (got.arrive_s[k] - want.arrive_s[k]).abs() < 1e-6,
                "arrive at {k}"
            );
            assert!(
                (got.depart_s[k] - want.depart_s[k]).abs() < 1e-6,
                "depart at {k}"
            );
        }
    }

    #[test]
    fn at_a_one_platform_terminal_a_train_leaves_before_the_next_comes_in() {
        // Headway 420 s, turn-back 180 s: with two platforms the fewest trains can leave a train
        // waiting almost a whole headway; with one, it must be gone 90 s before the next arrives.
        let run = |one: [bool; 2]| {
            periodic_pattern(
                420.0,
                &[],
                0.0,
                4229.0,
                4233.0,
                180.0,
                90.0,
                one,
                &|_, _| false,
            )
        };
        let layover = |a: f64| (-(a + 180.0)).rem_euclid(420.0) + 180.0;
        let far = |p: Pattern| 4229.0 + p.extra_s / 2.0 - p.offset_s;
        let home = |p: Pattern| p.offset_s + 4233.0 + p.extra_s / 2.0;
        let p = run([true, true]);
        assert!(layover(far(p)) <= 420.0 - 90.0 + 1e-6, "{p:?}");
        assert!(layover(home(p)) <= 420.0 - 90.0 + 1e-6, "{p:?}");
    }
}
