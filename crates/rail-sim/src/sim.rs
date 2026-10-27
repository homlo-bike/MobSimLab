//! The rail operations kernel: fixed-block interlocking with atomic route
//! locking and sectional release, plus longitudinal train dynamics.
//!
//! Safety model: a train may only occupy sections that it has reserved, and it
//! may never move past the end of its reserved routes (its movement authority).
//! Because reservations are exclusive, two trains can never occupy the same
//! section. [`RailSim::check_invariants`] verifies this at any time.

use serde::Serialize;

use crate::model::{SimConfig, TdsId, TdsSpec, TrainId, TrainSpec};

const G: f64 = 9.81;
const EPS: f64 = 1e-6;

/// Lifecycle of a train inside the kernel.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum TrainStatus {
    /// Holding before its first departure time.
    Waiting,
    /// Moving or stopped at a signal.
    Running,
    /// Standing at a scheduled stop.
    Dwelling,
    /// Head has passed the exit portal; tail still on kernel track.
    Exiting,
    /// Fully handed over through the exit portal (no longer occupies track).
    Exited,
    /// Reached the end of a non-cyclic path with no open portal.
    Terminated,
}

/// Something that happened during a step. Only recorded if `record_events` is on.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub enum Event {
    /// A route was locked: `sections` sections starting at path entry `first_path_index`.
    #[allow(missing_docs)]
    RouteSet {
        t: f64,
        train: TrainId,
        first_path_index: usize,
        sections: usize,
    },
    /// Train came to a stand at a scheduled stop.
    #[allow(missing_docs)]
    StopArrival {
        t: f64,
        train: TrainId,
        path_index: usize,
    },
    /// Train left a scheduled stop after its dwell.
    #[allow(missing_docs)]
    StopDeparture {
        t: f64,
        train: TrainId,
        path_index: usize,
    },
    /// Train head reached an open exit portal; the coordinator takes over its speed.
    #[allow(missing_docs)]
    HeadAtPortal { t: f64, train: TrainId },
    /// Train tail cleared the portal; all its sections are released.
    #[allow(missing_docs)]
    Exited { t: f64, train: TrainId },
    /// No train moved for `deadlock_timeout_s` while some wanted to.
    #[allow(missing_docs)]
    Deadlock { t: f64, waiting_trains: usize },
}

/// Public snapshot of a train for recorders and co-simulation.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct TrainState {
    /// Kernel train ID.
    pub id: TrainId,
    /// Train name from its spec.
    pub name: String,
    /// Lifecycle status.
    pub status: TrainStatus,
    /// Distance of the head from the start of the path (grows across laps).
    pub head_m: f64,
    /// Speed in m/s.
    pub speed_mps: f64,
    /// Acceleration over the last step in m/s².
    pub accel_mps2: f64,
    /// Section under the head and the head offset within it.
    pub head_tds: TdsId,
    /// Head offset within `head_tds`, metres.
    pub head_offset_m: f64,
    /// Distance from the head to the end of its movement authority.
    pub authority_ahead_m: f64,
}

/// Aggregate counters, useful for benchmarks and run reports.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct SimStats {
    /// Steps executed.
    pub steps: u64,
    /// Routes locked.
    pub routes_set: u64,
    /// Route requests refused because a section was taken or blocked.
    pub route_requests_rejected: u64,
    /// Arrivals at scheduled stops.
    pub stop_arrivals: u64,
    /// Train-kilometres run.
    pub train_km: f64,
    /// Deadlocks detected.
    pub deadlocks: u64,
}

#[derive(Clone, Debug)]
struct TdsState {
    spec: TdsSpec,
    reserved_by: Option<TrainId>,
    blocked: bool,
}

#[derive(Clone, Debug)]
struct Train {
    spec: TrainSpec,
    /// Start distance of each path entry within one lap.
    cum: Vec<f64>,
    lap_len: f64,
    /// For each path entry: exclusive end (path index, may exceed len for
    /// cyclic wrap) of the route starting at the next signal at or after it.
    route_end: Vec<usize>,
    /// Absolute (lap-unrolled) index of the first entry not yet reserved.
    auth_k: usize,
    /// Absolute index of the entry under the tail (oldest still reserved).
    tail_k: usize,
    head_m: f64,
    speed: f64,
    accel: f64,
    status: TrainStatus,
    /// Absolute index into the unrolled stop sequence.
    next_stop: usize,
    dwell_until: f64,
    exit_open: bool,
    external_speed: f64,
}

