//! The driving network inside a depot, so the road simulation can model the depot as a small road network
//! (07-simulation §6: aisles as lanes, slots as parking areas) and so the planner learns which lanes cannot
//! be reached from an entrance or left to an exit.
//!
//! Aisles are one-way, lanes are one-way drive-through, and drives join the gates and the aisle ends in
//! straight lines through open yard space (inside the outline, clear of parked vehicles). Only the drives
//! on the shortest routes between the gates and the lanes are kept.

use crate::geom::{
    bbox, boxes_near, contains, dist_point_segment, dist_segments, segments_meet, V2,
};
use crate::model::{GateKind, LonLat, Proj};
use serde::Serialize;
use std::cmp::Ordering;
use std::collections::BinaryHeap;

/// A node of the depot network.
#[derive(Debug, Clone, Serialize)]
pub struct Node {
    /// Stable within one report: `gate:<id>`, `aisle:<id>:<n>` or `yard:<n>`.
    pub id: String,
    /// Where it is.
    pub lonlat: LonLat,
}

/// An edge of the depot network.
#[derive(Debug, Clone, Serialize)]
pub struct Edge {
    /// Stable within one report.
    pub id: String,
    /// `gate` (fence to inside), `aisle`, `lane` or `drive`.
    pub kind: &'static str,
    /// Start node id.
    pub from: String,
    /// End node id.
    pub to: String,
    /// Driven only from `from` to `to`.
    pub one_way: bool,
    /// Shape from `from` to `to`.
    pub coords: Vec<LonLat>,
    /// Length, m.
    pub length_m: f64,
    /// Lane id for `lane` edges, aisle id for `aisle` edges, gate id for `gate` edges.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub of: Option<String>,
}

/// The depot network with what can be reached.
#[derive(Debug, Clone, Serialize, Default)]
pub struct Network {
    /// Nodes.
    pub nodes: Vec<Node>,
    /// Edges.
    pub edges: Vec<Edge>,
}

/// A lane for the network: id, entry, exit, aisle index in, aisle index out.
pub type NetLane = (String, V2, V2, Option<usize>, Option<usize>);

/// Inputs in local metres.
pub struct NetInput<'a> {
    /// Projection back to degrees.
    pub proj: &'a Proj,
    /// Depot outline.
    pub boundary: &'a [V2],
    /// Gates: id, kind, place on the outline.
    pub gates: Vec<(String, GateKind, V2)>,
    /// Aisles: id, start, end, two-way.
    pub aisles: Vec<(String, V2, V2, bool)>,
    /// Lanes.
    pub lanes: Vec<NetLane>,
    /// Parked vehicles (solid).
    pub parked: Vec<[V2; 4]>,
    /// Extra corners drives may pass (circulation zones).
    pub yard: Vec<V2>,
    /// Half the widest vehicle plus clearance: how far drives keep from parked vehicles and the fence, m.
    pub keep_off: f64,
    /// Inset of the perimeter road from the fence corners, m.
    pub perimeter_inset: f64,
}

/// Whether each lane can be driven into from an entrance and out to an exit.
#[derive(Debug, Clone, Serialize)]
pub struct Reach {
    /// Lane id.
    pub lane: String,
    /// A route from an entrance gate to the lane exists.
    pub from_entrance: bool,
    /// A route from the lane to an exit gate exists.
    pub to_exit: bool,
    /// Route length from the nearest entrance, m.
    pub in_m: Option<f64>,
    /// Route length to the nearest exit, m.
    pub out_m: Option<f64>,
}

struct Graph {
    pts: Vec<V2>,
    ids: Vec<String>,
    /// (from, to, length, edge index in `cand`)
    arcs: Vec<(usize, usize, f64, usize)>,
}

#[derive(Copy, Clone, PartialEq)]
struct St(f64, usize);
impl Eq for St {}
impl Ord for St {
    fn cmp(&self, o: &Self) -> Ordering {
        o.0.total_cmp(&self.0).then(self.1.cmp(&o.1))
    }
}
impl PartialOrd for St {
    fn partial_cmp(&self, o: &Self) -> Option<Ordering> {
        Some(self.cmp(o))
    }
}

