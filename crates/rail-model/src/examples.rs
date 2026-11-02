//! Small reference networks for tests, documentation and benchmarks.

use crate::spec::{
    Dir, Directions, End, InfraSpec, NodeSpec, PlatformSpec, SignalKind, SignalSpec, StationSpec,
    TrackEnd, TrackSpec,
};

fn te(track: &str, end: End) -> TrackEnd {
    TrackEnd {
        track: track.into(),
        end,
    }
}

fn track(id: &str, length_m: f64, kmh: f64, directions: Directions) -> TrackSpec {
    TrackSpec {
        id: id.into(),
        length_m,
        line_speed_mps: kmh / 3.6,
        speed_ranges: vec![],
        gradient_ranges: vec![],
        directions,
        usage: Default::default(),
        mode: None,
    }
}

fn signal(id: &str, track: &str, position_m: f64, facing: Dir, kind: SignalKind) -> SignalSpec {
    SignalSpec {
        id: id.into(),
        track: track.into(),
        position_m,
        facing,
        kind,
        overlap_m: None,
    }
}

/// Purpose: a terminal station on a double-track line.
///
/// Output: the network below (west on the left, `Up` = eastbound). Platform
/// tracks `p1` and `p2` (250 m, 60 km/h) end at buffer stops in the west. In the
/// throat, crossover `xo` (switches `sa`, `sb`) lets westbound trains reach `p1`,
/// and crossover `xo2` (switches `sd`, `sc`) lets trains from `p2` reach the
/// eastbound main. The mains `m1b` (eastbound only) and `m2b` (westbound only)
/// are 1,500 m at 120 km/h with a block signal halfway; their east ends are
/// portals. Diverging speed is 40 km/h. The two platform edges belong to two
/// station parts with the same name, "Westbahnhof".
///
/// ```text
///  buffer |== p1 ==|S_P1 sa--- m1a ---sc--- m1b (B1) --->  portal
///                     \             /
///                      xo        xo2
///                        \       /
///  buffer |== p2 ==|S_P2 sb--- m2a ---sd H2- m2b (B2) E2 <- portal
/// ```
pub fn terminal_station() -> InfraSpec {
    use Directions::*;
    InfraSpec {
        tracks: vec![
            track("p1", 250.0, 60.0, Both),
            track("p2", 250.0, 60.0, Both),
            track("xo", 60.0, 40.0, Both),
            track("m1a", 100.0, 60.0, Both),
            track("m2a", 100.0, 60.0, Both),
            track("xo2", 60.0, 40.0, Both),
            track("m1b", 1500.0, 120.0, UpOnly),
            track("m2b", 1500.0, 120.0, DownOnly),
        ],
        nodes: vec![
            NodeSpec::BufferStop {
                id: "buf1".into(),
                at: te("p1", End::A),
            },
            NodeSpec::BufferStop {
                id: "buf2".into(),
                at: te("p2", End::A),
            },
            NodeSpec::Switch {
                id: "sa".into(),
                common: te("p1", End::B),
                straight: te("m1a", End::A),
                diverging: te("xo", End::A),
                diverging_speed_mps: 40.0 / 3.6,
                throw_time_s: 6.0,
            },
            NodeSpec::Switch {
                id: "sb".into(),
                common: te("m2a", End::A),
                straight: te("p2", End::B),
                diverging: te("xo", End::B),
                diverging_speed_mps: 40.0 / 3.6,
                throw_time_s: 6.0,
            },
            NodeSpec::Switch {
                id: "sd".into(),
                common: te("m2a", End::B),
                straight: te("m2b", End::A),
                diverging: te("xo2", End::A),
                diverging_speed_mps: 40.0 / 3.6,
                throw_time_s: 6.0,
            },
            NodeSpec::Switch {
                id: "sc".into(),
                common: te("m1b", End::A),
                straight: te("m1a", End::B),
                diverging: te("xo2", End::B),
                diverging_speed_mps: 40.0 / 3.6,
                throw_time_s: 6.0,
            },
        ],
        signals: vec![
            signal("S_P1", "p1", 250.0, Dir::Up, SignalKind::Main),
            signal("S_P2", "p2", 250.0, Dir::Up, SignalKind::Main),
            signal("B1", "m1b", 750.0, Dir::Up, SignalKind::Block),
            signal("E2", "m2b", 1500.0, Dir::Down, SignalKind::Main),
            signal("B2", "m2b", 750.0, Dir::Down, SignalKind::Block),
            signal("H2", "m2b", 0.0, Dir::Down, SignalKind::Main),
        ],
        detection: vec![],
        stations: vec![
            StationSpec {
                id: "west-a".into(),
                name: "Westbahnhof".into(),
                group: None,
            },
            StationSpec {
                id: "west-b".into(),
                name: "  westbahnhof".into(),
                group: None,
            },
        ],
        platforms: vec![
            PlatformSpec {
                id: "pe-1".into(),
                station: "west-a".into(),
                label: Some("1".into()),
                track: "p1".into(),
                from_m: 0.0,
                to_m: 250.0,
            },
            PlatformSpec {
                id: "pe-2".into(),
                station: "west-b".into(),
                label: Some("2".into()),
                track: "p2".into(),
                from_m: 0.0,
                to_m: 250.0,
            },
        ],
        level_crossings: vec![],
        default_overlap_m: 200.0,
    }
}