impl Train {
    /// Purpose: absolute start distance of unrolled path entry `k`.
    fn start(&self, k: usize) -> f64 {
        let n = self.spec.path.len();
        (k / n) as f64 * self.lap_len + self.cum[k % n]
    }
    /// Purpose: absolute end distance of unrolled path entry `k`.
    fn end(&self, k: usize, tds: &[TdsState]) -> f64 {
        self.start(k) + tds[self.tds_at(k) as usize].spec.length_m
    }
    /// Purpose: section ID of unrolled path entry `k`.
    fn tds_at(&self, k: usize) -> TdsId {
        self.spec.path[k % self.spec.path.len()]
    }
    /// Purpose: highest unrolled index the train may ever reserve (path end
    /// for non-cyclic paths, unbounded for loops).
    fn max_k(&self) -> usize {
        if self.spec.cyclic {
            usize::MAX
        } else {
            self.spec.path.len()
        }
    }
    /// Purpose: absolute head position of the next pending stop, if any.
    fn next_stop_pos(&self) -> Option<(f64, usize)> {
        let ns = self.spec.stops.len();
        if ns == 0 {
            return None;
        }
        let lap = self.next_stop / ns;
        if !self.spec.cyclic && lap > 0 {
            return None;
        }
        let st = &self.spec.stops[self.next_stop % ns];
        let pos = lap as f64 * self.lap_len + self.cum[st.path_index] + st.offset_m;
        Some((pos, st.path_index))
    }
    /// Purpose: absolute index of the entry under the head.
    fn head_k(&self, tds: &[TdsState]) -> usize {
        let mut k = self.tail_k;
        while k + 1 < self.auth_k && self.end(k, tds) < self.head_m - EPS {
            k += 1;
        }
        k
    }
}

/// Stopping speed for a semi-implicit Euler integrator: the highest speed at
/// which braking at `b` each step of length `dt` still reaches speed `v_end`
/// within distance `d`.
///
/// Inputs: `d` metres (clamped at 0), `v_end` m/s, `b` m/s², `dt` s.
/// Output: allowed speed in m/s. No side effects.
fn braking_speed(d: f64, v_end: f64, b: f64, dt: f64) -> f64 {
    let d = d.max(0.0);
    let bdt = b * dt;
    (-bdt + (bdt * bdt + 2.0 * b * d + v_end * v_end).sqrt()).max(0.0)
}

/// The rail operations kernel.
pub struct RailSim {
    cfg: SimConfig,
    tds: Vec<TdsState>,
    trains: Vec<Train>,
    t: f64,
    events: Vec<Event>,
    stats: SimStats,
    last_movement_t: f64,
    deadlock_reported: bool,
}

impl RailSim {
    /// Purpose: create a kernel over a set of sections.
    /// Inputs: section specs (their index is their [`TdsId`]) and a config.
    /// Output: an empty simulation at t = 0. Errors on invalid sections.
    // Negated comparisons on purpose: they also reject NaN.
    #[allow(clippy::neg_cmp_op_on_partial_ord)]
    pub fn new(sections: Vec<TdsSpec>, cfg: SimConfig) -> Result<Self, String> {
        for (i, s) in sections.iter().enumerate() {
            if !(s.length_m > 0.0) || !(s.speed_limit_mps > 0.0) {
                return Err(format!("section {i}: length and speed limit must be > 0"));
            }
        }
        Ok(Self {
            cfg,
            tds: sections
                .into_iter()
                .map(|spec| TdsState {
                    spec,
                    reserved_by: None,
                    blocked: false,
                })
                .collect(),
            trains: Vec::new(),
            t: 0.0,
            events: Vec::new(),
            stats: SimStats::default(),
            last_movement_t: 0.0,
            deadlock_reported: false,
        })
    }

