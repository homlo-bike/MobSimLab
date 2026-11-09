//! Signals (ADR-0030 point 7): generated from the design, then edited by the planner.
//!
//! Signals are generated from the design on every build, so the plan follows the design as it
//! changes. The document holds only the planner's changes: their own signals
//! ([`Network::signals`], placed or edited) and the generated signals they removed or replaced
//! ([`Network::signals_removed`]). The effective plan is both together
//! (`topology::topology`), and each change is assessed against the generated plan. Each signal sits on a track line, a station track or
//! a switch leg and faces one direction of travel: `facing` +1 governs trains moving with the
//! chainage (or along the station's axis, or along the leg), −1 against it.
//!
//! Which signals are generated depends on the railway system's train control
//! (`signalling.system` in the assumption library):
//!
//! - `line_of_sight` (trams): signals only in front of switch areas and crossings with other
//!   railways; trams drive on sight between them.
//! - `fixed_block`: also starter signals at the ends of platform tracks, and block signals on
//!   plain line, spaced by the braking distance at line speed plus sighting distance and overlap.
//! - `cbtc`, `etcs_l2` (cab signalling): like fixed block, but the block signals are block
//!   markers without lights, spaced without sighting distance.

use crate::design::Design;
use crate::geom::{at_s, nearest, P2};
use crate::issue::Issue;
use crate::model::Network;
use serde::{Deserialize, Serialize};

/// What a signal does.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SignalKind {
    /// Main (home, entry or starter) signal protecting a switch area, crossing or the line ahead.
    Main,
    /// Block signal on plain line (a block marker under cab signalling).
    Block,
    /// Shunting signal (storage tracks).
    Shunting,
    /// Distant signal announcing a main signal.
    Distant,
    /// Speed signal where the line speed drops, showing the new speed (`speed_kmh`).
    Speed,
    /// Announces a speed signal at braking distance before it (`speed_kmh`: the coming speed).
    SpeedWarning,
}

/// Where a signal stands.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SignalAt {
    /// On one line of an alignment, at a chainage of its centre line.
    Track {
        /// Track (alignment) id.
        track: u32,
        /// Line: 0 the left track of a double track, 1 the right one.
        line: usize,
        /// Chainage on the track's centre line, m.
        s: f64,
    },
    /// On a station track, at a distance from the station's centre along its axis.
    Station {
        /// Station id.
        station: u32,
        /// Station track index.
        track: usize,
        /// Distance from the centre along the station's rotation, m.
        x: f64,
    },
    /// On the diverging leg of a switch, at a distance from its start.
    Leg {
        /// Switch id.
        switch: u32,
        /// Leg index.
        leg: usize,
        /// Distance from the leg's start, m.
        x: f64,
    },
}

/// A signal in the document.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Signal {
    /// Id, unique among all elements of the document.
    pub id: u32,
    /// Where it stands.
    pub at: SignalAt,
    /// +1: governs trains moving with the chainage (station axis, leg); −1: against it.
    pub facing: i8,
    /// Main, block, shunting or distant.
    pub kind: SignalKind,
    /// Name shown on the map, empty for none.
    #[serde(default)]
    pub name: String,
    /// Speed shown by a speed signal or its announcement, km/h.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speed_kmh: Option<f64>,
}

/// A generated signal the planner removed or replaced: where it stood and which way it faced.
/// It matches the generated signal at the same place (within [`SIGNAL_MATCH_M`]) on every
/// later build, so the plan stays removed while the design around it changes.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct SignalKey {
    /// Where it stood.
    pub at: SignalAt,
    /// Which way it faced (+1 / −1, as [`Signal::facing`]).
    pub facing: i8,
}

/// How far (m) two signal positions on the same track line, station track or switch leg may
/// lie apart and still be the same signal: a matching tolerance for generated positions that
/// shift a little when the design around them changes (ADR-0033 decision 15).
pub const SIGNAL_MATCH_M: f64 = 5.0;

impl SignalAt {
    /// Purpose: whether two anchors are on the same track line, station track or switch leg.
    /// Output: the distance between them along it, or None when they are on different ones.
    pub fn distance_to(&self, other: &SignalAt) -> Option<f64> {
        match (*self, *other) {
            (
                SignalAt::Track { track, line, s },
                SignalAt::Track {
                    track: t2,
                    line: l2,
                    s: s2,
                },
            ) if track == t2 && line == l2 => Some((s - s2).abs()),
            (
                SignalAt::Station { station, track, x },
                SignalAt::Station {
                    station: st2,
                    track: t2,
                    x: x2,
                },
            ) if station == st2 && track == t2 => Some((x - x2).abs()),
            (
                SignalAt::Leg { switch, leg, x },
                SignalAt::Leg {
                    switch: w2,
                    leg: l2,
                    x: x2,
                },
            ) if switch == w2 && leg == l2 => Some((x - x2).abs()),
            _ => None,
        }
    }
}

/// Purpose: whether a signal at `a` facing `fa` is the one at `b` facing `fb`: same facing,
/// same track line, station track or switch leg, within [`SIGNAL_MATCH_M`].
pub fn same_signal(a: &SignalAt, fa: i8, b: &SignalAt, fb: i8) -> bool {
    fa.signum() == fb.signum() && a.distance_to(b).is_some_and(|d| d <= SIGNAL_MATCH_M)
}

/// A signal of the effective plan: the planner's own signals and the generated ones the
/// planner has not removed or replaced.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PlanSignal {
    /// The signal (a generated one gets an id after the document's ids).
    #[serde(flatten)]
    pub signal: Signal,
    /// Generated from the design, not placed or edited by the planner.
    pub auto: bool,
}

