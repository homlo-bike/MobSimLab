//! MobSimLab railway interlocking (ADR-0032 §4).
//!
//! The interlocking sets routes from the route table of [`rail_model::Model`]
//! and keeps them safe while trains use them:
//!
//! - **Route setting.** A route is set only if every detection section (TDS)
//!   of the route and of its overlap is free of other trains and not locked by
//!   another route, its switches are in position or can be thrown (not locked
//!   elsewhere, not occupied), and its **flank protection** is available. The
//!   switches throw (with their throw time), then the whole route locks
//!   **atomically**; only then does it give a movement authority.
//! - **Flank protection.** For each switch of the route, the switch beyond its
//!   unused leg (for example the far switch of a crossover) is set and locked
//!   so that it leads away from the route. If that switch cannot be set
//!   because another route holds it, the flank track must be clear
//!   (protection by track clear detection).
//! - **Sectional release.** As the train's tail clears a section, that section
//!   and the switches in it are released in route order.
//! - **Overlaps** are locked with the route and released once the train has
//!   stood at the exit signal for `overlap_release_s`, or at once when the
//!   same train's next route from that signal locks.
//! - **Approach locking.** A route cancelled in front of a train that may no
//!   longer be able to stop is released only after `approach_release_s`.
//! - **Moving block** (CBTC, ETCS level 2): on tracks with moving block a
//!   train may lock the route a train ahead holds (a following move on the
//!   same route); its movement authority then ends at the rear of the train
//!   ahead, which the kernel enforces.
//! - **Level crossings** close when a train approaching on a locked route
//!   triggers them, are proved closed after the closing time (road lights and
//!   barriers), and open when the last train has cleared the rail zone. A
//!   crossing with special measures (outside the usual rules) is protected by
//!   **obstacle detection**: it counts as closed only while its road zone is
//!   clear.
//!
//! The kernel tells the interlocking where its trains are
//! ([`Interlocking::occupy`]) and asks for routes; the interlocking never moves
//! a switch under a train or in a locked route, and
//! [`Interlocking::check_invariants`] verifies the safety invariants 1, 3 and
//! 4 of ADR-0032 §4 at any time.
#![warn(missing_docs)]

use std::collections::{BTreeMap, BTreeSet};

use rail_model::{End, Model, PieceId, RouteId, SwitchId, SwitchPosition, TdsId};
use serde::{Deserialize, Serialize};

/// A train as the interlocking knows it.
pub type TrainId = u32;
/// A route set (or being set) for one train.
pub type Handle = usize;

/// Interlocking timing parameters (assumption library keys in brackets).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Params {
    /// Interlocking processing time from request to lock, on top of switch throwing, s
    /// (`signalling.route_setting_s`).
    pub route_setting_s: f64,
    /// Time a train must stand at the exit signal before the overlap is released, s
    /// (`signalling.overlap_release_s`).
    pub overlap_release_s: f64,
    /// Time a cancelled route stays locked in front of an approaching train, s
    /// (`signalling.approach_release_s`).
    pub approach_release_s: f64,
    /// Time from triggering a crossing with barriers until it is proved closed, s
    /// (`level_crossing.barrier_closing_s`).
    pub barrier_closing_s: f64,
    /// Time from triggering a crossing with road traffic signals until it is proved closed, s
    /// (`level_crossing.signal_closing_s`).
    pub signal_closing_s: f64,
}

impl Default for Params {
    /// Purpose: planning defaults (see the assumption library).
    fn default() -> Self {
        Params {
            route_setting_s: 3.0,
            overlap_release_s: 60.0,
            approach_release_s: 120.0,
            barrier_closing_s: 15.0,
            signal_closing_s: 10.0,
        }
    }
}

/// Why a route request was refused.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub enum Refusal {
    /// A section is occupied by another train.
    Occupied(TdsId),
    /// A section is locked by another train's route, overlap or standing train.
    Locked(TdsId),
    /// A switch is locked in the other position or is moving to it.
    SwitchLocked(SwitchId),
    /// A switch must move but a train stands on it.
    SwitchOccupied(SwitchId),
    /// Flank protection is not available at this switch.
    Flank(SwitchId),
    /// The route is cancelled or out of service.
    Unavailable,
}

/// State of a set route.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub enum RouteState {
    /// Switches are moving; locked at the given time if nothing changes.
    Setting {
        /// When the route locks.
        ready_at: f64,
    },
    /// Locked: gives a movement authority to its exit.
    Locked,
    /// Cancelled; released at the given time (approach locking).
    Cancelling {
        /// When it is released.
        at: f64,
    },
    /// Fully released.
    Released,
}

