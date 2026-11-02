//! The compiled operations model: tracks split into pieces at route signals,
//! train detection sections (TDS), the route table with overlaps and route
//! conflicts, platforms, stations and station groups (ADR-0032 §1).

use std::collections::{BTreeMap, BTreeSet, HashMap};

use serde::Serialize;
use unicode_normalization::UnicodeNormalization;

use crate::spec::{
    Dir, Directions, End, InfraSpec, LevelCrossingSpec, NodeSpec, SignalKind, SwitchPosition,
    TrackEnd, TrackSpec, TrackUse,
};

/// Index of a track piece.
pub type PieceId = u32;
/// Index of a train detection section.
pub type TdsId = u32;
/// Index of a route.
pub type RouteId = u32;
/// Index of a signal.
pub type SignalId = u32;
/// Index of a switch.
pub type SwitchId = u32;
/// Index of a platform edge.
pub type PlatformId = u32;
/// Index of a station (part).
pub type StationId = u32;
/// Index of a station group.
pub type GroupId = u32;

/// A piece reachable from another: (piece, direction entered, switch position used).
pub type Successor = (PieceId, Dir, Option<(SwitchId, SwitchPosition)>);
/// A piece end reached from another: (piece, end reached, switch position used).
pub type Neighbour = (PieceId, End, Option<(SwitchId, SwitchPosition)>);
/// A route found by the search: steps, switch positions, exit.
type FoundRoute = (Vec<Step>, Vec<(SwitchId, SwitchPosition)>, RouteExit);

const EPS: f64 = 1e-6;
/// Tolerance for a signal standing at a track end, metres.
const END_TOL_M: f64 = 0.01;
/// Longest route searched, in pieces (guards against loops in bad data).
const MAX_ROUTE_PIECES: usize = 400;

/// A part of a track between two cut points (track ends or route signals).
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Piece {
    /// Index of the track in [`Model::tracks`].
    pub track: usize,
    /// Start chainage on the track, metres.
    pub from_m: f64,
    /// End chainage on the track, metres.
    pub to_m: f64,
    /// The detection section this piece belongs to.
    pub tds: TdsId,
}

impl Piece {
    /// Purpose: length of the piece in metres.
    pub fn length_m(&self) -> f64 {
        self.to_m - self.from_m
    }
}

/// A train detection section: the unit of occupation and reservation.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Tds {
    /// Stable id: the detection section id, or `track` / `track#n` for a
    /// piece that forms its own section.
    pub id: String,
    /// Pieces it covers.
    pub pieces: Vec<PieceId>,
}

/// A switch as the interlocking sees it.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Switch {
    /// Stable id.
    pub id: String,
    /// Throw and lock time, seconds.
    pub throw_time_s: f64,
    /// Permitted speed on the diverging leg, m/s.
    pub diverging_speed_mps: f64,
    /// The piece end at the common (toe) leg.
    pub common: (PieceId, End),
    /// The piece end at the straight leg.
    pub straight: (PieceId, End),
    /// The piece end at the diverging leg.
    pub diverging: (PieceId, End),
}

/// Where a signal stands, as the place a train passes it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize)]
pub enum SignalAt {
    /// The train passes the signal as it enters `piece` travelling `dir`.
    Entry {
        /// Piece entered.
        piece: PieceId,
        /// Direction of travel.
        dir: Dir,
    },
    /// The train passes the signal as it leaves `piece` travelling `dir`
    /// (signals in front of a switch or at the network edge).
    Exit {
        /// Piece left.
        piece: PieceId,
        /// Direction of travel.
        dir: Dir,
    },
}

/// A compiled signal.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Signal {
    /// Stable id.
    pub id: String,
    /// Signal type.
    pub kind: SignalKind,
    /// Location.
    pub at: SignalAt,
    /// Overlap beyond the signal, metres.
    pub overlap_m: f64,
    /// Whether it stands at the lineside (false: a cab-signalling block marker).
    pub lineside: bool,
}

/// One piece passed in one direction, with an extra speed cap where the
/// movement uses a diverging switch leg.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct Step {
    /// Piece.
    pub piece: PieceId,
    /// Direction of travel.
    pub dir: Dir,
    /// Speed cap for this movement (diverging switch speed), m/s.
    pub speed_cap_mps: Option<f64>,
}

/// How a route ends.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum RouteExit {
    /// At the next route signal.
    Signal(SignalId),
    /// At a buffer stop (index into [`Model::buffer_stops`]).
    BufferStop(u32),
    /// At the edge of the modelled network (a portal).
    NetworkEnd,
}

