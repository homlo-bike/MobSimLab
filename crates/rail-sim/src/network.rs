//! The network kernel (ADR-0032 §4): trains run a planned day on the
//! compiled network, under the interlocking and train protection.
//!
//! - **Automatic route setting (ARS).** Each train asks for the next route of
//!   its run when it approaches the entry signal (braking distance plus a
//!   sighting margin and a look-ahead), or `route_lead_s` before a planned
//!   departure. Routes are given in the **planned order**: a train gets a
//!   section only after every train the plan puts on it earlier has locked it.
//! - **Train protection.** A train's movement authority ends at the exit of
//!   its last locked route, at the rear of a train ahead (moving block, or a
//!   shunting move into an occupied siding) less a safety margin, and before
//!   a level crossing that is not proved closed (or, with obstacle detection,
//!   whose road zone is not clear). The permitted speed is the line speed
//!   (held until the tail clears a lower limit) and the braking curves to
//!   lower limits ahead and to the end of authority. A train above the
//!   permitted speed plus the supervision tolerance is braked at the
//!   emergency rate and the event is recorded (a bug in normal operation).
//! - **Driver model (ATO style).** Trains leave on time and never early;
//!   they run at the highest permitted speed when late and coast when ahead
//!   of the plan (using the running-time supplement); they stop at every
//!   planned stop for at least the dwell and hold until the planned
//!   departure (timing points).
//! - **Level crossings** are triggered when a train with a locked route over
//!   them is within the crossing's approach distance (or would otherwise have
//!   to brake for it), and opened when its tail has cleared the rail zone.
//!
//! The kernel advances in fixed steps of `step_s` (default 0.5 s); braking to
//! a target point uses the exact deceleration needed, so trains stop on the
//! point. Every step can check the five safety invariants of ADR-0032 §4; a
//! violation stops the run with a description.

use std::collections::{BTreeMap, BTreeSet};

use rail_dynamics::TrainParams;
use rail_interlocking::{Handle, Interlocking, Params as IlParams, Refusal};
use rail_model::{Dir, End, Model, PieceId, RouteId, Step, TdsId};
use rail_plan::{run_timing, BlockingParams, Plan, RunKind, RunTiming};
use serde::{Deserialize, Serialize};

const G: f64 = 9.81;

/// Kernel parameters (assumption library keys in brackets).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct NetParams {
    /// Time step, s.
    pub step_s: f64,
    /// Sighting margin added to the braking distance when asking for a route, m (`signalling.sighting_m`).
    pub request_margin_m: f64,
    /// Running time added to the request distance, s.
    pub request_lookahead_s: f64,
    /// A standing train asks for its first route this long before the planned departure, s.
    pub route_lead_s: f64,
    /// Distance a train stops short of the end of its authority (a signal at danger), m.
    pub eoa_margin_m: f64,
    /// Safety margin behind the rear of a train ahead (moving block, on sight), m
    /// (`signalling.moving_block_margin_m`).
    pub follow_margin_m: f64,
    /// Distance a train stops short of a level crossing that is not safe, m.
    pub crossing_margin_m: f64,
    /// Overspeed allowed before the protection brakes, m/s
    /// (`signalling.supervision_tolerance_kmh`).
    pub supervision_tol_mps: f64,
    /// Emergency braking rate as a multiple of the service rate (`sim.emergency_brake_factor`).
    pub emergency_factor: f64,
    /// Share of the service braking rate the driver model uses (`sim.ato_brake_share`).
    pub driver_brake_share: f64,
    /// A train this far ahead of its planned time coasts, s.
    pub coast_when_early_s: f64,
    /// Report a deadlock when no train has moved for this long while one waits for a route, s.
    pub deadlock_timeout_s: f64,
    /// Check the safety invariants at every step.
    pub check_invariants: bool,
    /// Gap between trains stabled on one track, m (as the planner's `stabling_gap_m`).
    pub stabling_gap_m: f64,
    /// Distance the first stabled train stands from the exit signal, m (as the planner's `stop_margin_m`).
    pub stop_margin_m: f64,
    /// Interlocking timing.
    pub interlocking: IlParams,
}

impl Default for NetParams {
    /// Purpose: planning defaults.
    fn default() -> Self {
        NetParams {
            step_s: 0.5,
            request_margin_m: 150.0,
            request_lookahead_s: 10.0,
            route_lead_s: 30.0,
            eoa_margin_m: 5.0,
            follow_margin_m: 50.0,
            crossing_margin_m: 20.0,
            supervision_tol_mps: 7.5 / 3.6,
            emergency_factor: 1.3,
            driver_brake_share: 0.85,
            coast_when_early_s: 10.0,
            deadlock_timeout_s: 900.0,
            check_invariants: true,
            stabling_gap_m: 10.0,
            stop_margin_m: 5.0,
            interlocking: IlParams::default(),
        }
    }
}

/// What a train is doing.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub enum Status {
    /// Standing before a run's planned departure (stabled or turning back).
    Waiting,
    /// Moving or stopped at a signal.
    Running,
    /// Standing at a planned stop until the given time at the earliest.
    Dwelling {
        /// Earliest departure.
        until: f64,
    },
    /// All its runs are done.
    Done,
}

/// A call as it happened.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct CallRecord {
    /// Plan run index.
    pub run: usize,
    /// Trip or run name.
    pub name: String,
    /// Call index in the run (0 = origin).
    pub call: usize,
    /// Platform or storage track id.
    pub place: String,
    /// Planned arrival, s.
    pub planned_arrive_s: Option<f64>,
    /// Actual arrival, s.
    pub arrive_s: Option<f64>,
    /// Planned departure, s.
    pub planned_depart_s: Option<f64>,
    /// Actual departure, s.
    pub depart_s: Option<f64>,
}