/// A route set for a train.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Active {
    /// The route.
    pub route: RouteId,
    /// The train.
    pub train: TrainId,
    /// State.
    pub state: RouteState,
    /// Route sections released so far (a prefix of the route's sections).
    pub released: usize,
    /// Highest route section index the train has occupied, if any.
    pub reached: Option<usize>,
    /// Whether the overlap is still locked.
    pub overlap_held: bool,
    /// When the overlap is released (the train stands at the exit signal).
    pub overlap_release_at: Option<f64>,
    /// Whether this is a following move behind another train on the same route (moving block).
    pub following: bool,
    /// Flank protection: (route switch, flank switch) pairs locked for it.
    flank: Vec<(SwitchId, SwitchId)>,
    /// Switches thrown for this route (route, overlap and flank).
    thrown: Vec<SwitchId>,
}

#[derive(Clone, Debug, Default)]
struct TdsState {
    occupants: BTreeSet<TrainId>,
    route: Vec<Handle>,
    overlap: Vec<Handle>,
    standing: BTreeSet<TrainId>,
}

#[derive(Clone, Debug)]
struct SwitchState {
    pos: SwitchPosition,
    target: SwitchPosition,
    moving_until: Option<f64>,
    /// Handles locking it in `pos` (route or overlap).
    locks: BTreeSet<Handle>,
    /// Handles locking it in `pos` as flank protection.
    flank_locks: BTreeSet<Handle>,
}

/// State of a level crossing.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub enum CrossingState {
    /// Open to road traffic.
    Open,
    /// Road lights on, barriers lowering; proved closed at the given time.
    Closing {
        /// When it is proved closed.
        closed_at: f64,
    },
    /// Closed to road traffic.
    Closed,
}

#[derive(Clone, Debug)]
struct Crossing {
    state: CrossingState,
    since: f64,
    trains: BTreeSet<TrainId>,
    special: bool,
    road_clear: bool,
    closing_s: f64,
}

/// A closure of a level crossing to road traffic (from the start of the road warning).
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Closure {
    /// Level crossing index in the model.
    pub crossing: usize,
    /// Road warning starts, s.
    pub from_s: f64,
    /// Open again, s.
    pub to_s: f64,
}

/// The interlocking of one network.
#[derive(Clone, Debug)]
pub struct Interlocking<'m> {
    m: &'m Model,
    p: Params,
    tds: Vec<TdsState>,
    switches: Vec<SwitchState>,
    switch_tds: Vec<TdsId>,
    /// Sections of each switch's straight and diverging legs at the switch.
    switch_legs: Vec<(TdsId, TdsId)>,
    /// Flank requirements per route: (route switch, flank switch, position, flank section).
    flank: Vec<Vec<(SwitchId, SwitchId, SwitchPosition, TdsId)>>,
    /// Level crossings on each route's sections: crossing indices.
    route_crossings: Vec<Vec<usize>>,
    crossings: Vec<Crossing>,
    active: Vec<Active>,
    /// Closures finished so far.
    pub closures: Vec<Closure>,
    /// Routes locked so far.
    pub routes_locked: u64,
    /// Route requests refused so far.
    pub refusals: u64,
    /// Following moves locked so far (moving block).
    pub following_moves: u64,
}

fn other(p: SwitchPosition) -> SwitchPosition {
    match p {
        SwitchPosition::Straight => SwitchPosition::Diverging,
        SwitchPosition::Diverging => SwitchPosition::Straight,
    }
}

fn opposite(e: End) -> End {
    match e {
        End::A => End::B,
        End::B => End::A,
    }
}

/// Purpose: the flank protection a route needs.
/// Output: for each route switch, the switch beyond its unused leg (one plain
/// track away, at most 400 m) that must lead away from it: (route switch,
/// flank switch, required position, section of the flank track).
fn flank_of(m: &Model, route: RouteId) -> Vec<(SwitchId, SwitchId, SwitchPosition, TdsId)> {
    let r = &m.routes[route as usize];
    let own: BTreeSet<SwitchId> = r
        .switches
        .iter()
        .chain(r.overlap_switches.iter())
        .map(|s| s.0)
        .collect();
    let mut out = Vec::new();
    for &(sw, pos) in &r.switches {
        let s = &m.switches[sw as usize];
        let (mut p, e): (PieceId, End) = match pos {
            SwitchPosition::Straight => s.diverging,
            SwitchPosition::Diverging => s.straight,
        };
        let flank_tds = m.pieces[p as usize].tds;
        let mut far = opposite(e);
        let mut walked = m.pieces[p as usize].length_m();
        for _ in 0..16 {
            let n = m.neighbours(p, far);
            match n.as_slice() {
                [(_, _, Some((f, q)))] => {
                    if *f != sw && !own.contains(f) {
                        out.push((sw, *f, other(*q), flank_tds));
                    }
                    break;
                }
                [(np, ne, None)] if walked < 400.0 => {
                    p = *np;
                    far = opposite(*ne);
                    walked += m.pieces[p as usize].length_m();
                }
                _ => break,
            }
        }
    }
    out
}

