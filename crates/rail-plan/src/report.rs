//! Validation and capacity report of a plan (ADR-0032 §3 step 8).
//!
//! - **Conflicts** between trains (never between two runs of the same train,
//!   which hand over the same platform by construction).
//! - **Fleet**: trains used, the most in service at once, and the reserve.
//! - **Capacity** by the UIC 406 compression method for each line and
//!   direction and each hour: the blocking time stairways of the hour's trains
//!   are pushed together on the sections the line uses outside its terminal
//!   platforms; the compressed time over the hour is the line's capacity
//!   consumption. The **terminals** are measured as stations (UIC 406 node
//!   capacity): the share of the hour their platform tracks are blocked by
//!   arrivals, turn-backs and departures, over the platforms the line uses.
//!   The **maximum capacity** in trains per hour follows from the most
//!   consumed hour and the tighter of line and terminal: the theoretical
//!   maximum at 100 % and the practical one at the UIC 406 recommended limit
//!   (`capacity.occupancy_limit_share`). The section with the longest
//!   blocking in that hour is named as the bottleneck.

use std::collections::{BTreeMap, BTreeSet};

use rail_model::{Model, TdsId};
use serde::Serialize;

use crate::conflicts::{compress, find_conflicts, Conflict};
use crate::path::Place;
use crate::plan::{Plan, RunKind};

/// Capacity of one line direction in one hour.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct HourCapacity {
    /// Line id.
    pub line: String,
    /// Direction (0 outbound, 1 return).
    pub direction: u8,
    /// Hour of the service day (0 = 00:00–01:00).
    pub hour: u32,
    /// Service trains whose blocking starts in the hour.
    pub trains: usize,
    /// UIC 406 capacity consumption of the line outside the terminal platforms (1.0 = 100 %).
    pub consumption: f64,
    /// Busier terminal: blocked share of its platforms (1.0 = all platforms all hour).
    pub terminal_share: f64,
    /// That terminal (station name).
    pub terminal: String,
    /// Section with the longest total blocking in the hour.
    pub bottleneck: String,
    /// Its blocked share of the hour.
    pub bottleneck_share: f64,
}

/// Maximum capacity of one line direction.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct MaxCapacity {
    /// Line id.
    pub line: String,
    /// Direction.
    pub direction: u8,
    /// The most consumed hour.
    pub hour: u32,
    /// Trains planned in that hour.
    pub planned_per_hour: usize,
    /// Trains per hour at 100 % consumption.
    pub theoretical_per_hour: f64,
    /// Trains per hour at the recommended occupancy limit.
    pub practical_per_hour: f64,
}

/// The report.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Report {
    /// Conflicts between different trains (should be empty).
    pub conflicts: Vec<Conflict>,
    /// Service trips placed.
    pub trips: usize,
    /// Trains used.
    pub vehicles: usize,
    /// Most trains out of stabling at once.
    pub peak_out: usize,
    /// Reserve trains (`mode.spare_share` of the peak, rounded up).
    pub reserve: usize,
    /// Capacity per line, direction and hour with service.
    pub capacity: Vec<HourCapacity>,
    /// Maximum capacity per line and direction.
    pub max_capacity: Vec<MaxCapacity>,
}

