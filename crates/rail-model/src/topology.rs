//! Import of the railway design tool's topology export
//! (`contracts/rail-topology.schema.json`, `mobsimlab.rail-topology/1`).
//!
//! The export describes physical tracks between nodes. The operations model
//! needs train detection sections and signals, so the import:
//!
//! 1. cuts each section around every switch node, up to the switch's fouling
//!    points from the export (older exports: a toe margin on the common side and
//!    a default fouling distance on the legs; a whole switch leg), around
//!    every same-level crossing of two alignments (its fouling points) and around
//!    every level crossing with a street (its rail zone);
//! 2. groups the pieces of one switch (both switches of a crossover) or one
//!    diamond crossing into one detection section, so only one train at a time
//!    may occupy it, whichever railway system it belongs to;
//! 3. takes the export's signals if it has them; otherwise it places a
//!    **provisional** signal plan (ADR-0030 point 7 makes signal placement the
//!    design tool's job): home signals in front of every switch area facing it,
//!    entry signals where the line joins a platform track, starter signals at
//!    both ends of each platform edge facing out of the platform (not towards
//!    a buffer stop), and block signals on plain line at
//!    a spacing of braking distance plus sighting and overlap.
//!
//! Overlaps follow the speed classes of `signalling.overlap_*` (DB Ril 819.0202).

use std::collections::{BTreeMap, BTreeSet, HashMap};

use serde::Deserialize;

use crate::spec::{
    DetectionSpec, Dir, Directions, End, InfraSpec, LevelCrossingSpec, NodeSpec, PlatformSpec,
    Range, SignalKind, SignalSpec, StationSpec, TrackEnd, TrackSpec, TrackUse,
};

/// The schema id this importer reads.
pub const SCHEMA: &str = "mobsimlab.rail-topology/1";

#[derive(Deserialize)]
struct Topology {
    schema: String,
    valid: bool,
    #[serde(default)]
    errors: Vec<String>,
    nodes: Vec<TNode>,
    sections: Vec<TSection>,
    links: Vec<TLink>,
    switches: Vec<TSwitch>,
    platform_edges: Vec<TPlatform>,
    #[serde(default)]
    crossings: Vec<TCrossing>,
    #[serde(default)]
    level_crossings: Vec<TLevelCrossing>,
    #[serde(default)]
    signals: Vec<TSignal>,
}

#[derive(Deserialize)]
struct TNode {
    id: String,
    kind: String,
    #[serde(default)]
    switch: Option<u32>,
}

#[derive(Deserialize)]
struct TRange {
    from_m: f64,
    to_m: f64,
    value: f64,
}

#[derive(Deserialize)]
struct TSource {
    #[serde(rename = "ref")]
    reference: u32,
    #[serde(default)]
    chainage_m: Option<[f64; 2]>,
}

#[derive(Deserialize)]
struct TSection {
    id: String,
    source: TSource,
    from: String,
    to: String,
    length_m: f64,
    mode: String,
    #[serde(rename = "use")]
    usage: String,
    #[serde(default)]
    speed_kmh: Vec<TRange>,
    #[serde(default)]
    gradient_permille: Vec<TRange>,
}

#[derive(Deserialize, Clone)]
struct TEnd {
    section: String,
    end: String,
}

#[derive(Deserialize)]
struct TLink {
    node: String,
    a: TEnd,
    b: TEnd,
}

#[derive(Deserialize)]
struct TFouling {
    node: String,
    section: String,
    distance_m: f64,
    at_section: String,
    at_offset_m: f64,
}

#[derive(Deserialize)]
struct TSwitch {
    id: u32,
    nodes: Vec<String>,
    legs: Vec<String>,
    diverging_speed_kmh: f64,
    #[serde(default)]
    fouling_points: Vec<TFouling>,
}

#[derive(Deserialize)]
struct TPlatform {
    id: String,
    station: u32,
    station_name: String,
    section: String,
    from_m: f64,
    to_m: f64,
}

#[derive(Deserialize)]
struct TCrossingTrack {
    track: u32,
    chainage_m: f64,
    fouling_before_m: f64,
    fouling_after_m: f64,
    sections: Vec<String>,
}

#[derive(Deserialize)]
struct TCrossing {
    id: String,
    conflict: bool,
    tracks: Vec<TCrossingTrack>,
}

