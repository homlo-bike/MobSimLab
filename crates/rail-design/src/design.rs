//! Build the whole design from the document: stations, fitted tracks, switches, crossings,
//! speeds and the live checks of 06 §9.2.

use crate::alignment::{fit, FitInput, ResolvedAnchor, TrackGeo};
use crate::geom::{at_s, poly_cross, BBox, Grid, Sample, P2};
use crate::issue::{fmt_m, Issue, Severity};
use crate::model::{Anchor, Bed, Network, SwitchKind, Track, TrackUse};
use crate::params::{defaults, ModeParams, RailMode};
use crate::proj::LocalTm;
use crate::station::{layout, StationGeo};
use crate::switch::{place, SwitchGeo};
use std::collections::BTreeMap;

/// How two tracks cross.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CrossingKind {
    /// Same level: one piece of trackwork with a diamond.
    Diamond,
    /// Different levels: the upper track bridges the lower.
    GradeSeparated,
    /// Same level on a ramp: cannot be built.
    Clash,
}

/// A crossing of two tracks' centre lines.
#[derive(Debug, Clone, PartialEq)]
pub struct Crossing {
    /// Where.
    pub p: P2,
    /// Crossing angle, rad (0..π/2).
    pub angle: f64,
    /// The two tracks.
    pub tracks: [u32; 2],
    /// Kind.
    pub kind: CrossingKind,
}

/// Speed along a track for a train running from start to end.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct SpeedProfile {
    /// Chainages, m.
    pub s: Vec<f64>,
    /// Permitted speed, km/h.
    pub limit: Vec<f64>,
    /// Speed reached with the mode's acceleration and braking, km/h.
    pub v: Vec<f64>,
    /// Running time, s.
    pub time_s: f64,
    /// Highest speed reached, km/h.
    pub vmax: f64,
}

/// The built design.
#[derive(Debug, Clone)]
pub struct Design {
    /// Mode.
    pub mode: RailMode,
    /// Design values in use.
    pub params: ModeParams,
    /// Projection between local metres and degrees.
    pub proj: LocalTm,
    /// Longest train, m.
    pub train_length: f64,
    /// Station geometry.
    pub stations: Vec<StationGeo>,
    /// Track geometry (tracks whose start could be resolved).
    pub tracks: Vec<TrackGeo>,
    /// Switch geometry.
    pub switches: Vec<SwitchGeo>,
    /// Crossings between tracks.
    pub crossings: Vec<Crossing>,
    /// Speed profile per track id.
    pub speeds: BTreeMap<u32, SpeedProfile>,
    /// All findings, errors first.
    pub issues: Vec<Issue>,
    /// The document it was built from.
    pub network: Network,
}

impl Design {
    /// Purpose: track geometry by id.
    pub fn track(&self, id: u32) -> Option<&TrackGeo> {
        self.tracks.iter().find(|t| t.id == id)
    }
    /// Purpose: station geometry by id.
    pub fn station(&self, id: u32) -> Option<&StationGeo> {
        self.stations.iter().find(|t| t.id == id)
    }
    /// Purpose: switch geometry by id.
    pub fn switch(&self, id: u32) -> Option<&SwitchGeo> {
        self.switches.iter().find(|t| t.id == id)
    }
    /// Purpose: the document's track by id.
    pub fn doc_track(&self, id: u32) -> Option<&Track> {
        self.network.tracks.iter().find(|t| t.id == id)
    }
    /// Purpose: whether street-level track of this alignment is embedded in the road.
    pub fn embedded(&self, t: &Track) -> bool {
        match t.bed {
            Bed::Embedded => true,
            Bed::Ballast => false,
            Bed::Auto => self.mode.street_running(),
        }
    }
    /// Purpose: whether a track is fed by a third rail (else overhead line or none).
    pub fn third_rail(&self, t: &Track) -> bool {
        match t.power {
            crate::model::Power::ThirdRail => true,
            crate::model::Power::Auto => self.params.third_rail_default(),
            _ => false,
        }
    }
    /// Purpose: whether a track is electrified with an overhead line.
    pub fn overhead(&self, t: &Track) -> bool {
        match t.power {
            crate::model::Power::Overhead => true,
            crate::model::Power::Auto => !self.params.third_rail_default() && self.params.electrification != "none",
            _ => false,
        }
    }
}