/// Purpose: a straight single-direction line for headway and capacity tests.
/// Inputs: number of blocks, block length (m), line speed (km/h).
/// Output: tracks `b0..bn` joined end to end, eastbound only, a block signal at
/// the start of each, a portal at both ends, and a 50 m overlap.
pub fn plain_line(blocks: usize, block_m: f64, kmh: f64) -> InfraSpec {
    let mut spec = InfraSpec {
        default_overlap_m: 50.0,
        ..Default::default()
    };
    for i in 0..blocks {
        let id = format!("b{i}");
        spec.tracks
            .push(track(&id, block_m, kmh, Directions::UpOnly));
        spec.signals.push(signal(
            &format!("S{i}"),
            &id,
            0.0,
            Dir::Up,
            SignalKind::Block,
        ));
        if i > 0 {
            spec.nodes.push(NodeSpec::Link {
                a: te(&format!("b{}", i - 1), End::B),
                b: te(&id, End::A),
            });
        }
    }
    spec
}

fn storage(id: &str, length_m: f64) -> TrackSpec {
    TrackSpec {
        usage: crate::spec::TrackUse::Storage,
        ..track(id, length_m, 25.0, Directions::Both)
    }
}

fn switch(id: &str, common: TrackEnd, straight: TrackEnd, diverging: TrackEnd) -> NodeSpec {
    NodeSpec::Switch {
        id: id.into(),
        common,
        straight,
        diverging,
        diverging_speed_mps: 40.0 / 3.6,
        throw_time_s: 6.0,
    }
}

fn link(a: TrackEnd, b: TrackEnd) -> NodeSpec {
    NodeSpec::Link { a, b }
}

fn buffer(id: &str, at: TrackEnd) -> NodeSpec {
    NodeSpec::BufferStop { id: id.into(), at }
}