    /// Purpose: place a persistent train on the network.
    /// Inputs: the train spec. The sections under the train and up to the next
    /// signal ahead must be free.
    /// Output: the new [`TrainId`].
    /// Side effects: reserves those sections for the train. Nothing is placed if
    /// any of them is taken (the kernel never overlaps trains).
    pub fn add_train(&mut self, spec: TrainSpec) -> Result<TrainId, String> {
        let n = spec.path.len();
        if n == 0 {
            return Err("empty path".into());
        }
        if spec.path.iter().any(|&p| p as usize >= self.tds.len()) {
            return Err("path references unknown section".into());
        }
        if spec.length_m <= 0.0
            || spec.mass_kg <= 0.0
            || spec.service_decel_mps2 <= 0.0
            || spec.max_speed_mps <= 0.0
        {
            return Err("length, mass, deceleration and max speed must be > 0".into());
        }
        let mut cum = Vec::with_capacity(n);
        let mut acc = 0.0;
        for &p in &spec.path {
            cum.push(acc);
            acc += self.tds[p as usize].spec.length_m;
        }
        let lap_len = acc;
        if spec.start_head_m < spec.length_m - EPS || spec.start_head_m > lap_len {
            return Err("start_head_m must be within the path and >= train length".into());
        }
        let mut is_signal = vec![false; n];
        is_signal[0] = true;
        for &i in &spec.signals_at {
            if i < n {
                is_signal[i] = true;
            }
        }
        // route_end[k]: first signal strictly after k (unrolled for cyclic paths).
        let mut route_end = vec![0usize; n];
        #[allow(clippy::needless_range_loop)]
        for k in 0..n {
            let mut j = k + 1;
            loop {
                if j >= n {
                    if spec.cyclic {
                        if is_signal[j % n] {
                            break;
                        }
                    } else {
                        j = n;
                        break;
                    }
                } else if is_signal[j] {
                    break;
                }
                j += 1;
            }
            route_end[k] = j;
        }
        let mut stops = spec.stops.clone();
        stops.sort_by(|a, b| {
            (a.path_index, a.offset_m)
                .partial_cmp(&(b.path_index, b.offset_m))
                .unwrap()
        });
        let mut train = Train {
            spec: TrainSpec { stops, ..spec },
            cum,
            lap_len,
            route_end,
            auth_k: 0,
            tail_k: 0,
            head_m: 0.0,
            speed: 0.0,
            accel: 0.0,
            status: TrainStatus::Waiting,
            next_stop: 0,
            dwell_until: 0.0,
            exit_open: false,
            external_speed: 0.0,
        };
        train.head_m = train.spec.start_head_m;
        let tail_m = train.head_m - train.spec.length_m;
        // Find tail and head entries.
        let mut tail_k = 0;
        while tail_k + 1 < n && train.cum[tail_k + 1] <= tail_m + EPS {
            tail_k += 1;
        }
        let mut head_k = tail_k;
        while head_k + 1 < n && train.cum[head_k + 1] < train.head_m - EPS {
            head_k += 1;
        }
        let auth_k = train.route_end[head_k].min(train.max_k());
        let id = self.trains.len() as TrainId;
        let needed: Vec<TdsId> = (tail_k..auth_k).map(|k| train.tds_at(k)).collect();
        if needed
            .iter()
            .any(|&s| self.tds[s as usize].reserved_by.is_some() || self.tds[s as usize].blocked)
        {
            return Err(format!(
                "cannot place train '{}': its sections are not free",
                train.spec.name
            ));
        }
        for &s in &needed {
            self.tds[s as usize].reserved_by = Some(id);
        }
        train.tail_k = tail_k;
        train.auth_k = auth_k;
        // Skip stops already behind the head.
        while let Some((pos, _)) = train.next_stop_pos() {
            if pos < train.head_m - EPS {
                train.next_stop += 1;
            } else {
                break;
            }
        }
        self.trains.push(train);
        Ok(id)
    }

    /// Purpose: try to reserve the route that starts at the train's authority end.
    /// Output: true if the whole route was reserved (atomic: all or nothing).
    /// Side effects: marks sections reserved; updates counters and events.
    fn try_reserve_next_route(&mut self, id: TrainId) -> bool {
        let tr = &self.trains[id as usize];
        let n = tr.spec.path.len();
        let k0 = tr.auth_k;
        if k0 >= tr.max_k() {
            return false;
        }
        let lap_base = (k0 / n) * n;
        let k1 = (lap_base + tr.route_end[k0 % n]).min(tr.max_k());
        for k in k0..k1 {
            let s = &self.tds[tr.tds_at(k) as usize];
            if s.reserved_by.is_some() || s.blocked {
                self.stats.route_requests_rejected += 1;
                return false;
            }
        }
        for k in k0..k1 {
            let s = tr.tds_at(k) as usize;
            self.tds[s].reserved_by = Some(id);
        }
        self.trains[id as usize].auth_k = k1;
        self.stats.routes_set += 1;
        if self.cfg.record_events {
            self.events.push(Event::RouteSet {
                t: self.t,
                train: id,
                first_path_index: k0 % n,
                sections: k1 - k0,
            });
        }
        true
    }

