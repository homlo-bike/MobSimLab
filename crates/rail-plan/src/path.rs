//! Path finding on the route graph (ADR-0032 §3 step 1).
//!
//! Nodes are routes, edges join a route to the routes that start at its exit
//! signal. A path has to pass a sequence of **places** (platform edges, or a
//! storage track at the end of a pull-in), each chosen from a list of
//! candidates with a penalty, so the search prefers the platform a line
//! already uses and the planner's preferred platform over its alternatives.
//! Dijkstra runs over (route, places passed); the cost is the length run plus
//! the penalties of the places chosen.

use std::cmp::Ordering;
use std::collections::{BTreeMap, BinaryHeap};

use rail_model::{Dir, Model, PlatformId, RouteExit, RouteId, Step};
use serde::Serialize;

/// Where a train stops or passes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize)]
pub enum Place {
    /// A platform edge.
    Platform(PlatformId),
    /// A storage track (index into `Model::tracks`).
    Storage(usize),
}

impl Place {
    /// Purpose: track and chainage range of the place.
    pub fn range(self, m: &Model) -> (usize, f64, f64) {
        match self {
            Place::Platform(p) => {
                let p = &m.platforms[p as usize];
                (p.track, p.from_m, p.to_m)
            }
            Place::Storage(t) => (t, 0.0, m.tracks[t].length_m),
        }
    }

    /// Purpose: a readable id (platform edge id or storage track id).
    pub fn id(self, m: &Model) -> String {
        match self {
            Place::Platform(p) => m.platforms[p as usize].id.clone(),
            Place::Storage(t) => m.tracks[t].id.clone(),
        }
    }
}

/// A candidate place for one call, with its penalty (metres of extra path it is worth).
pub type Candidate = (Place, f64);

/// A path found.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct FoundPath {
    /// Routes in travel order.
    pub routes: Vec<RouteId>,
    /// The place chosen for each call.
    pub places: Vec<Place>,
    /// Length plus penalties.
    pub cost: f64,
}

/// Purpose: the direction a route runs along a place, if it reaches the place's
/// far end (the stopping end in that direction).
fn reaches(m: &Model, route: RouteId, place: Place) -> Option<Dir> {
    let (track, from, to) = place.range(m);
    m.routes[route as usize].steps.iter().find_map(|st| {
        let pc = &m.pieces[st.piece as usize];
        if pc.track != track {
            return None;
        }
        let far = if st.dir == Dir::Up { to } else { from };
        (far >= pc.from_m - 1e-6 && far <= pc.to_m + 1e-6).then_some(st.dir)
    })
}

fn enters_storage(m: &Model, route: RouteId) -> Option<usize> {
    m.routes[route as usize]
        .steps
        .iter()
        .map(|st| m.pieces[st.piece as usize].track)
        .find(|&t| m.tracks[t].usage == rail_model::TrackUse::Storage)
}

#[derive(PartialEq)]
struct Item(f64, u32, RouteId, usize);
impl Eq for Item {}
impl PartialOrd for Item {
    fn partial_cmp(&self, o: &Self) -> Option<Ordering> {
        Some(self.cmp(o))
    }
}
impl Ord for Item {
    fn cmp(&self, o: &Self) -> Ordering {
        // Min-heap on cost, then a deterministic tie break.
        o.0.partial_cmp(&self.0)
            .unwrap_or(Ordering::Equal)
            .then_with(|| o.1.cmp(&self.1))
    }
}