impl<'m> Interlocking<'m> {
    /// Purpose: a new interlocking with all switches straight, all sections
    /// free and all crossings open.
    pub fn new(m: &'m Model, p: Params) -> Self {
        let switches = m
            .switches
            .iter()
            .map(|_| SwitchState {
                pos: SwitchPosition::Straight,
                target: SwitchPosition::Straight,
                moving_until: None,
                locks: BTreeSet::new(),
                flank_locks: BTreeSet::new(),
            })
            .collect();
        let switch_tds = m
            .switches
            .iter()
            .map(|s| m.pieces[s.common.0 as usize].tds)
            .collect();
        let switch_legs = m
            .switches
            .iter()
            .map(|s| {
                (
                    m.pieces[s.straight.0 as usize].tds,
                    m.pieces[s.diverging.0 as usize].tds,
                )
            })
            .collect();
        let flank = (0..m.routes.len() as RouteId)
            .map(|r| flank_of(m, r))
            .collect();
        let crossings: Vec<Crossing> = m
            .level_crossings
            .iter()
            .map(|lc| Crossing {
                state: CrossingState::Open,
                since: 0.0,
                trains: BTreeSet::new(),
                special: !lc.spec.special_measures.is_empty(),
                road_clear: true,
                closing_s: if lc.spec.protection == "barriers" {
                    p.barrier_closing_s
                } else {
                    p.signal_closing_s
                },
            })
            .collect();
        let route_crossings = m
            .routes
            .iter()
            .map(|r| {
                m.level_crossings
                    .iter()
                    .enumerate()
                    .filter(|(_, lc)| r.steps.iter().any(|st| st.piece == lc.piece))
                    .map(|(i, _)| i)
                    .collect()
            })
            .collect();
        Interlocking {
            m,
            p,
            tds: vec![TdsState::default(); m.tds.len()],
            switches,
            switch_tds,
            switch_legs,
            flank,
            route_crossings,
            crossings,
            active: Vec::new(),
            closures: Vec::new(),
            routes_locked: 0,
            refusals: 0,
            following_moves: 0,
        }
    }

