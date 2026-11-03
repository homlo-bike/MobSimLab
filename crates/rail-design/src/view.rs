//! What the map editor shows: GeoJSON layers drawn to scale, edit handles, connection points,
//! summaries for the side panel and the issue list.
//!
//! Every drawn feature carries `z`, the level's drawing order (0 = underground −2 … 4 = elevated
//! +2, ramps with the structure they belong to). The editor draws one stack of layers per level,
//! lowest first, and inside each level all beds and sleepers before all rails, so tracks that
//! meet or cross on one level merge into one piece of trackwork (ADR-0030, ADR-0033).

use crate::alignment::VertexKind;
use crate::design::{CrossingKind, Design};
use crate::geom::{simplify, slice, with_headings, Grid, Sample, P2};
use crate::issue::Severity;
use crate::model::{Anchor, Level, Network, SwitchKind, TrackUse};
use crate::params::{defaults, Element};
use serde_json::{json, Map, Value};

/// Lateral position of a third rail from the track centre: outside the running rail, m.
const THIRD_RAIL_OFFSET_M: f64 = 0.72;
/// Overhead line mast distance from the track centre, m (drawing).
const MAST_OFFSET_M: f64 = 2.8;

struct Layers {
    proj: crate::proj::LocalTm,
    out: Map<String, Value>,
}

impl Layers {
    fn ll(&self, p: P2) -> Value {
        let [lon, lat] = self.proj.to_lonlat(p);
        json!([(lon * 1e8).round() / 1e8, (lat * 1e8).round() / 1e8])
    }
    fn push(&mut self, layer: &str, geometry: Value, props: Value) {
        let fc = self
            .out
            .entry(layer.to_string())
            .or_insert_with(|| json!([]));
        fc.as_array_mut()
            .expect("array")
            .push(json!({"type": "Feature", "geometry": geometry, "properties": props}));
    }
    fn line(&mut self, layer: &str, pts: &[P2], props: Value) {
        if pts.len() < 2 {
            return;
        }
        let c: Vec<Value> = simplify(pts, 0.002).iter().map(|p| self.ll(*p)).collect();
        self.push(
            layer,
            json!({"type": "LineString", "coordinates": c}),
            props,
        );
    }
    fn polygon(&mut self, layer: &str, ring: &[P2], props: Value) {
        if ring.len() < 3 {
            return;
        }
        let mut c: Vec<Value> = simplify(ring, 0.005).iter().map(|p| self.ll(*p)).collect();
        c.push(c[0].clone());
        self.push(layer, json!({"type": "Polygon", "coordinates": [c]}), props);
    }
    fn point(&mut self, layer: &str, p: P2, props: Value) {
        let c = self.ll(p);
        self.push(layer, json!({"type": "Point", "coordinates": c}), props);
    }
    fn finish(self) -> Value {
        let mut m = Map::new();
        for (k, v) in self.out {
            m.insert(k, json!({"type": "FeatureCollection", "features": v}));
        }
        Value::Object(m)
    }
}

fn offset_line(pts: &[Sample], o: f64) -> Vec<P2> {
    pts.iter().map(|q| q.offset(o)).collect()
}

/// Band polygon round a centre line, `half(sample)` metres each side.
fn band(pts: &[Sample], half: impl Fn(&Sample) -> f64) -> Vec<P2> {
    let mut ring: Vec<P2> = pts.iter().map(|q| q.offset(half(q))).collect();
    ring.extend(pts.iter().rev().map(|q| q.offset(-half(q))));
    ring
}

fn level_name(l: Option<Level>) -> Value {
    l.map_or(json!("ramp"), |l| json!(l))
}