/// Purpose: the shortest path from a set of start routes through one place per call.
/// Inputs: the model, start routes (the train stands at their entry signal),
/// the candidates of each call in order, and the most routes a path may have.
/// A route that enters a storage track is used only if a candidate of the
/// call being sought is that storage track.
/// Output: the cheapest path, or None.
pub fn find_path(
    m: &Model,
    start: &[RouteId],
    calls: &[Vec<Candidate>],
    max_routes: usize,
) -> Option<FoundPath> {
    let n = calls.len();
    let mut best: BTreeMap<(RouteId, usize), f64> = BTreeMap::new();
    // Parent: state -> (previous state, place chosen when advancing `k`).
    type State = (RouteId, usize);
    let mut parent: BTreeMap<State, (Option<State>, Option<Place>, usize)> = BTreeMap::new();
    let mut heap = BinaryHeap::new();
    let mut seq = 0u32;
    let allowed = |r: RouteId, k: usize| match enters_storage(m, r) {
        None => true,
        Some(t) => calls
            .get(k)
            .is_some_and(|c| c.iter().any(|(p, _)| *p == Place::Storage(t))),
    };
    for &r in start {
        if !allowed(r, 0) {
            continue;
        }
        let c = m.routes[r as usize].length_m;
        if best.get(&(r, 0)).map_or(true, |&b| c < b) {
            best.insert((r, 0), c);
            parent.insert((r, 0), (None, None, 1));
            heap.push(Item(c, seq, r, 0));
            seq += 1;
        }
    }
    while let Some(Item(cost, _, r, k)) = heap.pop() {
        if best.get(&(r, k)).is_some_and(|&b| cost > b + 1e-9) {
            continue;
        }
        if k == n {
            // Reconstruct.
            let mut routes = Vec::new();
            let mut places = Vec::new();
            let mut st = Some((r, k));
            while let Some(s) = st {
                let (prev, place, _) = parent[&s];
                if let Some(p) = place {
                    places.push(p);
                } else {
                    routes.push(s.0);
                }
                st = prev;
            }
            routes.reverse();
            places.reverse();
            return Some(FoundPath {
                routes,
                places,
                cost,
            });
        }
        let depth = parent[&(r, k)].2;
        // Advance a call inside this route.
        for &(place, pen) in &calls[k] {
            if reaches(m, r, place).is_some() {
                let c = cost + pen;
                if best.get(&(r, k + 1)).map_or(true, |&b| c < b - 1e-9) {
                    best.insert((r, k + 1), c);
                    parent.insert((r, k + 1), (Some((r, k)), Some(place), depth));
                    heap.push(Item(c, seq, r, k + 1));
                    seq += 1;
                }
            }
        }
        if depth >= max_routes {
            continue;
        }
        for &nx in m.next_routes(r) {
            if !allowed(nx, k) {
                continue;
            }
            let c = cost + m.routes[nx as usize].length_m;
            if best.get(&(nx, k)).map_or(true, |&b| c < b - 1e-9) {
                best.insert((nx, k), c);
                parent.insert((nx, k), (Some((r, k)), None, depth + 1));
                heap.push(Item(c, seq, nx, k));
                seq += 1;
            }
        }
    }
    None
}

/// Purpose: the routes a train standing at a place can start on in a direction.
/// Inputs: the place and the direction of travel. The start signal is the
/// signal on the place's track facing that direction that is nearest the
/// place's far end in that direction: from 30 m back inside the place to
/// anywhere ahead on the track (a station track's exit signal can stand
/// beyond the platform, at the end of the overrun the mode keeps).
/// Output: the routes from that signal (empty if there is none).
pub fn departure_routes(m: &Model, place: Place, dir: Dir) -> Vec<RouteId> {
    let (track, from, to) = place.range(m);
    let mut best: Option<(f64, u32)> = None;
    for s in 0..m.signals.len() as u32 {
        if m.signals[s as usize].kind == rail_model::SignalKind::Distant {
            continue;
        }
        let (t, c, d) = m.signal_location(s);
        let ahead = match dir {
            Dir::Up => c >= from - 30.0,
            Dir::Down => c <= to + 30.0,
        };
        if t != track || d != dir || !ahead {
            continue;
        }
        // Distance of the signal from the far end, measured in travel direction.
        let key = match dir {
            Dir::Up => (to - c).abs(),
            Dir::Down => (c - from).abs(),
        };
        if best.map_or(true, |(k, _)| key < k) {
            best = Some((key, s));
        }
    }
    best.map(|(_, s)| m.routes_from(s).to_vec())
        .unwrap_or_default()
}

/// Purpose: the direction a path last runs along a place (its arrival direction).
pub fn arrival_dir(m: &Model, steps: &[Step], place: Place) -> Option<Dir> {
    let (track, _, _) = place.range(m);
    steps
        .iter()
        .rev()
        .find(|st| m.pieces[st.piece as usize].track == track)
        .map(|st| st.dir)
}

/// Purpose: where the head stops at a place along a step sequence.
/// Inputs: steps, the place, the train length and the stop margin before the
/// place's far end (platform end, or the buffer stop of a storage track).
/// Output: head position from the start of the steps, or Err.
pub fn stop_at(
    m: &Model,
    steps: &[Step],
    place: Place,
    train_length_m: f64,
    margin_m: f64,
) -> Result<f64, String> {
    match place {
        Place::Platform(p) => m.stop_position(steps, p, train_length_m, margin_m),
        Place::Storage(t) => {
            let len = m.tracks[t].length_m;
            if len < train_length_m + margin_m {
                return Err(format!("storage track {} is too short", m.tracks[t].id));
            }
            let a = m.locate(steps, t, 0.0);
            let b = m.locate(steps, t, len);
            match (a, b) {
                (Some(a), Some(b)) => Ok(a.max(b) - margin_m),
                _ => Err(format!("the path does not reach {}", m.tracks[t].id)),
            }
        }
    }
}

/// Purpose: whether a route ends at a buffer stop (a stub track).
pub fn ends_at_buffer(m: &Model, route: RouteId) -> bool {
    matches!(m.routes[route as usize].exit, RouteExit::BufferStop(_))
}