    /// Purpose: the model.
    pub fn model(&self) -> &'m Model {
        self.m
    }

    /// Purpose: parameters.
    pub fn params(&self) -> &Params {
        &self.p
    }

    /// Purpose: a set route by handle.
    pub fn active(&self, h: Handle) -> &Active {
        &self.active[h]
    }

    /// Purpose: current switch position, and whether it is moving.
    pub fn switch(&self, s: SwitchId) -> (SwitchPosition, bool) {
        let st = &self.switches[s as usize];
        (st.pos, st.moving_until.is_some())
    }

    /// Purpose: put a switch in a position before the run starts (no train on it).
    pub fn preset_switch(&mut self, s: SwitchId, pos: SwitchPosition) {
        let st = &mut self.switches[s as usize];
        assert!(st.locks.is_empty() && st.flank_locks.is_empty());
        st.pos = pos;
        st.target = pos;
        st.moving_until = None;
    }

    /// Purpose: trains in a section.
    pub fn occupants(&self, t: TdsId) -> &BTreeSet<TrainId> {
        &self.tds[t as usize].occupants
    }

    /// Purpose: who holds a section (for diagnostics): route handles, overlap handles, standing trains.
    pub fn holders(&self, s: TdsId) -> (Vec<Handle>, Vec<Handle>, Vec<TrainId>) {
        let st = &self.tds[s as usize];
        (
            st.route.clone(),
            st.overlap.clone(),
            st.standing.iter().copied().collect(),
        )
    }

    /// Purpose: level crossings on a route's sections.
    pub fn crossings_on(&self, route: RouteId) -> &[usize] {
        &self.route_crossings[route as usize]
    }

    /// Purpose: whether a train may pass a level crossing (proved closed, and
    /// its road zone clear when it relies on obstacle detection).
    pub fn crossing_safe(&self, lc: usize) -> bool {
        let c = &self.crossings[lc];
        c.state == CrossingState::Closed && (!c.special || c.road_clear)
    }

    /// Purpose: state of a level crossing.
    pub fn crossing_state(&self, lc: usize) -> CrossingState {
        self.crossings[lc].state
    }

    /// Purpose: report whether the road zone of a crossing is clear (from the street simulation).
    pub fn set_road_zone_clear(&mut self, lc: usize, clear: bool) {
        self.crossings[lc].road_clear = clear;
    }

    /// Purpose: a train approaching a crossing on a locked route asks it to close.
    pub fn trigger_crossing(&mut self, t: f64, lc: usize, train: TrainId) {
        let c = &mut self.crossings[lc];
        if c.trains.insert(train) && c.state == CrossingState::Open {
            c.state = CrossingState::Closing {
                closed_at: t + c.closing_s,
            };
            c.since = t;
        }
    }

    /// Purpose: a train has cleared a crossing's rail zone; it opens when no train still needs it.
    pub fn clear_crossing(&mut self, t: f64, lc: usize, train: TrainId) {
        let c = &mut self.crossings[lc];
        if c.trains.remove(&train) && c.trains.is_empty() && c.state != CrossingState::Open {
            c.state = CrossingState::Open;
            self.closures.push(Closure {
                crossing: lc,
                from_s: c.since,
                to_s: t,
            });
        }
    }

    /// Purpose: place a train standing on the network before the run (for
    /// example stabled in the depot): its sections are occupied and locked as standing.
    pub fn place(&mut self, train: TrainId, sections: &BTreeSet<TdsId>) {
        for &s in sections {
            let st = &mut self.tds[s as usize];
            st.occupants.insert(train);
            st.standing.insert(train);
        }
    }

    /// Purpose: the train's routes that are not released, in the order set.
    pub fn routes_of(&self, train: TrainId) -> Vec<Handle> {
        self.active
            .iter()
            .enumerate()
            .filter(|(_, a)| a.train == train && a.state != RouteState::Released)
            .map(|(h, _)| h)
            .collect()
    }

    /// Purpose: whether a section lies on storage tracks only (depot, sidings).
    pub fn storage(&self, s: TdsId) -> bool {
        self.m.tds[s as usize]
            .pieces
            .iter()
            .all(|&p| self.m.is_storage(p))
    }

    fn moving_block(&self, s: TdsId) -> bool {
        self.m.tds[s as usize].pieces.iter().all(|&p| {
            self.m.tracks[self.m.pieces[p as usize].track]
                .protection
                .moving_block()
        })
    }

    /// Purpose: request a route for a train.
    /// Inputs: time, route, train.
    /// Output: the handle (the existing one if the train already has this
    /// route set and not yet released), or why it was refused.
    /// Side effects: locks the route's sections, overlap, switches and flank
    /// protection, starts switch throws; a route the train had into the entry
    /// signal hands over its overlap.
    pub fn request(&mut self, t: f64, route: RouteId, train: TrainId) -> Result<Handle, Refusal> {
        if let Some(h) = self.active.iter().position(|a| {
            a.train == train
                && a.route == route
                && matches!(a.state, RouteState::Setting { .. } | RouteState::Locked)
        }) {
            return Ok(h);
        }
        match self.check(route, train) {
            Ok((following, throws, flank)) => {
                Ok(self.commit(t, route, train, following, throws, flank))
            }
            Err(e) => {
                self.refusals += 1;
                Err(e)
            }
        }
    }

    fn own(&self, h: Handle, train: TrainId) -> bool {
        self.active[h].train == train
    }

    /// Purpose: check whether a route can be set now, without changing anything.
    /// Output: (following move, switches to throw, flank switches to lock or throw).
    #[allow(clippy::type_complexity)]
    fn check(
        &self,
        route: RouteId,
        train: TrainId,
    ) -> Result<
        (
            bool,
            Vec<(SwitchId, SwitchPosition)>,
            Vec<(SwitchId, SwitchId, SwitchPosition)>,
        ),
        Refusal,
    > {
        let r = &self.m.routes[route as usize];
        let into_siding = matches!(r.exit, rail_model::RouteExit::BufferStop(_));
        let mut following = false;
        for &s in &r.tds {
            let st = &self.tds[s as usize];
            // A shunting move into a siding may enter it while other trains stand
            // there; the train then stops behind them (on sight).
            let permissive = into_siding && self.storage(s);
            if st.standing.iter().any(|&x| x != train) && !permissive {
                return Err(Refusal::Locked(s));
            }
            if st.overlap.iter().any(|&h| !self.own(h, train)) {
                return Err(Refusal::Locked(s));
            }
            let others: Vec<Handle> = st
                .route
                .iter()
                .copied()
                .filter(|&h| !self.own(h, train))
                .collect();
            let follow_ok = !others.is_empty()
                && self.moving_block(s)
                && others.iter().all(|&h| self.active[h].route == route);
            if !others.is_empty() && !follow_ok {
                return Err(Refusal::Locked(s));
            }
            if follow_ok {
                following = true;
            }
            if st.occupants.iter().any(|&x| x != train) && !follow_ok && !permissive {
                return Err(Refusal::Occupied(s));
            }
        }
        // A following move under moving block keeps its distance by the safety
        // margin behind the train ahead, not by an overlap.
        let overlap_tds: &[TdsId] = if following { &[] } else { &r.overlap_tds };
        for &s in overlap_tds {
            let st = &self.tds[s as usize];
            if st.standing.iter().any(|&x| x != train)
                || st.route.iter().any(|&h| !self.own(h, train))
            {
                return Err(Refusal::Locked(s));
            }
            if st.occupants.iter().any(|&x| x != train) && !following {
                return Err(Refusal::Occupied(s));
            }
        }
        let mut throws = Vec::new();
        let mut need: BTreeMap<SwitchId, SwitchPosition> = BTreeMap::new();
        let overlap_sw: &[(SwitchId, SwitchPosition)] =
            if following { &[] } else { &r.overlap_switches };
        for &(sw, pos) in r.switches.iter().chain(overlap_sw.iter()) {
            need.insert(sw, pos);
        }
        for (&sw, &pos) in &need {
            let st = &self.switches[sw as usize];
            let in_place = st.pos == pos && st.moving_until.is_none();
            let moving_there = st.moving_until.is_some() && st.target == pos;
            if in_place || moving_there {
                continue;
            }
            if !st.locks.is_empty() || !st.flank_locks.is_empty() {
                return Err(Refusal::SwitchLocked(sw));
            }
            if self.switch_occupied(sw) {
                return Err(Refusal::SwitchOccupied(sw));
            }
            throws.push((sw, pos));
        }
        let mut flank = Vec::new();
        for &(rs, f, q, ftds) in &self.flank[route as usize] {
            if need.contains_key(&f) {
                continue;
            }
            let st = &self.switches[f as usize];
            let settled = |p: SwitchPosition| {
                st.pos == p && st.moving_until.is_none()
                    || st.moving_until.is_some() && st.target == p
            };
            if settled(q) {
                flank.push((rs, f, q));
                continue;
            }
            let free_to_move =
                st.locks.is_empty() && st.flank_locks.is_empty() && !self.switch_occupied(f);
            if free_to_move {
                flank.push((rs, f, q));
            } else if !self.tds[ftds as usize].occupants.is_empty()
                || self.tds[ftds as usize]
                    .route
                    .iter()
                    .any(|&h| !self.own(h, train))
            {
                // Protection by clear track detection is not available either.
                return Err(Refusal::Flank(f));
            }
        }
        Ok((following, throws, flank))
    }

    fn throw(&mut self, t: f64, sw: SwitchId, pos: SwitchPosition) -> f64 {
        let st = &mut self.switches[sw as usize];
        if st.pos == pos && st.moving_until.is_none() {
            return t;
        }
        if let Some(until) = st.moving_until.filter(|_| st.target == pos) {
            return until;
        }
        let until = t + self.m.switches[sw as usize].throw_time_s;
        st.target = pos;
        st.moving_until = Some(until);
        until
    }

    fn commit(
        &mut self,
        t: f64,
        route: RouteId,
        train: TrainId,
        following: bool,
        throws: Vec<(SwitchId, SwitchPosition)>,
        flank: Vec<(SwitchId, SwitchId, SwitchPosition)>,
    ) -> Handle {
        let h = self.active.len();
        let r = &self.m.routes[route as usize];
        if following {
            self.following_moves += 1;
        }
        let mut ready = t;
        let mut thrown = Vec::new();
        for (sw, pos) in throws {
            ready = ready.max(self.throw(t, sw, pos));
            thrown.push(sw);
        }
        let mut flank_locked = Vec::new();
        for (rs, f, q) in flank {
            ready = ready.max(self.throw(t, f, q));
            self.switches[f as usize].flank_locks.insert(h);
            flank_locked.push((rs, f));
        }
        let (ov_sw, ov_tds): (&[(SwitchId, SwitchPosition)], &[TdsId]) = if following {
            (&[], &[])
        } else {
            (&r.overlap_switches, &r.overlap_tds)
        };
        for &(sw, _) in r.switches.iter().chain(ov_sw.iter()) {
            self.switches[sw as usize].locks.insert(h);
        }
        for &s in &r.tds {
            self.tds[s as usize].route.push(h);
        }
        for &s in ov_tds {
            self.tds[s as usize].overlap.push(h);
        }
        self.active.push(Active {
            route,
            train,
            state: RouteState::Setting {
                ready_at: ready + self.p.route_setting_s,
            },
            released: 0,
            reached: None,
            overlap_held: !following,
            overlap_release_at: None,
            following,
            flank: flank_locked,
            thrown,
        });
        // The train's route into this entry signal hands over its overlap.
        let entry = r.entry;
        let prev: Vec<Handle> = (0..h)
            .filter(|&k| {
                let a = &self.active[k];
                a.train == train
                    && a.overlap_held
                    && a.state != RouteState::Released
                    && matches!(self.m.routes[a.route as usize].exit,
                        rail_model::RouteExit::Signal(s) if s == entry)
            })
            .collect();
        for k in prev {
            self.release_overlap(k);
        }
        h
    }

    fn release_overlap(&mut self, h: Handle) {
        if !self.active[h].overlap_held {
            return;
        }
        self.active[h].overlap_held = false;
        self.active[h].overlap_release_at = None;
        let r = &self.m.routes[self.active[h].route as usize];
        for &s in &r.overlap_tds {
            self.tds[s as usize].overlap.retain(|&x| x != h);
        }
        let route_sw: BTreeSet<SwitchId> = r.switches.iter().map(|s| s.0).collect();
        for &(sw, _) in &r.overlap_switches {
            if !route_sw.contains(&sw) {
                self.switches[sw as usize].locks.remove(&h);
            }
        }
    }

    /// Release route section `i` of route handle `h`, with the switches in it and their flank protection.
    fn release_section(&mut self, h: Handle, i: usize) {
        let r = &self.m.routes[self.active[h].route as usize];
        let s = r.tds[i];
        self.tds[s as usize].route.retain(|&x| x != h);
        let overlap_sw: BTreeSet<SwitchId> = if self.active[h].overlap_held {
            r.overlap_switches.iter().map(|x| x.0).collect()
        } else {
            BTreeSet::new()
        };
        for &(sw, _) in &r.switches {
            if self.switch_tds[sw as usize] == s {
                if !overlap_sw.contains(&sw) {
                    self.switches[sw as usize].locks.remove(&h);
                }
                let flank: Vec<SwitchId> = self.active[h]
                    .flank
                    .iter()
                    .filter(|(rs, _)| *rs == sw)
                    .map(|x| x.1)
                    .collect();
                for f in flank {
                    self.switches[f as usize].flank_locks.remove(&h);
                }
                self.active[h].flank.retain(|(rs, _)| *rs != sw);
            }
        }
    }

    /// Purpose: whether a train may stand on a switch. A train over the switch
    /// occupies the section of its common leg and the section of one of the
    /// other legs (the same section where the export gives the switch its own
    /// detection section). A train that only occupies the common leg's section
    /// stands in front of the switch, for example at a signal at the switch toe,
    /// and does not stop it from moving.
    fn switch_occupied(&self, sw: SwitchId) -> bool {
        let occ = |t: TdsId| !self.tds[t as usize].occupants.is_empty();
        let (a, b) = self.switch_legs[sw as usize];
        occ(self.switch_tds[sw as usize]) && (occ(a) || occ(b))
    }

    fn release_all(&mut self, h: Handle) {
        let n = self.m.routes[self.active[h].route as usize].tds.len();
        for i in self.active[h].released..n {
            self.release_section(h, i);
        }
        self.active[h].released = n;
        self.release_overlap(h);
        for st in &mut self.switches {
            st.locks.remove(&h);
            st.flank_locks.remove(&h);
        }
        self.active[h].flank.clear();
        self.active[h].state = RouteState::Released;
    }

    /// Purpose: cancel a route (traffic management or end of service).
    /// Inputs: time, handle, whether a train approaches that may no longer stop at its entry signal.
    /// Side effects: released at once, or after `approach_release_s` (approach locking).
    pub fn cancel(&mut self, t: f64, h: Handle, approach_locked: bool) {
        match self.active[h].state {
            RouteState::Released | RouteState::Cancelling { .. } => {}
            _ if approach_locked => {
                self.active[h].state = RouteState::Cancelling {
                    at: t + self.p.approach_release_s,
                }
            }
            _ => self.release_all(h),
        }
    }

    /// Purpose: whether a route gives a movement authority now.
    pub fn usable(&self, h: Handle) -> bool {
        self.active[h].state == RouteState::Locked
    }

    /// Purpose: advance switches, route locking, overlap and approach-lock timers and crossings to time `t`.
    pub fn update(&mut self, t: f64) {
        for st in &mut self.switches {
            if st.moving_until.is_some_and(|u| u <= t) {
                st.pos = st.target;
                st.moving_until = None;
            }
        }
        for h in 0..self.active.len() {
            match self.active[h].state {
                RouteState::Setting { ready_at } if ready_at <= t => {
                    let r = &self.m.routes[self.active[h].route as usize];
                    let ov: &[(SwitchId, SwitchPosition)] = if self.active[h].overlap_held {
                        &r.overlap_switches
                    } else {
                        &[]
                    };
                    let ready = r.switches.iter().chain(ov.iter()).all(|&(sw, pos)| {
                        let st = &self.switches[sw as usize];
                        st.pos == pos && st.moving_until.is_none()
                    });
                    if ready {
                        self.active[h].state = RouteState::Locked;
                        self.routes_locked += 1;
                    }
                }
                RouteState::Cancelling { at } if at <= t => self.release_all(h),
                _ => {}
            }
            if self.active[h].overlap_release_at.is_some_and(|x| x <= t) {
                self.release_overlap(h);
            }
        }
        for c in &mut self.crossings {
            if let CrossingState::Closing { closed_at } = c.state {
                if closed_at <= t {
                    c.state = CrossingState::Closed;
                }
            }
        }
    }

    /// Purpose: report the sections a train occupies now.
    /// Side effects: occupancy, sectional release of the train's routes and
    /// release of its standing locks on sections it has left.
    pub fn occupy(&mut self, train: TrainId, sections: &BTreeSet<TdsId>) {
        for (i, st) in self.tds.iter_mut().enumerate() {
            let here = sections.contains(&(i as TdsId));
            if here {
                st.occupants.insert(train);
            } else {
                st.occupants.remove(&train);
                st.standing.remove(&train);
            }
        }
        for h in self.routes_of(train) {
            if !matches!(
                self.active[h].state,
                RouteState::Locked | RouteState::Cancelling { .. }
            ) {
                continue;
            }
            let r = &self.m.routes[self.active[h].route as usize];
            let n = r.tds.len();
            for (i, s) in r.tds.iter().enumerate() {
                if sections.contains(s) {
                    let a = &mut self.active[h];
                    a.reached = Some(a.reached.map_or(i, |x| x.max(i)));
                }
            }
            let Some(reached) = self.active[h].reached else {
                continue;
            };
            let inside = r.tds.iter().any(|s| sections.contains(s));
            while self.active[h].released < n {
                let i = self.active[h].released;
                let s = r.tds[i];
                let passed = i < reached || (i == reached && !inside);
                if passed && !sections.contains(&s) {
                    self.release_section(h, i);
                    self.active[h].released += 1;
                } else {
                    break;
                }
            }
            if self.active[h].released == n {
                // The train has left the route: its overlap is no longer needed.
                self.release_overlap(h);
                self.release_all(h);
            }
        }
    }

    /// Purpose: the train stands at the end of its movement authority (an exit signal).
    /// Side effects: starts the overlap release timer of its routes.
    pub fn standing_at_signal(&mut self, t: f64, train: TrainId) {
        let release = self.p.overlap_release_s;
        for h in self.routes_of(train) {
            let a = &mut self.active[h];
            if a.overlap_held && a.overlap_release_at.is_none() && a.reached.is_some() {
                a.overlap_release_at = Some(t + release);
            }
        }
    }

    /// Purpose: the train has ended its run and stands where it is (terminal, siding).
    /// Side effects: the sections it occupies become standing locks; its routes
    /// are released except for what it occupies; overlaps release after the usual time.
    pub fn park(&mut self, t: f64, train: TrainId) {
        for st in &mut self.tds {
            if st.occupants.contains(&train) {
                st.standing.insert(train);
            }
        }
        for h in self.routes_of(train) {
            let r = &self.m.routes[self.active[h].route as usize];
            let n = r.tds.len();
            for i in self.active[h].released..n {
                self.release_section(h, i);
            }
            self.active[h].released = n;
            if self.active[h].overlap_held {
                self.active[h].overlap_release_at = Some(t + self.p.overlap_release_s);
                self.active[h].state = RouteState::Cancelling {
                    at: t + self.p.overlap_release_s,
                };
            } else {
                self.release_all(h);
            }
        }
    }

    /// Purpose: check safety invariants 1, 3 and 4 of ADR-0032 §4.
    /// Output: Err describing the first violation.
    pub fn check_invariants(&self) -> Result<(), String> {
        // 1. Every section under a train is locked for that train (route or standing).
        for (i, st) in self.tds.iter().enumerate() {
            for &tr in &st.occupants {
                let ok = st.standing.contains(&tr)
                    || st.route.iter().any(|&h| self.active[h].train == tr);
                if !ok {
                    return Err(format!(
                        "invariant 1: train {tr} occupies {} without a lock",
                        self.m.tds[i].id
                    ));
                }
            }
            let trains: BTreeSet<TrainId> =
                st.route.iter().map(|&h| self.active[h].train).collect();
            if trains.len() > 1 && !self.storage(i as TdsId) {
                let routes: BTreeSet<RouteId> =
                    st.route.iter().map(|&h| self.active[h].route).collect();
                if routes.len() > 1 || !self.moving_block(i as TdsId) {
                    return Err(format!(
                        "invariant 1: {} locked by trains {trains:?}",
                        self.m.tds[i].id
                    ));
                }
            }
            if let Some(&s) = st.standing.iter().next() {
                if !self.storage(i as TdsId)
                    && (st.standing.len() > 1
                        || st.route.iter().any(|&h| self.active[h].train != s))
                {
                    return Err(format!(
                        "invariant 1: {} has train {s} standing and another train's route",
                        self.m.tds[i].id
                    ));
                }
            }
        }
        // 3. A switch under a train or locked never moves.
        for (i, st) in self.switches.iter().enumerate() {
            if st.moving_until.is_some() {
                let occupied = self.switch_occupied(i as SwitchId);
                let locked_other = st.locks.iter().chain(st.flank_locks.iter()).any(|&h| {
                    let a = &self.active[h];
                    a.state == RouteState::Locked
                });
                if occupied || locked_other {
                    return Err(format!(
                        "invariant 3: switch {} moves while occupied or locked",
                        self.m.switches[i].id
                    ));
                }
            }
        }
        // 4. Conflicting routes of different trains never hold the same section or
        //    need a switch in different positions at the same time.
        let held: Vec<(Handle, BTreeSet<TdsId>, BTreeMap<SwitchId, SwitchPosition>)> = self
            .active
            .iter()
            .enumerate()
            .filter(|(_, a)| a.state != RouteState::Released)
            .map(|(h, a)| {
                let r = &self.m.routes[a.route as usize];
                let mut s: BTreeSet<TdsId> = r.tds[a.released..].iter().copied().collect();
                if a.overlap_held {
                    s.extend(r.overlap_tds.iter().copied());
                }
                let sw: BTreeMap<SwitchId, SwitchPosition> = r
                    .switches
                    .iter()
                    .chain(if a.overlap_held {
                        r.overlap_switches.iter()
                    } else {
                        [].iter()
                    })
                    .filter(|(sw, _)| self.switches[*sw as usize].locks.contains(&h))
                    .copied()
                    .collect();
                (h, s, sw)
            })
            .collect();
        for (i, (ha, sa, wa)) in held.iter().enumerate() {
            for (hb, sb, wb) in &held[i + 1..] {
                let (a, b) = (&self.active[*ha], &self.active[*hb]);
                if a.train == b.train || !self.m.routes_conflict(a.route, b.route) {
                    continue;
                }
                let ra = &self.m.routes[a.route as usize];
                let rb = &self.m.routes[b.route as usize];
                let shared: Vec<&TdsId> = sa
                    .intersection(sb)
                    .filter(|t| {
                        let both_overlap = ra.overlap_tds.contains(t)
                            && !ra.tds.contains(t)
                            && rb.overlap_tds.contains(t)
                            && !rb.tds.contains(t);
                        !both_overlap
                    })
                    .collect();
                if !shared.is_empty() {
                    return Err(format!(
                        "invariant 4: routes {} and {} both hold {}",
                        ra.id, rb.id, self.m.tds[*shared[0] as usize].id
                    ));
                }
                for (sw, p) in wa {
                    if wb.get(sw).is_some_and(|q| q != p) {
                        return Err(format!(
                            "invariant 4: routes {} and {} need switch {} in different positions",
                            ra.id, rb.id, self.m.switches[*sw as usize].id
                        ));
                    }
                }
            }
        }
        Ok(())
    }
}