fn resolve(a: &Anchor, stations: &[StationGeo], switches: &[SwitchGeo]) -> Option<ResolvedAnchor> {
    match a {
        Anchor::Free { x, y, level } => Some(ResolvedAnchor { p: P2::new(*x, *y), dir: None, spacing: 0.0, level: *level }),
        Anchor::Station { station, end, tracks } => {
            let g = stations.iter().find(|s| s.id == *station)?;
            let c = g.connection(*end, tracks)?;
            Some(ResolvedAnchor { p: c.p, dir: Some(c.dir), spacing: c.spacing, level: Some(g.level) })
        }
        Anchor::Switch { switch, leg } => switches.iter().find(|s| s.id == *switch)?.anchors.get(*leg).copied(),
    }
}

fn refers_to_missing(a: &Anchor, net: &Network) -> bool {
    match a {
        Anchor::Free { .. } => false,
        Anchor::Station { station, .. } => !net.stations.iter().any(|s| s.id == *station),
        Anchor::Switch { switch, .. } => !net.switches.iter().any(|s| s.id == *switch),
    }
}

/// Purpose: build the design and run every check.
/// Inputs: the document, and the id of a track still being drawn (no open-end warning for it).
/// Output: the design (pure; no side effects).
pub fn build(net: &Network, draft: Option<u32>) -> Design {
    let d = defaults();
    let params = net.params.clone().unwrap_or_else(|| d.mode(net.mode).clone());
    let storage_radius = d
        .switch(&params.default_turnout)
        .and_then(|s| s.radius_m)
        .unwrap_or(params.min_radius_m);
    let stations: Vec<StationGeo> = net.stations.iter().map(|s| layout(s, &params)).collect();
    let mut tracks: Vec<TrackGeo> = Vec::new();
    let mut switches: Vec<SwitchGeo> = Vec::new();
    let mut switch_errors: Vec<Issue> = Vec::new();
    let passes = 2 + net.switches.len().min(8);
    for pass in 0..passes {
        let last = pass + 1 == passes;
        for t in &net.tracks {
            if tracks.iter().any(|g| g.id == t.id) {
                continue;
            }
            let Some(start) = resolve(&t.start, &stations, &switches) else { continue };
            let end = match &t.end {
                None => None,
                Some(a) => match resolve(a, &stations, &switches) {
                    Some(r) => Some(r),
                    None if !last && !refers_to_missing(a, net) && matches!(a, Anchor::Switch { .. }) => continue,
                    None => None,
                },
            };
            let embedded = match t.bed {
                Bed::Embedded => true,
                Bed::Ballast => false,
                Bed::Auto => net.mode.street_running(),
            };
            tracks.push(fit(&FitInput { track: t, start, end, params: &params, storage_radius, embedded }));
        }
        for sw in &net.switches {
            if switches.iter().any(|g| g.id == sw.id) || switch_errors.iter().any(|i| i.ref_id == Some(sw.id)) {
                continue;
            }
            let Some(parent) = tracks.iter().find(|g| g.id == sw.track) else { continue };
            let Some(spec) = d.switch(&sw.element) else {
                switch_errors.push(Issue::error(format!("Unknown catalogue element {}.", sw.element), None, sw.id));
                continue;
            };
            match place(sw, parent, spec, &params) {
                Ok(g) => switches.push(g),
                Err(e) => switch_errors.push(Issue::error(e, Some(at_s(&parent.centre, sw.s).p), sw.id)),
            }
        }
    }
    let train_length = net.train_length_m.unwrap_or(params.platform_length_m - 5.0).max(1.0);
    let mut design = Design {
        mode: net.mode,
        params,
        proj: LocalTm::new(net.origin[0], net.origin[1]),
        train_length,
        stations,
        tracks,
        switches,
        crossings: vec![],
        speeds: BTreeMap::new(),
        issues: switch_errors,
        network: net.clone(),
    };
    validate(&mut design, draft);
    design
}