/// Purpose: a double-track metro line with two stub terminals, three through
/// stations, a depot and terminal sidings, for planning tests (ADR-0032 §7 step 3).
///
/// Output: the network below (`Up` = eastbound, right-hand running). The
/// eastbound main `e0..e3` and the westbound main `w0..w3` are 800 m
/// interstations at 80 km/h with a block signal halfway; the through stations
/// Alder, Birch and Cedar have a 150 m track with a 140 m platform on each main
/// and a starter at its end. Each terminal (Westpark, Eastgate) has two 160 m
/// stub platform tracks behind a double crossover, so every platform can be
/// reached from the arrival main and left towards the departure main. The
/// Westpark depot (three 400 m storage tracks `wd1..wd3`, three trains each)
/// and the Eastgate sidings (`es1`, `es2`, the same length) branch off the departure side of each throat:
/// trains enter them from a platform and leave them into a platform.
/// Throat tracks run at 40–60 km/h, depot tracks at 25 km/h, diverging at 40 km/h.
/// The default overlap is 100 m (a common metro value; `signalling.overlap_*`).
///
/// ```text
///          wd1..wd3                                                   es1, es2
///             \                                                          /
///  |wp1 S_WP1 wsa-wm1a-wsc= e0 =|alder|= e1 =|birch|= e2 =|cedar|= e3 =H_E esc-em1a-esa ep1|
///  |wp2 S_WP2 wsb-wm2a-wdep-wm2c-wsd= w0 =| ... westbound ... |= w3 = esd-em2a-edep-em2c-esb ep2|
/// ```
pub fn metro_line() -> InfraSpec {
    use Directions::*;
    use End::{A, B};
    let mut s = InfraSpec {
        default_overlap_m: 100.0,
        ..Default::default()
    };
    let main = |id: &str, len: f64, d: Directions| track(id, len, 80.0, d);
    // West terminal and depot.
    s.tracks.extend([
        track("wp1", 160.0, 40.0, Both),
        track("wp2", 160.0, 40.0, Both),
        track("wxo", 60.0, 40.0, Both),
        track("wm1a", 100.0, 60.0, Both),
        track("wm2a", 60.0, 60.0, Both),
        track("wm2c", 60.0, 60.0, Both),
        track("wxo2", 60.0, 40.0, Both),
        track("wdl", 120.0, 25.0, Both),
        track("wdl2", 30.0, 25.0, Both),
        storage("wd1", 400.0),
        storage("wd2", 400.0),
        storage("wd3", 400.0),
    ]);
    s.nodes.extend([
        buffer("wp1.end", te("wp1", A)),
        buffer("wp2.end", te("wp2", A)),
        switch("wsa", te("wp1", B), te("wm1a", A), te("wxo", A)),
        switch("wsb", te("wm2a", A), te("wp2", B), te("wxo", B)),
        switch("wdep", te("wm2a", B), te("wm2c", A), te("wdl", A)),
        switch("wsd", te("wm2c", B), te("w0", A), te("wxo2", A)),
        switch("wsc", te("e0", A), te("wm1a", B), te("wxo2", B)),
        switch("wds1", te("wdl", B), te("wd1", A), te("wdl2", A)),
        switch("wds2", te("wdl2", B), te("wd2", A), te("wd3", A)),
        buffer("wd1.end", te("wd1", B)),
        buffer("wd2.end", te("wd2", B)),
        buffer("wd3.end", te("wd3", B)),
    ]);
    // Mains and through stations.
    let names = ["alder", "birch", "cedar"];
    for k in 0..4 {
        s.tracks.push(main(&format!("e{k}"), 800.0, UpOnly));
        s.tracks.push(main(&format!("w{k}"), 800.0, DownOnly));
        s.signals.push(signal(
            &format!("E{k}B"),
            &format!("e{k}"),
            400.0,
            Dir::Up,
            SignalKind::Block,
        ));
        s.signals.push(signal(
            &format!("W{k}B"),
            &format!("w{k}"),
            400.0,
            Dir::Down,
            SignalKind::Block,
        ));
        if let Some(&nm) = names.get(k) {
            let (ea, wa) = (format!("ea{}", k + 1), format!("wa{}", k + 1));
            s.tracks.push(main(&ea, 150.0, UpOnly));
            s.tracks.push(main(&wa, 150.0, DownOnly));
            s.nodes.extend([
                link(te(&format!("e{k}"), B), te(&ea, A)),
                link(te(&ea, B), te(&format!("e{}", k + 1), A)),
                link(te(&format!("w{k}"), B), te(&wa, A)),
                link(te(&wa, B), te(&format!("w{}", k + 1), A)),
            ]);
            s.signals.push(signal(
                &format!("SE{}", k + 1),
                &ea,
                148.0,
                Dir::Up,
                SignalKind::Main,
            ));
            s.signals.push(signal(
                &format!("SW{}", k + 1),
                &wa,
                2.0,
                Dir::Down,
                SignalKind::Main,
            ));
            s.stations.push(StationSpec {
                id: nm.into(),
                name: format!("{}{}", nm[..1].to_uppercase(), &nm[1..]),
                group: None,
            });
            for (n, t) in [(1, &ea), (2, &wa)] {
                s.platforms.push(PlatformSpec {
                    id: format!("{}-{n}", nm),
                    station: nm.into(),
                    label: Some(n.to_string()),
                    track: t.clone(),
                    from_m: 5.0,
                    to_m: 145.0,
                });
            }
        }
    }
    // East terminal and sidings.
    s.tracks.extend([
        track("ep1", 160.0, 40.0, Both),
        track("ep2", 160.0, 40.0, Both),
        track("exo", 60.0, 40.0, Both),
        track("em1a", 100.0, 60.0, Both),
        track("em2a", 60.0, 60.0, Both),
        track("em2c", 60.0, 60.0, Both),
        track("exo2", 60.0, 40.0, Both),
        track("esl", 80.0, 25.0, Both),
        storage("es1", 400.0),
        storage("es2", 400.0),
    ]);
    s.nodes.extend([
        switch("esc", te("e3", B), te("em1a", A), te("exo2", A)),
        switch("esa", te("ep1", A), te("em1a", B), te("exo", B)),
        switch("esb", te("em2c", B), te("ep2", A), te("exo", A)),
        switch("edep", te("em2c", A), te("em2a", B), te("esl", B)),
        switch("esd", te("em2a", A), te("w3", B), te("exo2", B)),
        switch("ess", te("esl", A), te("es1", B), te("es2", B)),
        buffer("ep1.end", te("ep1", B)),
        buffer("ep2.end", te("ep2", B)),
        buffer("es1.end", te("es1", A)),
        buffer("es2.end", te("es2", A)),
    ]);
    s.signals.extend([
        signal("S_WP1", "wp1", 155.0, Dir::Up, SignalKind::Main),
        signal("S_WP2", "wp2", 155.0, Dir::Up, SignalKind::Main),
        signal("H_W", "w0", 0.0, Dir::Down, SignalKind::Main),
        signal("H_E", "e3", 800.0, Dir::Up, SignalKind::Main),
        signal("S_EP1", "ep1", 5.0, Dir::Down, SignalKind::Main),
        signal("S_EP2", "ep2", 5.0, Dir::Down, SignalKind::Main),
        signal("SD1", "wd1", 0.0, Dir::Down, SignalKind::Shunting),
        signal("SD2", "wd2", 0.0, Dir::Down, SignalKind::Shunting),
        signal("SD3", "wd3", 0.0, Dir::Down, SignalKind::Shunting),
        signal("SS1", "es1", 400.0, Dir::Up, SignalKind::Shunting),
        signal("SS2", "es2", 400.0, Dir::Up, SignalKind::Shunting),
    ]);
    for (id, name, p1, p2) in [
        ("westpark", "Westpark", "wp1", "wp2"),
        ("eastgate", "Eastgate", "ep1", "ep2"),
    ] {
        s.stations.push(StationSpec {
            id: id.into(),
            name: name.into(),
            group: None,
        });
        for (n, t) in [(1, p1), (2, p2)] {
            s.platforms.push(PlatformSpec {
                id: format!("{id}-{n}"),
                station: id.into(),
                label: Some(n.to_string()),
                track: t.into(),
                from_m: 10.0,
                to_m: 150.0,
            });
        }
    }
    s
}