/// Purpose: validate a plan and measure its capacity.
/// Inputs: model, plan, line ids (by index), the minimum buffer time, the
/// reserve share and the occupancy limit share.
/// Output: the report.
pub fn report(
    m: &Model,
    plan: &Plan,
    line_ids: &[String],
    min_buffer_s: f64,
    spare_share: f64,
    occupancy_limit: f64,
) -> Report {
    let vehicle = plan.vehicle_of();
    let blocks = plan.blocks();
    let conflicts: Vec<Conflict> = find_conflicts(&blocks, min_buffer_s)
        .into_iter()
        .filter(|c| vehicle[c.first] != vehicle[c.second])
        .collect();

    // Trains out of stabling over time: +1 at a pull-out departure, -1 at a pull-in arrival.
    let mut events: Vec<(f64, i32)> = Vec::new();
    for r in &plan.runs {
        match r.kind {
            RunKind::PullOut => events.push((r.depart_s(), 1)),
            RunKind::PullIn => events.push((r.arrive_s(), -1)),
            RunKind::Service => {}
        }
    }
    events.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let (mut out, mut peak) = (0i32, 0i32);
    for (_, d) in events {
        out += d;
        peak = peak.max(out);
    }

    let mut capacity = Vec::new();
    let mut max_capacity = Vec::new();
    for (li, lid) in line_ids.iter().enumerate() {
        for dir in 0..2u8 {
            let runs: Vec<usize> = plan
                .runs
                .iter()
                .enumerate()
                .filter(|(_, r)| r.kind == RunKind::Service && r.line == li && r.direction == dir)
                .map(|(i, _)| i)
                .collect();
            if runs.is_empty() {
                continue;
            }
            let set: BTreeSet<usize> = runs.iter().copied().collect();
            let own: Vec<_> = blocks
                .iter()
                .copied()
                .filter(|b| set.contains(&b.train))
                .collect();
            // Terminal platform sections per terminal station group.
            let mut terminals: BTreeMap<u32, BTreeSet<TdsId>> = BTreeMap::new();
            let mut platforms_used: BTreeMap<u32, BTreeSet<u32>> = BTreeMap::new();
            for &ri in &runs {
                let r = &plan.runs[ri];
                for c in [r.calls.first(), r.calls.last()].into_iter().flatten() {
                    if let Place::Platform(pid) = c.place {
                        let pf = &m.platforms[pid as usize];
                        let g = m.stations[pf.station as usize].group;
                        platforms_used.entry(g).or_default().insert(pid);
                        let e = terminals.entry(g).or_default();
                        for &pc in m.track_pieces(pf.track) {
                            let piece = &m.pieces[pc as usize];
                            if piece.to_m > pf.from_m && piece.from_m < pf.to_m {
                                e.insert(piece.tds);
                            }
                        }
                    }
                }
            }
            let terminal_tds: BTreeSet<TdsId> = terminals.values().flatten().copied().collect();
            let sections: BTreeSet<TdsId> = own
                .iter()
                .map(|b| b.tds)
                .filter(|t| !terminal_tds.contains(t))
                .collect();
            let first_h = (plan.runs[runs[0]].depart_s() / 3600.0).floor() as u32;
            let last_h = (plan.runs[*runs.last().unwrap()].depart_s() / 3600.0).floor() as u32;
            let mut worst: Option<(f64, u32, usize)> = None;
            for h in first_h.saturating_sub(1)..=last_h {
                let w0 = h as f64 * 3600.0;
                let c = compress(&own, Some(&sections), w0, 3600.0, min_buffer_s);
                let trains = c.shifts.len();
                if trains == 0 {
                    continue;
                }
                let mut per: BTreeMap<TdsId, f64> = BTreeMap::new();
                for b in &own {
                    let s = b.start_s.max(w0);
                    let e = b.end_s.min(w0 + 3600.0);
                    if e > s {
                        *per.entry(b.tds).or_default() += e - s;
                    }
                }
                let (bt, bs) = per
                    .iter()
                    .max_by(|a, b| a.1.partial_cmp(b.1).unwrap().then(b.0.cmp(a.0)))
                    .map(|(t, s)| (*t, *s))
                    .unwrap_or((0, 0.0));
                // Terminal platforms: blocked time of all trains (both directions,
                // depot moves) over the hour and the platforms the line uses.
                let mut term = (0.0f64, String::new());
                for (g, tds) in &terminals {
                    let mut busy = 0.0;
                    for t in tds {
                        let mut iv: Vec<(f64, f64)> = blocks
                            .iter()
                            .filter(|b| b.tds == *t)
                            .map(|b| (b.start_s.max(w0), b.end_s.min(w0 + 3600.0)))
                            .filter(|(a, b)| b > a)
                            .collect();
                        iv.sort_by(|a, b| a.partial_cmp(b).unwrap());
                        let mut end = f64::NEG_INFINITY;
                        for (a, b) in iv {
                            if a >= end {
                                busy += b - a;
                                end = b;
                            } else if b > end {
                                busy += b - end;
                                end = b;
                            }
                        }
                    }
                    let n = platforms_used[g].len().max(1) as f64;
                    let per_platform = (tds.len() as f64 / n).max(1.0);
                    let share = busy / (3600.0 * n * per_platform);
                    if share > term.0 {
                        term = (share, m.groups[*g as usize].name.clone());
                    }
                }
                capacity.push(HourCapacity {
                    line: lid.clone(),
                    direction: dir,
                    hour: h,
                    trains,
                    consumption: c.consumption,
                    terminal_share: term.0,
                    terminal: term.1,
                    bottleneck: m.tds[bt as usize].id.clone(),
                    bottleneck_share: bs / 3600.0,
                });
                // Only hours with a full hour of regular service count for the maximum.
                let tight = c.consumption.max(term.0);
                if worst.map_or(true, |(wc, _, _)| tight > wc) && trains >= 2 {
                    worst = Some((tight, h, trains));
                }
            }
            if let Some((c, h, n)) = worst {
                let theo = n as f64 / c.max(1e-9);
                max_capacity.push(MaxCapacity {
                    line: lid.clone(),
                    direction: dir,
                    hour: h,
                    planned_per_hour: n,
                    theoretical_per_hour: theo,
                    practical_per_hour: theo * occupancy_limit,
                });
            }
        }
    }
    Report {
        conflicts,
        trips: plan
            .runs
            .iter()
            .filter(|r| r.kind == RunKind::Service)
            .count(),
        vehicles: plan.vehicles,
        peak_out: peak.max(0) as usize,
        reserve: (peak.max(0) as f64 * spare_share).ceil() as usize,
        capacity,
        max_capacity,
    }
}
