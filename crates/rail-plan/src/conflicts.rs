//! Timetable conflict detection on blocking times (FR-TT-06) and UIC 406
//! capacity consumption by the compression method.

use std::collections::{BTreeMap, BTreeSet};

use rail_model::TdsId;
use serde::Serialize;

use crate::blocking::Blocking;

/// Two trains that block the same section at overlapping times (or with less
/// than the minimum buffer time between them).
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct Conflict {
    /// The section.
    pub tds: TdsId,
    /// The train that blocks it first.
    pub first: usize,
    /// The train that blocks it second.
    pub second: usize,
    /// How much the second train must move later to resolve it, s.
    pub shortfall_s: f64,
    /// Blocking interval of the first train.
    pub first_interval: (f64, f64),
    /// Blocking interval of the second train.
    pub second_interval: (f64, f64),
}

/// Purpose: merge each train's blocking intervals per section (a train may
/// block a section through two consecutive routes, or a route and an overlap).
/// Output: per section, (train, start, end), sorted by start then train.
fn by_section(blocks: &[Blocking]) -> BTreeMap<TdsId, Vec<(usize, f64, f64)>> {
    let mut m: BTreeMap<TdsId, Vec<(usize, f64, f64)>> = BTreeMap::new();
    for b in blocks {
        m.entry(b.tds)
            .or_default()
            .push((b.train, b.start_s, b.end_s));
    }
    for v in m.values_mut() {
        v.sort_by(|a, b| (a.0, a.1).partial_cmp(&(b.0, b.1)).unwrap());
        let mut merged: Vec<(usize, f64, f64)> = Vec::with_capacity(v.len());
        for &(t, s, e) in v.iter() {
            match merged.last_mut() {
                Some(l) if l.0 == t && s <= l.2 + 1e-9 => l.2 = l.2.max(e),
                _ => merged.push((t, s, e)),
            }
        }
        merged.sort_by(|a, b| (a.1, a.0).partial_cmp(&(b.1, b.0)).unwrap());
        *v = merged;
    }
    m
}

/// Purpose: all conflicts between different trains.
/// Inputs: blocking intervals of all trains and the minimum buffer time between
/// two trains on one section (`timetable.min_buffer_s`).
/// Output: conflicts sorted by section, then time.
pub fn find_conflicts(blocks: &[Blocking], min_buffer_s: f64) -> Vec<Conflict> {
    let mut out = Vec::new();
    for (tds, v) in by_section(blocks) {
        for (i, a) in v.iter().enumerate() {
            for b in &v[i + 1..] {
                if b.1 >= a.2 + min_buffer_s {
                    break;
                }
                if a.0 == b.0 {
                    continue;
                }
                out.push(Conflict {
                    tds,
                    first: a.0,
                    second: b.0,
                    shortfall_s: a.2 + min_buffer_s - b.1,
                    first_interval: (a.1, a.2),
                    second_interval: (b.1, b.2),
                });
            }
        }
    }
    out
}

/// One train's blocking interval per section (its blocking time stairway).
type Stairway = BTreeMap<TdsId, (f64, f64)>;

/// Result of the UIC 406 compression method over a time window.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Compression {
    /// Time the compressed blocking time stairways take, s.
    pub compressed_s: f64,
    /// Window length, s.
    pub window_s: f64,
    /// Capacity consumption = compressed time / window (1.0 = 100 %).
    pub consumption: f64,
    /// Trains in the order kept, with the shift each was moved by, s (negative = earlier;
    /// positive only if the input timetable already has conflicts).
    pub shifts: Vec<(usize, f64)>,
    /// The minimum headway between consecutive trains after compression, s
    /// (difference of their shifted earliest blocking starts).
    pub headways_s: Vec<f64>,
}

/// Purpose: UIC 406 capacity consumption of the trains in a window on a set of sections.
/// Inputs: blocking intervals, the sections of the line section studied (None =
/// all), window start and length, and the minimum buffer time. Trains whose
/// blocking on those sections starts inside the window are compressed, keeping
/// their order: each is moved as early as the trains before it allow.
/// Output: the compression result. Consumption above the UIC 406 recommended
/// limit (`capacity.occupancy_limit_share`) means the timetable is not stable.
pub fn compress(
    blocks: &[Blocking],
    sections: Option<&BTreeSet<TdsId>>,
    window_start_s: f64,
    window_s: f64,
    min_buffer_s: f64,
) -> Compression {
    // Per train: its merged blocking per section in the studied set.
    let mut per_train: BTreeMap<usize, BTreeMap<TdsId, (f64, f64)>> = BTreeMap::new();
    for (tds, v) in by_section(blocks) {
        if sections.is_some_and(|s| !s.contains(&tds)) {
            continue;
        }
        for (t, s, e) in v {
            let e0 = per_train.entry(t).or_default().entry(tds).or_insert((s, e));
            e0.0 = e0.0.min(s);
            e0.1 = e0.1.max(e);
        }
    }
    let mut trains: Vec<(usize, f64, Stairway)> = per_train
        .into_iter()
        .map(|(t, m)| {
            let first = m.values().map(|x| x.0).fold(f64::INFINITY, f64::min);
            (t, first, m)
        })
        .filter(|(_, first, _)| *first >= window_start_s && *first < window_start_s + window_s)
        .collect();
    trains.sort_by(|a, b| (a.1, a.0).partial_cmp(&(b.1, b.0)).unwrap());
    let mut placed: Vec<(f64, &Stairway)> = Vec::new();
    let mut shifts = Vec::new();
    let mut starts = Vec::new();
    let mut span_end = window_start_s;
    for (t, first, m) in &trains {
        let mut d = window_start_s - first;
        for (dp, pm) in &placed {
            for (tds, (s, _)) in m.iter() {
                if let Some((_, pe)) = pm.get(tds) {
                    d = d.max(pe + dp + min_buffer_s - s);
                }
            }
        }
        span_end = span_end.max(m.values().map(|x| x.1).fold(f64::NEG_INFINITY, f64::max) + d);
        shifts.push((*t, d));
        starts.push(first + d);
        placed.push((d, m));
    }
    let compressed_s = if trains.is_empty() {
        0.0
    } else {
        span_end - window_start_s
    };
    Compression {
        compressed_s,
        window_s,
        consumption: compressed_s / window_s,
        shifts,
        headways_s: starts.windows(2).map(|w| w[1] - w[0]).collect(),
    }
}