    /// Purpose: release sections the tail has fully cleared (sectional release).
    /// Side effects: clears reservations owned by this train behind its tail.
    fn release_behind(&mut self, id: TrainId) {
        let tail_m = {
            let tr = &self.trains[id as usize];
            tr.head_m - tr.spec.length_m
        };
        loop {
            let tr = &self.trains[id as usize];
            if tr.tail_k >= tr.auth_k {
                break;
            }
            let end = tr.end(tr.tail_k, &self.tds);
            if tail_m >= end - EPS {
                let s = tr.tds_at(tr.tail_k) as usize;
                if self.tds[s].reserved_by == Some(id) {
                    self.tds[s].reserved_by = None;
                }
                let tr = &mut self.trains[id as usize];
                tr.tail_k += 1;
                if tr.tail_k >= tr.auth_k {
                    break;
                }
            } else {
                break;
            }
        }
    }

    /// Purpose: advance the whole simulation by one fixed step.
    /// Inputs: `dt` step length in seconds (> 0).
    /// Side effects: moves trains, reserves and releases routes, records events.
    pub fn step(&mut self, dt: f64) {
        let mut any_moved = false;
        let mut waiting = 0usize;
        for id in 0..self.trains.len() as TrainId {
            let moved = self.step_train(id, dt);
            any_moved |= moved;
            let st = self.trains[id as usize].status;
            if !moved && matches!(st, TrainStatus::Running) {
                waiting += 1;
            }
        }
        self.t += dt;
        self.stats.steps += 1;
        if any_moved || waiting == 0 {
            self.last_movement_t = self.t;
            self.deadlock_reported = false;
        } else if !self.deadlock_reported
            && self.t - self.last_movement_t >= self.cfg.deadlock_timeout_s
        {
            self.deadlock_reported = true;
            self.stats.deadlocks += 1;
            if self.cfg.record_events {
                self.events.push(Event::Deadlock {
                    t: self.t,
                    waiting_trains: waiting,
                });
            }
        }
    }

    /// Purpose: run fixed steps until simulated time reaches `t_end`.
    pub fn advance_to(&mut self, t_end: f64, dt: f64) {
        while self.t + EPS < t_end {
            let h = dt.min(t_end - self.t);
            self.step(h);
        }
    }