fn validate(dz: &mut Design, draft: Option<u32>) {
    let mut iss: Vec<Issue> = std::mem::take(&mut dz.issues);
    let p = dz.params.clone();
    let net = dz.network.clone();
    for g in &dz.tracks {
        iss.extend(g.issues.iter().cloned());
    }
    // Track ends.
    for t in &net.tracks {
        let Some(g) = dz.track(t.id) else {
            iss.push(Issue::warning(
                "This track lost its start connection (the station, its tracks or the switch changed). Delete it or draw it again.",
                None,
                t.id,
            ));
            continue;
        };
        let end_at = g.centre.last().map(|q| q.p);
        match &t.end {
            Some(a) if !matches!(a, Anchor::Free { .. }) && g.end.is_none() => iss.push(Issue::warning(
                "This track lost its end connection (the station or its tracks changed). Drag the end onto a connection point.",
                end_at,
                t.id,
            )),
            Some(Anchor::Station { .. }) | Some(Anchor::Switch { .. }) => {}
            _ if t.usage == TrackUse::Running && draft != Some(t.id) => iss.push(Issue::warning(
                "Open track end. Connect it to a station or a switch, or set the track to storage to end it at a buffer stop.",
                end_at,
                t.id,
            )),
            _ => {}
        }
        if t.usage == TrackUse::Storage && g.length - 10.0 < dz.train_length {
            iss.push(Issue::warning(
                format!(
                    "{} holds {}, shorter than one {} train.",
                    if t.name.is_empty() { "Storage track" } else { &t.name },
                    fmt_m(g.length - 10.0),
                    fmt_m(dz.train_length)
                ),
                end_at,
                t.id,
            ));
        }
    }
    // Switches.
    for sw in &dz.switches {
        let Some(g) = dz.track(sw.track) else { continue };
        let at = sw.toes.first().copied();
        let name = &sw.label;
        if !sw.fits {
            iss.push(Issue::error(
                format!(
                    "{name}: the tracks are {:.2} m apart, too close for the catalogue turnouts' legs to meet. Use a flatter turnout, or widen the track spacing.",
                    g.spacing_at(sw.s0)
                ),
                at,
                sw.id,
            ));
        }
        if g.centre.iter().any(|q| q.s >= sw.s0 - 0.5 && q.s <= sw.s1 + 0.5 && q.k.abs() > 1e-7) {
            iss.push(Issue::error(format!("{name} sits on a curve. Catalogue switches go on straight track."), at, sw.id));
        }
        if g.ntracks == 2
            && ((g.spread_start > 0.0 && sw.s0 < g.spread_start) || (g.spread_end > 0.0 && sw.s1 > g.length - g.spread_end))
        {
            iss.push(Issue::error(
                format!("{name} is where the tracks spread towards the platforms. Move it onto parallel track."),
                at,
                sw.id,
            ));
        }
        if g.ramps.iter().any(|r| !(sw.s1 < r.s0 || sw.s0 > r.s1)) {
            iss.push(Issue::warning(
                format!("{name} is on a ramp. Switches should not sit on a gradient change or vertical curve."),
                at,
                sw.id,
            ));
        }
        if sw.s0 < -0.5 || sw.s1 > g.length + 0.5 {
            iss.push(Issue::error(format!("{name} runs past the end of the track."), at, sw.id));
        }
        for o in &dz.switches {
            if o.id > sw.id && o.track == sw.track && !(o.s1 < sw.s0 || o.s0 > sw.s1) {
                iss.push(Issue::error("Two switches overlap. Move one along the track.", at, sw.id));
            }
        }
    }
    // Crossings between tracks.
    let coarse = |g: &TrackGeo| -> Vec<Sample> {
        let k = (g.centre.len() / 600).max(1);
        let mut v: Vec<Sample> = g.centre.iter().step_by(k).copied().collect();
        if let Some(l) = g.centre.last() {
            if v.last() != Some(l) {
                v.push(*l);
            }
        }
        v
    };
    let flattest = defaults().flattest_diamond_n();
    let mut crossings = Vec::new();
    let geos = &dz.tracks;
    let boxes: Vec<BBox> = geos.iter().map(|g| BBox::of(g.centre.iter().map(|q| q.p))).collect();
    for i in 0..geos.len() {
        for j in i + 1..geos.len() {
            if !boxes[i].overlaps(&boxes[j], 0.0) {
                continue;
            }
            let (a, b) = (&geos[i], &geos[j]);
            let (ca, cb) = (coarse(a), coarse(b));
            let pa: Vec<P2> = ca.iter().map(|q| q.p).collect();
            let pb: Vec<P2> = cb.iter().map(|q| q.p).collect();
            poly_cross(&pa, &pb, |h, ii, jj| {
                let sa = ca[ii].s + (ca[ii + 1].s - ca[ii].s) * h.t;
                let sb = cb[jj].s + (cb[jj + 1].s - cb[jj].s) * h.u;
                if sa < 1.0 || sb < 1.0 || sa > a.length - 1.0 || sb > b.length - 1.0 {
                    return;
                }
                let (oa, ob) = (a.order_at(sa), b.order_at(sb));
                let (la, lb) = (a.level_at(sa), b.level_at(sb));
                let deg = h.angle.to_degrees();
                let kind = if oa != ob {
                    CrossingKind::GradeSeparated
                } else if la.is_none() || lb.is_none() {
                    iss.push(Issue::error(
                        "Two tracks cross on a ramp at the same height. Change one track's level.",
                        Some(h.p),
                        b.id,
                    ));
                    CrossingKind::Clash
                } else {
                    if dz.mode == RailMode::HighSpeedRail {
                        iss.push(Issue::error(
                            "Flat crossing of two high-speed tracks. Make one track a flyover or a dive-under.",
                            Some(h.p),
                            b.id,
                        ));
                    } else if h.angle < (1.0 / flattest).atan() {
                        iss.push(Issue::error(
                            format!("Diamond crossing too flat ({deg:.1}°). The catalogue's flattest diamond is 1:{flattest}."),
                            Some(h.p),
                            b.id,
                        ));
                    } else {
                        iss.push(Issue::info(
                            format!(
                                "Diamond crossing at {deg:.0}° on {}: the two tracks share one piece of trackwork.",
                                la.map_or("a ramp", |l| l.label())
                            ),
                            Some(h.p),
                            Some(b.id),
                        ));
                    }
                    CrossingKind::Diamond
                };
                crossings.push(Crossing { p: h.p, angle: h.angle, tracks: [a.id, b.id], kind });
            });
        }
    }
    // Clearance between tracks of different alignments on the same level.
    let anchored_near = |g: &TrackGeo, s: f64| {
        let lead = 40.0 + g.spread_start.max(g.spread_end);
        (g.start.dir.is_some() && s < lead) || (g.end.is_some_and(|e| e.dir.is_some()) && s > g.length - lead)
    };
    let mut grid = Grid::new(25.0);
    for g in geos {
        for l in &g.lines {
            grid.add(g.id, l);
        }
    }
    let by_id: BTreeMap<u32, &TrackGeo> = geos.iter().map(|g| (g.id, g)).collect();
    let mut worst: BTreeMap<(u32, u32), (f64, P2)> = BTreeMap::new();
    for a in geos {
        for la in &a.lines {
            for q in la.iter().step_by(2) {
                if anchored_near(a, q.s) || crossings.iter().any(|c| c.p.dist(q.p) < 40.0) {
                    continue;
                }
                grid.near(q.p, p.clearance_marker_m, |owner, dd, sb| {
                    if owner == a.id {
                        return;
                    }
                    let b = by_id[&owner];
                    if anchored_near(b, sb) || a.order_at(q.s) != b.order_at(sb) {
                        return;
                    }
                    let key = (a.id.min(owner), a.id.max(owner));
                    if worst.get(&key).map_or(true, |w| dd < w.0) {
                        worst.insert(key, (dd, q.p));
                    }
                });
            }
        }
    }
    for ((_, b), (dd, at)) in worst {
        iss.push(Issue::error(
            format!(
                "Tracks of two alignments only {dd:.2} m apart; they need at least {:.2} m between track centres (clearance marker).",
                p.clearance_marker_m
            ),
            Some(at),
            b,
        ));
    }
    // Tracks running through a station box on its level without being attached to it.
    for st in &dz.stations {
        for g in geos {
            let attached = |a: &Anchor| matches!(a, Anchor::Station { station, .. } if *station == st.id);
            let t = net.tracks.iter().find(|t| t.id == g.id);
            if t.is_some_and(|t| attached(&t.start) || t.end.as_ref().is_some_and(attached)) {
                continue;
            }
            let hit = g.centre.iter().find(|q| {
                let r = q.p.sub(st.centre);
                r.dot(st.u).abs() < st.half_len - 1.0
                    && r.dot(st.v).abs() < st.half_w
                    && g.order_at(q.s) == st.level.order()
            });
            if let Some(q) = hit {
                iss.push(Issue::error(
                    format!(
                        "This track runs through station {} on the same level. Connect it to the station's tracks, or change its level.",
                        net.stations.iter().find(|s| s.id == st.id).map_or("", |s| s.name.as_str())
                    ),
                    Some(q.p),
                    g.id,
                ));
            }
        }
    }
    // Platforms and termini.
    for (st, doc) in dz.stations.iter().zip(&net.stations) {
        if doc.platform_length_m < dz.train_length + 5.0 {
            iss.push(Issue::error(
                format!(
                    "{}: platform {} is too short for a {} train plus 5 m stopping tolerance.",
                    doc.name,
                    fmt_m(doc.platform_length_m),
                    fmt_m(dz.train_length)
                ),
                Some(st.centre),
                st.id,
            ));
        }
        let at_end = |e: u8| {
            net.tracks
                .iter()
                .filter(|t| {
                    [Some(&t.start), t.end.as_ref()]
                        .into_iter()
                        .flatten()
                        .any(|a| matches!(a, Anchor::Station { station, end, .. } if *station == st.id && *end == e))
                })
                .map(|t| t.id)
                .collect::<Vec<_>>()
        };
        for e in [0u8, 1] {
            let (here, other) = (at_end(e), at_end(1 - e));
            if !here.is_empty() || other.is_empty() {
                continue;
            }
            let has_crossover = dz.switches.iter().any(|s| {
                other.contains(&s.track) && matches!(s.kind, SwitchKind::Crossover | SwitchKind::Scissors)
            });
            let double = other.iter().any(|id| dz.track(*id).is_some_and(|g| g.ntracks == 2));
            let pos = st.point(if e == 1 { st.half_len } else { -st.half_len }, 0.0);
            let name = format!("{} {} end", doc.name, if e == 1 { "ahead" } else { "rear" });
            if double && !has_crossover {
                iss.push(Issue::error(
                    format!("{name} is a terminus with no crossover on the approach: trains cannot change track to turn back."),
                    Some(pos),
                    st.id,
                ));
            }
        }
    }
    // Speeds.
    for g in geos {
        if let Some(t) = net.tracks.iter().find(|t| t.id == g.id) {
            let sp = speed_profile(dz, t, g);
            dz.speeds.insert(g.id, sp);
        }
    }
    iss.sort_by_key(|i| i.severity);
    if !iss.iter().any(|i| matches!(i.severity, Severity::Error | Severity::Warning)) && !geos.is_empty() {
        iss.insert(
            0,
            Issue {
                severity: Severity::Ok,
                text: "No sharp corners or impossible connections: every curve meets the minimum radius, every switch is a catalogue element on straight track, every level change has a ramp within the maximum gradient.".into(),
                at: None,
                ref_id: None,
            },
        );
    }
    dz.crossings = crossings;
    dz.issues = iss;
}

