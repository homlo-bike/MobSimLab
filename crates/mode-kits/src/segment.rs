//! Mesoscopic segment engine (ADR-0036 §8, ADR-0037 §5).
//!
//! A vehicle runs a list of calls. At each call it needs the call's resource (a berth at a pier, the single
//! track of an aerial tramway…) for its dwell; it travels to the next call in a fixed running time that the
//! mode plugin computed. The engine keeps the simulation clock and a [`Reservations`] table; a vehicle that
//! finds every unit of a resource taken holds (waits outside the pier, like a train at a signal) until one
//! is free. The engine does not own a loop of its own beyond [`Engine::advance`], so a co-simulation
//! coordinator can drive it step by step, and it is deterministic: events at the same time are processed in
//! the order they were created.

use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{BTreeMap, BinaryHeap};

/// Time in seconds after midnight.
pub type Secs = f64;

/// Answer to a reservation request.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Grant {
    /// The resource is held for `[from, to)` as asked.
    Granted,
    /// Every unit is taken; the earliest start at which a unit is free for the same duration.
    Wait { until: Secs },
}

/// Reservation table: per resource, a number of units (berths) and the intervals booked on them.
#[derive(Debug, Clone, Default)]
pub struct Reservations {
    capacity: BTreeMap<String, u32>,
    booked: BTreeMap<String, Vec<(Secs, Secs)>>,
}

impl Reservations {
    /// Purpose: declare a resource with `units` interchangeable units (berths at a pier, lock chambers).
    /// Side effects: replaces an earlier declaration; bookings stay.
    pub fn declare(&mut self, resource: &str, units: u32) {
        self.capacity.insert(resource.into(), units.max(1));
    }

    fn overlaps(&self, resource: &str, from: Secs, to: Secs) -> usize {
        self.booked.get(resource).map_or(0, |v| {
            v.iter().filter(|(a, b)| *a < to && from < *b).count()
        })
    }

    /// Purpose: hold one unit of `resource` for `[from, to)`.
    /// Output: [`Grant::Granted`] and the booking is made, or [`Grant::Wait`] with the earliest start at
    /// which a unit is free for the same duration (nothing is booked). Undeclared resources have no limit.
    pub fn reserve(&mut self, resource: &str, from: Secs, to: Secs) -> Grant {
        let Some(&cap) = self.capacity.get(resource) else {
            return Grant::Granted;
        };
        let cap = cap as usize;
        if self.overlaps(resource, from, to) < cap {
            self.booked
                .entry(resource.into())
                .or_default()
                .push((from, to));
            return Grant::Granted;
        }
        let d = to - from;
        let mut ends: Vec<Secs> = self.booked[resource]
            .iter()
            .map(|(_, b)| *b)
            .filter(|b| *b > from)
            .collect();
        ends.sort_by(|a, b| a.partial_cmp(b).unwrap_or(Ordering::Equal));
        for s in ends {
            if self.overlaps(resource, s, s + d) < cap {
                return Grant::Wait { until: s };
            }
        }
        // Unreachable with finite bookings: after the last end every unit is free.
        Grant::Wait { until: to }
    }

    /// Purpose: the most units of `resource` booked at the same time.
    pub fn peak(&self, resource: &str) -> usize {
        let Some(v) = self.booked.get(resource) else {
            return 0;
        };
        let mut ev: Vec<(Secs, i32)> = v.iter().flat_map(|(a, b)| [(*a, 1), (*b, -1)]).collect();
        ev.sort_by(|x, y| {
            x.0.partial_cmp(&y.0)
                .unwrap_or(Ordering::Equal)
                .then(x.1.cmp(&y.1))
        });
        let (mut n, mut best) = (0i32, 0i32);
        for (_, d) in ev {
            n += d;
            best = best.max(n);
        }
        best as usize
    }
}

/// One call of a vehicle's run.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Call {
    /// Stop id, for the event log.
    pub stop: String,
    /// Resource held during the dwell, if any (for example `berth:<pier>`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource: Option<String>,
    /// Time at the call (boarding, alighting, layover), seconds.
    pub dwell_s: Secs,
    /// Running time from this call to the next, seconds (ignored on the last call).
    pub run_s: Secs,
}