/// Train control of a railway system (`signalling.system`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum System {
    /// Driving on sight (trams).
    LineOfSight,
    /// Fixed blocks with lineside signals.
    FixedBlock,
    /// Cab signalling: CBTC or ETCS Level 2 (block markers, no lineside block signals).
    Cab,
}

/// Purpose: the train control of a mode's design values.
pub fn system_of(p: &crate::params::ModeParams) -> System {
    match p.signalling_system.as_str() {
        "line_of_sight" => System::LineOfSight,
        "cbtc" | "etcs_l2" => System::Cab,
        _ => System::FixedBlock,
    }
}

/// Purpose: overlap behind a signal for the approach speed (DB Ril 819.0202 classes,
/// `signalling.overlap_*`); none for driving on sight.
pub fn overlap_m(p: &crate::params::ModeParams, kmh: f64) -> Option<f64> {
    if system_of(p) == System::LineOfSight {
        return None;
    }
    Some(if kmh <= 40.0 {
        p.overlap_31_40_m
    } else if kmh <= 60.0 {
        p.overlap_41_60_m
    } else {
        p.overlap_above_60_m
    })
}

/// Purpose: distance a train needs to stop from `kmh` with the mode's service braking.
pub fn braking_m(p: &crate::params::ModeParams, kmh: f64) -> f64 {
    let v = kmh / 3.6;
    v * v / (2.0 * p.service_braking_ms2.max(0.1))
}

/// Purpose: block length on plain line: braking distance at the line speed with the mode's
/// service braking, plus sighting distance (lineside signals only) and overlap.
pub fn block_length_m(p: &crate::params::ModeParams, kmh: f64) -> f64 {
    let sighting = if system_of(p) == System::Cab {
        0.0
    } else {
        p.sighting_m
    };
    braking_m(p, kmh) + sighting + overlap_m(p, kmh).unwrap_or(0.0)
}

/// Purpose: position and heading of travel of a signal's anchor on the built design, or None
/// when its track, station or switch is gone (or the chainage is off the track).
pub fn locate(dz: &Design, at: &SignalAt) -> Option<(P2, f64)> {
    match *at {
        SignalAt::Track { track, line, s } => {
            let g = dz.track(track)?;
            let l = g.lines.get(line)?;
            let (a, b) = (l.first()?.s, l.last()?.s);
            if s < a - 0.5 || s > b + 0.5 {
                return None;
            }
            let q = at_s(l, s);
            Some((q.p, q.h))
        }
        SignalAt::Station { station, track, x } => {
            let st = dz.station(station)?;
            let t = st.tracks.get(track)?;
            if x.abs() > st.half_len + 0.5 {
                return None;
            }
            Some((st.point(x, t.n), st.u.heading()))
        }
        SignalAt::Leg { switch, leg, x } => {
            let sw = dz.switch(switch)?;
            let p = sw.paths.get(leg)?;
            if x < -0.5 || x > p.last()?.s + 0.5 {
                return None;
            }
            let q = at_s(p, x);
            Some((q.p, q.h))
        }
    }
}

/// Purpose: how a signal is called in messages: its name, or its id.
pub fn label(s: &Signal) -> String {
    if s.name.is_empty() {
        format!("signal {}", s.id)
    } else {
        format!("signal {}", s.name)
    }
}

/// Purpose: warn about signals whose track, station or switch is gone or has moved away.
/// Side effects: appends to `dz.issues`.
pub fn check(dz: &mut Design) {
    let Some(signals) = dz.network.signals.clone() else {
        return;
    };
    let mut iss = Vec::new();
    for s in &signals {
        if locate(dz, &s.at).is_none() {
            iss.push(Issue::warning(
                format!(
                    "Signal {} is no longer on a track (its track, station or switch changed). Delete it, or reset the signals.",
                    if s.name.is_empty() { s.id.to_string() } else { s.name.clone() }
                ),
                None,
                s.id,
            ));
        }
    }
    dz.issues.extend(iss);
}

/// Purpose: the next free id of a document, counting signals too.
pub fn next_id(net: &Network) -> u32 {
    let sig = net
        .signals
        .iter()
        .flatten()
        .map(|s| s.id)
        .max()
        .unwrap_or(0);
    net.next_id().max(sig + 1)
}

/// Purpose: the signal position nearest to a point (local metres): on a track line, a station
/// track or a switch leg, within `max_m`. Output: the anchor and its distance, or None.
pub fn nearest_anchor(dz: &Design, q: P2, max_m: f64) -> Option<(SignalAt, f64)> {
    let mut best: Option<(SignalAt, f64)> = None;
    let mut take = |at: SignalAt, d: f64| {
        if d <= max_m && best.as_ref().map_or(true, |b| d < b.1) {
            best = Some((at, d));
        }
    };
    for g in &dz.tracks {
        for (line, l) in g.lines.iter().enumerate() {
            if let Some(r) = nearest(l, q) {
                take(
                    SignalAt::Track {
                        track: g.id,
                        line,
                        s: r.s,
                    },
                    r.d,
                );
            }
        }
    }
    for st in &dz.stations {
        let x = q.sub(st.centre).dot(st.u).clamp(-st.half_len, st.half_len);
        for (track, t) in st.tracks.iter().enumerate() {
            let d = st.point(x, t.n).sub(q).len();
            take(
                SignalAt::Station {
                    station: st.id,
                    track,
                    x,
                },
                d,
            );
        }
    }
    for sw in &dz.switches {
        for (leg, path) in sw.paths.iter().enumerate() {
            if let Some(r) = nearest(path, q) {
                take(
                    SignalAt::Leg {
                        switch: sw.id,
                        leg,
                        x: r.s,
                    },
                    r.d,
                );
            }
        }
    }
    best
}
