//! Road closures at level crossings from the planned train runs (ADR-0007: the
//! railway owns the crossing). The street line tool reads them to add the
//! expected wait at each level crossing to bus running times; the JSON form is
//! `contracts/level-crossing-closures.schema.json`.
//!
//! For each run over a level crossing, the street closes when the head passes
//! the approach point (`approach_m` before the crossing, set from the warning
//! time at line speed) and opens `reopen_s` after the tail clears the rail zone
//! beyond the crossing. A train that stops between the approach point and the
//! crossing (a platform just before it) closes the street when it leaves the
//! stop instead, but never later than the warning time before it arrives.
//! Closures of different runs that overlap are one closure, so two trains
//! passing close together keep the street closed once.

use std::collections::BTreeMap;

use rail_model::{Dir, Model};
use serde::Serialize;

use crate::blocking::{route_steps, run_timing, BlockingParams, RunTiming, TrainRun};
use crate::plan::Plan;

/// Schema id of the export.
pub const SCHEMA: &str = "mobsimlab.level-crossing-closures/1";

/// One time the street is closed.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Closure {
    /// Street closed, s after service-day midnight.
    pub start_s: f64,
    /// Street open again, s.
    pub end_s: f64,
    /// Runs (trip ids) that keep it closed.
    pub runs: Vec<String>,
}

/// The closures of one level crossing over the day.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct CrossingClosures {
    /// Level crossing id of the track topology (`lc{track}-{way}-{n}`).
    pub id: String,
    /// OSM way id of the street.
    pub way: i64,
    /// Street name.
    pub street: String,
    /// Closures in time order, without overlaps.
    pub closures: Vec<Closure>,
}

/// The export.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ClosuresOut {
    /// Schema id ([`SCHEMA`]).
    pub schema: &'static str,
    /// Every level crossing of the model, also those no train uses.
    pub level_crossings: Vec<CrossingClosures>,
}

/// Purpose: the topology id of a model level crossing (the import adds `@section`).
fn topology_id(id: &str) -> &str {
    id.split('@').next().unwrap_or(id)
}

/// Purpose: when one run closes each level crossing it passes.
/// Inputs: model, the run, its timing ([`run_timing`]) and the reopen time to use where the
/// topology gives none.
/// Output: (index into `model.level_crossings`, start, end) per pass, in path order.
pub fn run_closures(
    m: &Model,
    tr: &TrainRun,
    t: &RunTiming,
    default_reopen_s: f64,
) -> Result<Vec<(usize, f64, f64)>, String> {
    let steps = route_steps(m, &tr.routes)?;
    let path_len = tr.start_m + t.profile.length_m();
    let arrive_end = t.depart_s + t.profile.total_time_s();
    let occupy_until = tr.occupy_until_s.unwrap_or(arrive_end).max(arrive_end);
    let at = |pos: f64| t.depart_s + t.profile.time_at(pos - tr.start_m);
    let leaving = |pos: f64| t.depart_s + t.profile.time_leaving(pos - tr.start_m);
    let mut out = Vec::new();
    let mut pos = 0.0;
    for st in &steps {
        let pc = &m.pieces[st.piece as usize];
        for (i, lc) in m.level_crossings.iter().enumerate() {
            if lc.piece != st.piece {
                continue;
            }
            let off = match st.dir {
                Dir::Up => lc.spec.position_m - pc.from_m,
                Dir::Down => pc.to_m - lc.spec.position_m,
            };
            let p = pos + off.clamp(0.0, pc.length_m());
            if p < tr.start_m - 1e-6 || p > path_len + 1e-6 {
                continue;
            }
            let arrive = at(p);
            let a = p - lc.spec.approach_m;
            let mut anchor = if a < tr.start_m { t.depart_s } else { at(a) };
            for s in &tr.stops {
                if s.position_m >= a - 1e-6 && s.position_m < p - 1e-6 {
                    anchor = anchor.max(leaving(s.position_m));
                }
            }
            let start = anchor.min(arrive - lc.spec.warning_time_s);
            let h = p + lc.spec.rail_zone_m + tr.train.length_m;
            let clear = if h <= path_len + 1e-6 {
                at(h)
            } else if tr.stop_at_end {
                occupy_until
            } else {
                let v = t.profile.speed_mps.last().copied().unwrap_or(0.0).max(0.1);
                arrive_end + (h - path_len) / v
            };
            let end = clear + lc.spec.reopen_s.unwrap_or(default_reopen_s);
            out.push((i, start, end));
        }
        pos += pc.length_m();
    }
    Ok(out)
}

/// One pass of a run: closed from, open again at, run name.
type Pass = (f64, f64, String);

/// Purpose: the closures of every level crossing over a planned day.
/// Inputs: model, plan, signalling parameters (the timing is recomputed exactly as planned)
/// and the reopen time for topologies without one.
/// Output: one entry per level crossing of the topology, closures merged across runs and
/// across the lines of a double track.
pub fn level_crossing_closures(
    m: &Model,
    plan: &Plan,
    p: &BlockingParams,
    default_reopen_s: f64,
) -> Result<ClosuresOut, String> {
    let mut by_id: BTreeMap<String, (i64, String, Vec<Pass>)> = BTreeMap::new();
    for lc in &m.level_crossings {
        by_id
            .entry(topology_id(&lc.spec.id).to_string())
            .or_insert_with(|| (lc.spec.street_way, lc.spec.street_name.clone(), Vec::new()));
    }
    if !m.level_crossings.is_empty() {
        for (k, r) in plan.runs.iter().enumerate() {
            let t = run_timing(m, &r.run, k, p)?;
            for (i, s, e) in run_closures(m, &r.run, &t, default_reopen_s)? {
                let id = topology_id(&m.level_crossings[i].spec.id);
                by_id
                    .get_mut(id)
                    .expect("every crossing is listed")
                    .2
                    .push((s, e, r.name.clone()));
            }
        }
    }
    let level_crossings = by_id
        .into_iter()
        .map(|(id, (way, street, mut v))| {
            v.sort_by(|a, b| a.0.total_cmp(&b.0));
            let mut closures: Vec<Closure> = Vec::new();
            for (s, e, run) in v {
                match closures.last_mut() {
                    Some(c) if s <= c.end_s => {
                        c.end_s = c.end_s.max(e);
                        if !c.runs.contains(&run) {
                            c.runs.push(run);
                        }
                    }
                    _ => closures.push(Closure {
                        start_s: s,
                        end_s: e,
                        runs: vec![run],
                    }),
                }
            }
            for c in &mut closures {
                c.start_s = (c.start_s * 10.0).round() / 10.0;
                c.end_s = (c.end_s * 10.0).round() / 10.0;
            }
            CrossingClosures {
                id,
                way,
                street,
                closures,
            }
        })
        .collect();
    Ok(ClosuresOut {
        schema: SCHEMA,
        level_crossings,
    })
}