/// A vehicle's run: its calls in order, from a first departure time.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Run {
    pub vehicle: String,
    /// Arrival time at the first call (the start of its dwell).
    pub start: Secs,
    pub calls: Vec<Call>,
}

/// What happened, in time order.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Event {
    Arrive {
        vehicle: String,
        stop: String,
        call: usize,
        t: Secs,
    },
    /// The vehicle waits for the call's resource from `t` until `until`.
    Hold {
        vehicle: String,
        stop: String,
        call: usize,
        t: Secs,
        until: Secs,
    },
    Depart {
        vehicle: String,
        stop: String,
        call: usize,
        t: Secs,
    },
    Finish {
        vehicle: String,
        t: Secs,
    },
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct Pending {
    t: Secs,
    seq: u64,
    run: usize,
    call: usize,
}

impl Eq for Pending {}
impl Ord for Pending {
    fn cmp(&self, o: &Self) -> Ordering {
        // Min-heap on (t, seq).
        o.t.partial_cmp(&self.t)
            .unwrap_or(Ordering::Equal)
            .then(o.seq.cmp(&self.seq))
    }
}
impl PartialOrd for Pending {
    fn partial_cmp(&self, o: &Self) -> Option<Ordering> {
        Some(self.cmp(o))
    }
}

/// The segment engine: runs, the reservation table and the clock.
#[derive(Debug, Default)]
pub struct Engine {
    runs: Vec<Run>,
    queue: BinaryHeap<Pending>,
    seq: u64,
    now: Secs,
    pub reservations: Reservations,
}

impl Engine {
    /// Purpose: an engine with no runs; declare resources on `reservations` before departing runs.
    pub fn new() -> Self {
        Self::default()
    }

    /// Purpose: add a run; its vehicle arrives at the first call at `run.start`.
    pub fn depart(&mut self, run: Run) {
        let t = run.start;
        self.runs.push(run);
        self.push(t, self.runs.len() - 1, 0);
    }

    fn push(&mut self, t: Secs, run: usize, call: usize) {
        self.seq += 1;
        self.queue.push(Pending {
            t,
            seq: self.seq,
            run,
            call,
        });
    }

    /// Purpose: the simulation clock (the time of the last processed arrival).
    pub fn now(&self) -> Secs {
        self.now
    }

    /// Purpose: process every arrival up to and including time `t`.
    /// Output: the events in time order (an arrival's dwell, hold and departure are reported together).
    pub fn advance(&mut self, t: Secs) -> Vec<Event> {
        let mut out = Vec::new();
        while let Some(p) = self.queue.peek().copied() {
            if p.t > t {
                break;
            }
            self.queue.pop();
            self.now = p.t;
            let call = self.runs[p.run].calls[p.call].clone();
            let vehicle = self.runs[p.run].vehicle.clone();
            let mut start = p.t;
            out.push(Event::Arrive {
                vehicle: vehicle.clone(),
                stop: call.stop.clone(),
                call: p.call,
                t: p.t,
            });
            if let Some(r) = &call.resource {
                loop {
                    match self.reservations.reserve(r, start, start + call.dwell_s) {
                        Grant::Granted => break,
                        Grant::Wait { until } => {
                            out.push(Event::Hold {
                                vehicle: vehicle.clone(),
                                stop: call.stop.clone(),
                                call: p.call,
                                t: start,
                                until,
                            });
                            start = until;
                        }
                    }
                }
            }
            let dep = start + call.dwell_s;
            let last = p.call + 1 == self.runs[p.run].calls.len();
            if last {
                out.push(Event::Finish { vehicle, t: dep });
            } else {
                out.push(Event::Depart {
                    vehicle,
                    stop: call.stop.clone(),
                    call: p.call,
                    t: dep,
                });
                self.push(dep + call.run_s, p.run, p.call + 1);
            }
        }
        out
    }

    /// Purpose: run everything to the end.
    pub fn run_all(&mut self) -> Vec<Event> {
        self.advance(f64::INFINITY)
    }
}

/// Input of [`simulate`]: resources with their units, and the runs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimInput {
    #[serde(default)]
    pub resources: BTreeMap<String, u32>,
    pub runs: Vec<Run>,
}

/// Output of [`simulate`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimOutput {
    pub events: Vec<Event>,
    /// Number of holds and total held seconds.
    pub holds: usize,
    pub held_s: Secs,
    /// Most units booked at once, per resource.
    pub peak: BTreeMap<String, usize>,
}

