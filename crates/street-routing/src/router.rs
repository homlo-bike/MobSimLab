//! Legal paths between positions on the road graph (edge-based Dijkstra).
//!
//! The search state is the directed arc the vehicle is on, so turn bans and the
//! "no U-turn" rule (ADR-0029 §5) are checked on every arc-to-arc transition.
//! The algorithm is `pathfinding::dijkstra` (one routing library, ADR-0009).

use crate::geo::deflection_deg;
use crate::graph::RoadGraph;
use crate::profile::{Mode, VehicleProfile};
use pathfinding::prelude::dijkstra;
use serde::Serialize;

/// A position on a directed arc: the vehicle passes it while driving along `arc`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Anchor {
    /// Directed arc.
    pub arc: u32,
    /// Position along the arc, 0 at its start, 1 at its end.
    pub t: f64,
}

/// A routed path between two anchors.
#[derive(Debug, Clone, PartialEq)]
pub struct Path {
    /// Arcs driven, starting with the start anchor's arc and ending with the end anchor's arc.
    pub arcs: Vec<u32>,
    /// Polyline in local metres.
    pub xy: Vec<(f64, f64)>,
    /// Length in metres.
    pub length_m: f64,
    /// Running time in seconds at legal speed (no dwell, no traffic).
    pub time_s: f64,
    /// Longest continuous stretch without overhead wire, in metres.
    pub max_off_wire_m: f64,
}

/// Search options.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SearchOptions {
    /// Allow U-turns anywhere. Only used to measure the direct distance for detour warnings.
    pub allow_u_turns: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum State {
    Start,
    Arc(u32),
    End,
}

/// Turning round at a turning circle costs this much time (manoeuvring).
const TURN_ROUND_MS: u64 = 30_000;
/// Cost factor for BRT on bus lanes and busways (preference, not a ban elsewhere).
const BRT_LANE_FACTOR: f64 = 0.7;

fn arc_time_ms(g: &RoadGraph, arc: u32, v: &VehicleProfile) -> f64 {
    let a = &g.arcs[arc as usize];
    let speed = a.speed_kmh.min(v.max_speed_kmh) / 3.6;
    let factor = if v.mode == Mode::Brt && a.bus_lane {
        BRT_LANE_FACTOR
    } else {
        1.0
    };
    a.length_m / speed * 1000.0 * factor
}

/// Purpose: time penalty for a turn by deflection angle, or `None` when the turn is illegal.
fn turn_ms(g: &RoadGraph, from: u32, to: u32, opt: SearchOptions) -> Option<u64> {
    let (a, b) = (&g.arcs[from as usize], &g.arcs[to as usize]);
    if b.to == a.from && b.segment == a.segment {
        // Straight back along the same segment: a U-turn.
        let allowed = opt.allow_u_turns || g.nodes[a.to as usize].turn_round;
        return allowed.then_some(TURN_ROUND_MS);
    }
    if g.banned.contains(&(from, to)) {
        return None;
    }
    let d = deflection_deg(a.heading, b.heading);
    Some(if d > 120.0 {
        15_000
    } else if d > 60.0 {
        6_000
    } else if d > 30.0 {
        2_000
    } else {
        0
    })
}

/// Purpose: fastest legal path from `start` to `end` for vehicle `v`.
/// Output: `None` when no legal path exists (one-ways, bans, nowhere to turn round).
pub fn route(
    g: &RoadGraph,
    v: &VehicleProfile,
    start: Anchor,
    end: Anchor,
    opt: SearchOptions,
) -> Option<Path> {
    let succ = |s: &State| -> Vec<(State, u64)> {
        let mut out = Vec::new();
        let (arc, leave_ms) = match *s {
            State::End => return out,
            State::Start => {
                if start.arc == end.arc && end.t >= start.t {
                    let ms = (end.t - start.t) * arc_time_ms(g, start.arc, v);
                    out.push((State::End, ms.round() as u64));
                }
                (start.arc, (1.0 - start.t) * arc_time_ms(g, start.arc, v))
            }
            State::Arc(a) => {
                if a == end.arc {
                    out.push((State::End, (end.t * arc_time_ms(g, a, v)).round() as u64));
                }
                (a, arc_time_ms(g, a, v))
            }
        };
        let node = g.arcs[arc as usize].to as usize;
        for &n in &g.out[node] {
            if !g.allows(n, v) {
                continue;
            }
            if let Some(t) = turn_ms(g, arc, n, opt) {
                out.push((State::Arc(n), leave_ms.round() as u64 + t));
            }
        }
        out
    };
    let (states, _) = dijkstra(&State::Start, succ, |s| *s == State::End)?;
    let mut arcs = vec![start.arc];
    arcs.extend(states.iter().filter_map(|s| match s {
        State::Arc(a) => Some(*a),
        _ => None,
    }));
    Some(build_path(g, v, &arcs, start, end))
}

fn build_path(g: &RoadGraph, v: &VehicleProfile, arcs: &[u32], start: Anchor, end: Anchor) -> Path {
    let mut xy = vec![g.point_on_arc(start.arc, start.t)];
    let (mut length_m, mut time_ms, mut off, mut max_off) = (0.0, 0.0, 0.0f64, 0.0f64);
    for (i, &a) in arcs.iter().enumerate() {
        let t0 = if i == 0 { start.t } else { 0.0 };
        let t1 = if i == arcs.len() - 1 { end.t } else { 1.0 };
        let share = (t1 - t0).max(0.0);
        let len = g.arcs[a as usize].length_m * share;
        length_m += len;
        time_ms += arc_time_ms(g, a, v) * share;
        if g.arcs[a as usize].wire {
            off = 0.0;
        } else {
            off += len;
            max_off = max_off.max(off);
        }
        if i < arcs.len() - 1 {
            xy.push(g.nodes[g.arcs[a as usize].to as usize].xy);
        }
    }
    xy.push(g.point_on_arc(end.arc, end.t));
    Path {
        arcs: arcs.to_vec(),
        xy,
        length_m,
        time_s: time_ms / 1000.0,
        max_off_wire_m: max_off,
    }
}