#[derive(Deserialize)]
struct TStreet {
    way: i64,
    #[serde(default)]
    name: String,
    keep_clear_m: f64,
    #[serde(default)]
    bus: bool,
}

#[derive(Deserialize)]
struct TLevelCrossing {
    id: String,
    protection: String,
    #[serde(default = "yes")]
    allowed: bool,
    track: u32,
    chainage_m: f64,
    rail_zone_m: f64,
    sections: Vec<String>,
    warning_time_s: f64,
    approach_m: f64,
    street: TStreet,
}

fn yes() -> bool {
    true
}

#[derive(Deserialize)]
struct TSignal {
    id: String,
    section: String,
    chainage_m: f64,
    facing: String,
    kind: String,
    #[serde(default)]
    overlap_m: Option<f64>,
}

/// Options for the import. Defaults are planning assumptions until the
/// export carries the values.
#[derive(Clone, Debug, PartialEq)]
pub struct ImportOptions {
    /// Distance from a switch node to the fouling point along each leg, m,
    /// for exports without fouling points.
    pub switch_fouling_m: f64,
    /// Distance from a switch node to the detection joint on the toe side, m
    /// (also the shortest switch area on a side the export gives 0 m).
    pub switch_toe_m: f64,
    /// Switch throw and lock time, s.
    pub switch_throw_s: f64,
    /// Deceleration used to space generated block signals, m/s².
    pub block_decel_mps2: f64,
    /// Sighting distance added to generated block spacing, m.
    pub sighting_m: f64,
    /// Shortest plain stretch kept between two switch or crossing areas, m;
    /// shorter ones join the areas.
    pub min_plain_m: f64,
    /// Generate a provisional signal plan when the export has no signals.
    pub generate_signals: bool,
}

impl Default for ImportOptions {
    /// Purpose: 50 m fouling distance, 10 m toe margin, 6 s throw time,
    /// 0.8 m/s² block spacing deceleration, 150 m sighting, 100 m shortest
    /// plain stretch between areas, generator on.
    fn default() -> Self {
        Self {
            switch_fouling_m: 50.0,
            switch_toe_m: 10.0,
            switch_throw_s: 6.0,
            block_decel_mps2: 0.8,
            sighting_m: 150.0,
            min_plain_m: 100.0,
            generate_signals: true,
        }
    }
}

/// The imported network and notes about what the import assumed.
#[derive(Clone, Debug, PartialEq)]
pub struct Imported {
    /// The network, ready for [`crate::Model::compile`].
    pub spec: InfraSpec,
    /// Whether the signals were generated provisionally.
    pub signals_generated: bool,
    /// Notes for the run report (assumed values, skipped elements).
    pub notes: Vec<String>,
}

/// Purpose: overlap for a signal from the approach speed (DB Ril 819.0202 classes,
/// `signalling.overlap_31_40_m`, `_41_60_m`, `_above_60_m` central values).
pub fn overlap_for_speed(kmh: f64) -> f64 {
    if kmh <= 40.0 {
        50.0
    } else if kmh <= 60.0 {
        100.0
    } else {
        200.0
    }
}

/// Union-find over group keys.
#[derive(Default)]
struct Groups {
    parent: BTreeMap<String, String>,
}

impl Groups {
    fn find(&mut self, k: &str) -> String {
        let p = self
            .parent
            .entry(k.to_string())
            .or_insert_with(|| k.to_string())
            .clone();
        if p == k {
            return p;
        }
        let r = self.find(&p);
        self.parent.insert(k.to_string(), r.clone());
        r
    }
    fn union(&mut self, a: &str, b: &str) {
        let (ra, rb) = (self.find(a), self.find(b));
        if ra != rb {
            let (lo, hi) = if ra < rb { (ra, rb) } else { (rb, ra) };
            self.parent.insert(hi, lo);
        }
    }
}

/// A stretch of an export section that becomes its own track.
#[derive(Clone, Debug)]
struct Sub {
    id: String,
    from: f64,
    to: f64,
    group: Option<String>,
}

/// Purpose: import a topology export (JSON text) into a network description.
/// Inputs: the JSON text and import options.
/// Output: the network and notes, or Err for an unknown schema, an export
/// marked invalid, or malformed data.
pub fn import_json(json: &str, opt: &ImportOptions) -> Result<Imported, String> {
    let t: Topology = serde_json::from_str(json).map_err(|e| format!("topology: {e}"))?;
    import(t, opt)
}