/// Purpose: everything the editor needs after a rebuild, as one JSON value.
pub fn view(dz: &Design) -> Value {
    let net = &dz.network;
    let mut ly = Layers {
        proj: dz.proj,
        out: Map::new(),
    };
    for k in [
        "structures",
        "edges",
        "tracks",
        "rails",
        "platforms",
        "wires",
        "masts",
        "markers",
        "level_crossings",
        "signals",
        "street_running",
        "corridors",
        "connections",
    ] {
        ly.out.insert(k.into(), json!([]));
    }
    let mut pieces: Vec<(Vec<Sample>, Value)> = Vec::new();

    // Stations.
    for (st, doc) in dz.stations.iter().zip(&net.stations) {
        let z = st.level.order();
        let sm = dz.station_mode(doc);
        let sp = dz.params_for(sm);
        let box_ring = vec![
            st.point(-st.half_len, -st.half_w),
            st.point(st.half_len, -st.half_w),
            st.point(st.half_len, st.half_w),
            st.point(-st.half_len, st.half_w),
        ];
        let kind = if st.level.underground() {
            "station_box"
        } else if st.level.elevated() {
            "deck"
        } else {
            "ballast"
        };
        ly.polygon(
            "structures",
            &box_ring,
            json!({"kind": kind, "z": z, "ref": st.id, "deep": st.level == Level::Underground2}),
        );
        if st.level != Level::Street {
            let wall = if st.level.underground() {
                "tunnel_wall"
            } else {
                "deck_edge"
            };
            let props = json!({"kind": wall, "z": z, "ref": st.id, "deep": st.level == Level::Underground2});
            ly.line("edges", &[box_ring[0], box_ring[1]], props.clone());
            ly.line("edges", &[box_ring[3], box_ring[2]], props.clone());
            // End walls with openings where tracks leave.
            for end in [0u8, 1] {
                let a = if end == 1 { st.half_len } else { -st.half_len };
                let mut open: Vec<(f64, f64)> = Vec::new();
                for t in &net.tracks {
                    for anc in [Some(&t.start), t.end.as_ref()].into_iter().flatten() {
                        if let Anchor::Station {
                            station,
                            end: e,
                            tracks,
                        } = anc
                        {
                            if *station == st.id && *e == end {
                                let ns: Vec<f64> = tracks
                                    .iter()
                                    .filter_map(|i| st.tracks.get(*i).map(|t| t.n))
                                    .collect();
                                if let (Some(lo), Some(hi)) = (
                                    ns.iter().copied().reduce(f64::min),
                                    ns.iter().copied().reduce(f64::max),
                                ) {
                                    open.push((lo - 2.5, hi + 2.5));
                                }
                            }
                        }
                    }
                }
                open.sort_by(|x, y| x.0.total_cmp(&y.0));
                let mut n = -st.half_w;
                for (o0, o1) in open {
                    if o0 > n {
                        ly.line("edges", &[st.point(a, n), st.point(a, o0)], props.clone());
                    }
                    n = n.max(o1);
                }
                if n < st.half_w {
                    ly.line(
                        "edges",
                        &[st.point(a, n), st.point(a, st.half_w)],
                        props.clone(),
                    );
                }
            }
        }
        for pl in &st.platforms {
            let ring = vec![
                st.point(-st.platform_half, pl.n0),
                st.point(st.platform_half, pl.n0),
                st.point(st.platform_half, pl.n1),
                st.point(-st.platform_half, pl.n1),
            ];
            ly.polygon(
                "platforms",
                &ring,
                json!({"kind": "platform", "z": z, "ref": st.id, "name": doc.name}),
            );
            for n in [pl.n0, pl.n1] {
                ly.line(
                    "platforms",
                    &[
                        st.point(-st.platform_half, n),
                        st.point(st.platform_half, n),
                    ],
                    json!({"kind": "platform_edge", "z": z, "ref": st.id}),
                );
            }
        }
        ly.point(
            "markers",
            st.point(0.0, st.half_w + 6.0),
            json!({"kind": "station_label", "z": z, "ref": st.id, "name": doc.name}),
        );
        let embedded = sm.street_running() && st.level == Level::Street;
        for (i, t) in st.tracks.iter().enumerate() {
            let pts = with_headings(&[st.point(-st.half_len, t.n), st.point(st.half_len, t.n)]);
            let third_side = if t.platform_left { -1.0 } else { 1.0 };
            pieces.push((
                pts,
                json!({"kind": "station", "ref": st.id, "index": i, "z": z, "bed": if embedded {"embedded"} else {"ballast"},
                       "use": "running", "third": sp.third_rail_default(), "third_side": third_side,
                       "overhead": !sp.third_rail_default() && sp.electrification != "none",
                       "underground": st.level.underground(), "mode": sm, "gauge": sp.gauge_m()}),
            ));
        }
        ly.line(
            "corridors",
            &[st.point(-st.half_len, 0.0), st.point(st.half_len, 0.0)],
            json!({"kind": "station", "z": z, "ref": st.id, "underground": st.level.underground()}),
        );
    }

    let mut grid = Grid::new(25.0);
    for g in &dz.tracks {
        for l in &g.lines {
            grid.add(g.id, l);
        }
    }
    // Tracks.
    for g in &dz.tracks {
        let Some(t) = dz.doc_track(g.id) else {
            continue;
        };
        if g.length < 0.1 {
            continue;
        }
        let tm = dz.track_mode(g.id);
        let p = dz.track_params(g.id);
        let gauge = p.gauge_m();
        let embedded = dz.embedded(t);
        let third = dz.third_rail(t);
        let overhead = dz.overhead(t);
        let storage = t.usage == TrackUse::Storage;
        let half = |q: &Sample| g.spacing_at(q.s) / 2.0 + gauge / 2.0 + p.structure_outline_m;
        for z in &g.zones {
            let order = match (z.level, z.ramp) {
                (Some(l), _) => l.order(),
                (None, Some(r)) => g.ramps[r].order(),
                _ => 2,
            };
            let centre = slice(&g.centre, z.s0, z.s1);
            let lvl = z.level;
            let underground = lvl.map_or_else(
                || z.ramp.is_some_and(|r| g.ramps[r].order() < 2),
                |l| l.underground(),
            );
            let common = json!({"ref": g.id, "z": order, "mode": tm});
            let props = |extra: Value| {
                let mut m = common.as_object().unwrap().clone();
                m.extend(extra.as_object().unwrap().clone());
                Value::Object(m)
            };
            match lvl {
                Some(l) if l.underground() => {
                    ly.polygon(
                        "structures",
                        &band(&centre, half),
                        props(json!({"kind": "tunnel", "deep": l == Level::Underground2})),
                    );
                    for sg in [1.0, -1.0] {
                        let e: Vec<P2> = centre
                            .iter()
                            .map(|q| q.offset(sg * (half(q) + 0.3)))
                            .collect();
                        ly.line(
                            "edges",
                            &e,
                            props(json!({"kind": "tunnel_wall", "deep": l == Level::Underground2})),
                        );
                    }
                }
                Some(l) if l.elevated() => {
                    ly.polygon(
                        "structures",
                        &band(&centre, half),
                        props(json!({"kind": "deck", "deep": l == Level::Elevated2})),
                    );
                    for sg in [1.0, -1.0] {
                        let e: Vec<P2> = centre.iter().map(|q| q.offset(sg * half(q))).collect();
                        ly.line(
                            "edges",
                            &e,
                            props(json!({"kind": "deck_edge", "deep": l == Level::Elevated2})),
                        );
                    }
                }
                Some(_) => {
                    let kind = if embedded { "paving" } else { "ballast" };
                    ly.polygon(
                        "structures",
                        &band(&centre, |q| half(q) - 0.4),
                        props(json!({"kind": kind})),
                    );
                }
                None => {
                    let r = &g.ramps[z.ramp.unwrap_or(0)];
                    ly.polygon(
                        "structures",
                        &band(&centre, half),
                        props(json!({"kind": "ramp", "underground": underground})),
                    );
                    for sg in [1.0, -1.0] {
                        let e: Vec<P2> = centre.iter().map(|q| q.offset(sg * half(q))).collect();
                        ly.line("edges", &e, props(json!({"kind": if underground {"tunnel_wall"} else {"deck_edge"}, "deep": false})));
                    }
                    // Portal or abutment across the deep (or high) end.
                    let deep_start = r.from.height_m(p).abs() >= r.to.height_m(p).abs();
                    let q = if deep_start {
                        centre.first()
                    } else {
                        centre.last()
                    };
                    if let Some(q) = q {
                        let w = half(q) + 0.6;
                        ly.line(
                            "edges",
                            &[q.offset(w), q.offset(-w)],
                            props(json!({"kind": "portal", "deep": false})),
                        );
                    }
                }
            }
            ly.line(
                "corridors",
                &centre.iter().map(|q| q.p).collect::<Vec<_>>(),
                props(json!({"kind": "track", "underground": underground, "use": if storage {"storage"} else {"running"}})),
            );
            for (li, line) in g.lines.iter().enumerate() {
                let pts = slice(line, z.s0, z.s1);
                // Third rail on the outer side, away from the other track.
                let third_side = if g.ntracks == 2 {
                    if li == 0 {
                        1.0
                    } else {
                        -1.0
                    }
                } else {
                    -1.0
                };
                pieces.push((
                    pts,
                    props(json!({"kind": "track", "line": li, "bed": if lvl == Some(Level::Street) && embedded {"embedded"} else {"ballast"},
                                 "use": if storage {"storage"} else {"running"}, "third": third, "third_side": third_side,
                                 "overhead": overhead, "underground": underground, "gauge": gauge})),
                ));
            }
        }
        // Buffer stops at free ends.
        for (anchor, at_start) in [(Some(&t.start), true), (t.end.as_ref(), false)] {
            let free = anchor.is_none_or_free();
            if !free {
                continue;
            }
            for line in &g.lines {
                let q = if at_start { line.first() } else { line.last() };
                if let Some(q) = q {
                    ly.line(
                        "markers",
                        &[q.offset(1.2), q.offset(-1.2)],
                        json!({"kind": "buffer", "z": g.order_at(q.s), "ref": g.id}),
                    );
                }
            }
        }
        // Overhead line masts outside the tracks, not in tunnels.
        if overhead {
            let span = p.ocl_span_m.max(10.0);
            let mut s = span / 2.0;
            while s < g.length {
                let open = g.level_at(s).is_some_and(|l| !l.underground());
                if open {
                    let q = crate::geom::at_s(&g.centre, s);
                    let e = g.spacing_at(s) / 2.0;
                    let sides: &[f64] = if g.ntracks == 2 {
                        &[1.0, -1.0]
                    } else {
                        &[-1.0]
                    };
                    for sg in sides {
                        let mast = q.offset(sg * (e + MAST_OFFSET_M));
                        let mut blocked = false;
                        grid.near(mast, 2.5, |owner, _, _| blocked |= owner != g.id);
                        if blocked {
                            continue;
                        }
                        let z = g.order_at(s);
                        ly.point("masts", mast, json!({"kind": "mast", "z": z, "ref": g.id}));
                        ly.line(
                            "masts",
                            &[mast, q.offset(sg * e)],
                            json!({"kind": "cantilever", "z": z, "ref": g.id}),
                        );
                    }
                }
                s += span;
            }
        }
    }

    // Switch paths.
    for sw in &dz.switches {
        let Some(g) = dz.track(sw.track) else {
            continue;
        };
        let t = dz.doc_track(sw.track);
        let mid = (sw.s0 + sw.s1) / 2.0;
        let z = g.order_at(mid.clamp(0.0, g.length));
        let lvl = g.level_at(mid.clamp(0.0, g.length));
        let embedded = t.is_some_and(|t| dz.embedded(t)) && lvl == Some(Level::Street);
        let overhead = t.is_some_and(|t| dz.overhead(t));
        let sm = dz.track_mode(sw.track);
        let p = dz.params_for(sm);
        let gauge = p.gauge_m();
        let half_w = gauge / 2.0 + p.structure_outline_m;
        for path in &sw.paths {
            if lvl.is_some_and(|l| l != Level::Street) {
                let kind = if lvl.is_some_and(|l| l.underground()) {
                    "tunnel"
                } else {
                    "deck"
                };
                ly.polygon(
                    "structures",
                    &band(path, |_| half_w),
                    json!({"kind": kind, "z": z, "ref": sw.id, "deep": false}),
                );
            } else {
                let kind = if embedded { "paving" } else { "ballast" };
                ly.polygon(
                    "structures",
                    &band(path, |_| half_w - 0.4),
                    json!({"kind": kind, "z": z, "ref": sw.id}),
                );
            }
            pieces.push((
                path.clone(),
                json!({"kind": "switch", "ref": sw.id, "z": z, "bed": if embedded {"embedded"} else {"ballast"},
                       "use": "running", "third": false, "third_side": 0.0, "overhead": overhead,
                       "underground": lvl.is_some_and(|l| l.underground()), "mode": sm, "gauge": gauge}),
            ));
        }
        for d in &sw.diamonds {
            ly.point(
                "markers",
                *d,
                json!({"kind": "diamond", "z": z, "ref": sw.id}),
            );
        }
        for toe in &sw.toes {
            ly.point(
                "markers",
                *toe,
                json!({"kind": "toe", "z": z, "ref": sw.id}),
            );
        }
    }
    for c in &dz.crossings {
        let kind = match c.kind {
            CrossingKind::Diamond => "diamond",
            CrossingKind::GradeSeparated => "bridge",
            CrossingKind::Clash => "clash",
        };
        ly.point(
            "markers",
            c.p,
            json!({"kind": kind, "z": 4, "ref": c.tracks[1]}),
        );
    }

    // Level crossings: the street surface across the sleepers (rails stay on top), the stop
    // lines road vehicles wait behind and, where the crossing has them, the barriers.
    for x in &dz.level_crossings {
        let Some(g) = dz.track(x.track) else {
            continue;
        };
        let p = dz.track_params(x.track);
        let ds = x.street_dir;
        let dt = P2::dir(crate::geom::at_s(&g.centre, x.s).h);
        let sin = x.angle.sin().max(0.05);
        // The deck covers the sleepers of every line: half the spacing plus half a sleeper.
        let deck = g.spacing_at(x.s) / 2.0 + (p.gauge_m() + 1.165) / 2.0 + 0.3;
        let (a, b) = (deck / sin, x.street_width_m / 2.0 / sin);
        let corner = |i: f64, j: f64| x.p.add(ds.mul(i * a)).add(dt.mul(j * b));
        let z = Level::Street.order();
        let props = |kind: &str| json!({"kind": kind, "z": z, "ref": x.track, "id": x.id, "standard": x.standard});
        ly.polygon(
            "level_crossings",
            &[
                corner(-1.0, -1.0),
                corner(1.0, -1.0),
                corner(1.0, 1.0),
                corner(-1.0, 1.0),
            ],
            props("deck"),
        );
        let n = ds.left();
        let half = x.street_width_m / 2.0;
        for k in [-1.0, 1.0] {
            let c = x.p.add(ds.mul(k * x.keep_clear_m));
            ly.line(
                "level_crossings",
                &[c.add(n.mul(-half)), c.add(n.mul(half))],
                props("stop_line"),
            );
            if x.protection == crate::street::Protection::Barriers {
                // A half barrier across the lane that approaches the crossing (right-hand
                // traffic), 1 m beyond the stop line.
                let c = x.p.add(ds.mul(k * (x.keep_clear_m - 1.0)));
                let side = n.mul(k);
                ly.line(
                    "level_crossings",
                    &[c.add(side.mul(half)), c],
                    props("barrier"),
                );
            }
        }
    }

    // Street running: the edges of the tram's own lane (solid) or, in mixed traffic, of the
    // space the tram sweeps in the traffic lane (dashed).
    for r in &dz.street_running {
        let Some(g) = dz.track(r.track) else {
            continue;
        };
        if r.running == crate::street_running::Running::PedestrianZone {
            continue;
        }
        let pts = slice(&g.centre, r.from_m, r.to_m);
        let z = Level::Street.order();
        let kind = match r.running {
            crate::street_running::Running::Reserved => "tram_lane",
            _ => "shared_lane",
        };
        for side in [-1.0, 1.0] {
            ly.line(
                "street_running",
                &offset_line(&pts, side * r.tram_lane_m / 2.0),
                json!({"kind": kind, "z": z, "ref": r.track, "id": r.id}),
            );
        }
    }

    // Signals of the plan: a post on the right of the track in the direction of travel, and a
    // short arm pointing that way, so the facing reads on the map.
    let mut signal_list: Vec<Value> = Vec::new();
    for sg in net.signals.iter().flatten() {
        let Some((p, h)) = crate::signal::locate(dz, &sg.at) else {
            continue;
        };
        let dir = P2::dir(h).mul(f64::from(sg.facing.signum()));
        let right = dir.left().mul(-1.0);
        let z = match sg.at {
            crate::signal::SignalAt::Track { track, s, .. } => {
                dz.track(track).map_or(2, |g| g.order_at(s))
            }
            crate::signal::SignalAt::Station { station, .. } => {
                dz.station(station).map_or(2, |st| st.level.order())
            }
            crate::signal::SignalAt::Leg { switch, .. } => dz
                .switch(switch)
                .and_then(|sw| dz.track(sw.track).map(|g| g.order_at(sw.s0)))
                .unwrap_or(2),
        };
        let lineside = !(sg.kind == crate::signal::SignalKind::Block
            && dz
                .signal_params(&sg.at)
                .is_some_and(|p| crate::signal::system_of(p) == crate::signal::System::Cab));
        let props = |kind: &str| json!({"kind": kind, "z": z, "ref": sg.id, "signal": sg.kind, "lineside": lineside});
        let (foot, head) = (p.add(right.mul(1.6)), p.add(right.mul(3.0)));
        ly.line("signals", &[foot, head], props("signal_post"));
        ly.line(
            "signals",
            &[head, head.add(dir.mul(2.0))],
            props("signal_arm"),
        );
        ly.point("signals", head, props("signal"));
        signal_list.push(json!({
            "id": sg.id, "kind": sg.kind, "name": sg.name, "facing": sg.facing, "at": sg.at,
            "lineside": lineside, "lonlat": ly.ll(head),
        }));
    }

    // Track pieces: centre line (beds, sleepers, single-line view), rails, wires and third rail.
    let gaps: Vec<(u32, f64, f64)> = dz
        .switches
        .iter()
        .map(|s| (s.track, s.s0 - 4.0, s.s1 + 4.0))
        .collect();
    for (pts, props) in &pieces {
        if pts.len() < 2 {
            continue;
        }
        let centre: Vec<P2> = pts.iter().map(|q| q.p).collect();
        let gauge = props["gauge"].as_f64().unwrap_or(1.435);
        ly.line("tracks", &centre, props.clone());
        let mut rp = props.clone();
        rp["kind"] = json!("rail");
        ly.line("rails", &offset_line(pts, gauge / 2.0), rp.clone());
        ly.line("rails", &offset_line(pts, -gauge / 2.0), rp);
        let underground = props["underground"].as_bool().unwrap_or(false);
        let z = props["z"].clone();
        let r = props["ref"].clone();
        if props["overhead"].as_bool().unwrap_or(false) {
            ly.line(
                "wires",
                &centre,
                json!({"kind": "contact_wire", "z": z, "ref": r, "underground": underground}),
            );
        }
        if props["third"].as_bool().unwrap_or(false) {
            let side = props["third_side"].as_f64().unwrap_or(1.0);
            let id = r.as_u64().unwrap_or(0) as u32;
            let mut run: Vec<P2> = Vec::new();
            let flush = |run: &mut Vec<P2>, ly: &mut Layers| {
                if run.len() >= 2 {
                    ly.line(
                        "wires",
                        run,
                        json!({"kind": "third_rail", "z": z, "ref": r}),
                    );
                }
                run.clear();
            };
            for q in pts {
                let in_gap = gaps
                    .iter()
                    .any(|(t, a, b)| *t == id && q.s > *a && q.s < *b)
                    || dz
                        .crossings
                        .iter()
                        .any(|c| c.kind == CrossingKind::Diamond && c.p.dist(q.p) < 9.0);
                if in_gap {
                    flush(&mut run, &mut ly);
                } else {
                    run.push(q.offset(side * (gauge / 2.0 + THIRD_RAIL_OFFSET_M)));
                }
            }
            flush(&mut run, &mut ly);
        }
    }

    // Connection points a track can start or end at.
    let mut used: Vec<Anchor> = Vec::new();
    for t in &net.tracks {
        used.push(t.start.clone());
        if let Some(e) = &t.end {
            used.push(e.clone());
        }
    }
    let mut connections = Vec::new();
    for st in &dz.stations {
        for c in &st.connections {
            let anchor = Anchor::Station {
                station: st.id,
                end: c.end,
                tracks: c.tracks.clone(),
            };
            connections.push((anchor, c.p, c.dir, c.tracks.len(), st.level));
        }
    }
    for sw in &dz.switches {
        for (leg, a) in sw.anchors.iter().enumerate() {
            let anchor = Anchor::Switch { switch: sw.id, leg };
            let n = if sw.kind == SwitchKind::DoubleJunction {
                2
            } else {
                1
            };
            connections.push((
                anchor,
                a.p,
                a.dir.unwrap_or_default(),
                n,
                a.level.unwrap_or(Level::Street),
            ));
        }
    }
    let mut conn_out = Vec::new();
    for (i, (anchor, at, dir, n, level)) in connections.iter().enumerate() {
        let is_used = used.contains(anchor);
        ly.point(
            "connections",
            *at,
            json!({"index": i, "tracks": n, "used": is_used, "z": level.order(), "pair": *n == 2}),
        );
        conn_out.push(json!({
            "index": i, "anchor": anchor, "lonlat": ly.ll(*at), "tracks": n, "used": is_used, "level": level,
            "mode": anchor_mode(dz, anchor),
            "bearing_deg": (90.0 - dir.heading().to_degrees()).rem_euclid(360.0),
        }));
    }

    // Edit handles.
    let mut handles = Vec::new();
    for g in &dz.tracks {
        let Some(t) = dz.doc_track(g.id) else {
            continue;
        };
        for (i, v) in g.verts.iter().enumerate() {
            let kind = match g.kinds[i] {
                VertexKind::Pi => "pi",
                VertexKind::LeadStart => "lead_start",
                VertexKind::LeadEnd => "lead_end",
                VertexKind::End if matches!(t.end, Some(Anchor::Free { .. })) => "end",
                VertexKind::Start if matches!(t.start, Anchor::Free { .. }) => "start",
                _ => continue,
            };
            handles.push(json!({"track": g.id, "kind": kind, "index": g.pi_of[i], "lonlat": ly.ll(*v), "level": g.vert_levels[i]}));
        }
    }
    for (st, doc) in dz.stations.iter().zip(&net.stations) {
        let rot = st.point(0.0, st.half_w + 14.0);
        handles.push(json!({"station": doc.id, "kind": "rotate", "lonlat": ly.ll(rot)}));
    }

    let stations: Vec<Value> = dz
        .stations
        .iter()
        .zip(&net.stations)
        .map(|(st, doc)| {
            let layout: Vec<&str> = {
                let mut v = Vec::new();
                let mut plats = st.platforms.iter().peekable();
                let mut tracks = st.tracks.iter().peekable();
                // right to left: platforms and tracks interleave by offset
                loop {
                    match (plats.peek(), tracks.peek()) {
                        (Some(pl), Some(tr)) if pl.n0 < tr.n => {
                            v.push(if pl.island { "I" } else { "S" });
                            plats.next();
                        }
                        (_, Some(_)) => {
                            v.push("│");
                            tracks.next();
                        }
                        (Some(pl), None) => {
                            v.push(if pl.island { "I" } else { "S" });
                            plats.next();
                        }
                        (None, None) => break,
                    }
                }
                v
            };
            json!({
                "id": doc.id, "name": doc.name, "tracks": st.tracks.len(),
                "platform_edges": st.tracks.iter().filter(|t| t.platform_left || t.platform_right).count(),
                "layout": layout.join(" "), "box_length_m": st.half_len * 2.0, "box_width_m": st.half_w * 2.0,
                "platform_height_mm": dz.params_for(dz.station_mode(doc)).platform_height_mm, "lonlat": ly.ll(st.centre),
                "mode": dz.station_mode(doc),
            })
        })
        .collect();

    let tracks: Vec<Value> = dz
        .tracks
        .iter()
        .map(|g| {
            let sp = dz.speeds.get(&g.id);
            json!({
                "id": g.id, "length_m": g.length, "tracks": g.ntracks, "mode": dz.track_mode(g.id),
                "curves": g.curves.iter().map(|c| json!({
                    "pi": c.pi, "kind": format!("{:?}", c.kind).to_lowercase(), "radius_m": c.radius, "nominal_radius_m": c.nominal_radius,
                    "deflection_deg": c.deflection.to_degrees(), "transition_m": c.transition, "speed_kmh": c.speed_kmh,
                    "cant_mm": c.cant_mm, "cant_deficiency_mm": c.cant_deficiency_mm,
                })).collect::<Vec<_>>(),
                "ramps": g.ramps.iter().map(|r| json!({"from": r.from, "to": r.to, "dh_m": r.dh, "length_m": r.length})).collect::<Vec<_>>(),
                "levels": g.zones.iter().map(|z| json!({"from_m": z.s0, "to_m": z.s1, "level": level_name(z.level)})).collect::<Vec<_>>(),
                "spread_m": [g.spread_start, g.spread_end],
                "embedded": dz.doc_track(g.id).is_some_and(|t| dz.embedded(t)),
                "speed": sp.map(|s| json!({"max_kmh": s.vmax, "time_s": s.time_s,
                    "profile": s.s.iter().zip(&s.limit).zip(&s.v).step_by((s.s.len() / 120).max(1)).map(|((a, b), c)| json!([a, b, c])).collect::<Vec<_>>()})),
                "centre": slice(&g.centre, 0.0, g.length).iter().step_by((g.centre.len() / 400).max(1)).map(|q| ly.ll(q.p)).collect::<Vec<_>>(),
            })
        })
        .collect();

    let switches: Vec<Value> = dz
        .switches
        .iter()
        .map(|s| {
            json!({"id": s.id, "track": s.track, "label": s.label, "element": s.element, "kind": s.kind, "length_m": s.s1 - s.s0,
                   "diverging_speed_kmh": s.turnout.diverging_kmh, "crossing_ratio_n": s.turnout.n, "radius_m": s.turnout.radius,
                   "s0": s.s0, "s1": s.s1})
        })
        .collect();

    let issues: Vec<Value> = dz
        .issues
        .iter()
        .map(|i| json!({"severity": i.severity, "text": i.text, "at": i.at.map(|a| ly.ll(a)), "ref_id": i.ref_id}))
        .collect();

    let all: Vec<P2> = dz
        .tracks
        .iter()
        .flat_map(|g| g.centre.iter().map(|q| q.p))
        .chain(dz.stations.iter().flat_map(|s| {
            [-1.0, 1.0]
                .into_iter()
                .map(move |k| s.centre.add(s.u.mul(k * s.half_len)))
        }))
        .collect();
    let bbox = if all.is_empty() {
        Value::Null
    } else {
        let b = crate::geom::BBox::of(all);
        let (sw, ne) = (ly.ll(b.min), ly.ll(b.max));
        json!([sw[0], sw[1], ne[0], ne[1]])
    };

    let counts = json!({
        "errors": dz.issues.iter().filter(|i| i.severity == Severity::Error).count(),
        "warnings": dz.issues.iter().filter(|i| i.severity == Severity::Warning).count(),
        "track_km": dz.tracks.iter().map(|g| g.length * g.ntracks as f64).sum::<f64>() / 1000.0,
        "route_km": dz.tracks.iter().filter(|g| dz.doc_track(g.id).is_some_and(|t| t.usage == TrackUse::Running)).map(|g| g.length).sum::<f64>() / 1000.0,
    });

    let crossings: Vec<Value> = dz.crossings.iter().map(|c| json!({
        "id": c.id, "kind": format!("{:?}", c.kind).to_lowercase(), "tracks": c.tracks, "modes": c.modes,
        "angle_deg": c.angle.to_degrees(), "lonlat": ly.ll(c.p),
    })).collect();

    let level_crossings: Vec<Value> = dz
        .level_crossings
        .iter()
        .map(|x| {
            json!({
                "id": x.id, "track": x.track, "mode": x.mode, "street": x.street, "class": x.class,
                "angle_deg": x.angle.to_degrees(), "protection": x.protection, "standard": x.standard, "special_measures": x.special_measures,
                "bus": x.bus, "trolley_wire": x.trolley_wire, "keep_clear_m": x.keep_clear_m,
                "approach_m": x.approach_m, "lonlat": ly.ll(x.p),
            })
        })
        .collect();

    let street_running: Vec<Value> = dz.street_running.iter().map(|r| json!({
            "id": r.id, "track": r.track, "running": r.running, "speed_limit_kmh": r.speed_limit_kmh,
            "length_m": r.to_m - r.from_m, "street": r.street.name, "class": r.street.class, "bus": r.street.bus,
            "stops": r.stops, "way": r.street.way, "separated": r.separated, "source": r.source,
            "bike_lane": r.street.bike_lane, "traffic_delay_share": r.traffic_delay_share,
            "lonlat": dz.track(r.track).map(|g| ly.ll(crate::geom::at_s(&g.centre, (r.from_m + r.to_m) / 2.0).p)),
        })).collect::<Vec<_>>();

    json!({
        "layers": ly.finish(),
        "connections": conn_out,
        "handles": handles,
        "stations": stations,
        "tracks": tracks,
        "switches": switches,
        "issues": issues,
        "params": dz.params,
        "train_length_m": dz.train_length,
        "turnouts": turnouts(dz.mode),
        "modes": dz.modes.iter().map(|(m, p)| (m.id().to_string(), json!({"params": p, "turnouts": turnouts(*m)}))).collect::<Map<String, Value>>(),
        "crossings": crossings,
        "level_crossings": level_crossings,
        "signals": signal_list,
        "street_running": street_running,
        "signals_planned": net.signals.is_some(),
        "counts": counts,
        "bbox": bbox,
    })
}