/// Something that happened.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub enum NetEvent {
    /// A train was braked by the protection for overspeed.
    Overspeed {
        /// Time.
        t: f64,
        /// Train (vehicle).
        train: usize,
        /// Speed, m/s.
        speed_mps: f64,
        /// Permitted speed, m/s.
        permitted_mps: f64,
    },
    /// No train moved for the deadlock time-out.
    Deadlock {
        /// Time.
        t: f64,
        /// Trains waiting for a route.
        waiting: Vec<usize>,
    },
    /// A train stopped before a level crossing that was not safe.
    HeldAtCrossing {
        /// Time.
        t: f64,
        /// Train.
        train: usize,
        /// Crossing index.
        crossing: usize,
    },
}

/// Snapshot of one train.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct TrainView {
    /// Vehicle number from the plan.
    pub vehicle: usize,
    /// Current or last run name.
    pub run: String,
    /// Status.
    pub status: Status,
    /// Speed, m/s.
    pub speed_mps: f64,
    /// Head position along the current run (from its first entry signal), m.
    pub head_m: f64,
    /// Distance to the end of the movement authority, m.
    pub authority_m: f64,
    /// Delay against the plan at the last call, s (positive = late).
    pub delay_s: f64,
}

#[derive(Clone, Debug)]
struct Path {
    /// Back part (reversed steps behind the first entry signal) then the run's steps.
    steps: Vec<Step>,
    /// Start of each step in path coordinates (0 = first entry signal).
    start: Vec<f64>,
    /// Speed segments: (start, end, speed, gradient).
    segs: Vec<(f64, f64, f64, f64)>,
    /// Each route of the run: (route, start, end).
    routes: Vec<(RouteId, f64, f64)>,
    /// Level crossings on the run: (index, position).
    crossings: Vec<(usize, f64)>,
}

impl Path {
    /// Purpose: pieces and chainage intervals covered by [a, b].
    fn cover(&self, m: &Model, a: f64, b: f64) -> Vec<(PieceId, f64, f64)> {
        let mut out = Vec::new();
        for (i, st) in self.steps.iter().enumerate() {
            let pc = &m.pieces[st.piece as usize];
            let (s0, s1) = (self.start[i], self.start[i] + pc.length_m());
            if s1 <= a + 1e-9 || s0 >= b - 1e-9 {
                continue;
            }
            let (u0, u1) = ((a - s0).max(0.0), (b - s0).min(s1 - s0));
            let (c0, c1) = match st.dir {
                Dir::Up => (pc.from_m + u0, pc.from_m + u1),
                Dir::Down => (pc.to_m - u1, pc.to_m - u0),
            };
            out.push((st.piece, c0, c1));
        }
        out
    }

    /// Purpose: path coordinate of a point (piece, chainage), if on the path.
    fn locate(&self, m: &Model, piece: PieceId, ch: f64) -> Option<f64> {
        self.steps.iter().enumerate().find_map(|(i, st)| {
            if st.piece != piece {
                return None;
            }
            let pc = &m.pieces[piece as usize];
            let u = match st.dir {
                Dir::Up => ch - pc.from_m,
                Dir::Down => pc.to_m - ch,
            };
            Some(self.start[i] + u)
        })
    }

    fn seg_at(&self, s: f64) -> usize {
        self.segs
            .iter()
            .position(|x| s < x.1)
            .unwrap_or(self.segs.len().saturating_sub(1))
    }
}

#[derive(Clone, Debug)]
struct RunInfo {
    plan_index: usize,
    routes: Vec<RouteId>,
    /// Stops: (position, min dwell, planned arrival, planned departure).
    stops: Vec<(f64, f64, f64, f64)>,
    end_m: f64,
    timing: RunTiming,
    depart_s: f64,
    /// Extra hold before departure (a disturbance), s.
    hold_s: f64,
}

#[derive(Clone, Debug)]
struct Train {
    vehicle: usize,
    params: TrainParams,
    runs: Vec<RunInfo>,
    k: usize,
    path: Path,
    s: f64,
    v: f64,
    status: Status,
    handles: Vec<Option<Handle>>,
    next_route: usize,
    next_stop: usize,
    /// Body on the network: (piece, chainage from, to).
    body: Vec<(PieceId, f64, f64)>,
    tds: BTreeSet<TdsId>,
    triggered: BTreeSet<usize>,
    held_at: Option<usize>,
    delay_s: f64,
    last_eoa: f64,
    /// Why the interlocking last refused this train's next route.
    refused: Option<String>,
}

/// The kernel.
pub struct NetworkSim<'m> {
    m: &'m Model,
    p: NetParams,
    il: Interlocking<'m>,
    trains: Vec<Train>,
    t: f64,
    /// Planned order of locks per section: (planned time, vehicle, run, route position).
    order: BTreeMap<TdsId, Vec<(f64, usize, usize, usize)>>,
    order_next: BTreeMap<TdsId, usize>,
    calls: Vec<CallRecord>,
    call_index: BTreeMap<(usize, usize), usize>,
    events: Vec<NetEvent>,
    last_move: f64,
    names: Vec<String>,
}

fn opposite(e: End) -> End {
    match e {
        End::A => End::B,
        End::B => End::A,
    }
}