/// Purpose: speed along a track: design speed capped by each curve, by the diverging speed when
/// it starts from a switch leg, 25 km/h on storage track; stops at station and buffer ends; mode
/// acceleration and braking between.
fn speed_profile(dz: &Design, t: &Track, g: &TrackGeo) -> SpeedProfile {
    let p = &dz.params;
    let tot = g.length;
    if tot < 1.0 {
        return SpeedProfile::default();
    }
    let ds = (tot / 500.0).clamp(2.0, 40.0);
    let vdiv = match &t.start {
        Anchor::Switch { switch, .. } => dz.switch(*switch).map(|s| s.turnout.diverging_kmh),
        _ => None,
    };
    let (mut s, mut lim) = (Vec::new(), Vec::new());
    let mut x: f64 = 0.0;
    loop {
        let sv = x.min(tot);
        let mut l = if t.usage == TrackUse::Storage { p.design_speed_kmh.min(25.0) } else { p.design_speed_kmh };
        for c in &g.curves {
            if sv >= c.s0 - 1.0 && sv <= c.s1 + 1.0 {
                l = l.min(c.speed_kmh);
            }
        }
        if let Some(v) = vdiv {
            if sv < dz.train_length {
                l = l.min(v);
            }
        }
        s.push(sv);
        lim.push(l);
        if sv >= tot {
            break;
        }
        x += ds;
    }
    let n = s.len();
    let mut v: Vec<f64> = lim.iter().map(|l| l / 3.6).collect();
    if vdiv.is_none() {
        v[0] = 0.0;
    }
    if !matches!(t.end, Some(Anchor::Switch { .. })) {
        v[n - 1] = 0.0;
    }
    for i in 1..n {
        v[i] = v[i].min((v[i - 1].powi(2) + 2.0 * p.acceleration_ms2 * (s[i] - s[i - 1])).sqrt());
    }
    for i in (0..n - 1).rev() {
        v[i] = v[i].min((v[i + 1].powi(2) + 2.0 * p.service_braking_ms2 * (s[i + 1] - s[i])).sqrt());
    }
    let mut time = 0.0;
    for i in 1..n {
        time += (s[i] - s[i - 1]) / ((v[i] + v[i - 1]) / 2.0).max(0.5);
    }
    let vmax = v.iter().copied().fold(0.0, f64::max) * 3.6;
    SpeedProfile { s, limit: lim, v: v.iter().map(|x| x * 3.6).collect(), time_s: time, vmax }
}