/// Purpose: a mode's catalogue turnouts for the panel.
fn turnouts(m: crate::params::RailMode) -> Vec<Value> {
    defaults()
        .turnouts_for(m)
        .iter()
        .map(|s| {
            json!({
                "id": s.id, "label": s.label, "radius_m": s.radius_m, "crossing_ratio_n": s.crossing_ratio_n,
                "diverging_speed_kmh": s.diverging_speed_kmh, "total_length_m": s.total_length_m, "length_a_m": s.length_a_m,
            })
        })
        .collect()
}

/// Purpose: the railway system a connection point belongs to.
fn anchor_mode(dz: &Design, a: &Anchor) -> crate::params::RailMode {
    match a {
        Anchor::Station { station, .. } => dz
            .network
            .stations
            .iter()
            .find(|s| s.id == *station)
            .map_or(dz.mode, |s| dz.station_mode(s)),
        Anchor::Switch { switch, .. } => dz
            .switch(*switch)
            .map_or(dz.mode, |s| dz.track_mode(s.track)),
        Anchor::Free { .. } => dz.mode,
    }
}

trait FreeEnd {
    fn is_none_or_free(&self) -> bool;
}

impl FreeEnd for Option<&Anchor> {
    fn is_none_or_free(&self) -> bool {
        matches!(self, None | Some(Anchor::Free { .. }))
    }
}

/// Purpose: the catalogue's turnouts and diamonds for a mode, for the panel's pickers.
pub fn catalogue_for(mode: crate::params::RailMode) -> Value {
    let d = defaults();
    json!(d
        .switches
        .iter()
        .filter(|s| s.typical_modes.contains(&mode) && matches!(s.element, Element::Turnout))
        .map(|s| json!({"id": s.id, "label": s.label, "radius_m": s.radius_m, "diverging_speed_kmh": s.diverging_speed_kmh}))
        .collect::<Vec<_>>())
}

/// Purpose: an empty document for a mode around an origin, as JSON.
pub fn empty(mode: crate::params::RailMode, lon: f64, lat: f64) -> Network {
    Network::new(mode, [lon, lat])
}