/// Purpose: steps behind a piece entered in `dir` (walking backwards), using
/// the current switch positions, for at least `want` metres. Where the track
/// branches, a piece of `prefer` (the storage track the train stands on) wins
/// over the switch position, so two trains stabled on neighbouring sidings
/// behind one switch are each placed on their own siding.
fn back_steps(
    m: &Model,
    il: &Interlocking,
    first: Step,
    want: f64,
    prefer: Option<usize>,
) -> Vec<Step> {
    let mut out = Vec::new();
    let (mut piece, mut entry_end) = (first.piece, opposite(first.dir.exit_end()));
    let mut got = 0.0;
    while got < want && out.len() < 64 {
        let n = m.neighbours(piece, entry_end);
        let pick = if n.len() == 1 {
            Some(n[0])
        } else {
            n.iter()
                .copied()
                .find(|(p, _, _)| prefer.is_some_and(|t| m.pieces[*p as usize].track == t))
                .or_else(|| {
                    n.iter()
                        .copied()
                        .find(|(_, _, sw)| sw.is_some_and(|(s, pos)| il.switch(s).0 == pos))
                })
        };
        let Some((np, ne, _)) = pick else {
            break;
        };
        // We arrive at `np` through its end `ne`: the train travelled towards `ne`.
        let dir = if ne == End::B { Dir::Up } else { Dir::Down };
        out.push(Step {
            piece: np,
            dir,
            speed_cap_mps: None,
        });
        got += m.pieces[np as usize].length_m();
        piece = np;
        entry_end = opposite(ne);
    }
    out.reverse();
    out
}

fn build_path(
    m: &Model,
    il: &Interlocking,
    routes: &[RouteId],
    back_m: f64,
    prefer: Option<usize>,
) -> Path {
    let mut run_steps: Vec<Step> = Vec::new();
    let mut rs = Vec::new();
    let mut x = 0.0;
    for &r in routes {
        let route = &m.routes[r as usize];
        run_steps.extend_from_slice(&route.steps);
        rs.push((r, x, x + route.length_m));
        x += route.length_m;
    }
    let back = back_steps(m, il, run_steps[0], back_m, prefer);
    let back_len: f64 = back
        .iter()
        .map(|s| m.pieces[s.piece as usize].length_m())
        .sum();
    let steps: Vec<Step> = back.into_iter().chain(run_steps).collect();
    let mut start = Vec::with_capacity(steps.len());
    let mut y = -back_len;
    for st in &steps {
        start.push(y);
        y += m.pieces[st.piece as usize].length_m();
    }
    let mut segs = Vec::new();
    let mut y = -back_len;
    for p in m.profile(&steps) {
        segs.push((y, y + p.length_m, p.speed_mps, p.gradient));
        y += p.length_m;
    }
    let mut crossings = Vec::new();
    for (i, lc) in m.level_crossings.iter().enumerate() {
        for (k, st) in steps.iter().enumerate() {
            if st.piece == lc.piece && start[k] >= -1e-6 {
                let pc = &m.pieces[st.piece as usize];
                let u = match st.dir {
                    Dir::Up => lc.spec.position_m - pc.from_m,
                    Dir::Down => pc.to_m - lc.spec.position_m,
                };
                crossings.push((i, start[k] + u));
            }
        }
    }
    crossings.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap());
    Path {
        steps,
        start,
        segs,
        routes: rs,
        crossings,
    }
}

impl<'m> NetworkSim<'m> {
    /// Purpose: set up a run of a planned day.
    /// Inputs: model, plan, kernel parameters.
    /// Output: the kernel at the start of the day with every train stabled
    /// as the plan's morning stabling says, or an error.
    pub fn new(m: &'m Model, plan: &Plan, p: NetParams) -> Result<Self, String> {
        let mut il = Interlocking::new(m, p.interlocking.clone());
        let bp = BlockingParams::default();
        let mut by_vehicle: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
        for (i, r) in plan.runs.iter().enumerate() {
            by_vehicle.entry(r.vehicle).or_default().push(i);
        }
        let mut infos: BTreeMap<usize, Vec<RunInfo>> = BTreeMap::new();
        let mut params: BTreeMap<usize, TrainParams> = BTreeMap::new();
        for (&v, runs) in &mut by_vehicle {
            runs.sort_by(|a, b| {
                plan.runs[*a]
                    .depart_s()
                    .partial_cmp(&plan.runs[*b].depart_s())
                    .unwrap()
            });
            let mut out = Vec::new();
            for &i in runs.iter() {
                let pr = &plan.runs[i];
                let timing = run_timing(m, &pr.run, i, &bp)?;
                params.insert(v, pr.run.train.clone());
                let stops = pr
                    .run
                    .stops
                    .iter()
                    .zip(timing.profile.stops.iter())
                    .map(|(s, &(a, d))| {
                        (
                            s.position_m,
                            s.dwell_s,
                            timing.depart_s + a,
                            timing.depart_s + d,
                        )
                    })
                    .collect();
                let len: f64 = pr
                    .run
                    .routes
                    .iter()
                    .map(|&r| m.routes[r as usize].length_m)
                    .sum();
                let end_m = match pr.run.end_m {
                    Some(e) => e,
                    None if pr.run.stop_at_end => len - p.stop_margin_m,
                    None => len,
                };
                out.push(RunInfo {
                    plan_index: i,
                    routes: pr.run.routes.clone(),
                    stops,
                    end_m,
                    depart_s: pr.run.depart_s,
                    hold_s: 0.0,
                    timing,
                });
            }
            infos.insert(v, out);
        }
        // Morning positions: the stabling stacks, front first.
        let mut stack_pos: BTreeMap<usize, usize> = BTreeMap::new();
        for vs in plan.stabling_start.values() {
            for (j, &v) in vs.iter().enumerate() {
                stack_pos.insert(v, j);
            }
        }
        let mut trains = Vec::new();
        let mut names = Vec::new();
        for (v, runs) in infos {
            let tp = params[&v].clone();
            let j = stack_pos.get(&v).copied().unwrap_or(0) as f64;
            let s0 = -(p.stop_margin_m + j * (tp.length_m + p.stabling_gap_m));
            let back = tp.length_m - s0 + 50.0;
            let storage = plan
                .stabling_start
                .iter()
                .find(|(_, vs)| vs.contains(&v))
                .and_then(|(t, _)| m.track(t));
            let path = build_path(m, &il, &runs[0].routes, back, storage);
            let body = path.cover(m, s0 - tp.length_m, s0);
            let tds: BTreeSet<TdsId> = body
                .iter()
                .map(|&(pc, _, _)| m.pieces[pc as usize].tds)
                .collect();
            il.place(trains.len() as u32, &tds);
            let n = runs[0].routes.len();
            names.push(plan.runs[runs[0].plan_index].name.clone());
            trains.push(Train {
                vehicle: v,
                params: tp,
                runs,
                k: 0,
                path,
                s: s0,
                v: 0.0,
                status: Status::Waiting,
                handles: vec![None; n],
                next_route: 0,
                next_stop: 0,
                body,
                tds,
                triggered: BTreeSet::new(),
                held_at: None,
                delay_s: 0.0,
                last_eoa: s0,
                refused: None,
            });
        }
        // Planned order of locks per section.
        let mut order: BTreeMap<TdsId, Vec<(f64, usize, usize, usize)>> = BTreeMap::new();
        for (ti, tr) in trains.iter().enumerate() {
            for (k, ri) in tr.runs.iter().enumerate() {
                let mut x = 0.0;
                for (q, &r) in ri.routes.iter().enumerate() {
                    let at = ri.timing.time_at(x, 0.0);
                    for &s in &m.routes[r as usize].tds {
                        order.entry(s).or_default().push((at, ti, k, q));
                    }
                    x += m.routes[r as usize].length_m;
                }
            }
        }
        for v in order.values_mut() {
            v.sort_by(|a, b| a.partial_cmp(b).unwrap());
            v.dedup_by(|a, b| a.1 == b.1 && a.2 == b.2 && a.3 == b.3);
        }
        // Call records.
        let mut calls = Vec::new();
        let mut call_index = BTreeMap::new();
        for (i, r) in plan.runs.iter().enumerate() {
            if r.kind != RunKind::Service {
                continue;
            }
            for (c, ct) in r.calls.iter().enumerate() {
                if !ct.stop {
                    continue;
                }
                call_index.insert((i, c), calls.len());
                calls.push(CallRecord {
                    run: i,
                    name: r.name.clone(),
                    call: c,
                    place: ct.id.clone(),
                    planned_arrive_s: ct.arrive_s,
                    arrive_s: None,
                    planned_depart_s: ct.depart_s,
                    depart_s: None,
                });
            }
        }
        let t0 = trains
            .iter()
            .map(|t| t.runs[0].depart_s - p.route_lead_s - 60.0)
            .fold(f64::INFINITY, f64::min)
            .max(0.0);
        il.update(t0);
        Ok(NetworkSim {
            m,
            p,
            il,
            trains,
            t: (t0 / 60.0).floor() * 60.0,
            order,
            order_next: BTreeMap::new(),
            calls,
            call_index,
            events: Vec::new(),
            last_move: 0.0,
            names,
        })
    }