    /// Purpose: advance one train by `dt`.
    /// Output: true if the train moved.
    fn step_train(&mut self, id: TrainId, dt: f64) -> bool {
        let t_now = self.t;
        let idx = id as usize;
        match self.trains[idx].status {
            TrainStatus::Exited | TrainStatus::Terminated => return false,
            TrainStatus::Waiting => {
                if t_now + EPS >= self.trains[idx].spec.depart_s {
                    self.trains[idx].status = TrainStatus::Running;
                } else {
                    return false;
                }
            }
            TrainStatus::Dwelling => {
                if t_now + EPS >= self.trains[idx].dwell_until {
                    let tr = &mut self.trains[idx];
                    tr.status = TrainStatus::Running;
                    let pi = tr.spec.stops[tr.next_stop % tr.spec.stops.len()].path_index;
                    tr.next_stop += 1;
                    if self.cfg.record_events {
                        self.events.push(Event::StopDeparture {
                            t: t_now,
                            train: id,
                            path_index: pi,
                        });
                    }
                } else {
                    return false;
                }
            }
            TrainStatus::Exiting => return self.step_exiting(id, dt),
            TrainStatus::Running => {}
        }

        // Request routes far enough ahead to keep running at current speed.
        loop {
            let tr = &self.trains[idx];
            let auth_end = if tr.auth_k == 0 {
                0.0
            } else {
                tr.end(tr.auth_k - 1, &self.tds)
            };
            let b = tr.spec.service_decel_mps2;
            let need = tr.speed * tr.speed / (2.0 * b)
                + tr.speed * self.cfg.route_request_lookahead_s
                + self.cfg.route_request_margin_m;
            if auth_end - tr.head_m > need || tr.auth_k >= tr.max_k() {
                break;
            }
            if !self.try_reserve_next_route(id) {
                break;
            }
        }

        let tds = &self.tds;
        let tr = &self.trains[idx];
        let sp = &tr.spec;
        let b = sp.service_decel_mps2;
        let v = tr.speed;
        let auth_end = tr.end(tr.auth_k - 1, tds);
        let path_end_portal = !sp.cyclic && tr.auth_k >= sp.path.len() && tr.exit_open;
        let mut target = auth_end;
        let mut target_v = 0.0;
        if path_end_portal {
            // Portal open: run through at line speed; the coordinator takes over.
            target_v = tds[tr.tds_at(tr.auth_k - 1) as usize]
                .spec
                .speed_limit_mps
                .min(sp.max_speed_mps);
        }
        let stop = tr.next_stop_pos();
        if let Some((pos, _)) = stop {
            if pos <= target + EPS {
                target = pos;
                target_v = 0.0;
            }
        }
        // Speed limit over the sections the train body covers.
        let head_k = tr.head_k(tds);
        let mut v_lim = sp.max_speed_mps;
        for k in tr.tail_k..=head_k {
            v_lim = v_lim.min(tds[tr.tds_at(k) as usize].spec.speed_limit_mps);
        }
        // Braking curves to lower limits ahead within the authority.
        let mut v_allowed = v_lim.min(braking_speed(target - tr.head_m, target_v, b, dt));
        for k in head_k + 1..tr.auth_k {
            let d = tr.start(k) - tr.head_m;
            if d > target - tr.head_m {
                break;
            }
            let lim = tds[tr.tds_at(k) as usize].spec.speed_limit_mps;
            v_allowed = v_allowed.min(braking_speed(d, lim, b, dt));
        }
        let grad = tds[tr.tds_at(head_k) as usize].spec.gradient;
        let a_trac = sp
            .max_accel_mps2
            .min(sp.power_w / (sp.mass_kg * v.max(1.0)));
        let resist = (sp.davis_a_n + sp.davis_b_n_per_mps * v + sp.davis_c_n_per_mps2 * v * v)
            / sp.mass_kg
            + G * grad;
        let v_cand = (v + (a_trac - resist) * dt).max(0.0);
        let mut v_new = v_cand
            .min(v_allowed)
            .max((v - b * dt).max(0.0).min(v_allowed));
        let mut head_new = tr.head_m + v_new * dt;
        if !path_end_portal && head_new > target {
            head_new = target.max(tr.head_m);
            v_new = (head_new - tr.head_m) / dt;
        }
        let moved = head_new > tr.head_m + EPS;
        let dist = head_new - tr.head_m;
        let old_v = v;
        let arrived_stop =
            stop.is_some_and(|(pos, _)| (head_new - pos).abs() < 0.05 && v_new < 0.5);
        let reached_portal = path_end_portal && head_new >= auth_end - EPS;
        let reached_end = !sp.cyclic
            && !tr.exit_open
            && tr.auth_k >= sp.path.len()
            && head_new >= auth_end - 0.05
            && !arrived_stop;

        let tr = &mut self.trains[idx];
        tr.head_m = head_new;
        tr.speed = v_new;
        tr.accel = (v_new - old_v) / dt;
        self.stats.train_km += dist / 1000.0;
        if arrived_stop {
            let (pos, pi) = stop.unwrap();
            tr.head_m = pos;
            tr.speed = 0.0;
            tr.status = TrainStatus::Dwelling;
            let dwell = tr.spec.stops[tr.next_stop % tr.spec.stops.len()].dwell_s;
            tr.dwell_until = t_now + dt + dwell;
            self.stats.stop_arrivals += 1;
            if self.cfg.record_events {
                self.events.push(Event::StopArrival {
                    t: t_now + dt,
                    train: id,
                    path_index: pi,
                });
            }
        } else if reached_portal {
            tr.status = TrainStatus::Exiting;
            tr.external_speed = tr.speed;
            if self.cfg.record_events {
                self.events.push(Event::HeadAtPortal {
                    t: t_now + dt,
                    train: id,
                });
            }
        } else if reached_end && tr.speed < 0.01 {
            tr.status = TrainStatus::Terminated;
        }
        self.release_behind(id);
        moved
    }