/// A route from one signal to the next (07 §4.1), with its overlap.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Route {
    /// Stable id: `entry>exit`, with `#n` for parallel routes between the same signals.
    pub id: String,
    /// Entry signal.
    pub entry: SignalId,
    /// How it ends.
    pub exit: RouteExit,
    /// Pieces passed from the entry signal to the exit.
    pub steps: Vec<Step>,
    /// Length from the entry signal to the exit, metres.
    pub length_m: f64,
    /// Switch positions the route needs, sorted by switch.
    pub switches: Vec<(SwitchId, SwitchPosition)>,
    /// Pieces of the overlap beyond the exit signal.
    pub overlap_steps: Vec<Step>,
    /// Length of the overlap, metres (shorter than asked if a buffer stop or the network edge comes first).
    pub overlap_m: f64,
    /// Switch positions the overlap needs.
    pub overlap_switches: Vec<(SwitchId, SwitchPosition)>,
    /// Detection sections of the route, in travel order.
    pub tds: Vec<TdsId>,
    /// Detection sections of the overlap that are not already in `tds`, in travel order.
    pub overlap_tds: Vec<TdsId>,
}

/// A platform edge.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Platform {
    /// Stable platform edge id.
    pub id: String,
    /// Station part.
    pub station: StationId,
    /// Label passengers see.
    pub label: Option<String>,
    /// Track index.
    pub track: usize,
    /// Start chainage, metres.
    pub from_m: f64,
    /// End chainage, metres.
    pub to_m: f64,
}

impl Platform {
    /// Purpose: usable length of the platform edge, metres.
    pub fn length_m(&self) -> f64 {
        self.to_m - self.from_m
    }
}

/// A station or a part of a station.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Station {
    /// Stable id.
    pub id: String,
    /// Name.
    pub name: String,
    /// The group it belongs to.
    pub group: GroupId,
    /// Its platform edges.
    pub platforms: Vec<PlatformId>,
}

/// Stations that passengers see as one: same normalised name, or the same
/// explicit group key. Each member station is a part.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct StationGroup {
    /// Grouping key (normalised name or explicit key).
    pub key: String,
    /// Display name, from the first member.
    pub name: String,
    /// Member stations in input order.
    pub stations: Vec<StationId>,
}

/// A level crossing with a street, located on a piece.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct LevelCrossing {
    /// The crossing as given.
    pub spec: LevelCrossingSpec,
    /// Track index.
    pub track: usize,
    /// The piece holding the crossing point.
    pub piece: PieceId,
}

/// A stretch of a path with constant permitted speed and gradient.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct ProfileSegment {
    /// Length, metres.
    pub length_m: f64,
    /// Permitted speed, m/s.
    pub speed_mps: f64,
    /// Gradient in the direction of travel (rise over run).
    pub gradient: f64,
}

#[derive(Clone, Copy, Debug)]
struct Adj {
    piece: PieceId,
    end: End,
    switch: Option<(SwitchId, SwitchPosition)>,
}

/// The compiled operations model.
#[derive(Clone, Debug)]
pub struct Model {
    /// Tracks as given.
    pub tracks: Vec<TrackSpec>,
    /// Pieces.
    pub pieces: Vec<Piece>,
    /// Detection sections.
    pub tds: Vec<Tds>,
    /// Switches.
    pub switches: Vec<Switch>,
    /// Signals.
    pub signals: Vec<Signal>,
    /// The route table.
    pub routes: Vec<Route>,
    /// For each route, the routes that conflict with it (sorted).
    pub conflicts: Vec<Vec<RouteId>>,
    /// Platform edges.
    pub platforms: Vec<Platform>,
    /// Stations (parts).
    pub stations: Vec<Station>,
    /// Station groups.
    pub groups: Vec<StationGroup>,
    /// Level crossings with streets.
    pub level_crossings: Vec<LevelCrossing>,
    adj: Vec<Vec<Adj>>,
    buffer_ends: BTreeMap<(PieceId, End), String>,
    signal_at: HashMap<SignalAt, SignalId>,
    routes_from: Vec<Vec<RouteId>>,
    track_index: HashMap<String, usize>,
    track_pieces: Vec<Vec<PieceId>>,
}