/// Purpose: shortest distances and predecessor arcs from several sources, forwards or backwards.
fn dijkstra(g: &Graph, sources: &[usize], backwards: bool) -> (Vec<f64>, Vec<Option<usize>>) {
    let n = g.pts.len();
    let mut adj: Vec<Vec<(usize, f64, usize)>> = vec![Vec::new(); n];
    for (k, &(a, b, l, _)) in g.arcs.iter().enumerate() {
        if backwards {
            adj[b].push((a, l, k));
        } else {
            adj[a].push((b, l, k));
        }
    }
    let mut dist = vec![f64::INFINITY; n];
    let mut pred = vec![None; n];
    let mut h = BinaryHeap::new();
    for &s in sources {
        dist[s] = 0.0;
        h.push(St(0.0, s));
    }
    while let Some(St(d, u)) = h.pop() {
        if d > dist[u] {
            continue;
        }
        for &(v, l, k) in &adj[u] {
            let nd = d + l;
            if nd < dist[v] - 1e-9 {
                dist[v] = nd;
                pred[v] = Some(k);
                h.push(St(nd, v));
            }
        }
    }
    (dist, pred)
}

/// Purpose: a point moved `d` metres inside the outline from a place on (or near) it.
fn inset_from_fence(boundary: &[V2], p: V2, d: f64) -> V2 {
    let n = boundary.len();
    let mut best = (f64::INFINITY, V2::default());
    for i in 0..n {
        let (a, b) = (boundary[i], boundary[(i + 1) % n]);
        let dd = dist_point_segment(p, a, b);
        if dd < best.0 {
            best = (dd, b.sub(a).unit().perp());
        }
    }
    let nrm = best.1;
    let try_in = p.add(nrm.mul(d));
    if contains(boundary, try_in) {
        try_in
    } else {
        p.sub(nrm.mul(d))
    }
}

/// Purpose: a fence corner moved `d` metres inwards along its bisector, if that lands inside.
fn inset_corner(boundary: &[V2], i: usize, d: f64) -> Option<V2> {
    let n = boundary.len();
    let p = boundary[i];
    let e1 = boundary[(i + n - 1) % n].sub(p).unit();
    let e2 = boundary[(i + 1) % n].sub(p).unit();
    let mut bis = e1.add(e2).unit();
    if bis.len() < 1e-9 {
        bis = e2.perp();
    }
    let half = (e1.dot(e2).clamp(-1.0, 1.0).acos() / 2.0).sin().max(0.3);
    for s in [1.0, -1.0] {
        let q = p.add(bis.mul(s * d / half));
        if contains(boundary, q) && boundary_clear(boundary, q, d * 0.9) {
            return Some(q);
        }
    }
    None
}

/// Purpose: the part of an aisle centreline (as fractions from `a`) at least `d` metres from the fence; the
/// whole aisle when no part is.
fn clear_span(boundary: &[V2], a: V2, b: V2, d: f64) -> (f64, f64) {
    let len = a.dist(b);
    let steps = (len / 0.5).ceil().max(1.0) as usize;
    let ok = |k: usize| {
        let t = k as f64 / steps as f64;
        boundary_clear(boundary, a.add(b.sub(a).mul(t)), d)
    };
    match (
        (0..=steps).find(|&k| ok(k)),
        (0..=steps).rev().find(|&k| ok(k)),
    ) {
        (Some(i), Some(j)) => (i as f64 / steps as f64, j as f64 / steps as f64),
        _ => (0.0, 1.0),
    }
}

fn boundary_clear(boundary: &[V2], p: V2, d: f64) -> bool {
    let n = boundary.len();
    (0..n).all(|i| dist_point_segment(p, boundary[i], boundary[(i + 1) % n]) >= d)
}