    /// Purpose: move a train whose head has left through the exit portal. Its
    /// speed is set externally by the co-simulation coordinator.
    fn step_exiting(&mut self, id: TrainId, dt: f64) -> bool {
        let idx = id as usize;
        let v = self.trains[idx].external_speed.max(0.0);
        let tr = &mut self.trains[idx];
        tr.head_m += v * dt;
        tr.speed = v;
        self.stats.train_km += v * dt / 1000.0;
        self.release_behind(id);
        let tr = &mut self.trains[idx];
        if tr.tail_k >= tr.auth_k {
            tr.status = TrainStatus::Exited;
            if self.cfg.record_events {
                self.events.push(Event::Exited {
                    t: self.t + dt,
                    train: id,
                });
            }
        }
        v > 0.0
    }

    /// Purpose: open or close the exit portal at the end of a non-cyclic path.
    /// Side effects: when open, the train may run past its path end.
    pub fn set_exit_open(&mut self, id: TrainId, open: bool) {
        self.trains[id as usize].exit_open = open;
    }

    /// Purpose: set the speed of an exiting train (taken from the road engine).
    pub fn set_external_speed(&mut self, id: TrainId, v: f64) {
        self.trains[id as usize].external_speed = v;
    }

    /// Purpose: block or unblock a section (disruption, level-crossing fault).
    /// Side effects: blocked sections cannot be newly reserved; existing
    /// reservations are kept, so trains already given authority are not affected.
    pub fn set_blocked(&mut self, tds: TdsId, blocked: bool) {
        self.tds[tds as usize].blocked = blocked;
    }

    /// Purpose: which train, if any, holds a reservation on a section.
    pub fn reserved_by(&self, tds: TdsId) -> Option<TrainId> {
        self.tds[tds as usize].reserved_by
    }

    /// Purpose: current simulation time in seconds.
    pub fn time(&self) -> f64 {
        self.t
    }

    /// Purpose: aggregate counters.
    pub fn stats(&self) -> &SimStats {
        &self.stats
    }

    /// Purpose: number of trains (all statuses).
    pub fn train_count(&self) -> usize {
        self.trains.len()
    }

    /// Purpose: take recorded events, leaving the buffer empty.
    pub fn drain_events(&mut self) -> Vec<Event> {
        std::mem::take(&mut self.events)
    }

    /// Purpose: snapshot of one train.
    pub fn train_state(&self, id: TrainId) -> TrainState {
        let tr = &self.trains[id as usize];
        let head_k = tr.head_k(&self.tds).min(tr.auth_k.saturating_sub(1));
        let auth_end = if tr.auth_k == 0 {
            tr.head_m
        } else {
            tr.end(tr.auth_k - 1, &self.tds)
        };
        TrainState {
            id,
            name: tr.spec.name.clone(),
            status: tr.status,
            head_m: tr.head_m,
            speed_mps: tr.speed,
            accel_mps2: tr.accel,
            head_tds: tr.tds_at(head_k),
            head_offset_m: tr.head_m - tr.start(head_k),
            authority_ahead_m: auth_end - tr.head_m,
        }
    }

    /// Purpose: verify the safety invariants.
    /// Output: Ok, or a description of the first violation found.
    /// Checks: (1) every section under a train body is reserved by that train;
    /// (2) no head is beyond its movement authority (except through an open portal).
    pub fn check_invariants(&self) -> Result<(), String> {
        for (i, tr) in self.trains.iter().enumerate() {
            if matches!(tr.status, TrainStatus::Exited) {
                continue;
            }
            let id = i as TrainId;
            let tail_m = tr.head_m - tr.spec.length_m;
            let mut k = tr.tail_k;
            while k < tr.auth_k && tr.start(k) < tr.head_m - EPS {
                if tr.end(k, &self.tds) > tail_m + EPS {
                    let s = tr.tds_at(k);
                    if self.tds[s as usize].reserved_by != Some(id) {
                        return Err(format!(
                            "t={:.1}: train {} occupies section {} reserved by {:?}",
                            self.t, tr.spec.name, s, self.tds[s as usize].reserved_by
                        ));
                    }
                }
                k += 1;
            }
            if !matches!(tr.status, TrainStatus::Exiting) && tr.auth_k > 0 {
                let auth_end = tr.end(tr.auth_k - 1, &self.tds);
                if tr.head_m > auth_end + 1e-3 {
                    return Err(format!(
                        "t={:.1}: train {} passed its authority by {:.3} m",
                        self.t,
                        tr.spec.name,
                        tr.head_m - auth_end
                    ));
                }
            }
        }
        Ok(())
    }
}