fn import(t: Topology, opt: &ImportOptions) -> Result<Imported, String> {
    if t.schema != SCHEMA {
        return Err(format!(
            "unsupported topology schema {} (expected {SCHEMA})",
            t.schema
        ));
    }
    if !t.valid {
        return Err(format!("the design has errors: {}", t.errors.join("; ")));
    }
    let mut notes = Vec::new();
    let sec_index: HashMap<&str, usize> = t
        .sections
        .iter()
        .enumerate()
        .map(|(i, s)| (s.id.as_str(), i))
        .collect();
    let sec = |id: &str| -> Result<usize, String> {
        sec_index
            .get(id)
            .copied()
            .ok_or_else(|| format!("unknown section {id}"))
    };
    let node_kind: HashMap<&str, &TNode> = t.nodes.iter().map(|n| (n.id.as_str(), n)).collect();

    // 1. Zones per section: (from, to, group key or None for a cut only).
    let mut zones: Vec<Vec<(f64, f64, Option<String>)>> = vec![Vec::new(); t.sections.len()];
    let mut groups = Groups::default();
    let switch_of_node: HashMap<&str, &TSwitch> = t
        .switches
        .iter()
        .flat_map(|s| s.nodes.iter().map(move |n| (n.as_str(), s)))
        .collect();
    for sw in t.switches.iter().filter(|s| !s.fouling_points.is_empty()) {
        // Fouling points from the export: the area runs from the node to each point.
        let key = format!("sw{}", sw.id);
        groups.find(&key);
        for f in &sw.fouling_points {
            let i = sec(&f.section)?;
            let s = &t.sections[i];
            let len = s.length_m;
            let at_from = s.from == f.node;
            if sw.legs.contains(&s.id) {
                zones[i].push((0.0, len, Some(key.clone())));
            }
            if f.at_section == f.section {
                let d = f.distance_m.max(opt.switch_toe_m).min(len);
                let z = if at_from { (0.0, d) } else { (len - d, len) };
                zones[i].push((z.0, z.1, Some(key.clone())));
            } else {
                // The point lies beyond the section, on a section joined at its far end.
                zones[i].push((0.0, len, Some(key.clone())));
                let far = if at_from { &s.to } else { &s.from };
                let j = sec(&f.at_section)?;
                let a = &t.sections[j];
                let z = if &a.from == far {
                    (0.0, f.at_offset_m)
                } else {
                    (f.at_offset_m, a.length_m)
                };
                zones[j].push((z.0, z.1, Some(key.clone())));
            }
        }
    }
    if t.switches.iter().any(|s| s.fouling_points.is_empty()) {
        notes.push(format!(
            "switches without fouling points in the export: assumed {} m on the legs, {} m on the toe side",
            opt.switch_fouling_m, opt.switch_toe_m
        ));
    }
    for sw in t.switches.iter().filter(|s| s.fouling_points.is_empty()) {
        let key = format!("sw{}", sw.id);
        groups.find(&key);
        for (i, s) in t.sections.iter().enumerate() {
            let len = s.length_m;
            if sw.legs.contains(&s.id) {
                zones[i].push((0.0, len, Some(key.clone())));
                continue;
            }
            for (node, at_from) in [(&s.from, true), (&s.to, false)] {
                if !sw.nodes.contains(node) {
                    continue;
                }
                // Toe side: the end that two links share at this node.
                let toe = t
                    .links
                    .iter()
                    .filter(|l| &l.node == node)
                    .flat_map(|l| [&l.a, &l.b])
                    .filter(|e| e.section == s.id && (e.end == "from") == at_from)
                    .count()
                    > 1;
                let d = if toe {
                    opt.switch_toe_m
                } else {
                    opt.switch_fouling_m
                }
                .min(len);
                let z = if at_from { (0.0, d) } else { (len - d, len) };
                zones[i].push((z.0, z.1, Some(key.clone())));
            }
        }
    }
    let section_chainage = |s: &TSection, track: u32, ch: f64| -> Option<f64> {
        let [c0, c1] = s.source.chainage_m?;
        if s.source.reference != track || ch < c0 - 1e-6 || ch > c1 + 1e-6 || c1 <= c0 {
            return None;
        }
        Some((ch - c0) * s.length_m / (c1 - c0))
    };
    for x in t.crossings.iter().filter(|x| x.conflict) {
        let key = format!("x{}", x.id);
        groups.find(&key);
        for tr in &x.tracks {
            for sid in &tr.sections {
                let i = sec(sid)?;
                let s = &t.sections[i];
                let Some(c) = section_chainage(s, tr.track, tr.chainage_m) else {
                    notes.push(format!(
                        "crossing {}: chainage not on section {sid}; whole section used",
                        x.id
                    ));
                    zones[i].push((0.0, s.length_m, Some(key.clone())));
                    continue;
                };
                zones[i].push((
                    (c - tr.fouling_before_m).max(0.0),
                    (c + tr.fouling_after_m).min(s.length_m),
                    Some(key.clone()),
                ));
            }
        }
    }
    let mut level_crossings = Vec::new();
    for lc in &t.level_crossings {
        if !lc.allowed {
            notes.push(format!(
                "level crossing {} is not allowed by the design; skipped",
                lc.id
            ));
            continue;
        }
        for sid in &lc.sections {
            let i = sec(sid)?;
            let s = &t.sections[i];
            let Some(c) = section_chainage(s, lc.track, lc.chainage_m) else {
                continue;
            };
            zones[i].push((
                (c - lc.rail_zone_m).max(0.0),
                (c + lc.rail_zone_m).min(s.length_m),
                None,
            ));
            level_crossings.push((lc, i, c));
        }
    }

    // 2. Split sections into sub-tracks; merge overlapping zones.
    let mut subs: Vec<Vec<Sub>> = Vec::with_capacity(t.sections.len());
    for (i, s) in t.sections.iter().enumerate() {
        let mut z = zones[i].clone();
        z.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
        let mut merged: Vec<(f64, f64, Option<String>)> = Vec::new();
        for (a, b, k) in z {
            if b - a <= 1e-6 {
                continue;
            }
            match merged.last_mut() {
                Some(l) if a < l.1 - 1e-6 && (l.2.is_some() || k.is_some()) => {
                    l.1 = l.1.max(b);
                    match (&l.2, &k) {
                        (Some(x), Some(y)) => groups.union(x, y),
                        (None, Some(_)) => l.2 = k.clone(),
                        _ => {}
                    }
                }
                _ => merged.push((a, b, k)),
            }
        }
        let mut out = Vec::new();
        let mut pos = 0.0;
        let push = |from: f64, to: f64, group: Option<String>, out: &mut Vec<Sub>| {
            if to - from > 0.01 {
                out.push(Sub {
                    id: String::new(),
                    from,
                    to,
                    group,
                });
            }
        };
        for (a, b, k) in merged {
            push(pos, a.max(pos), None, &mut out);
            push(a.max(pos), b, k, &mut out);
            pos = b.max(pos);
        }
        push(pos, s.length_m, None, &mut out);
        if out.is_empty() {
            out.push(Sub {
                id: String::new(),
                from: 0.0,
                to: s.length_m,
                group: None,
            });
        }
        // A short plain stretch between two areas of the same section (for
        // example between the two switches of a crossover and a turnout) is
        // no place for a signal: it joins both areas.
        for k in 1..out.len().saturating_sub(1) {
            if out[k].group.is_none() && out[k].to - out[k].from < opt.min_plain_m {
                if let (Some(a), Some(b)) = (out[k - 1].group.clone(), out[k + 1].group.clone()) {
                    groups.union(&a, &b);
                    out[k].group = Some(a);
                }
            }
        }
        let n = out.len();
        for (k, o) in out.iter_mut().enumerate() {
            o.id = if n == 1 {
                s.id.clone()
            } else {
                format!("{}/{k}", s.id)
            };
        }
        subs.push(out);
    }

    // 3. Tracks.
    let mut spec = InfraSpec {
        default_overlap_m: 200.0,
        ..Default::default()
    };
    let clip = |r: &[TRange], from: f64, to: f64, scale: f64| -> Vec<Range> {
        r.iter()
            .filter(|x| x.to_m > from + 1e-6 && x.from_m < to - 1e-6)
            .map(|x| Range {
                from_m: (x.from_m - from).max(0.0),
                to_m: (x.to_m.min(to)) - from,
                value: x.value * scale,
            })
            .collect()
    };
    for (i, s) in t.sections.iter().enumerate() {
        for sub in &subs[i] {
            let speed = clip(&s.speed_kmh, sub.from, sub.to, 1.0 / 3.6);
            let line = speed.iter().map(|r| r.value).fold(0.0, f64::max);
            let line = if line > 0.0 { line } else { 40.0 / 3.6 };
            spec.tracks.push(TrackSpec {
                id: sub.id.clone(),
                length_m: sub.to - sub.from,
                line_speed_mps: line,
                speed_ranges: speed,
                gradient_ranges: clip(&s.gradient_permille, sub.from, sub.to, 1e-3),
                directions: Directions::Both,
                usage: if s.usage == "storage" {
                    TrackUse::Storage
                } else {
                    TrackUse::Running
                },
                mode: Some(s.mode.clone()),
            });
        }
        for w in subs[i].windows(2) {
            spec.nodes.push(NodeSpec::Link {
                a: TrackEnd {
                    track: w[0].id.clone(),
                    end: End::B,
                },
                b: TrackEnd {
                    track: w[1].id.clone(),
                    end: End::A,
                },
            });
        }
    }
    let end_of = |e: &TEnd| -> Result<TrackEnd, String> {
        let i = sec(&e.section)?;
        Ok(if e.end == "from" {
            TrackEnd {
                track: subs[i][0].id.clone(),
                end: End::A,
            }
        } else {
            TrackEnd {
                track: subs[i].last().unwrap().id.clone(),
                end: End::B,
            }
        })
    };

    // 4. Nodes.
    let mut by_node: BTreeMap<&str, Vec<&TLink>> = BTreeMap::new();
    for l in &t.links {
        by_node.entry(l.node.as_str()).or_default().push(l);
    }
    for (node, links) in &by_node {
        let is_switch = node_kind.get(node).is_some_and(|n| n.kind == "switch");
        if is_switch && links.len() == 2 {
            let key = |e: &TEnd| (e.section.clone(), e.end.clone());
            let ends: Vec<&TEnd> = links.iter().flat_map(|l| [&l.a, &l.b]).collect();
            let common = ends
                .iter()
                .find(|e| ends.iter().filter(|f| key(f) == key(e)).count() == 2)
                .copied();
            let Some(common) = common else {
                return Err(format!("switch node {node}: no common end"));
            };
            let legs: Vec<&TEnd> = ends
                .iter()
                .filter(|e| key(e) != key(common))
                .copied()
                .collect();
            let sw = switch_of_node.get(node).copied().or_else(|| {
                node_kind
                    .get(node)
                    .and_then(|n| n.switch)
                    .and_then(|id| t.switches.iter().find(|s| s.id == id))
            });
            let is_leg = |e: &TEnd| sw.is_some_and(|s| s.legs.contains(&e.section));
            let (straight, diverging) = if is_leg(legs[0]) && !is_leg(legs[1]) {
                (legs[1], legs[0])
            } else {
                (legs[0], legs[1])
            };
            spec.nodes.push(NodeSpec::Switch {
                id: node.to_string(),
                common: end_of(common)?,
                straight: end_of(straight)?,
                diverging: end_of(diverging)?,
                diverging_speed_mps: sw.map_or(40.0, |s| s.diverging_speed_kmh) / 3.6,
                throw_time_s: opt.switch_throw_s,
            });
        } else {
            for l in links {
                spec.nodes.push(NodeSpec::Link {
                    a: end_of(&l.a)?,
                    b: end_of(&l.b)?,
                });
            }
        }
    }
    let linked: BTreeSet<(String, String)> = t
        .links
        .iter()
        .flat_map(|l| {
            [
                (l.a.section.clone(), l.a.end.clone()),
                (l.b.section.clone(), l.b.end.clone()),
            ]
        })
        .collect();
    let mut buffers = BTreeSet::new();
    for s in &t.sections {
        for (node, end) in [(&s.from, "from"), (&s.to, "to")] {
            if node_kind
                .get(node.as_str())
                .is_some_and(|n| n.kind == "end")
                && !linked.contains(&(s.id.clone(), end.into()))
            {
                let te = end_of(&TEnd {
                    section: s.id.clone(),
                    end: end.into(),
                })?;
                buffers.insert((te.track.clone(), te.end));
                spec.nodes.push(NodeSpec::BufferStop {
                    id: node.clone(),
                    at: te,
                });
            }
        }
    }

    // 5. Detection sections.
    let mut det: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for ss in &subs {
        for sub in ss {
            if let Some(k) = &sub.group {
                det.entry(groups.find(k)).or_default().push(sub.id.clone());
            }
        }
    }
    spec.detection = det
        .into_iter()
        .map(|(id, tracks)| DetectionSpec { id, tracks })
        .collect();

    // 6. Stations and platforms.
    let mut seen_station = BTreeSet::new();
    for p in &t.platform_edges {
        let i = sec(&p.section)?;
        let sid = format!("st{}", p.station);
        if seen_station.insert(sid.clone()) {
            spec.stations.push(StationSpec {
                id: sid.clone(),
                name: p.station_name.clone(),
                group: None,
            });
        }
        let mid = 0.5 * (p.from_m + p.to_m);
        let sub = subs[i]
            .iter()
            .find(|s| mid >= s.from && mid <= s.to)
            .unwrap_or(&subs[i][0]);
        if p.from_m < sub.from - 1e-6 || p.to_m > sub.to + 1e-6 {
            notes.push(format!(
                "platform {} spans a switch or crossing area; clipped",
                p.id
            ));
        }
        spec.platforms.push(PlatformSpec {
            id: p.id.clone(),
            station: sid,
            label: None,
            track: sub.id.clone(),
            from_m: (p.from_m.max(sub.from)) - sub.from,
            to_m: (p.to_m.min(sub.to)) - sub.from,
        });
    }

    // 7. Level crossings.
    for (lc, i, c) in level_crossings {
        let sub = subs[i].iter().find(|s| c >= s.from && c <= s.to).unwrap();
        spec.level_crossings.push(LevelCrossingSpec {
            id: format!("{}@{}", lc.id, t.sections[i].id),
            track: sub.id.clone(),
            position_m: c - sub.from,
            rail_zone_m: lc.rail_zone_m,
            approach_m: lc.approach_m,
            warning_time_s: lc.warning_time_s,
            protection: lc.protection.clone(),
            street_way: lc.street.way,
            street_name: lc.street.name.clone(),
            keep_clear_m: lc.street.keep_clear_m,
            bus: lc.street.bus,
        });
    }

    // 8. Signals.
    let signals_generated = t.signals.is_empty() && opt.generate_signals;
    if !t.signals.is_empty() {
        for s in &t.signals {
            let i = sec(&s.section)?;
            let sub = subs[i]
                .iter()
                .find(|x| s.chainage_m >= x.from - 1e-6 && s.chainage_m <= x.to + 1e-6)
                .ok_or_else(|| {
                    format!("signal {}: chainage outside section {}", s.id, s.section)
                })?;
            let kind = match s.kind.as_str() {
                "main" => SignalKind::Main,
                "block" => SignalKind::Block,
                "shunting" => SignalKind::Shunting,
                "distant" => SignalKind::Distant,
                k => return Err(format!("signal {}: unknown kind {k}", s.id)),
            };
            spec.signals.push(SignalSpec {
                id: s.id.clone(),
                track: sub.id.clone(),
                position_m: s.chainage_m - sub.from,
                facing: if s.facing == "to" { Dir::Up } else { Dir::Down },
                kind,
                overlap_m: s.overlap_m,
            });
        }
    } else if signals_generated {
        generate_signals(&mut spec, &buffers, opt);
        notes.push(format!(
            "provisional signal plan generated: {} signals (home signals at switch and crossing areas, platform starters, block signals)",
            spec.signals.len()
        ));
    } else {
        notes.push("the export has no signals and generation is off: no routes".into());
    }
    Ok(Imported {
        spec,
        signals_generated,
        notes,
    })
}