/// Purpose: normalise a station name for grouping.
/// Inputs: a display name.
/// Output: lower case, accents removed (NFD without combining marks), runs of
/// whitespace, hyphens and dots collapsed to one space, trimmed.
pub fn normalise_name(name: &str) -> String {
    let stripped: String = name
        .nfd()
        .filter(|c| !unicode_normalization::char::is_combining_mark(*c))
        .collect::<String>()
        .to_lowercase();
    stripped
        .split(|c: char| c.is_whitespace() || c == '-' || c == '.' || c == '_')
        .filter(|w| !w.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn end_index(piece: PieceId, end: End) -> usize {
    piece as usize * 2 + matches!(end, End::B) as usize
}

impl Model {
    /// Purpose: compile a network description into the operations model.
    /// Inputs: the network.
    /// Output: the model, or every validation error found (ids are named).
    pub fn compile(spec: &InfraSpec) -> Result<Model, Vec<String>> {
        let mut errors = Vec::new();
        let mut track_index = HashMap::new();
        for (i, t) in spec.tracks.iter().enumerate() {
            #[allow(clippy::neg_cmp_op_on_partial_ord)]
            if !(t.length_m > 0.0) || !(t.line_speed_mps > 0.0) {
                errors.push(format!("track {}: length and line speed must be > 0", t.id));
            }
            if track_index.insert(t.id.clone(), i).is_some() {
                errors.push(format!("track {}: duplicate id", t.id));
            }
        }
        let find_track = |id: &str, errors: &mut Vec<String>, what: &str| -> Option<usize> {
            let r = track_index.get(id).copied();
            if r.is_none() {
                errors.push(format!("{what}: unknown track {id}"));
            }
            r
        };

        // Cut points: route signals strictly inside a track.
        let mut cuts: Vec<Vec<f64>> = vec![Vec::new(); spec.tracks.len()];
        for s in &spec.signals {
            let Some(t) = find_track(&s.track, &mut errors, &format!("signal {}", s.id)) else {
                continue;
            };
            let len = spec.tracks[t].length_m;
            if s.position_m < -END_TOL_M || s.position_m > len + END_TOL_M {
                errors.push(format!(
                    "signal {}: position outside track {}",
                    s.id, s.track
                ));
                continue;
            }
            if s.kind != SignalKind::Distant
                && s.position_m > END_TOL_M
                && s.position_m < len - END_TOL_M
            {
                cuts[t].push(s.position_m);
            }
        }
        let mut pieces = Vec::new();
        let mut track_pieces = vec![Vec::new(); spec.tracks.len()];
        for (t, track) in spec.tracks.iter().enumerate() {
            let c = &mut cuts[t];
            c.sort_by(|a, b| a.partial_cmp(b).unwrap());
            c.dedup_by(|a, b| (*a - *b).abs() < END_TOL_M);
            let mut from = 0.0;
            for &x in c.iter().chain(std::iter::once(&track.length_m)) {
                track_pieces[t].push(pieces.len() as PieceId);
                pieces.push(Piece {
                    track: t,
                    from_m: from,
                    to_m: x,
                    tds: 0,
                });
                from = x;
            }
        }

        // Detection sections.
        let mut tds = Vec::new();
        let mut assigned = vec![false; pieces.len()];
        for d in &spec.detection {
            let mut ps = Vec::new();
            for tid in &d.tracks {
                let Some(t) = find_track(tid, &mut errors, &format!("detection {}", d.id)) else {
                    continue;
                };
                if track_pieces[t].len() > 1 {
                    errors.push(format!(
                        "detection {}: track {tid} carries a route signal mid-track",
                        d.id
                    ));
                }
                for &p in &track_pieces[t] {
                    if assigned[p as usize] {
                        errors.push(format!(
                            "detection {}: track {tid} is in two sections",
                            d.id
                        ));
                    }
                    assigned[p as usize] = true;
                    ps.push(p);
                }
            }
            for &p in &ps {
                pieces[p as usize].tds = tds.len() as TdsId;
            }
            tds.push(Tds {
                id: d.id.clone(),
                pieces: ps,
            });
        }
        for (t, ps) in track_pieces.iter().enumerate() {
            for (k, &p) in ps.iter().enumerate() {
                if assigned[p as usize] {
                    continue;
                }
                pieces[p as usize].tds = tds.len() as TdsId;
                let id = if ps.len() == 1 {
                    spec.tracks[t].id.clone()
                } else {
                    format!("{}#{}", spec.tracks[t].id, k)
                };
                tds.push(Tds {
                    id,
                    pieces: vec![p],
                });
            }
        }

        // Adjacency between piece ends.
        let mut adj: Vec<Vec<Adj>> = vec![Vec::new(); pieces.len() * 2];
        let piece_end =
            |te: &TrackEnd, errors: &mut Vec<String>, what: &str| -> Option<(PieceId, End)> {
                let t = find_track(&te.track, errors, what)?;
                let ps = &track_pieces[t];
                Some(match te.end {
                    End::A => (ps[0], End::A),
                    End::B => (*ps.last().unwrap(), End::B),
                })
            };
        let link = |adj: &mut Vec<Vec<Adj>>,
                    a: (PieceId, End),
                    b: (PieceId, End),
                    sw: Option<(SwitchId, SwitchPosition)>| {
            adj[end_index(a.0, a.1)].push(Adj {
                piece: b.0,
                end: b.1,
                switch: sw,
            });
            adj[end_index(b.0, b.1)].push(Adj {
                piece: a.0,
                end: a.1,
                switch: sw,
            });
        };
        for ps in &track_pieces {
            for w in ps.windows(2) {
                link(&mut adj, (w[0], End::B), (w[1], End::A), None);
            }
        }
        let mut switches = Vec::new();
        let mut buffer_ends = BTreeMap::new();
        let mut used_ends: HashMap<(PieceId, End), usize> = HashMap::new();
        for n in &spec.nodes {
            match n {
                NodeSpec::Link { a, b } => {
                    let what = format!("link {}.{:?}-{}.{:?}", a.track, a.end, b.track, b.end);
                    if let (Some(x), Some(y)) = (
                        piece_end(a, &mut errors, &what),
                        piece_end(b, &mut errors, &what),
                    ) {
                        *used_ends.entry(x).or_default() += 1;
                        *used_ends.entry(y).or_default() += 1;
                        link(&mut adj, x, y, None);
                    }
                }
                NodeSpec::Switch {
                    id,
                    common,
                    straight,
                    diverging,
                    diverging_speed_mps,
                    throw_time_s,
                } => {
                    let what = format!("switch {id}");
                    let c = piece_end(common, &mut errors, &what);
                    let s = piece_end(straight, &mut errors, &what);
                    let d = piece_end(diverging, &mut errors, &what);
                    if let (Some(c), Some(s), Some(d)) = (c, s, d) {
                        let sid = switches.len() as SwitchId;
                        for e in [c, s, d] {
                            *used_ends.entry(e).or_default() += 1;
                        }
                        link(&mut adj, c, s, Some((sid, SwitchPosition::Straight)));
                        link(&mut adj, c, d, Some((sid, SwitchPosition::Diverging)));
                        switches.push(Switch {
                            id: id.clone(),
                            throw_time_s: *throw_time_s,
                            diverging_speed_mps: *diverging_speed_mps,
                            common: c,
                            straight: s,
                            diverging: d,
                        });
                    }
                }
                NodeSpec::BufferStop { id, at } => {
                    if let Some(e) = piece_end(at, &mut errors, &format!("buffer stop {id}")) {
                        *used_ends.entry(e).or_default() += 1;
                        buffer_ends.insert(e, id.clone());
                    }
                }
            }
        }
        for (e, n) in &used_ends {
            if *n > 1 {
                let p = &pieces[e.0 as usize];
                errors.push(format!(
                    "track {} end {:?} is used by {n} nodes",
                    spec.tracks[p.track].id, e.1
                ));
            }
        }

        // Signals.
        let mut signals = Vec::new();
        let mut signal_at = HashMap::new();
        for s in &spec.signals {
            let Some(&t) = track_index.get(&s.track) else {
                continue;
            };
            let len = spec.tracks[t].length_m;
            let ps = &track_pieces[t];
            let at = if s.position_m <= END_TOL_M {
                match s.facing {
                    Dir::Up => SignalAt::Entry {
                        piece: ps[0],
                        dir: Dir::Up,
                    },
                    Dir::Down => SignalAt::Exit {
                        piece: ps[0],
                        dir: Dir::Down,
                    },
                }
            } else if s.position_m >= len - END_TOL_M {
                let last = *ps.last().unwrap();
                match s.facing {
                    Dir::Up => SignalAt::Exit {
                        piece: last,
                        dir: Dir::Up,
                    },
                    Dir::Down => SignalAt::Entry {
                        piece: last,
                        dir: Dir::Down,
                    },
                }
            } else {
                // A cut point: the piece starting here (Up) or ending here (Down).
                let k = ps
                    .iter()
                    .position(|&p| (pieces[p as usize].from_m - s.position_m).abs() < END_TOL_M)
                    .expect("cut point exists");
                match s.facing {
                    Dir::Up => SignalAt::Entry {
                        piece: ps[k],
                        dir: Dir::Up,
                    },
                    Dir::Down => SignalAt::Entry {
                        piece: ps[k - 1],
                        dir: Dir::Down,
                    },
                }
            };
            let id = signals.len() as SignalId;
            if s.kind != SignalKind::Distant && signal_at.insert(at, id).is_some() {
                errors.push(format!(
                    "signal {}: another route signal stands at the same place",
                    s.id
                ));
            }
            signals.push(Signal {
                id: s.id.clone(),
                kind: s.kind,
                at,
                overlap_m: s.overlap_m.unwrap_or(spec.default_overlap_m),
                lineside: s.lineside,
            });
        }

        // Stations and groups.
        let mut stations = Vec::new();
        let mut station_index = HashMap::new();
        let mut groups: Vec<StationGroup> = Vec::new();
        let mut group_index: BTreeMap<String, GroupId> = BTreeMap::new();
        for st in &spec.stations {
            let key = match &st.group {
                Some(g) => format!("group:{g}"),
                None => normalise_name(&st.name),
            };
            let sid = stations.len() as StationId;
            let g = *group_index.entry(key.clone()).or_insert_with(|| {
                groups.push(StationGroup {
                    key: key.clone(),
                    name: st.name.clone(),
                    stations: Vec::new(),
                });
                (groups.len() - 1) as GroupId
            });
            groups[g as usize].stations.push(sid);
            if station_index.insert(st.id.clone(), sid).is_some() {
                errors.push(format!("station {}: duplicate id", st.id));
            }
            stations.push(Station {
                id: st.id.clone(),
                name: st.name.clone(),
                group: g,
                platforms: Vec::new(),
            });
        }
        let mut platforms = Vec::new();
        for p in &spec.platforms {
            let Some(&st) = station_index.get(&p.station) else {
                errors.push(format!("platform {}: unknown station {}", p.id, p.station));
                continue;
            };
            let Some(t) = find_track(&p.track, &mut errors, &format!("platform {}", p.id)) else {
                continue;
            };
            let (from_m, to_m) = (p.from_m.min(p.to_m), p.from_m.max(p.to_m));
            if from_m < -END_TOL_M
                || to_m > spec.tracks[t].length_m + END_TOL_M
                || to_m - from_m <= 0.0
            {
                errors.push(format!(
                    "platform {}: range outside track {}",
                    p.id, p.track
                ));
                continue;
            }
            let pid = platforms.len() as PlatformId;
            stations[st as usize].platforms.push(pid);
            platforms.push(Platform {
                id: p.id.clone(),
                station: st,
                label: p.label.clone(),
                track: t,
                from_m,
                to_m,
            });
        }

        let mut level_crossings = Vec::new();
        for lc in &spec.level_crossings {
            let Some(t) = find_track(&lc.track, &mut errors, &format!("level crossing {}", lc.id))
            else {
                continue;
            };
            let piece = track_pieces[t]
                .iter()
                .copied()
                .find(|&p| lc.position_m <= pieces[p as usize].to_m + END_TOL_M)
                .unwrap_or(*track_pieces[t].last().unwrap());
            level_crossings.push(LevelCrossing {
                spec: lc.clone(),
                track: t,
                piece,
            });
        }

        if !errors.is_empty() {
            return Err(errors);
        }
        let mut model = Model {
            tracks: spec.tracks.clone(),
            pieces,
            tds,
            switches,
            signals,
            routes: Vec::new(),
            conflicts: Vec::new(),
            platforms,
            stations,
            groups,
            level_crossings,
            adj,
            buffer_ends,
            signal_at,
            routes_from: Vec::new(),
            track_index,
            track_pieces,
        };
        model.build_routes();
        Ok(model)
    }

    /// Purpose: track index by stable id.
    pub fn track(&self, id: &str) -> Option<usize> {
        self.track_index.get(id).copied()
    }

    /// Purpose: pieces of a track in chainage order.
    pub fn track_pieces(&self, track: usize) -> &[PieceId] {
        &self.track_pieces[track]
    }

    /// Purpose: signal index by stable id.
    pub fn signal(&self, id: &str) -> Option<SignalId> {
        self.signals
            .iter()
            .position(|s| s.id == id)
            .map(|i| i as SignalId)
    }

    /// Purpose: route index by stable id.
    pub fn route(&self, id: &str) -> Option<RouteId> {
        self.routes
            .iter()
            .position(|r| r.id == id)
            .map(|i| i as RouteId)
    }

    /// Purpose: platform index by stable id.
    pub fn platform(&self, id: &str) -> Option<PlatformId> {
        self.platforms
            .iter()
            .position(|p| p.id == id)
            .map(|i| i as PlatformId)
    }

    /// Purpose: routes that start at a signal.
    pub fn routes_from(&self, signal: SignalId) -> &[RouteId] {
        &self.routes_from[signal as usize]
    }

    /// Purpose: routes that can follow a route (start at its exit signal).
    pub fn next_routes(&self, route: RouteId) -> &[RouteId] {
        match self.routes[route as usize].exit {
            RouteExit::Signal(s) => self.routes_from(s),
            _ => &[],
        }
    }

    /// Purpose: whether two routes conflict (can never be locked together).
    pub fn routes_conflict(&self, a: RouteId, b: RouteId) -> bool {
        a != b && self.conflicts[a as usize].binary_search(&b).is_ok()
    }

    /// Purpose: the pieces that follow a piece in a direction.
    /// Output: (piece, direction entered, switch position used) for each
    /// successor the track's allowed directions permit.
    pub fn successors(&self, piece: PieceId, dir: Dir) -> Vec<Successor> {
        self.adj[end_index(piece, dir.exit_end())]
            .iter()
            .map(|a| (a.piece, Dir::entering_at(a.end), a.switch))
            .filter(|&(p, d, _)| self.allowed(p, d))
            .collect()
    }

    fn allowed(&self, piece: PieceId, dir: Dir) -> bool {
        match self.tracks[self.pieces[piece as usize].track].directions {
            Directions::Both => true,
            Directions::UpOnly => dir == Dir::Up,
            Directions::DownOnly => dir == Dir::Down,
        }
    }

    fn route_signal(&self, at: SignalAt) -> Option<SignalId> {
        self.signal_at
            .get(&at)
            .copied()
            .filter(|&s| self.signals[s as usize].kind != SignalKind::Distant)
    }

    fn diverging_cap(&self, sw: Option<(SwitchId, SwitchPosition)>) -> Option<f64> {
        match sw {
            Some((s, SwitchPosition::Diverging)) => {
                Some(self.switches[s as usize].diverging_speed_mps)
            }
            _ => None,
        }
    }

    /// Purpose: build the route table, the route index per signal and the conflict lists.
    fn build_routes(&mut self) {
        let mut routes = Vec::new();
        for sig in 0..self.signals.len() as SignalId {
            let s = &self.signals[sig as usize];
            if s.kind == SignalKind::Distant {
                continue;
            }
            // Initial states: the piece entered at the signal.
            let starts: Vec<Successor> = match s.at {
                SignalAt::Entry { piece, dir } => {
                    if self.allowed(piece, dir) {
                        vec![(piece, dir, None)]
                    } else {
                        vec![]
                    }
                }
                SignalAt::Exit { piece, dir } => self.successors(piece, dir),
            };
            let mut found: Vec<FoundRoute> = Vec::new();
            for (p, d, sw) in starts {
                let mut steps = vec![Step {
                    piece: p,
                    dir: d,
                    speed_cap_mps: self.diverging_cap(sw),
                }];
                let mut sws: Vec<_> = sw.into_iter().collect();
                self.search(&mut steps, &mut sws, &mut found);
            }
            for (steps, mut sws, exit) in found {
                sws.sort();
                let length_m = steps
                    .iter()
                    .map(|st| self.pieces[st.piece as usize].length_m())
                    .sum();
                let (overlap_steps, overlap_m, mut overlap_switches) = match exit {
                    RouteExit::Signal(x) => self.overlap(x, self.signals[x as usize].overlap_m),
                    _ => (Vec::new(), 0.0, Vec::new()),
                };
                overlap_switches.sort();
                let mut tds: Vec<TdsId> = Vec::new();
                for st in &steps {
                    let t = self.pieces[st.piece as usize].tds;
                    if !tds.contains(&t) {
                        tds.push(t);
                    }
                }
                let mut overlap_tds = Vec::new();
                for st in &overlap_steps {
                    let t = self.pieces[st.piece as usize].tds;
                    if !tds.contains(&t) && !overlap_tds.contains(&t) {
                        overlap_tds.push(t);
                    }
                }
                let exit_name = match exit {
                    RouteExit::Signal(x) => self.signals[x as usize].id.clone(),
                    RouteExit::BufferStop(i) => self.buffer_stops()[i as usize].clone(),
                    RouteExit::NetworkEnd => "end".into(),
                };
                routes.push(Route {
                    id: format!("{}>{}", self.signals[sig as usize].id, exit_name),
                    entry: sig,
                    exit,
                    steps,
                    length_m,
                    switches: sws,
                    overlap_steps,
                    overlap_m,
                    overlap_switches,
                    tds,
                    overlap_tds,
                });
            }
        }
        // Make ids unique for parallel routes between the same signals.
        let mut seen: HashMap<String, usize> = HashMap::new();
        for r in routes.iter_mut() {
            let n = seen.entry(r.id.clone()).or_default();
            *n += 1;
            if *n > 1 {
                r.id = format!("{}#{}", r.id, *n - 1);
            }
        }
        let mut routes_from = vec![Vec::new(); self.signals.len()];
        for (i, r) in routes.iter().enumerate() {
            routes_from[r.entry as usize].push(i as RouteId);
        }
        self.conflicts = compute_conflicts(&routes);
        self.routes = routes;
        self.routes_from = routes_from;
    }

    /// Purpose: depth-first search from the last step to the next route signal.
    /// Side effects: appends every complete route found to `found`.
    fn search(
        &self,
        steps: &mut Vec<Step>,
        sws: &mut Vec<(SwitchId, SwitchPosition)>,
        found: &mut Vec<FoundRoute>,
    ) {
        let last = *steps.last().unwrap();
        if let Some(x) = self.route_signal(SignalAt::Exit {
            piece: last.piece,
            dir: last.dir,
        }) {
            found.push((steps.clone(), sws.clone(), RouteExit::Signal(x)));
            return;
        }
        let succ = self.successors(last.piece, last.dir);
        if succ.is_empty() {
            let exit = if let Some(i) = self.buffer_index(last.piece, last.dir.exit_end()) {
                RouteExit::BufferStop(i)
            } else if self.adj[end_index(last.piece, last.dir.exit_end())].is_empty() {
                RouteExit::NetworkEnd
            } else {
                // Connected only to tracks closed to this direction: no route.
                return;
            };
            found.push((steps.clone(), sws.clone(), exit));
            return;
        }
        for (p, d, sw) in succ {
            if let Some(x) = self.route_signal(SignalAt::Entry { piece: p, dir: d }) {
                // Diverging speed applies to the last piece as well.
                let mut st = steps.clone();
                let mut sw_list = sws.clone();
                if let Some(cap) = self.diverging_cap(sw) {
                    let l = st.last_mut().unwrap();
                    l.speed_cap_mps = Some(l.speed_cap_mps.map_or(cap, |c| c.min(cap)));
                }
                if let Some(s) = sw {
                    sw_list.push(s);
                }
                found.push((st, sw_list, RouteExit::Signal(x)));
                continue;
            }
            if steps.len() >= MAX_ROUTE_PIECES || steps.iter().any(|s| s.piece == p) {
                continue;
            }
            if let Some((s, pos)) = sw {
                if sws.iter().any(|&(s2, p2)| s2 == s && p2 != pos) {
                    continue;
                }
            }
            let cap = self.diverging_cap(sw);
            let saved_cap = steps.last().unwrap().speed_cap_mps;
            if let Some(c) = cap {
                let l = steps.last_mut().unwrap();
                l.speed_cap_mps = Some(l.speed_cap_mps.map_or(c, |x| x.min(c)));
            }
            steps.push(Step {
                piece: p,
                dir: d,
                speed_cap_mps: cap,
            });
            let pushed_sw = sw.is_some();
            if let Some(s) = sw {
                sws.push(s);
            }
            self.search(steps, sws, found);
            steps.pop();
            steps.last_mut().unwrap().speed_cap_mps = saved_cap;
            if pushed_sw {
                sws.pop();
            }
        }
    }

    /// Purpose: the overlap path beyond a signal, preferring straight legs.
    /// Output: steps, actual length (capped by buffer stops and the network
    /// edge) and switch positions.
    fn overlap(
        &self,
        signal: SignalId,
        want_m: f64,
    ) -> (Vec<Step>, f64, Vec<(SwitchId, SwitchPosition)>) {
        let mut steps = Vec::new();
        let mut sws = Vec::new();
        let mut len = 0.0;
        if want_m <= EPS {
            return (steps, 0.0, sws);
        }
        let mut next: Vec<Successor> = match self.signals[signal as usize].at {
            SignalAt::Entry { piece, dir } => vec![(piece, dir, None)],
            SignalAt::Exit { piece, dir } => self.successors(piece, dir),
        };
        while len < want_m - EPS {
            next.sort_by_key(|&(_, _, sw)| matches!(sw, Some((_, SwitchPosition::Diverging))));
            let Some(&(p, d, sw)) = next.first() else {
                break;
            };
            if steps.iter().any(|s: &Step| s.piece == p) {
                break;
            }
            if let Some(s) = sw {
                sws.push(s);
            }
            steps.push(Step {
                piece: p,
                dir: d,
                speed_cap_mps: self.diverging_cap(sw),
            });
            len += self.pieces[p as usize].length_m();
            next = self.successors(p, d);
        }
        (steps, len.min(want_m), sws)
    }

    /// Purpose: speed and gradient profile along a sequence of steps.
    /// Inputs: steps in travel order.
    /// Output: segments in travel order; speed = min(line speed, range limits,
    /// diverging switch cap); gradient signed for the direction of travel.
    pub fn profile(&self, steps: &[Step]) -> Vec<ProfileSegment> {
        let mut out: Vec<ProfileSegment> = Vec::new();
        for st in steps {
            let pc = &self.pieces[st.piece as usize];
            let tr = &self.tracks[pc.track];
            let mut cuts = vec![pc.from_m, pc.to_m];
            for r in tr.speed_ranges.iter().chain(tr.gradient_ranges.iter()) {
                for x in [r.from_m, r.to_m] {
                    if x > pc.from_m + EPS && x < pc.to_m - EPS {
                        cuts.push(x);
                    }
                }
            }
            cuts.sort_by(|a, b| a.partial_cmp(b).unwrap());
            cuts.dedup_by(|a, b| (*a - *b).abs() < EPS);
            let mut segs: Vec<ProfileSegment> = cuts
                .windows(2)
                .map(|w| {
                    let mid = 0.5 * (w[0] + w[1]);
                    let mut v = tr.line_speed_mps;
                    for r in &tr.speed_ranges {
                        if mid >= r.from_m && mid < r.to_m {
                            v = v.min(r.value);
                        }
                    }
                    if let Some(c) = st.speed_cap_mps {
                        v = v.min(c);
                    }
                    let mut g = 0.0;
                    for r in &tr.gradient_ranges {
                        if mid >= r.from_m && mid < r.to_m {
                            g = r.value;
                        }
                    }
                    if st.dir == Dir::Down {
                        g = -g;
                    }
                    ProfileSegment {
                        length_m: w[1] - w[0],
                        speed_mps: v,
                        gradient: g,
                    }
                })
                .collect();
            if st.dir == Dir::Down {
                segs.reverse();
            }
            for s in segs {
                match out.last_mut() {
                    Some(l)
                        if (l.speed_mps - s.speed_mps).abs() < EPS
                            && (l.gradient - s.gradient).abs() < EPS =>
                    {
                        l.length_m += s.length_m
                    }
                    _ => out.push(s),
                }
            }
        }
        out
    }

    /// Purpose: distance from the start of a step sequence to a chainage on a track.
    /// Output: the distance of the first pass over that point, or None if the
    /// sequence does not pass it.
    pub fn locate(&self, steps: &[Step], track: usize, chainage_m: f64) -> Option<f64> {
        let mut acc = 0.0;
        for st in steps {
            let pc = &self.pieces[st.piece as usize];
            if pc.track == track && chainage_m >= pc.from_m - EPS && chainage_m <= pc.to_m + EPS {
                let off = match st.dir {
                    Dir::Up => chainage_m - pc.from_m,
                    Dir::Down => pc.to_m - chainage_m,
                };
                return Some(acc + off.clamp(0.0, pc.length_m()));
            }
            acc += pc.length_m();
        }
        None
    }

    /// Purpose: where a train's head stops at a platform edge (07 §4.1, ADR-0032 §1).
    /// Inputs: the step sequence the train runs, a platform, train length and the
    /// stop margin before the platform end.
    /// Output: head distance from the start of the steps; Err if the sequence
    /// does not run along the platform or the train does not fit.
    pub fn stop_position(
        &self,
        steps: &[Step],
        platform: PlatformId,
        train_length_m: f64,
        margin_m: f64,
    ) -> Result<f64, String> {
        let p = &self.platforms[platform as usize];
        if p.length_m() + EPS < train_length_m + margin_m {
            return Err(format!(
                "platform {} is {:.0} m, train needs {:.0} m",
                p.id,
                p.length_m(),
                train_length_m + margin_m
            ));
        }
        let a = self.locate(steps, p.track, p.from_m);
        let b = self.locate(steps, p.track, p.to_m);
        match (a, b) {
            (Some(a), Some(b)) => Ok(a.max(b) - margin_m),
            _ => Err(format!("the path does not run along platform {}", p.id)),
        }
    }

    /// Purpose: buffer stop ids, in piece-end order (indices used by [`RouteExit::BufferStop`]).
    pub fn buffer_stops(&self) -> Vec<String> {
        self.buffer_ends.values().cloned().collect()
    }

    fn buffer_index(&self, piece: PieceId, end: End) -> Option<u32> {
        self.buffer_ends
            .keys()
            .position(|&k| k == (piece, end))
            .map(|i| i as u32)
    }

    /// Purpose: where a signal stands.
    /// Output: track index, chainage (m) and the direction of travel it faces.
    pub fn signal_location(&self, signal: SignalId) -> (usize, f64, Dir) {
        let (piece, dir, entry) = match self.signals[signal as usize].at {
            SignalAt::Entry { piece, dir } => (piece, dir, true),
            SignalAt::Exit { piece, dir } => (piece, dir, false),
        };
        let pc = &self.pieces[piece as usize];
        let at_from = matches!((entry, dir), (true, Dir::Up) | (false, Dir::Down));
        (pc.track, if at_from { pc.from_m } else { pc.to_m }, dir)
    }

    /// Purpose: what a piece end connects to, whatever the allowed directions.
    /// Output: (piece, end reached, switch position used) for each connection.
    pub fn neighbours(&self, piece: PieceId, end: End) -> Vec<Neighbour> {
        self.adj[end_index(piece, end)]
            .iter()
            .map(|a| (a.piece, a.end, a.switch))
            .collect()
    }

    /// Purpose: the buffer stop at a piece end, if any.
    pub fn buffer_at(&self, piece: PieceId, end: End) -> Option<&str> {
        self.buffer_ends.get(&(piece, end)).map(|s| s.as_str())
    }

    /// Purpose: whether a piece is on a storage track.
    pub fn is_storage(&self, piece: PieceId) -> bool {
        self.tracks[self.pieces[piece as usize].track].usage == TrackUse::Storage
    }
}

/// Purpose: conflicting route pairs (07 §4.3).
/// Two routes conflict if one's sections or overlap sections meet the other's
/// sections, or if they need the same switch in different positions. Two
/// overlaps may share sections when their switch positions agree.
fn compute_conflicts(routes: &[Route]) -> Vec<Vec<RouteId>> {
    let mut by_tds: BTreeMap<TdsId, Vec<(RouteId, bool)>> = BTreeMap::new();
    for (i, r) in routes.iter().enumerate() {
        for &t in &r.tds {
            by_tds.entry(t).or_default().push((i as RouteId, false));
        }
        for &t in &r.overlap_tds {
            by_tds.entry(t).or_default().push((i as RouteId, true));
        }
    }
    let mut sets: Vec<BTreeSet<RouteId>> = vec![BTreeSet::new(); routes.len()];
    for users in by_tds.values() {
        for (i, &(a, a_ov)) in users.iter().enumerate() {
            for &(b, b_ov) in &users[i + 1..] {
                if a == b || (a_ov && b_ov) {
                    continue;
                }
                sets[a as usize].insert(b);
                sets[b as usize].insert(a);
            }
        }
    }
    let mut by_switch: BTreeMap<SwitchId, Vec<(RouteId, SwitchPosition)>> = BTreeMap::new();
    for (i, r) in routes.iter().enumerate() {
        for &(s, p) in r.switches.iter().chain(r.overlap_switches.iter()) {
            by_switch.entry(s).or_default().push((i as RouteId, p));
        }
    }
    for users in by_switch.values() {
        for (i, &(a, pa)) in users.iter().enumerate() {
            for &(b, pb) in &users[i + 1..] {
                if a != b && pa != pb {
                    sets[a as usize].insert(b);
                    sets[b as usize].insert(a);
                }
            }
        }
    }
    sets.into_iter().map(|s| s.into_iter().collect()).collect()
}