/// Purpose: run a whole set of runs on a fresh engine (for checks and the MCP tools later).
pub fn simulate(input: &SimInput) -> SimOutput {
    let mut e = Engine::new();
    for (r, n) in &input.resources {
        e.reservations.declare(r, *n);
    }
    for r in &input.runs {
        e.depart(r.clone());
    }
    let events = e.run_all();
    let (mut holds, mut held_s) = (0, 0.0);
    for ev in &events {
        if let Event::Hold { t, until, .. } = ev {
            holds += 1;
            held_s += until - t;
        }
    }
    let peak = input
        .resources
        .keys()
        .map(|r| (r.clone(), e.reservations.peak(r)))
        .collect();
    SimOutput {
        events,
        holds,
        held_s,
        peak,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(stop: &str, res: Option<&str>, dwell: f64, run: f64) -> Call {
        Call {
            stop: stop.into(),
            resource: res.map(Into::into),
            dwell_s: dwell,
            run_s: run,
        }
    }

    #[test]
    fn reserve_grants_until_full_then_waits_for_the_first_free_unit() {
        let mut r = Reservations::default();
        r.declare("berth:a", 2);
        assert_eq!(r.reserve("berth:a", 0.0, 100.0), Grant::Granted);
        assert_eq!(r.reserve("berth:a", 10.0, 50.0), Grant::Granted);
        assert_eq!(
            r.reserve("berth:a", 20.0, 60.0),
            Grant::Wait { until: 50.0 }
        );
        assert_eq!(r.peak("berth:a"), 2);
        // Undeclared resources are unlimited.
        assert_eq!(r.reserve("free", 0.0, 1.0), Grant::Granted);
    }

    #[test]
    fn wait_finds_a_gap_long_enough() {
        let mut r = Reservations::default();
        r.declare("x", 1);
        r.reserve("x", 0.0, 10.0);
        r.reserve("x", 15.0, 30.0);
        // A 10 s dwell does not fit in the 5 s gap at 10..15, so it waits until 30.
        assert_eq!(r.reserve("x", 5.0, 15.0), Grant::Wait { until: 30.0 });
        // A 4 s dwell fits at 10.
        assert_eq!(r.reserve("x", 5.0, 9.0), Grant::Wait { until: 10.0 });
    }

    #[test]
    fn second_vessel_holds_outside_a_one_berth_pier() {
        let input = SimInput {
            resources: [("berth:b".to_string(), 1)].into_iter().collect(),
            runs: vec![
                Run {
                    vehicle: "v1".into(),
                    start: 0.0,
                    calls: vec![
                        call("a", None, 0.0, 100.0),
                        call("b", Some("berth:b"), 300.0, 0.0),
                    ],
                },
                Run {
                    vehicle: "v2".into(),
                    start: 60.0,
                    calls: vec![
                        call("a", None, 0.0, 100.0),
                        call("b", Some("berth:b"), 300.0, 0.0),
                    ],
                },
            ],
        };
        let out = simulate(&input);
        assert_eq!(out.holds, 1);
        assert!(
            (out.held_s - 240.0).abs() < 1e-9,
            "v2 arrives at 160 and waits until 400"
        );
        assert!(out.events.contains(&Event::Finish {
            vehicle: "v2".into(),
            t: 700.0
        }));
        assert_eq!(out.peak["berth:b"], 1);
    }

    #[test]
    fn advance_is_stepwise_and_deterministic() {
        let mut e = Engine::new();
        e.depart(Run {
            vehicle: "a".into(),
            start: 0.0,
            calls: vec![call("s", None, 10.0, 50.0), call("t", None, 0.0, 0.0)],
        });
        let first = e.advance(30.0);
        assert_eq!(first.len(), 2, "arrive and depart at s");
        let rest = e.advance(100.0);
        assert_eq!(
            rest,
            vec![
                Event::Arrive {
                    vehicle: "a".into(),
                    stop: "t".into(),
                    call: 1,
                    t: 60.0
                },
                Event::Finish {
                    vehicle: "a".into(),
                    t: 60.0
                },
            ]
        );
        assert_eq!(e.now(), 60.0);
    }
}