/// Purpose: build the network and find which lanes can be reached.
pub fn build(inp: &NetInput) -> (Network, Vec<Reach>) {
    let proj = inp.proj;
    let mut pts: Vec<V2> = Vec::new();
    let mut ids: Vec<String> = Vec::new();
    let mut cand: Vec<Edge> = Vec::new();
    let mut arcs: Vec<(usize, usize, f64, usize)> = Vec::new();
    let add_node = |pts: &mut Vec<V2>, ids: &mut Vec<String>, p: V2, id: String| {
        pts.push(p);
        ids.push(id);
        pts.len() - 1
    };
    let add_edge = |pts: &Vec<V2>,
                    ids: &Vec<String>,
                    cand: &mut Vec<Edge>,
                    arcs: &mut Vec<(usize, usize, f64, usize)>,
                    a: usize,
                    b: usize,
                    kind: &'static str,
                    one_way: bool,
                    shape: Vec<V2>,
                    of: Option<String>| {
        let length: f64 = shape.windows(2).map(|w| w[0].dist(w[1])).sum();
        let k = cand.len();
        cand.push(Edge {
            id: format!("{kind}:{k}"),
            kind,
            from: ids[a].clone(),
            to: ids[b].clone(),
            one_way,
            coords: shape.iter().map(|p| proj.ll(*p)).collect(),
            length_m: (length * 100.0).round() / 100.0,
            of,
        });
        arcs.push((a, b, length.max(0.01), k));
        if !one_way {
            arcs.push((b, a, length.max(0.01), k));
        }
        let _ = pts;
    };

    // Gates: a node just inside the fence, and the short gate edge from the fence.
    let mut entrances = Vec::new();
    let mut exits = Vec::new();
    let mut terminals: Vec<usize> = Vec::new();
    for (id, kind, at) in &inp.gates {
        let fence = add_node(&mut pts, &mut ids, *at, format!("fence:{id}"));
        let inside = inset_from_fence(inp.boundary, *at, inp.keep_off.max(1.5));
        let g = add_node(&mut pts, &mut ids, inside, format!("gate:{id}"));
        add_edge(
            &pts,
            &ids,
            &mut cand,
            &mut arcs,
            fence,
            g,
            "gate",
            false,
            vec![*at, inside],
            Some(id.clone()),
        );
        if kind.enters() {
            entrances.push(fence);
        }
        if kind.leaves() {
            exits.push(fence);
        }
        terminals.push(g);
    }

    // Aisles: their ends, and a junction in front of every lane end that uses them.
    let mut lane_in: Vec<Option<usize>> = vec![None; inp.lanes.len()];
    let mut lane_out: Vec<Option<usize>> = vec![None; inp.lanes.len()];
    for (ai, (aid, a, b, both)) in inp.aisles.iter().enumerate() {
        let d = b.sub(*a);
        let len2 = d.dot(d).max(1e-9);
        let mut stops: Vec<(f64, Option<(usize, bool)>)> = vec![(0.0, None), (1.0, None)];
        // An aisle that runs up to the fence is joined to the yard where it is clear of the fence.
        let (t0, t1) = clear_span(inp.boundary, *a, *b, inp.keep_off);
        if t0 > 0.0 {
            stops.push((t0, None));
        }
        if t1 < 1.0 {
            stops.push((t1, None));
        }
        for (li, (_, entry, exit, ain, aout)) in inp.lanes.iter().enumerate() {
            if *ain == Some(ai) {
                stops.push((
                    (entry.sub(*a).dot(d) / len2).clamp(0.0, 1.0),
                    Some((li, true)),
                ));
            }
            if *aout == Some(ai) {
                stops.push((
                    (exit.sub(*a).dot(d) / len2).clamp(0.0, 1.0),
                    Some((li, false)),
                ));
            }
        }
        stops.sort_by(|x, y| x.0.total_cmp(&y.0));
        let mut prev: Option<(usize, f64)> = None;
        let mut first_node = None;
        let mut last_node = None;
        let mut count = 0;
        for (t, who) in stops {
            let node = match prev {
                Some((n, pt)) if (t - pt) * len2.sqrt() < 0.5 => n,
                _ => {
                    count += 1;
                    let n = add_node(
                        &mut pts,
                        &mut ids,
                        a.add(d.mul(t)),
                        format!("aisle:{aid}:{count}"),
                    );
                    if let Some((p, _)) = prev {
                        add_edge(
                            &pts,
                            &ids,
                            &mut cand,
                            &mut arcs,
                            p,
                            n,
                            "aisle",
                            !both,
                            vec![pts[p], pts[n]],
                            Some(aid.clone()),
                        );
                    }
                    n
                }
            };
            if who.is_none() && (t - t0).abs() < 1e-9 {
                first_node = Some(node);
            }
            if who.is_none() && (t - t1).abs() < 1e-9 {
                last_node = Some(node);
            }
            if let Some((li, is_in)) = who {
                if is_in {
                    lane_in[li] = Some(node);
                } else {
                    lane_out[li] = Some(node);
                }
            }
            prev = Some((node, t));
        }
        if let Some(f) = first_node {
            terminals.push(f);
        }
        if let Some(l) = last_node {
            terminals.push(l);
        }
    }
    // Lanes: one-way from the junction on their entry aisle to the one on their exit aisle.
    for (li, (lid, entry, exit, _, _)) in inp.lanes.iter().enumerate() {
        if let (Some(a), Some(b)) = (lane_in[li], lane_out[li]) {
            let shape = vec![pts[a], *entry, *exit, pts[b]];
            add_edge(
                &pts,
                &ids,
                &mut cand,
                &mut arcs,
                a,
                b,
                "lane",
                true,
                shape,
                Some(lid.clone()),
            );
        }
    }
    // Yard points: perimeter road corners and the corners of circulation zones.
    let mut yard_n = 0;
    for i in 0..inp.boundary.len() {
        if let Some(q) = inset_corner(inp.boundary, i, inp.perimeter_inset.max(inp.keep_off)) {
            yard_n += 1;
            terminals.push(add_node(&mut pts, &mut ids, q, format!("yard:{yard_n}")));
        }
    }
    for q in &inp.yard {
        if contains(inp.boundary, *q) && boundary_clear(inp.boundary, *q, inp.keep_off) {
            yard_n += 1;
            terminals.push(add_node(&mut pts, &mut ids, *q, format!("yard:{yard_n}")));
        }
    }
    terminals.sort_unstable();
    terminals.dedup();
    // Drives: straight lines between terminals through open yard space.
    let parked_boxes: Vec<_> = inp.parked.iter().map(|r| bbox(r)).collect();
    let drive_first = cand.len();
    for (x, &i) in terminals.iter().enumerate() {
        for &j in &terminals[x + 1..] {
            let (p, q) = (pts[i], pts[j]);
            if p.dist(q) < 0.5 || !drivable(inp, &parked_boxes, p, q) {
                continue;
            }
            add_edge(
                &pts,
                &ids,
                &mut cand,
                &mut arcs,
                i,
                j,
                "drive",
                false,
                vec![p, q],
                None,
            );
        }
    }
    let g = Graph { pts, ids, arcs };
    let (din, pin) = dijkstra(&g, &entrances, false);
    let (dout, pout) = dijkstra(&g, &exits, true);
    let mut used = vec![false; cand.len()];
    let mut mark = |pred: &Vec<Option<usize>>, mut v: usize, backwards: bool| {
        while let Some(k) = pred[v] {
            let (a, b, _, e) = g.arcs[k];
            used[e] = true;
            v = if backwards { b } else { a };
        }
    };
    let mut reach = Vec::new();
    for (li, (lid, ..)) in inp.lanes.iter().enumerate() {
        let a = lane_in[li];
        let b = lane_out[li];
        let in_m = a.map(|a| din[a]).filter(|d| d.is_finite());
        let out_m = b.map(|b| dout[b]).filter(|d| d.is_finite());
        if let Some(a) = a.filter(|_| in_m.is_some()) {
            mark(&pin, a, false);
        }
        if let Some(b) = b.filter(|_| out_m.is_some()) {
            mark(&pout, b, true);
        }
        reach.push(Reach {
            lane: lid.clone(),
            from_entrance: in_m.is_some(),
            to_exit: out_m.is_some(),
            in_m: in_m.map(|d| (d * 10.0).round() / 10.0),
            out_m: out_m.map(|d| (d * 10.0).round() / 10.0),
        });
    }
    // Keep all gate, aisle and lane edges, and the drives on the routes.
    let edges: Vec<Edge> = cand
        .into_iter()
        .enumerate()
        .filter(|(k, _)| *k < drive_first || used[*k])
        .map(|(_, e)| e)
        .collect();
    let mut keep_nodes: Vec<bool> = vec![false; g.pts.len()];
    for e in &edges {
        for id in [&e.from, &e.to] {
            if let Some(i) = g.ids.iter().position(|x| x == id) {
                keep_nodes[i] = true;
            }
        }
    }
    let nodes = g
        .pts
        .iter()
        .zip(&g.ids)
        .zip(keep_nodes)
        .filter(|(_, k)| *k)
        .map(|((p, id), _)| Node {
            id: id.clone(),
            lonlat: proj.ll(*p),
        })
        .collect();
    (Network { nodes, edges }, reach)
}

/// Purpose: whether a straight drive from `p` to `q` stays inside the fence and clear of parked vehicles.
fn drivable(inp: &NetInput, boxes: &[(V2, V2)], p: V2, q: V2) -> bool {
    let n = inp.boundary.len();
    if !contains(inp.boundary, p)
        || !contains(inp.boundary, q)
        || !contains(inp.boundary, p.add(q).mul(0.5))
    {
        return false;
    }
    for i in 0..n {
        let (a, b) = (inp.boundary[i], inp.boundary[(i + 1) % n]);
        if segments_meet(p, q, a, b) {
            return false;
        }
    }
    let sb = bbox(&[p, q]);
    for (r, rb) in inp.parked.iter().zip(boxes) {
        if !boxes_near(sb, *rb, inp.keep_off) {
            continue;
        }
        if contains(r, p) || contains(r, q) {
            return false;
        }
        for k in 0..4 {
            if dist_segments(p, q, r[k], r[(k + 1) % 4]) < inp.keep_off {
                return false;
            }
        }
    }
    true
}