/// Purpose: place a provisional signal plan on an imported network.
/// Side effects: appends signals to `spec`.
fn generate_signals(spec: &mut InfraSpec, buffers: &BTreeSet<(String, End)>, opt: &ImportOptions) {
    let grouped: BTreeSet<String> = spec
        .detection
        .iter()
        .flat_map(|d| d.tracks.iter().cloned())
        .collect();
    let index: HashMap<String, usize> = spec
        .tracks
        .iter()
        .enumerate()
        .map(|(i, t)| (t.id.clone(), i))
        .collect();
    // Neighbours of each track end: (track, end) pairs joined by a node.
    let mut neigh: HashMap<(String, End), Vec<(String, End)>> = HashMap::new();
    for n in &spec.nodes {
        let mut join = |a: &TrackEnd, b: &TrackEnd| {
            neigh
                .entry((a.track.clone(), a.end))
                .or_default()
                .push((b.track.clone(), b.end));
            neigh
                .entry((b.track.clone(), b.end))
                .or_default()
                .push((a.track.clone(), a.end));
        };
        match n {
            NodeSpec::Link { a, b } => join(a, b),
            NodeSpec::Switch {
                common,
                straight,
                diverging,
                ..
            } => {
                join(common, straight);
                join(common, diverging);
            }
            NodeSpec::BufferStop { .. } => {}
        }
    }
    let mut placed: BTreeSet<(String, i64, Dir)> = BTreeSet::new();
    let mut out: Vec<SignalSpec> = Vec::new();
    let mut add =
        |out: &mut Vec<SignalSpec>, track: &TrackSpec, pos: f64, facing: Dir, kind: SignalKind| {
            let key = (track.id.clone(), (pos * 10.0).round() as i64, facing);
            if !placed.insert(key) {
                return;
            }
            let kmh = track.line_speed_mps * 3.6;
            let n = out.len();
            out.push(SignalSpec {
                id: format!("G{n}"),
                track: track.id.clone(),
                position_m: pos,
                facing,
                kind,
                overlap_m: Some(overlap_for_speed(kmh)),
            });
        };
    // Home signals: on a plain track at an end that touches a grouped (switch or crossing) track, facing it.
    for t in &spec.tracks {
        if grouped.contains(&t.id) {
            continue;
        }
        let kind = if t.usage == TrackUse::Storage {
            SignalKind::Shunting
        } else {
            SignalKind::Main
        };
        for (end, facing, pos) in [(End::B, Dir::Up, t.length_m), (End::A, Dir::Down, 0.0)] {
            let touches = neigh
                .get(&(t.id.clone(), end))
                .is_some_and(|v| v.iter().any(|(o, _)| grouped.contains(o)));
            if touches {
                add(&mut out, t, pos, facing, kind);
            }
        }
    }
    // Entry signals: on a plain track at an end that joins a platform track, facing it.
    let platform_tracks: BTreeSet<String> =
        spec.platforms.iter().map(|p| p.track.clone()).collect();
    for t in &spec.tracks {
        if grouped.contains(&t.id) || platform_tracks.contains(&t.id) {
            continue;
        }
        for (end, facing, pos) in [(End::B, Dir::Up, t.length_m), (End::A, Dir::Down, 0.0)] {
            let joins = neigh
                .get(&(t.id.clone(), end))
                .is_some_and(|v| v.iter().any(|(o, _)| platform_tracks.contains(o)));
            if joins {
                add(&mut out, t, pos, facing, SignalKind::Main);
            }
        }
    }
    // Starters at platform ends, facing out, unless that way is a buffer stop on the same track.
    for p in &spec.platforms {
        let Some(&ti) = index.get(&p.track) else {
            continue;
        };
        let t = &spec.tracks[ti];
        if !buffers.contains(&(t.id.clone(), End::B)) {
            add(
                &mut out,
                t,
                (p.to_m + 5.0).min(t.length_m),
                Dir::Up,
                SignalKind::Main,
            );
        }
        if !buffers.contains(&(t.id.clone(), End::A)) {
            add(
                &mut out,
                t,
                (p.from_m - 5.0).max(0.0),
                Dir::Down,
                SignalKind::Main,
            );
        }
    }
    // Block signals on long plain tracks, both directions.
    for t in &spec.tracks {
        if grouped.contains(&t.id) || t.usage == TrackUse::Storage {
            continue;
        }
        let v = t.line_speed_mps;
        let block =
            (v * v / (2.0 * opt.block_decel_mps2) + opt.sighting_m + overlap_for_speed(v * 3.6))
                .max(300.0);
        for facing in [Dir::Up, Dir::Down] {
            let mut cuts: Vec<f64> = vec![0.0, t.length_m];
            cuts.extend(
                out.iter()
                    .filter(|s| s.track == t.id && s.facing == facing)
                    .map(|s| s.position_m),
            );
            cuts.sort_by(|a, b| a.partial_cmp(b).unwrap());
            for w in cuts.windows(2) {
                let gap = w[1] - w[0];
                let n = (gap / block).floor() as usize;
                for k in 1..n {
                    let pos = w[0] + gap * k as f64 / n as f64;
                    add(&mut out, t, pos, facing, SignalKind::Block);
                }
            }
        }
    }
    spec.signals.extend(out);
}
