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