    /// Purpose: current time, s.
    pub fn time(&self) -> f64 {
        self.t
    }

    /// Purpose: the interlocking (read only).
    pub fn interlocking(&self) -> &Interlocking<'m> {
        &self.il
    }

    /// Purpose: report whether a level crossing's road zone is clear (street simulation).
    pub fn set_road_zone_clear(&mut self, crossing: usize, clear: bool) {
        self.il.set_road_zone_clear(crossing, clear);
    }

    /// Purpose: the record of calls so far.
    pub fn calls(&self) -> &[CallRecord] {
        &self.calls
    }

    /// Purpose: events so far.
    pub fn events(&self) -> &[NetEvent] {
        &self.events
    }

    /// Purpose: snapshots of all trains.
    pub fn trains(&self) -> Vec<TrainView> {
        self.trains
            .iter()
            .enumerate()
            .map(|(i, tr)| TrainView {
                vehicle: tr.vehicle,
                run: self.names[i].clone(),
                status: tr.status,
                speed_mps: tr.v,
                head_m: tr.s,
                authority_m: (tr.last_eoa - tr.s).max(0.0),
                delay_s: tr.delay_s,
            })
            .collect()
    }

    /// Purpose: whether every train has finished its runs.
    pub fn finished(&self) -> bool {
        self.trains.iter().all(|t| t.status == Status::Done)
    }

    /// Purpose: run until `t_end` or until all trains are done.
    /// Output: Err with a state description on a safety invariant violation or a deadlock.
    pub fn run_until(&mut self, t_end: f64) -> Result<(), String> {
        while self.t < t_end && !self.finished() {
            self.step()?;
        }
        Ok(())
    }

    fn may_lock(&self, ti: usize, route: RouteId) -> bool {
        let tr = &self.trains[ti];
        let me = (ti, tr.k, tr.next_route);
        self.m.routes[route as usize].tds.iter().all(|s| {
            let Some(q) = self.order.get(s) else {
                return true;
            };
            let next = self.order_next.get(s).copied().unwrap_or(0);
            q.get(next).map_or(true, |x| (x.1, x.2, x.3) == me)
        })
    }

    /// Purpose: why a standing train cannot get its next route, as text: the
    /// section and the run the plan puts on it first, or the interlocking.
    fn blocked_by(&self, ti: usize) -> Option<String> {
        let tr = &self.trains[ti];
        if tr.status != Status::Running || tr.v != 0.0 {
            return None;
        }
        let run = &self.names_of(ti);
        let Some(&(route, _, _)) = tr.path.routes.get(tr.next_route) else {
            return Some(format!("{run} waits at the end of its authority"));
        };
        let me = (ti, tr.k, tr.next_route);
        for s in &self.m.routes[route as usize].tds {
            let Some(q) = self.order.get(s) else { continue };
            let next = self.order_next.get(s).copied().unwrap_or(0);
            if let Some(x) = q.get(next) {
                if (x.1, x.2, x.3) != me {
                    let other = &self.trains[x.1];
                    let name = other
                        .runs
                        .get(x.2)
                        .map(|r| r.plan_index.to_string())
                        .unwrap_or_default();
                    return Some(format!(
                        "{run} waits on section {} for plan run {name} (train {})",
                        self.m.tds[*s as usize].id, other.vehicle
                    ));
                }
            }
        }
        Some(format!(
            "{run} waits for the interlocking to set route {}: {}",
            self.m.routes[route as usize].id,
            tr.refused.as_deref().unwrap_or("not asked yet")
        ))
    }

    fn names_of(&self, ti: usize) -> String {
        let tr = &self.trains[ti];
        format!(
            "train {} (plan run {})",
            tr.vehicle,
            tr.runs.get(tr.k).map(|r| r.plan_index).unwrap_or(0)
        )
    }

    fn locked_in_order(&mut self, ti: usize, route: RouteId) {
        let tr = &self.trains[ti];
        let me = (ti, tr.k, tr.next_route);
        for s in &self.m.routes[route as usize].tds {
            if let Some(q) = self.order.get(s) {
                let n = self.order_next.entry(*s).or_insert(0);
                if q.get(*n).is_some_and(|x| (x.1, x.2, x.3) == me) {
                    *n += 1;
                }
            }
        }
    }

    /// Purpose: end of authority and the reason, in path coordinates.
    /// Output: (end of authority, crossing that limits it).
    /// Output: (end of authority, crossing that limits it, whether a train ahead limits it).
    fn authority(&self, ti: usize) -> (f64, Option<usize>, bool) {
        let tr = &self.trains[ti];
        let mut eoa = 0.0f64.min(tr.s);
        for (q, &(_, _, end)) in tr.path.routes.iter().enumerate() {
            match tr.handles[q] {
                // A route the head has left may already be released behind the train.
                Some(_) if end <= tr.s + 1e-6 => eoa = eoa.max(end),
                Some(h) if self.il.usable(h) => eoa = end,
                _ => break,
            }
        }
        // Trains ahead on the path (moving block, sidings, turn-back).
        let mut behind = false;
        for (oi, o) in self.trains.iter().enumerate() {
            if oi == ti {
                continue;
            }
            for &(pc, c0, c1) in &o.body {
                for (i, st) in tr.path.steps.iter().enumerate() {
                    if st.piece != pc {
                        continue;
                    }
                    let p = &self.m.pieces[pc as usize];
                    let (u0, u1) = match st.dir {
                        Dir::Up => (c0 - p.from_m, c1 - p.from_m),
                        Dir::Down => (p.to_m - c1, p.to_m - c0),
                    };
                    let rear = tr.path.start[i] + u0.min(u1);
                    if rear > tr.s - 1e-6 {
                        let lim = rear - self.p.follow_margin_m + self.p.eoa_margin_m;
                        if lim < eoa {
                            eoa = lim;
                            behind = true;
                        }
                    }
                }
            }
        }
        let mut limit = None;
        for &(lc, at) in &tr.path.crossings {
            let zone = self.m.level_crossings[lc].spec.rail_zone_m;
            if at - zone > tr.s && at < eoa + zone && !self.il.crossing_safe(lc) {
                let stop = at - zone - self.p.crossing_margin_m + self.p.eoa_margin_m;
                if stop < eoa {
                    eoa = stop.max(tr.s.min(eoa));
                    limit = Some(lc);
                    behind = false;
                }
                break;
            }
        }
        (eoa, limit, behind)
    }

    /// Purpose: static permitted speed at the head, with the train-length rule
    /// and braking curves to lower limits ahead (rate `b`).
    fn static_speed(&self, tr: &Train, b: f64) -> f64 {
        let path = &tr.path;
        let mut v = tr.params.max_speed_mps;
        for &(s0, s1, sp, _) in &path.segs {
            if s1 > tr.s - tr.params.length_m && s0 <= tr.s {
                v = v.min(sp);
            } else if s0 > tr.s {
                v = v.min((sp * sp + 2.0 * b * (s0 - tr.s)).sqrt());
                if s0 - tr.s > 3000.0 {
                    break;
                }
            }
        }
        v
    }

    /// Purpose: advance by one time step.
    /// Output: Err on an invariant violation or a deadlock.
    pub fn step(&mut self) -> Result<(), String> {
        let dt = self.p.step_s;
        let t = self.t;
        self.il.update(t);
        let mut moved = false;
        let mut waiting = Vec::new();
        for ti in 0..self.trains.len() {
            if self.trains[ti].status == Status::Done {
                continue;
            }
            self.ars(ti);
            self.crossings(ti);
            let before = self.trains[ti].s;
            self.drive(ti, dt)?;
            if (self.trains[ti].s - before).abs() > 1e-6 {
                moved = true;
            }
            let tr = &self.trains[ti];
            if tr.status == Status::Running && tr.v == 0.0 {
                waiting.push(tr.vehicle);
            }
        }
        if moved || waiting.is_empty() {
            self.last_move = t;
        } else if t - self.last_move > self.p.deadlock_timeout_s {
            self.events.push(NetEvent::Deadlock {
                t,
                waiting: waiting.clone(),
            });
            let why: Vec<String> = (0..self.trains.len())
                .filter_map(|ti| self.blocked_by(ti))
                .collect();
            return Err(format!(
                "deadlock at {t:.0} s: trains {waiting:?} wait for routes ({})",
                why.join("; ")
            ));
        }
        self.t += dt;
        if self.p.check_invariants {
            self.check()?;
        }
        Ok(())
    }

    fn ars(&mut self, ti: usize) {
        let t = self.t;
        loop {
            let tr = &self.trains[ti];
            let q = tr.next_route;
            if q >= tr.path.routes.len() {
                return;
            }
            let run = &tr.runs[tr.k];
            let (route, start, _) = tr.path.routes[q];
            // Routes are asked for when the train approaches their entry signal
            // (braking distance, sighting margin and a look-ahead); a standing
            // train asks for the route in front of it shortly before it may leave.
            let reach = tr.params.braking_distance(tr.v)
                + self.p.request_margin_m
                + tr.v * self.p.request_lookahead_s;
            let near = q == 0 || start - tr.s <= reach;
            let due = near
                && match tr.status {
                    Status::Waiting => t >= run.depart_s + run.hold_s - self.p.route_lead_s,
                    Status::Dwelling { until } => t >= until - self.p.route_lead_s,
                    Status::Running => true,
                    Status::Done => false,
                };
            if !due {
                return;
            }
            if !self.may_lock(ti, route) {
                return;
            }
            let rq = self.il.request(t, route, ti as u32);
            match rq {
                Ok(h) => {
                    self.locked_in_order(ti, route);
                    let tr = &mut self.trains[ti];
                    tr.refused = None;
                    tr.handles[q] = Some(h);
                    tr.next_route += 1;
                }
                Err(r) => {
                    let why = match r {
                        Refusal::Occupied(s) => {
                            format!("section {} is occupied", self.m.tds[s as usize].id)
                        }
                        Refusal::Locked(s) => {
                            format!("section {} is locked", self.m.tds[s as usize].id)
                        }
                        Refusal::SwitchLocked(w) => {
                            format!("switch {} is locked", self.m.switches[w as usize].id)
                        }
                        Refusal::SwitchOccupied(w) => {
                            format!("switch {} is occupied", self.m.switches[w as usize].id)
                        }
                        Refusal::Flank(w) => {
                            format!("no flank protection at {}", self.m.switches[w as usize].id)
                        }
                        Refusal::Unavailable => "the route is out of service".into(),
                    };
                    self.trains[ti].refused = Some(why);
                    return;
                }
            }
        }
    }

    fn crossings(&mut self, ti: usize) {
        let t = self.t;
        let tr = &self.trains[ti];
        let mut trig = Vec::new();
        let mut clear = Vec::new();
        for &(lc, at) in &tr.path.crossings {
            let spec = &self.m.level_crossings[lc].spec;
            let q = tr.path.routes.iter().position(|r| at >= r.1 && at <= r.2);
            let locked = q.is_some_and(|q| tr.handles[q].is_some_and(|h| self.il.usable(h)));
            let dist = at - tr.s;
            let reach = tr.params.braking_distance(tr.v) / self.p.driver_brake_share
                + self.p.crossing_margin_m
                + spec.rail_zone_m
                + tr.v * 2.0 * self.p.step_s;
            if locked
                && dist > -spec.rail_zone_m
                && (dist <= spec.approach_m || dist <= reach + 30.0)
            {
                trig.push(lc);
            }
            if tr.triggered.contains(&lc) && tr.s - tr.params.length_m > at + spec.rail_zone_m {
                clear.push(lc);
            }
        }
        for lc in trig {
            if self.trains[ti].triggered.insert(lc) {
                self.il.trigger_crossing(t, lc, ti as u32);
            }
        }
        for lc in clear {
            self.trains[ti].triggered.remove(&lc);
            self.il.clear_crossing(t, lc, ti as u32);
        }
    }

    /// Purpose: hold a planned run at its origin beyond its planned departure
    /// (a disturbance, for example a late crew or a door fault).
    /// Inputs: plan run index and the extra hold, s.
    /// Output: false if the run is unknown or already left.
    pub fn delay_departure(&mut self, plan_run: usize, by_s: f64) -> bool {
        for tr in &mut self.trains {
            for (k, r) in tr.runs.iter_mut().enumerate() {
                if r.plan_index == plan_run {
                    if k < tr.k || (k == tr.k && tr.status != Status::Waiting) {
                        return false;
                    }
                    r.hold_s += by_s.max(0.0);
                    return true;
                }
            }
        }
        false
    }

    fn record_call(&mut self, run: usize, call: usize, arrive: Option<f64>, depart: Option<f64>) {
        if let Some(&i) = self.call_index.get(&(run, call)) {
            let c = &mut self.calls[i];
            if arrive.is_some() {
                c.arrive_s = arrive;
            }
            if depart.is_some() {
                c.depart_s = depart;
            }
        }
    }

    fn drive(&mut self, ti: usize, dt: f64) -> Result<(), String> {
        let t = self.t;
        // Departures.
        match self.trains[ti].status {
            Status::Waiting => {
                let tr = &self.trains[ti];
                let run = &tr.runs[tr.k];
                if t + 1e-9 < run.depart_s + run.hold_s {
                    return Ok(());
                }
                let pi = run.plan_index;
                // The train also leaves the last call of its previous run (a turn-back).
                let prev = (tr.k > 0).then(|| {
                    let r = &tr.runs[tr.k - 1];
                    (r.plan_index, r.stops.len() + 1)
                });
                self.trains[ti].status = Status::Running;
                self.trains[ti].delay_s = t - self.trains[ti].runs[self.trains[ti].k].depart_s;
                self.record_call(pi, 0, None, Some(t));
                if let Some((pp, pc)) = prev {
                    self.record_call(pp, pc, None, Some(t));
                }
            }
            Status::Dwelling { until } => {
                if t + 1e-9 < until {
                    return Ok(());
                }
                let (eoa, _, _) = self.authority(ti);
                let tr = &self.trains[ti];
                if eoa - tr.s < self.p.eoa_margin_m + 1.0 {
                    return Ok(());
                }
                let pi = tr.runs[tr.k].plan_index;
                let ns = tr.next_stop;
                self.trains[ti].status = Status::Running;
                self.trains[ti].next_stop += 1;
                self.record_call(pi, ns + 1, None, Some(t));
            }
            Status::Running => {}
            Status::Done => return Ok(()),
        }
        let (eoa, crossing, behind) = self.authority(ti);
        let p = self.p.clone();
        let tr = &mut self.trains[ti];
        tr.last_eoa = eoa;
        let run = &tr.runs[tr.k];
        let b = tr.params.service_decel_mps2;
        let bd = b * p.driver_brake_share;
        // Target point: the next stop, the end of the run, or the end of authority.
        let stop = run.stops.get(tr.next_stop).map(|x| x.0);
        let end_target = run.end_m;
        let eoa_target = eoa - p.eoa_margin_m;
        let mut target = eoa_target.min(end_target);
        let mut target_is_stop = false;
        if let Some(sp) = stop {
            if sp <= target + 1e-6 {
                target = sp;
                target_is_stop = true;
            }
        }
        let target_is_end = !target_is_stop && (end_target - target).abs() < 1e-6;
        // Permitted speed (protection) and the driver's target speed.
        let v_static = {
            let path = &tr.path;
            let mut v = tr.params.max_speed_mps;
            for &(s0, s1, sp, _) in &path.segs {
                if s1 > tr.s - tr.params.length_m && s0 <= tr.s {
                    v = v.min(sp);
                } else if s0 > tr.s {
                    v = v.min((sp * sp + 2.0 * b * (s0 - tr.s)).sqrt());
                    if s0 - tr.s > 3000.0 {
                        break;
                    }
                }
            }
            v
        };
        let permitted = v_static.min((2.0 * b * (eoa - tr.s).max(0.0)).sqrt());
        let v_drv_static = {
            let mut v = tr.params.max_speed_mps;
            for &(s0, s1, sp, _) in &tr.path.segs {
                if s1 > tr.s - tr.params.length_m && s0 <= tr.s {
                    v = v.min(sp);
                } else if s0 > tr.s {
                    v = v.min((sp * sp + 2.0 * bd * (s0 - tr.s)).sqrt());
                    if s0 - tr.s > 3000.0 {
                        break;
                    }
                }
            }
            v
        };
        let d = (target - tr.s).max(0.0);
        let v_target = v_drv_static.min((2.0 * bd * d).sqrt());
        // Early or late against the plan.
        let planned_t = run.timing.time_at(tr.s.max(0.0), 0.0);
        let early = planned_t - t > p.coast_when_early_s;
        let seg = tr.path.seg_at(tr.s);
        let grad = tr.path.segs.get(seg).map_or(0.0, |x| x.3);
        let m_eff = tr.params.mass_kg * tr.params.rotating_mass_factor;
        let resist = (tr.params.resistance(tr.v) + tr.params.mass_kg * G * grad) / m_eff;
        let mut a;
        if tr.v > permitted + p.supervision_tol_mps {
            a = -b * p.emergency_factor;
            self.events.push(NetEvent::Overspeed {
                t,
                train: tr.vehicle,
                speed_mps: tr.v,
                permitted_mps: permitted,
            });
        } else if tr.v * tr.v >= 2.0 * bd * d - 1e-9
            && d < 1e6
            && tr.v > 0.0
            && tr.v * tr.v / (2.0 * d.max(1e-3)) >= bd * 0.98
        {
            // On the braking curve to the target point: exact deceleration.
            a = -(tr.v * tr.v / (2.0 * d.max(1e-3))).min(b * p.emergency_factor);
        } else if tr.v > v_target + 0.05 {
            a = -bd.min((tr.v - v_target) / dt);
        } else if early && tr.v > 0.5 * v_target {
            a = -resist; // coast
        } else {
            let f = tr.params.tractive_effort(tr.v) / m_eff;
            a = f - resist;
            a = a.min((v_target - tr.v) / dt + resist.min(0.0)).max(-bd);
            if a < 0.0 && tr.v < v_target {
                a = 0.0;
            }
        }
        let v_new = (tr.v + a * dt).max(0.0);
        let mut ds = if tr.v + a * dt < 0.0 && a < 0.0 {
            tr.v * tr.v / (-2.0 * a)
        } else {
            (tr.v + v_new) * 0.5 * dt
        };
        let mut v_new = v_new;
        if tr.s + ds >= target - 0.01 && target >= tr.s - 1e-9 {
            ds = (target - tr.s).max(0.0);
            v_new = if ds < 0.05 || a < 0.0 { 0.0 } else { v_new };
            if a < 0.0 || v_new == 0.0 {
                v_new = 0.0;
            }
        }
        // A standing train passes nothing: its authority may end behind its
        // head when a train ahead stands closer than the following margin (a
        // shunting move on sight into an occupied siding, or a stabling stack).
        if ds > 1e-9 && tr.s + ds > eoa + 1e-6 {
            return Err(format!(
                "invariant 2: train {} would pass its end of authority at {:.1} m (authority {:.1} m) at {t:.1} s",
                tr.vehicle,
                tr.s + ds,
                eoa
            ));
        }
        tr.s += ds;
        tr.v = v_new;
        // Arrivals.
        let at_target = tr.v == 0.0 && (target - tr.s).abs() < 0.05;
        if at_target && target_is_stop {
            let (_, dwell, _, pdep) = run.stops[tr.next_stop];
            let until = (t + dt + dwell).max(pdep);
            let pi = run.plan_index;
            let call = tr.next_stop + 1;
            tr.status = Status::Dwelling { until };
            tr.delay_s = t + dt - run.stops[tr.next_stop].2;
            self.record_call(pi, call, Some(t + dt), None);
        } else if at_target && target_is_end {
            let pi = run.plan_index;
            let ncalls = run.stops.len() + 1;
            let planned_end = run.timing.time_at(run.end_m, 0.0);
            tr.delay_s = t + dt - planned_end;
            self.record_call(pi, ncalls, Some(t + dt), None);
            self.end_run(ti);
        } else if tr.v == 0.0
            && behind
            && (target - tr.s).abs() < 0.05
            && tr.s >= tr.path.routes.last().map_or(0.0, |r| r.1)
            && matches!(
                self.m.routes[tr.path.routes.last().unwrap().0 as usize].exit,
                rail_model::RouteExit::BufferStop(_)
            )
        {
            // Stabled behind the trains already on the siding: the run ends here.
            let pi = run.plan_index;
            let ncalls = run.stops.len() + 1;
            self.record_call(pi, ncalls, Some(t + dt), None);
            self.end_run(ti);
        } else if tr.v == 0.0 {
            if let Some(lc) = crossing {
                let tr = &mut self.trains[ti];
                if tr.held_at != Some(lc) {
                    tr.held_at = Some(lc);
                    self.events.push(NetEvent::HeldAtCrossing {
                        t,
                        train: tr.vehicle,
                        crossing: lc,
                    });
                }
            } else {
                self.il.standing_at_signal(t, ti as u32);
            }
        }
        // Occupation.
        let tr = &mut self.trains[ti];
        if ds > 0.0 || tr.body.is_empty() {
            tr.body = tr.path.cover(self.m, tr.s - tr.params.length_m, tr.s);
            tr.tds = tr
                .body
                .iter()
                .map(|&(pc, _, _)| self.m.pieces[pc as usize].tds)
                .collect();
            if tr.s > 0.0 {
                tr.held_at = None;
            }
            let tds = tr.tds.clone();
            self.il.occupy(ti as u32, &tds);
        }
        Ok(())
    }

    fn end_run(&mut self, ti: usize) {
        let t = self.t;
        self.il.park(t, ti as u32);
        let m = self.m;
        let tr = &mut self.trains[ti];
        let (head, tail) = (tr.s, tr.s - tr.params.length_m);
        let head_pt = tr.path.cover(m, head - 0.01, head).last().copied();
        let tail_pt = tr.path.cover(m, tail, tail + 0.01).first().copied();
        tr.k += 1;
        if tr.k >= tr.runs.len() {
            tr.status = Status::Done;
            tr.v = 0.0;
            return;
        }
        let back = tr.params.length_m + 400.0;
        let path = build_path(m, &self.il, &tr.runs[tr.k].routes, back, None);
        // Where the train stands on the new path: its front in the new direction.
        let mut ends = Vec::new();
        if let Some((pc, c0, c1)) = head_pt {
            for ch in [c0, c1] {
                if let Some(x) = path.locate(m, pc, ch) {
                    ends.push(x);
                }
            }
        }
        if let Some((pc, c0, c1)) = tail_pt {
            for ch in [c0, c1] {
                if let Some(x) = path.locate(m, pc, ch) {
                    ends.push(x);
                }
            }
        }
        let s0 = ends.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        let s0 = if s0.is_finite() { s0.min(0.0) } else { 0.0 };
        let n = tr.runs[tr.k].routes.len();
        tr.path = path;
        tr.s = s0;
        tr.v = 0.0;
        tr.status = Status::Waiting;
        tr.handles = vec![None; n];
        tr.next_route = 0;
        tr.next_stop = 0;
        tr.triggered.clear();
        tr.body = tr.path.cover(m, tr.s - tr.params.length_m, tr.s);
        let pi = tr.runs[tr.k].plan_index;
        self.names[ti] = format!("run {pi}");
    }

    /// Purpose: check the safety invariants (ADR-0032 §4).
    /// Output: Err describing the first violation.
    pub fn check(&self) -> Result<(), String> {
        self.il
            .check_invariants()
            .map_err(|e| format!("at {:.1} s: {e}", self.t))?;
        // Bodies never overlap.
        let mut by_piece: BTreeMap<PieceId, Vec<(f64, f64, usize)>> = BTreeMap::new();
        for (i, tr) in self.trains.iter().enumerate() {
            for &(pc, a, b) in &tr.body {
                by_piece.entry(pc).or_default().push((a, b, i));
            }
        }
        for (pc, v) in &by_piece {
            for (i, x) in v.iter().enumerate() {
                for y in &v[i + 1..] {
                    if x.2 != y.2 && x.0 < y.1 - 1e-6 && y.0 < x.1 - 1e-6 {
                        return Err(format!(
                            "at {:.1} s: trains {} and {} overlap on piece {pc}",
                            self.t, self.trains[x.2].vehicle, self.trains[y.2].vehicle
                        ));
                    }
                }
            }
        }
        for (i, tr) in self.trains.iter().enumerate() {
            if tr.status == Status::Done {
                continue;
            }
            // A train is on a level crossing only while it is closed to the road.
            for &(lc, at) in &tr.path.crossings {
                let zone = self.m.level_crossings[lc].spec.rail_zone_m;
                if tr.s > at - zone
                    && tr.s - tr.params.length_m < at + zone
                    && self.il.crossing_state(lc) != rail_interlocking::CrossingState::Closed
                {
                    return Err(format!(
                        "at {:.1} s: train {} is on level crossing {} while it is not closed",
                        self.t, tr.vehicle, self.m.level_crossings[lc].spec.id
                    ));
                }
            }
            // 5. Speed within the permitted speed plus tolerance (after protection braking).
            let (eoa, _, _) = self.authority(i);
            let v_perm = self
                .static_speed(tr, tr.params.service_decel_mps2)
                .min((2.0 * tr.params.service_decel_mps2 * (eoa - tr.s).max(0.0)).sqrt());
            if tr.v > v_perm + 2.0 * self.p.supervision_tol_mps + 0.5 {
                return Err(format!(
                    "at {:.1} s: invariant 5: train {} at {:.1} m/s, permitted {:.1} m/s",
                    self.t, tr.vehicle, tr.v, v_perm
                ));
            }
        }
        Ok(())
    }
}
